// Real browser QA. Signing credentials are read in Node and injected into Chrome memory only.
// No traces, HAR, video, persistent browser profile or credential copies are written.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { loadCredentials } from '../packages/sdk/scripts/signer.mjs';
import { view, viewAccount, rpc, PRICE_SOURCE } from '../packages/sdk/src/index.mjs';

const root = resolve(import.meta.dirname, '..');
const date = new Date().toISOString().slice(0, 10);
const scratch = '/private/tmp/claude-501/-Volumes-Extreme-SSD-Projects-grokbot/0f121b7c-0081-4ec0-81a9-0ccb4f7f8b48/scratchpad';
const dir = resolve(process.env.QA_SCREENSHOTS || join(scratch, 'flow-qa/mienai/qa-signer'));
const output = resolve(process.env.QA_EVIDENCE || join(root, `deployments/qa-browser-${date}.json`));
const resume = process.argv.includes('--resume');
const { withChromeLock } = await import(process.env.CHROME_LOCK_PATH || join(scratch, 'chrome-lock.mjs'));
const dep = JSON.parse(readFileSync(join(root, 'deployments/testnet-2026-11-09.json')));
const C = dep.contract_id, TOKEN = dep.token_id;
const rpcUrl = process.env.QA_TESTNET_RPC || 'https://test.rpc.fastnear.com';
const allowedRpcs = ['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org', 'https://near-testnet.drpc.org'];
assert(allowedRpcs.includes(rpcUrl), 'Refusing a non-testnet RPC.');
assert(C.endsWith('.testnet') && TOKEN.endsWith('.testnet'), 'Testnet contracts only.');
if (existsSync(output) && !resume) throw new Error('Evidence already exists. Refusing another spend. Use --resume only for an interrupted run.');
mkdirSync(dir, { recursive: true });
const buildDir = join(dir, 'build');
const log = (s) => console.log(s); // Only public progress, never browser console arguments or injected values.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function memoryCheck() {
  const readFree = () => Number(execFileSync('sysctl', ['vm.swapusage'], { encoding: 'utf8' }).match(/free = ([\d.]+)M/)?.[1] || 0);
  let free = readFree(); log(`Swap free: ${free} MB`);
  if (free >= 500) return;
  for (let i = 0; i < 4; i++) await pause(30_000);
  free = readFree(); log(`Swap free after two minutes: ${free} MB`);
  assert(free >= 500, 'Swap remains below 500 MB; no build started.');
}
function command(args, name, env = {}) {
  const result = spawnSync('pnpm', args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  writeFileSync(join(dir, name), result.stdout + result.stderr);
  assert.equal(result.status, 0, `${name} failed; see its public build log.`);
}
function files(path) { return readdirSync(path, { withFileTypes: true }).flatMap((p) => p.isDirectory() ? files(join(path, p.name)) : [join(path, p.name)]); }
await memoryCheck();
command(['build'], 'production-build.log', { VITE_QA_SIGNER: '1' });
const markers = ['qa-signer', 'SETER_QA_SIGNER_TESTNET_ONLY', '__SETER_QA_SIGNER__', 'QA signer'];
for (const file of files(join(root, 'packages/web/dist'))) {
  const text = readFileSync(file, 'utf8');
  assert(!markers.some((m) => file.includes(m) || text.includes(m)), 'QA signer leaked into a normal production artifact.');
}
log('PASS: normal production bundle excludes the QA signer module and markers.');
await memoryCheck();
command(['--filter', '@mienai/web', 'exec', 'vite', 'build', '--mode', 'qa', '--outDir', buildDir], 'qa-build.log', { VITE_QA_SIGNER: '1' });
assert(files(buildDir).some((f) => f.includes('qa-signer') && readFileSync(f, 'utf8').includes('SETER_QA_SIGNER_TESTNET_ONLY')), 'QA build flag did not enable the signer.');

// This is the only credential read. It remains in Node/Chrome RAM, never in evidence or logs.
const credentials = await loadCredentials('trader');
const account = credentials.account_id;
assert(/^[a-z0-9._-]+\.testnet$/.test(account), 'Refusing a non-testnet signer account.');
const prior = JSON.parse(readFileSync(join(root, 'deployments/flow-qa-2026-11-11.json')));
assert.equal(account, prior.account, 'Use only this project’s existing funded demo trader.');
let previousSpend = BigInt(prior.wallet_debit_yocto || '0');
for (const name of readdirSync(join(root, 'deployments')).filter((f) => /^qa-browser-.*\.json$/.test(f))) {
  const file = join(root, 'deployments', name);
  if (resolve(file) === output) continue;
  const earlier = JSON.parse(readFileSync(file));
  if (earlier.account !== account) continue;
  assert(earlier.browser_spend_yocto !== undefined, 'Another browser QA ledger is incomplete. Resolve it before another spend.');
  previousSpend += BigInt(earlier.browser_spend_yocto);
}
const repoCap = 300_000_000_000_000_000_000_000n;
const budget = repoCap - previousSpend;
assert(budget >= 120_000_000_000_000_000_000_000n, 'Less than 0.12 NEAR remains in the combined QA budget; no writes.');
const beforeWallet = await viewAccount(account, rpcUrl);
const spendable = BigInt(beforeWallet.amount) - BigInt(beforeWallet.storage_usage) * 10n ** 19n;
assert(spendable >= repoCap, 'Demo trader has less than 0.3 spendable testnet NEAR; no writes.');
const initialVault = await view(C, 'balance_of', { account_id: account }, rpcUrl);
const stats = await view(C, 'get_stats', {}, rpcUrl);
assert(stats.open <= 14, 'Need two free sealed-order slots; no writes.');
let record = resume ? JSON.parse(readFileSync(output)) : {
  network: 'testnet', at: new Date().toISOString(), contract: C, token: TOKEN, account,
  wallet_before: beforeWallet.amount, vault_before: initialVault,
  prior_qa_spend_yocto: previousSpend.toString(), combined_spend_cap_near: '0.3',
  production_excludes_qa_signer: true, signer: 'QA signer (real browser transactions)',
  status: 'in_progress', steps: [], screenshots: [], checks: [],
};
assert.equal(record.account, account);
assert.notEqual(record.status, 'PASS', 'This completed run must not spend again.');
if (resume && record.intent && !record.steps.some((s) => s.label === record.intent && s.final)) throw new Error('Previous transaction outcome is uncertain. Inspect the chain before resuming; no writes.');
if (resume) record.status = 'in_progress';
const save = () => writeFileSync(output, JSON.stringify(record, null, 2) + '\n');
save();
log(`Preflight passed for ${account}; public evidence: ${output}`);
let preview;
async function freePort() {
  for (let port = 5380; port < 6000; port++) {
    const server = createServer();
    const free = await new Promise((r) => server.once('error', () => r(false)).listen(port, '127.0.0.1', () => server.close(() => r(true))));
    if (free) return port;
  }
  throw new Error('No free QA port in 5380–5999.');
}
try {
  const port = await freePort();
  // lsof documents that the chosen port is free; Vite strictPort also rejects races.
  const occupied = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  assert.equal(occupied.status, 1, 'Selected preview port became occupied.');
  preview = spawn(process.execPath, [join(root, 'packages/web/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', buildDir], { cwd: join(root, 'packages/web'), stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) { try { if ((await fetch(url)).ok) break; } catch {} if (i > 100) throw new Error('QA preview failed to start.'); await pause(100); }
  await withChromeLock(async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      // Refusal cases exercise the actual adapter, with no usable signing key and no transaction.
      for (const invalid of [{ accountId: 'mainnet-account.near', rpcUrl }, { accountId: account, rpcUrl: 'https://rpc.mainnet.near.org' }]) {
        const context = await browser.newContext();
        const p = await context.newPage();
        await p.addInitScript((value) => { window.__SETER_QA_SIGNER__ = { ...value, secretKey: '' }; }, invalid);
        await p.goto(url + '/app');
        await p.getByRole('alert').filter({ hasText: 'QA signer unavailable' }).waitFor();
        await context.close();
      }
      record.checks.push('Non-testnet account and mainnet RPC refused before signing.'); save();
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const pageErrors = [], failures = [];
      let dropResponse = process.env.QA_DROP_SEND_RESPONSE === '1';
      if (dropResponse) await page.route('**/*', async (route) => {
        let data; try { data = route.request().postDataJSON(); } catch {}
        if (dropResponse && data?.method === 'send_tx') {
          assert(record.steps.some((s) => s.label === record.intent && s.tx && !s.final), 'Hash must be saved before broadcast.');
          dropResponse = false;
          await route.fetch(); // Real broadcast accepted; deliberately discard only its response.
          record.dropped_send_response = { label: record.intent, expected_failed_request: true }; save();
          return route.abort('failed');
        }
        return route.continue();
      });
      page.on('pageerror', () => pageErrors.push('Unhandled page exception (message omitted to protect injected credentials).'));
      page.on('requestfailed', (r) => failures.push({ url: r.url().split('?')[0], error: r.failure()?.errorText }));
      // Persist public hashes immediately, including an outcome received before FINAL polling finishes.
      await page.exposeBinding('__qaPublicOutcome', (_source, detail) => {
        const r = detail.result, tx = detail.tx || r.transaction.hash;
        const step = { label: record.steps.find((s) => s.tx === tx)?.label || record.intent, method: detail.method, receiver: detail.receiver, deposit: detail.deposit,
          tx, explorer: `https://testnet.nearblocks.io/txns/${tx}`, at: new Date().toISOString(), final: detail.final,
          ok: r ? !r.status.Failure : null, return: r?.status.SuccessValue === undefined ? null : Buffer.from(r.status.SuccessValue, 'base64').toString(),
          failure: r?.status.Failure || null, rejection: detail.rejection, logs: r?.receipts_outcome.flatMap((x) => x.outcome.logs) || [] };
        const index = record.steps.findIndex((s) => s.tx === tx);
        if (index < 0) record.steps.push(step); else record.steps[index] = step;
        save();
      });
      const publicReceipts = record.steps.filter((s) => s.final && s.ok).map((s) => {
        const r = { tx: s.tx, at: s.at, method: s.method, signer: account, receiver: s.receiver };
        if (s.method === 'place_order') r.order = JSON.parse(s.return);
        if (s.method === 'cancel_order' && record.order_ids) r.order = record.order_ids.take_profit;
        for (const line of s.logs) if (line.startsWith('EVENT_JSON:')) { const e = JSON.parse(line.slice(11)); if (e.event === 'enclave_request') r.request = e.data[0].request; }
        return r;
      });
      await page.addInitScript(({ input, receipts, contract }) => {
        window.__SETER_QA_SIGNER__ = input;
        localStorage.setItem(`seter:receipts:testnet:${contract}`, JSON.stringify(receipts));
      }, { input: { accountId: account, secretKey: credentials.secret_key, rpcUrl, budgetYocto: budget.toString() }, receipts: publicReceipts, contract: C });
      async function snap(id, selector) {
        for (const width of [1440, 375]) {
          await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
          if (selector) await page.locator(selector).first().scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, bad: /\b(?:NaN|undefined)\b|TypeError|ReferenceError/.test(document.body.innerText) }));
          assert(dimensions.scroll <= dimensions.width, `${id}: horizontal overflow at ${width}`);
          assert(!dimensions.bad, `${id}: invalid text at ${width}`);
          const path = join(dir, `${id}-${width}.png`);
          await page.screenshot({ path }); record.screenshots.push({ id, width, path }); save();
        }
        await page.setViewportSize({ width: 1440, height: 900 });
      }
      async function perform(label, action) {
        const found = record.steps.find((s) => s.label === label);
        if (found) { assert(found.final && found.ok, `${label}: recorded failure or incomplete finality; no repeat.`); return found; }
        const wallet = await viewAccount(account, rpcUrl);
        assert(previousSpend + BigInt(record.wallet_before) - BigInt(wallet.amount) < repoCap - 30_000_000_000_000_000_000_000n, 'Combined QA cap is nearly exhausted; no writes.');
        record.intent = label; save();
        await action();
        const deadline = Date.now() + 330_000;
        let step;
        while (!(step = record.steps.find((s) => s.label === label && s.final))) {
          const visibleErrors = await page.locator('.sheet-err:visible, [role=alert]:visible').allTextContents();
          const rejected = visibleErrors.find((text) => /QA transaction (rejected|.*still pending)|QA signer.*budget|QA signer balance/.test(text));
          if (rejected) throw new Error(`${label}: ${rejected}`);
          if (Date.now() > deadline) throw new Error(`${label}: no FINAL result. Inspect saved hashes before retrying.`);
          await page.waitForTimeout(300);
        }
        assert(step.ok, `${label}: transaction failed; see public evidence.`);
        // Wallet receipt handling and transaction-triggered refresh run after the outcome event.
        await page.waitForFunction((tx) => Object.keys(localStorage).filter((k) => k.startsWith('seter:receipts:')).some((k) => JSON.parse(localStorage.getItem(k) || '[]').some((r) => r.tx === tx)), step.tx);
        record.intent = null; save(); log(`PASS ${label}: ${step.tx}`); return step;
      }
      async function vault(mode, asset, amount) {
        if (!await page.getByRole('dialog', { name: 'Vault', exact: true }).count()) await page.getByRole('button', { name: 'Vault', exact: true }).click();
        await page.getByRole('tab', { name: mode, exact: true }).click();
        await page.getByLabel('Asset', { exact: true }).selectOption(asset);
        await page.getByLabel('Amount', { exact: true }).fill(amount);
      }
      async function expectVault(balance) {
        const near = amountFromUnits(balance.near, 24).slice(0, amountFromUnits(balance.near, 24).indexOf('.') + 5);
        const usd = (Number(balance.usd) / 1e6).toFixed(4);
        await page.waitForFunction(({ near, usd }) => {
          const values = [...document.querySelectorAll('.sheet .receipt dd')].map((e) => e.textContent);
          return values[0] === near && values[1] === usd;
        }, { near, usd });
      }
      async function closeVault() { await page.getByRole('button', { name: 'Close', exact: true }).click(); }
      const amountFromUnits = (v, decimals) => { const n = BigInt(v), base = 10n ** BigInt(decimals); return `${n / base}.${(n % base).toString().padStart(decimals, '0')}`; };
      await page.goto(url + '/'); await page.locator('.trust').waitFor(); await snap('landing');
      await page.getByRole('link', { name: 'Launch app', exact: true }).first().click();
      await page.locator('.ahead').getByRole('button', { name: 'Connect wallet', exact: true }).click();
      await page.getByRole('button', { name: 'Vault', exact: true }).waitFor(); await snap('connected');
      const completed = (label) => record.steps.some((s) => s.label === label && s.final && s.ok);
      if (!completed('deposit-near')) {
      await vault('Deposit', 'NEAR', '0.03');
      await perform('deposit-near', () => page.locator('.sheet .btn-primary').click());
      await page.getByRole('button', { name: 'Deposit complete', exact: true }).waitFor();
      await expectVault({ near: String(BigInt(record.vault_before.near) + 30_000_000_000_000_000_000_000n), usd: record.vault_before.usd });
      await snap('near-deposited', '.sheet'); await closeVault();
      }
      const tokenBalance = BigInt(await view(TOKEN, 'ft_balance_of', { account_id: account }, rpcUrl));
      if (tokenBalance < 100_000n) {
        await vault('Deposit', 'tUSD', '0.1');
        await perform('faucet', () => page.getByRole('button', { name: 'Take 1,000 from the faucet', exact: true }).click());
        await snap('faucet', '.sheet'); await closeVault();
      } else { record.faucet = 'Existing demo account already funded with tUSD; no new faucet claim needed.'; save(); }
      if (!completed('deposit-tusd')) {
      await vault('Deposit', 'tUSD', '0.1');
      await perform('deposit-tusd', () => page.locator('.sheet .btn-primary').click());
      await page.getByRole('button', { name: 'Deposit complete', exact: true }).waitFor(); await expectVault({ near: String(BigInt(record.vault_before.near) + 30_000_000_000_000_000_000_000n), usd: String(BigInt(record.vault_before.usd) + 100_000n) }); await snap('tusd-deposited', '.sheet'); await closeVault();
      }
      const ticker = await (await fetch(PRICE_SOURCE)).json();
      const price = Number(ticker.price); assert(Number.isFinite(price) && price > 0);
      async function place(kind, multiplier, label) {
        if (completed(label)) return JSON.parse(record.steps.find((s) => s.label === label).return);
        await page.getByRole('tab', { name: kind, exact: true }).click();
        await page.getByRole('textbox', { name: 'Trigger price in USD per NEAR' }).fill((price * multiplier).toFixed(4));
        await page.getByRole('textbox', { name: 'Amount of NEAR to sell' }).fill('0.01');
        const step = await perform(label, () => page.getByRole('button', { name: kind === 'Sealed stop' ? 'Seal stop order' : 'Seal take-profit order', exact: true }).click());
        const id = JSON.parse(step.return); assert(Number.isSafeInteger(id));
        const row = page.locator('.bottom tbody tr').filter({ hasText: `№${id}` });
        await row.waitFor(); assert.match(await row.innerText(), /only you/, 'Owner trigger must decrypt from the browser view copy.');
        await snap(label, '.bottom'); return id;
      }
      const stop = await place('Sealed stop', 1.15, 'sealed-stop');
      const tp = await place('Sealed take-profit', 2, 'sealed-take-profit');
      record.order_ids = { stop, take_profit: tp }; save();
      if (!record.screenshots.some((s) => s.id === 'armed-order')) {
      await page.locator('.bottom tbody tr').filter({ hasText: `№${tp}` }).getByRole('link', { name: 'View', exact: true }).click();
      await page.getByRole('heading', { name: `Order №${tp}`, exact: true }).waitFor();
      assert.match(await page.locator('.osum-grid').innerText(), /only you/); await snap('armed-order', '.order-hero');
      await page.getByRole('link', { name: 'Trade', exact: true }).first().click();
      }
      await perform('enclave-check', () => page.getByRole('button', { name: 'Pay for a check · 0.02 NEAR', exact: true }).click());
      await page.getByRole('tab', { name: /^Order history/ }).click();
      const firedRow = page.locator('.bottom tbody tr').filter({ hasText: `№${stop}` });
      await firedRow.getByText('Fired', { exact: true }).waitFor({ timeout: 30000 });
      await snap('stop-fired-history', '.bottom');
      await firedRow.getByRole('link', { name: 'View', exact: true }).click();
      await page.getByRole('heading', { name: `Order №${stop}`, exact: true }).waitFor();
      assert.match(await page.locator('.verdict').innerText(), /Sold/);
      const checkTx = record.steps.find((s) => s.label === 'enclave-check').tx;
      await page.locator(`a[href$="/${checkTx}"]`).first().waitFor(); await snap('fired-order-receipt', '.order-hero');
      await page.locator('.envelope').scrollIntoViewIfNeeded();
      assert(await page.locator(`a[href$="/${record.steps.find((s) => s.label === 'sealed-stop').tx}"]`).count(), 'Order placement receipt must survive route navigation.');
      await snap('fired-order-chain-record', '.envelope');
      await page.getByRole('link', { name: 'Trade', exact: true }).first().click();
      const cancelRow = page.locator('.bottom tbody tr').filter({ hasText: `№${tp}` });
      await perform('cancel-take-profit', () => cancelRow.getByRole('button', { name: 'Cancel', exact: true }).click());
      await page.getByRole('tab', { name: /^Order history/ }).click();
      await page.locator('.bottom tbody tr').filter({ hasText: `№${tp}` }).getByText('Cancelled', { exact: true }).waitFor();
      await snap('cancelled-history', '.bottom');
      const current = await view(C, 'balance_of', { account_id: account }, rpcUrl);
      const nearDelta = BigInt(current.near) - BigInt(record.vault_before.near);
      const usdDelta = BigInt(current.usd) - BigInt(record.vault_before.usd);
      assert((completed('withdraw-near') || nearDelta > 0n) && (completed('withdraw-tusd') || usdDelta > 0n), 'Expected credited assets for remaining withdrawal paths.');
      if (!completed('withdraw-near')) {
      await vault('Withdraw', 'NEAR', amountFromUnits(nearDelta, 24));
      await perform('withdraw-near', () => page.locator('.sheet .btn-primary').click());
      await page.getByRole('button', { name: 'Withdrawal complete', exact: true }).waitFor(); await snap('near-withdrawn', '.sheet'); await closeVault();
      }
      if (!completed('withdraw-tusd')) {
      await vault('Withdraw', 'tUSD', amountFromUnits(usdDelta, 6));
      await perform('withdraw-tusd', () => page.locator('.sheet .btn-primary').click());
      await page.getByRole('button', { name: 'Withdrawal complete', exact: true }).waitFor(); await expectVault(record.vault_before); await snap('vault-restored', '.sheet');
      }
      if (!await page.getByRole('dialog', { name: 'Vault', exact: true }).count()) await page.getByRole('button', { name: 'Vault', exact: true }).click();
      record.vault_after = await view(C, 'balance_of', { account_id: account }, rpcUrl);
      assert.deepEqual(record.vault_after, record.vault_before, 'Both vault balances must be restored.');
      await page.getByRole('button', { name: /^Sign out / }).click(); await closeVault();
      await page.locator('.ahead').getByRole('button', { name: 'Connect wallet', exact: true }).waitFor(); await snap('signed-out');
      record.orders_after = await Promise.all([stop, tp].map((id) => view(C, 'get_order', { id }, rpcUrl)));
      record.wallet_after = (await viewAccount(account, rpcUrl)).amount;
      record.browser_spend_yocto = String(BigInt(record.wallet_before) - BigInt(record.wallet_after));
      record.combined_qa_spend_yocto = String(previousSpend + BigInt(record.browser_spend_yocto));
      assert(BigInt(record.combined_qa_spend_yocto) <= repoCap, 'Combined QA spend cap exceeded.');
      record.page_errors = pageErrors; record.failed_requests = failures;
      assert.equal(pageErrors.length, 0, 'Unexpected browser exceptions.');
      record.checks.push('Browser deposits, owner-view decryption, stop execution, cancellation, receipt links, both withdrawals and vault restoration passed at 1440 and 375.');
      record.status = 'PASS'; delete record.error; record.checks = [...new Set(record.checks)]; save(); await context.close();
    } finally { await browser.close(); }
  });
} catch (e) {
  record.status = 'FAILED'; record.error = String(e.message).replace(/ed25519:[A-Za-z0-9]+/g, '[redacted]'); save();
  throw new Error(record.error);
} finally {
  credentials.secret_key = '';
  if (preview) { preview.kill('SIGTERM'); await Promise.race([new Promise((r) => preview.once('exit', r)), pause(3000)]); if (preview.exitCode === null) preview.kill('SIGKILL'); }
}
log(`PASS. Browser spend: ${Number(record.browser_spend_yocto) / 1e24} testnet NEAR. All evidence saved to ${output}`);
