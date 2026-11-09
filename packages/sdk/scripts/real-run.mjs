// The real testnet run: a trader seals a stop-loss just below and a take-profit just above the live
// NEAR/USD price; a keeper pays for OutLayer `check()` runs until the real price crosses one of them.
// Every transaction, the fired order's public audit record and its verified TDX attestation are saved.
// Usage: node packages/sdk/scripts/real-run.mjs [band_bps=15] [max_checks=40] [interval_s=45]
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signerFor, root, loadCredentials } from './signer.mjs';
import { call } from './tx.mjs';
import { outlayerIo } from './receipts.mjs';
import { view, PRICE_SOURCE, orderPlaintext, sealToEnclave, commitment, newViewKey, sealView } from '../src/index.mjs';
import { verifyExecution } from '../src/attestation.mjs';

const [bandBps = 15, maxChecks = 40, intervalS = 45] = process.argv.slice(2).map(Number);
const dep = JSON.parse(await readFile(resolve(root, `deployments/testnet-2026-11-09.json`), 'utf8'));
const C = dep.contract_id;
const trader = await signerFor('trader');
const keeper = await signerFor('deployer');
const steps = [];
const log = (s) => { steps.push(s); return s; };
const save = () => writeFile(resolve(root, 'deployments/real-run-2026-11-09.json'), JSON.stringify({ network: 'testnet', contract: C, enclave_sha256: dep.enclave.sha256, band_bps: bandBps, steps }, null, 2) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let viewKey;
try { viewKey = (await loadCredentials('trader-view')).view_key; } catch {
  viewKey = newViewKey();
  await writeFile(resolve(root, '.near-credentials/trader-view.json'), JSON.stringify({ account_id: trader.accountId, view_key: viewKey }), { mode: 0o600 });
}

const cfg = await view(C, 'get_config');
if (!cfg.tee) throw new Error('enclave keys not set on the contract');
const before = await view(C, 'balance_of', { account_id: trader.accountId });
if (BigInt(before.near) < 8n * 10n ** 23n) log(await call(trader, C, 'deposit_near', {}, { deposit: 10n ** 24n, step: 'trader deposits 1 NEAR into the vault' }));
else log({ step: 'trader vault balance before the run (deposit tx Ciu5geSzbtyQGa1VzXS6eicJFeLiSzs7P7k2pdr47bWp)', balance: before });

const ticker = await (await fetch(PRICE_SOURCE, { headers: { 'user-agent': 'mienai-run/0.1' } })).json();
const p = Number(ticker.price);
const stopUsd = (p * (1 - bandBps / 10_000)).toFixed(4);
const tpUsd = (p * (1 + bandBps / 10_000)).toFixed(4);
const placed = [];
for (const [label, cond, trig] of [['stop-loss', 'lte', stopUsd], ['take-profit', 'gte', tpUsd]]) {
  const pt = orderPlaintext({ cond, triggerUsd: trig, side: 'sell', amount: String(4n * 10n ** 23n) });
  const s = log(await call(trader, C, 'place_order', { ct: sealToEnclave(cfg.tee.order_pub, trader.accountId, pt), commit: commitment(trader.accountId, pt), view_ct: sealView(viewKey, trader.accountId, pt) }, { deposit: 20n * 10n ** 21n, step: `trader seals a ${label} (sell 0.4 NEAR); trigger hidden on chain` }));
  s.placed_at_price = { source: PRICE_SOURCE, price: ticker.price, trade_id: ticker.trade_id, time: ticker.time };
  placed.push(JSON.parse(s.return));
}
await save();

let fired = [];
for (let i = 1; i <= maxChecks && fired.length === 0; i++) {
  const s = log(await call(keeper, C, 'check', {}, { deposit: 20n * 10n ** 21n, gas: 300_000_000_000_000n, step: `keeper check #${i} (OutLayer TEE run)` }));
  const stats = await view(C, 'get_stats');
  s.last_check = stats.last_check;
  console.log(`  check #${i}: ${s.return} price ${stats.last_check?.price_e6 / 1e6}`);
  if (stats.last_check?.fired?.length && s.return?.includes('fired') && !s.return.includes('fired 0')) {
    fired = stats.last_check.fired;
    const io = await outlayerIo(s.tx, keeper.accountId);
    s.attestation = await verifyExecution({ txHash: s.tx, input: io.input, output: io.output, wasmHash: dep.enclave.sha256 });
    s.enclave_output = io.output;
    console.log(`  attestation ok: ${s.attestation.ok}`);
  }
  await save();
  if (fired.length === 0) await sleep(intervalS * 1000);
}
if (fired.length === 0) { console.log('no crossing within the run; orders stay sealed'); process.exit(2); }

for (const id of placed.filter((id) => !fired.includes(id))) {
  log(await call(trader, C, 'cancel_order', { id }, { step: `trader cancels the other order (#${id}); its trigger stays sealed` }));
}
const audit = await view(C, 'get_fired', {});
log({ step: 'public audit of fired orders (get_fired view)', audit });
log({ step: 'trader vault balance after the fire', balance: await view(C, 'balance_of', { account_id: trader.accountId }) });
await save();
console.log('done');
