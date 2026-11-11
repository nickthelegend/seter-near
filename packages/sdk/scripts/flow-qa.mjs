// Seter full-flow testnet check. Loads keys only through signerFor; never prints keys or view keys.
// Default is read-only. Run: node packages/sdk/scripts/flow-qa.mjs --run /absolute/public-evidence.json
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signerFor, root } from './signer.mjs';
import { call } from './tx.mjs';
import { view, viewAccount, PRICE_SOURCE, orderPlaintext, sealToEnclave, commitment, newViewKey, sealView, openView } from '../src/index.mjs';

const dep = JSON.parse(await readFile(resolve(root, 'deployments/testnet-2026-11-09.json'), 'utf8'));
const C = dep.contract_id, TOKEN = dep.token_id;
const trader = await signerFor('trader');
if (!C.endsWith('.testnet') || !TOKEN.endsWith('.testnet') || !trader.accountId.endsWith('.testnet')) throw new Error('Testnet only.');
const walletBefore = await viewAccount(trader.accountId);
const before = await view(C, 'balance_of', { account_id: trader.accountId });
console.log(JSON.stringify({ account: trader.accountId, wallet_near: Number(walletBefore.amount) / 1e24, vault: before }));
if (process.argv[2] !== '--run') process.exit(0);
const path = resolve(process.argv[3] || resolve(root, 'deployments/flow-qa-2026-11-11.json'));
try { await readFile(path); throw new Error('Evidence already exists; refusing to run twice.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const free = BigInt(walletBefore.amount) - BigInt(walletBefore.storage_usage) * 10n ** 19n;
if (free < 3n * 10n ** 23n) throw new Error('Need at least 0.3 spendable testnet NEAR; no writes sent.');
const config = await view(C, 'get_config');
const stats = await view(C, 'get_stats');
if (stats.open > config.max_open - 2) throw new Error('Need two free order slots.');
const ticker = await (await fetch(PRICE_SOURCE)).json();
const price = Number(ticker.price);
if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid live price.');
const record = { network: 'testnet', contract: C, token: TOKEN, account: trader.accountId, at: new Date().toISOString(), wallet_before: walletBefore.amount, vault_before: before, spend_cap_near: '0.3', steps: [] };
let attached = 0n;
const save = () => writeFile(path, JSON.stringify(record, null, 2) + '\n');
await save();
async function send(receiver, method, args, deposit = 0n, gas = 100_000_000_000_000n) {
  attached += deposit;
  if (attached > 12n * 10n ** 22n) throw new Error('Attachment budget exceeded; no further writes.');
  const step = await call(trader, receiver, method, args, { deposit, gas, step: method });
  record.steps.push(step); await save();
  if (!step.ok) throw new Error(`${method} failed; see public evidence. Do not repeat this run.`);
  return step;
}
await send(C, 'deposit_near', {}, 3n * 10n ** 22n, 30_000_000_000_000n);
await send(TOKEN, 'faucet', {}, 10n ** 22n, 30_000_000_000_000n);
await send(TOKEN, 'ft_transfer_call', { receiver_id: C, amount: '1000000', msg: 'deposit' }, 1n);
const viewKey = newViewKey();
const ids = [];
for (const [cond, multiplier] of [['lte', 1.15], ['gte', 2]]) {
  const plaintext = orderPlaintext({ cond, triggerUsd: (price * multiplier).toFixed(4), side: 'sell', amount: '10000000000000000000000' });
  const args = { ct: sealToEnclave(config.tee.order_pub, trader.accountId, plaintext), commit: commitment(trader.accountId, plaintext), view_ct: sealView(viewKey, trader.accountId, plaintext) };
  if (openView(viewKey, trader.accountId, args.view_ct) !== plaintext) throw new Error('Device view copy failed.');
  ids.push(JSON.parse((await send(C, 'place_order', args, 2n * 10n ** 22n, 50_000_000_000_000n)).return));
}
record.order_ids = ids; record.owner_view_round_trip = true; await save();
await send(C, 'check', {}, 2n * 10n ** 22n, 300_000_000_000_000n);
record.checked_orders = await Promise.all(ids.map(id => view(C, 'get_order', { id })));
await save();
if (record.checked_orders[0].status !== 'Fired') throw new Error('Expected crossed stop did not fill; inspect check result.');
if (record.checked_orders[1].status !== 'Open') throw new Error('Expected distant take-profit to stay open.');
await send(C, 'cancel_order', { id: ids[1] }, 0n, 30_000_000_000_000n);
const credited = await view(C, 'balance_of', { account_id: trader.accountId });
const nearDelta = BigInt(credited.near) - BigInt(before.near), usdDelta = BigInt(credited.usd) - BigInt(before.usd);
if (nearDelta > 0n) await send(C, 'withdraw_near', { amount: String(nearDelta) }, 0n, 30_000_000_000_000n);
if (usdDelta > 0n) await send(C, 'withdraw_usd', { amount: String(usdDelta) }, 0n, 60_000_000_000_000n);
record.orders_after = await Promise.all(ids.map(id => view(C, 'get_order', { id })));
record.vault_after = await view(C, 'balance_of', { account_id: trader.accountId });
record.wallet_after = (await viewAccount(trader.accountId)).amount;
record.wallet_debit_yocto = String(BigInt(record.wallet_before) - BigInt(record.wallet_after));
record.restored_vault = record.vault_after.near === before.near && record.vault_after.usd === before.usd;
record.within_cap = BigInt(record.wallet_debit_yocto) <= 3n * 10n ** 23n;
await save();
if (!record.restored_vault || !record.within_cap) throw new Error('Final vault/budget invariant failed; see public record.');
console.log(JSON.stringify({ result: 'PASS', order_ids: ids, vault_restored: true, wallet_debit_near: Number(record.wallet_debit_yocto) / 1e24 }));
