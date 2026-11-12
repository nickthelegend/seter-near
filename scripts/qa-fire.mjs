// One fresh in-app stop and one in-app keeper check. Uses the existing build-gated QA signer.
// No credential copies, persistent profile, trace, HAR or video; public evidence only.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { loadCredentials } from '../packages/sdk/scripts/signer.mjs';
import { PRICE_SOURCE } from '../packages/sdk/src/index.mjs';
const root = resolve(import.meta.dirname, '..'), date = new Date().toISOString().slice(0, 10);
const shots = resolve(root, '../../orchestration/shots/mienai/r4');
const { withChromeLock } = await import(resolve(root, '../../orchestration/chrome-lock.mjs'));
const output = resolve(root, `deployments/r4-fire-${date}.json`), resume = process.argv.includes('--resume');
const C = 'mienai-3013a230.testnet', RPCS = ['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org', 'https://rpc.testnet.near.org'];
const CAP = 30_000_000_000_000_000_000_000n, SELL = 100_000_000_000_000_000_000n; // 0.0001 NEAR from the existing vault
if (existsSync(output) && !resume) throw new Error('R4 evidence already exists. Refusing another placement.');
let record = existsSync(output) ? JSON.parse(readFileSync(output)) : null;
if (record?.status === 'PASS') throw new Error('The completed fire proof cannot be replayed.');
mkdirSync(shots, { recursive: true });
const save = () => writeFileSync(output, JSON.stringify(record, null, 2) + '\n');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function resources() {
  const disk = execFileSync('df', ['-k', '/System/Volumes/Data'], { encoding: 'utf8' }).trim().split('\n').at(-1).split(/\s+/);
  assert(Number(disk[3]) >= 5 * 1024 * 1024, 'Disk below 5 GB: stop before build/browser.');
  let free;
  do { free = Number(execFileSync('memory_pressure', { encoding: 'utf8' }).match(/free percentage: (\d+)%/)?.[1] || 0); if (free < 30) await pause(30000); } while (free < 30);
  console.log(`Resource preflight: ${free}% memory free; disk above 5 GB.`);
}
async function rpc(method, params) {
  for (const url of RPCS) {
    try {
      const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'r4-fire', method, params }) });
      if (!response.ok) continue;
      const data = await response.json(); if (data.result) return data.result;
    } catch { /* read-only fallback */ }
  }
  throw new Error(`Testnet read failed: ${method}. No transaction was retried.`);
}
const balance = (account) => rpc('query', { request_type: 'view_account', finality: 'final', account_id: account });
async function view(method, args = {}) {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: C, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (r.error) throw new Error('Contract read failed.'); return JSON.parse(Buffer.from(r.result).toString());
}
async function funds(account) {
  const b = await balance(account); assert(BigInt(b.amount) - BigInt(b.storage_usage) * 10n ** 19n >= 300_000_000_000_000_000_000_000n, 'Less than 0.3 spendable testnet NEAR; stop.'); return b;
}
await resources();
assert.equal(spawnSync(process.execPath, ['scripts/verify-host-build.mjs'], { cwd: root, stdio: 'inherit' }).status, 0);
const build = join(shots, 'qa-build');
const built = spawnSync('pnpm', ['--filter', '@mienai/web', 'exec', 'vite', 'build', '--mode', 'qa', '--outDir', build], { cwd: root, env: { ...process.env, VITE_QA_SIGNER: '1' }, encoding: 'utf8' });
writeFileSync(join(shots, 'qa-build.log'), built.stdout + built.stderr); assert.equal(built.status, 0, 'QA build failed.');
const trader = await loadCredentials('trader'), keeper = await loadCredentials('deployer');
let server, browser;
try {
  assert(trader.account_id.endsWith('.testnet') && keeper.account_id === C, 'Use only this repo’s existing testnet trader and historical keeper.');
  const [tb, kb, vault, stats] = await Promise.all([funds(trader.account_id), funds(keeper.account_id), view('balance_of', { account_id: trader.account_id }), view('get_stats')]);
  assert(BigInt(vault.near) >= SELL && stats.open < 16, 'Need an existing funded vault and one free slot; no deposit or extra order will be made.');
  record ??= { network: 'testnet', contract: C, at: new Date().toISOString(), status: 'in_progress', spend_cap_near: '0.03', trader: trader.account_id, keeper: keeper.account_id, vault_before: vault, initial_wallet_balances: { trader: tb.amount, keeper: kb.amount }, sell_yocto: String(SELL), trigger_multiplier: 1.01, production_excludes_qa_signer: true, steps: [], screenshots: [] };
  assert.equal(record.trader, trader.account_id); assert.equal(record.keeper, keeper.account_id);
  for (const step of record.steps) if (!step.final) {
    const result = await rpc('tx', { tx_hash: step.tx, sender_account_id: step.account, wait_until: 'FINAL' });
    assert(result.final_execution_status === 'FINAL', 'Resolve the saved hash before resuming.');
    step.final = true; step.ok = !result.status.Failure; step.return = result.status.SuccessValue === undefined ? null : Buffer.from(result.status.SuccessValue, 'base64').toString();
    step.logs = result.receipts_outcome.flatMap((r) => r.outcome.logs);
    step.balance_after = (await balance(step.account)).amount;
    step.wallet_debit_yocto = String(BigInt(step.balance_before) - BigInt(step.balance_after));
  }
  save();
  let port;
  for (let n = 5411; n < 6000; n++) { const s = createServer(); if (await new Promise((r) => s.once('error', () => r(false)).listen(n, '127.0.0.1', () => s.close(() => r(true))))) { port = n; break; } }
  assert(port); assert.equal(spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).status, 1);
  server = spawn(process.execPath, [resolve(root, 'packages/web/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', build], { cwd: resolve(root, 'packages/web'), stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`, expected = readFileSync(join(build, 'index.html'), 'utf8');
  for (let i = 0; ; i++) { try { if (await (await fetch(url)).text() === expected) break; } catch {} assert(i < 100, 'Expected QA preview did not start.'); await pause(100); }
  await withChromeLock(async () => {
    await resources(); browser = await chromium.launch({ channel: 'chrome' });
    try {
      const errors = [];
      async function pageFor(role, credentials) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await context.newPage();
        p.on('pageerror', () => errors.push('Unhandled page exception; message omitted to protect injected credentials.'));
        await p.exposeBinding('__qaPublicOutcome', async (_source, detail) => {
          const label = role === 'trader' ? 'seal-stop' : 'check';
          assert(detail.receiver === C && detail.method === (role === 'trader' ? 'place_order' : 'check') && detail.deposit === '20000000000000000000000', 'Only the two intended app calls are permitted.');
          let step = record.steps.find((s) => s.tx === detail.tx);
          if (!step) { assert(!record.steps.some((s) => s.label === label), 'Refusing a second placement or paid check.'); step = { label, account: credentials.account_id, tx: detail.tx, explorer: `https://testnet.nearblocks.io/txns/${detail.tx}`, method: detail.method, deposit: detail.deposit, balance_before: record.current_balance_before, at: new Date().toISOString() }; record.steps.push(step); }
          const r = detail.result;
          Object.assign(step, { final: detail.final, rejection: detail.rejection, ok: r ? !r.status.Failure : null });
          if (r) { step.return = r.status.SuccessValue === undefined ? null : Buffer.from(r.status.SuccessValue, 'base64').toString(); step.logs = r.receipts_outcome.flatMap((x) => x.outcome.logs); step.balance_after = (await balance(credentials.account_id)).amount; step.wallet_debit_yocto = String(BigInt(step.balance_before) - BigInt(step.balance_after)); }
          save();
        });
        await p.addInitScript((input) => { window.__SETER_QA_SIGNER__ = input; }, { accountId: credentials.account_id, secretKey: credentials.secret_key, rpcUrl: RPCS[0], budgetYocto: String(CAP) });
        await p.goto(url + '/app'); await p.locator('.ahead').getByRole('button', { name: 'Connect wallet', exact: true }).click();
        await p.getByRole('button', { name: 'Vault', exact: true }).waitFor();
        await p.waitForFunction(() => !document.querySelector('.form .frow')?.textContent?.includes('…'));
        return { context, p };
      }
      async function snap(p, id, selector) {
        for (const width of [1440, 375]) {
          await p.setViewportSize({ width, height: width === 1440 ? 900 : 812 }); if (selector) await p.locator(selector).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(250);
          assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && !/\b(?:NaN|undefined)\b/.test(document.body.innerText)), `${id}: overflow/raw error.`);
          const file = `${id}-${width}.png`; await p.screenshot({ path: join(shots, file) }); record.screenshots.push({ id, width, file }); save();
        } await p.setViewportSize({ width: 1440, height: 900 });
      }
      async function perform(p, label, account, action) {
        const old = record.steps.find((s) => s.label === label); if (old) { assert(old.final && old.ok && !old.rejection, 'Saved attempt must be FINAL; never repeat it.'); return old; }
        const spent = record.steps.reduce((n, s) => n + BigInt(s.wallet_debit_yocto || '0'), 0n);
        // R3's current upfront compute quote plus a gas allowance, with the sold asset counted too.
        if (label === 'check') { const quote = JSON.parse(readFileSync(resolve(root, 'deployments/r3-2026-11-12.json'))).diagnosis.required_payment_yocto; assert(spent + SELL + BigInt(quote) + 2_000_000_000_000_000_000_000n <= CAP, 'Remaining total budget is insufficient for the check.'); assert(BigInt((await rpc('gas_price', [null])).gas_price) <= 100_000_000n, 'Gas price rose; stop before another write.'); }
        record.current_balance_before = (await funds(account)).amount; save(); await action();
        const deadline = Date.now() + 330_000;
        while (!record.steps.find((s) => s.label === label && s.final)) {
          const messages = await p.locator('.sheet-err:visible, [role=alert]:visible').allTextContents(); assert(!messages.length, `${label}: app reported an error.`);
          assert(Date.now() < deadline, `${label}: finality uncertain; inspect the saved hash, do not resend.`); await pause(300);
        }
        const step = record.steps.find((s) => s.label === label); assert(step.ok, 'Transaction failed.');
        await p.waitForFunction((tx) => Object.keys(localStorage).filter((k) => k.startsWith('seter:receipts:')).some((k) => JSON.parse(localStorage.getItem(k) || '[]').some((r) => r.tx === tx)), step.tx);
        console.log(`FINAL ${label}: ${step.tx}`); return step;
      }
      let trading;
      if (!record.steps.some((s) => s.label === 'seal-stop')) {
        trading = await pageFor('trader', trader); const p = trading.p;
        const price = await (await fetch(PRICE_SOURCE)).json(); assert(Number(price.price) > 0);
        record.placement_quote = { price: price.price, time: price.time, trade_id: price.trade_id }; record.trigger_usd = (Number(price.price) * 1.01).toFixed(4); save();
        await p.getByRole('tab', { name: 'Sealed stop', exact: true }).click();
        await p.getByRole('textbox', { name: 'Trigger price in USD per NEAR' }).fill(record.trigger_usd);
        await p.getByRole('textbox', { name: 'Amount of NEAR to sell' }).fill('0.0001'); await snap(p, 'configured', '.otabs');
        const sealed = await perform(p, 'seal-stop', trader.account_id, () => p.getByRole('button', { name: 'Seal stop order', exact: true }).click());
        record.order_id = JSON.parse(sealed.return); save();
        const row = p.locator('.bottom tbody tr').filter({ hasText: `№${record.order_id}` }); await row.waitFor(); assert.match(await row.innerText(), /only you/);
        await row.getByRole('link', { name: 'View', exact: true }).click(); await p.getByRole('heading', { name: `Order №${record.order_id}`, exact: true }).waitFor(); await snap(p, 'armed', '.order-hero');
        await trading.context.close();
      } else record.order_id ??= JSON.parse(record.steps.find((s) => s.label === 'seal-stop').return);
      const checking = await pageFor('keeper', keeper); const p = checking.p;
      await snap(p, 'keeper-ready', '.enclave-box');
      const checked = await perform(p, 'check', keeper.account_id, () => p.getByRole('button', { name: 'Pay for a check · 0.02 NEAR', exact: true }).click());
      const event = checked.logs.filter((s) => s.startsWith('EVENT_JSON:')).map((s) => JSON.parse(s.slice(11))).find((e) => e.event === 'enclave_request');
      record.request = await view('get_request', { id: event.data[0].request }); record.order_after = await view('get_order', { id: record.order_id }); record.vault_after = await view('balance_of', { account_id: trader.account_id }); save();
      assert(record.request.status === 'Done' && record.order_after.status === 'Fired' && BigInt(record.order_after.fire.filled_in) === SELL, 'Fresh stop did not fill; no second order/check will be sent.');
      // Persist only real public receipt metadata across the trader/keeper browser contexts.
      await p.evaluate(({ contract, receipts }) => { localStorage.setItem(`seter:receipts:testnet:${contract}`, JSON.stringify(receipts)); }, { contract: C, receipts: record.steps.map((s) => ({ tx: s.tx, at: s.at, signer: s.account, receiver: C, method: s.method, ...(s.label === 'seal-stop' ? { order: record.order_id } : { request: record.request.id }) })) });
      await p.goto(url + '/order/' + record.order_id); await p.getByRole('heading', { name: `Order №${record.order_id}`, exact: true }).waitFor();
      await p.locator('.st-fired').waitFor(); assert.match(await p.locator('.osum-grid').innerText(), /0\.0001/); await snap(p, 'fired', '.order-hero');
      assert(await p.locator(`a[href$="/${checked.tx}"]`).count(), 'Check receipt is missing.'); await snap(p, 'receipts', '.envelope');
      await p.reload(); await p.locator('.st-fired').waitFor(); await snap(p, 'fired-refreshed', '.order-hero');
      record.wallet_debit_yocto = String(record.steps.reduce((n, s) => n + BigInt(s.wallet_debit_yocto), 0n));
      record.conservative_spend_yocto = String(BigInt(record.wallet_debit_yocto) + SELL); assert(BigInt(record.conservative_spend_yocto) <= CAP, 'Total spend exceeded 0.03 NEAR.');
      record.page_errors = errors; assert(!errors.length, 'Unexpected page exception.'); record.status = 'PASS'; delete record.error; delete record.current_balance_before; save();
      await checking.context.close();
    } finally { await browser.close(); }
  });
} catch (error) {
  if (record) { record.status = 'FAILED'; record.error = String(error.message).replace(/ed25519:[A-Za-z0-9]+/g, '[redacted]'); save(); }
  throw new Error(record?.error || 'R4 browser proof failed before sending.');
} finally {
  trader.secret_key = ''; keeper.secret_key = '';
  if (server) { server.kill('SIGTERM'); await new Promise((r) => server.once('exit', r)); }
}
console.log(`PASS order ${record.order_id} Fired. Wallet debit ${Number(record.wallet_debit_yocto) / 1e24} NEAR; including sold asset ${Number(record.conservative_spend_yocto) / 1e24} NEAR.`);
