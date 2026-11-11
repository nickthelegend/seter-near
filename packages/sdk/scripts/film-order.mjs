// A bounded Seter testnet film action. Keys are loaded by signerFor from a file, never printed.
// Usage: SETER_FILM_RECORD=/absolute/public-record.json node packages/sdk/scripts/film-order.mjs status|place|cancel
// One placement (0.02 NEAR storage) and one cancellation per record; no deposit, keeper run or mainnet calls.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { signerFor, root } from './signer.mjs';
import { call } from './tx.mjs';
import { view, viewAccount, PRICE_SOURCE, orderPlaintext, sealToEnclave, commitment } from '../src/index.mjs';

const action = process.argv[2];
if (!['status', 'place', 'cancel'].includes(action)) throw new Error('Use status, place or cancel. Testnet only.');
const CONTRACT = 'mienai-3013a230.testnet';
const STORAGE = 20n * 10n ** 21n;
const MIN_FREE = 100n * 10n ** 21n;
const recordPath = resolve(process.env.SETER_FILM_RECORD || resolve(root, 'deployments/film-order-2026-11-11.json'));
const trader = await signerFor('trader');
if (!trader.accountId.endsWith('.testnet')) throw new Error('Testnet trader required.');
const balance = await viewAccount(trader.accountId);
const free = BigInt(balance.amount) - BigInt(balance.storage_usage) * 10n ** 19n;
const [config, stats] = await Promise.all([view(CONTRACT, 'get_config'), view(CONTRACT, 'get_stats')]);
console.log(`Seter | NEAR testnet | ${trader.accountId}`);
console.log(`Wallet: ${(Number(balance.amount) / 1e24).toFixed(4)} NEAR | armed orders: ${stats.open}`);
let record;
try { record = JSON.parse(await readFile(recordPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (action === 'status') process.exit(0);
if (free < MIN_FREE) throw new Error('Need at least 0.10 spendable testnet NEAR; no transaction sent.');
if (action === 'place') {
  if (record) throw new Error('Record already exists; refusing another placement.');
  if (stats.open >= config.max_open) throw new Error('Book full; no transaction sent.');
  const response = await fetch(PRICE_SOURCE);
  if (!response.ok) throw new Error('Coinbase unavailable; no transaction sent.');
  const tick = await response.json();
  if (!Number.isFinite(Number(tick.price)) || Number(tick.price) <= 0) throw new Error('Invalid Coinbase price.');
  // A fresh random stop well below the current price. Neither the level nor the plaintext is recorded.
  const triggerUsd = (Number(tick.price) * randomInt(650000, 850001) / 1000000).toFixed(6);
  const plaintext = orderPlaintext({ cond: 'lte', triggerUsd, side: 'sell', amount: '10000000000000000000000' });
  const ct = sealToEnclave(config.tee.order_pub, trader.accountId, plaintext);
  const args = { ct, commit: commitment(trader.accountId, plaintext), view_ct: null };
  console.log('Sealing one small stop. Trigger stays encrypted.');
  const result = await call(trader, CONTRACT, 'place_order', args, { deposit: STORAGE, gas: 50_000_000_000_000n, step: 'place_order' });
  if (!result.ok) throw new Error('Placement failed; inspect the public transaction.');
  const id = JSON.parse(result.return);
  record = { network: 'testnet', contract: CONTRACT, account: trader.accountId, order_id: id, balance_before: balance.amount, attached_near: '0.02', place: result };
  await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
  const order = await view(CONTRACT, 'get_order', { id });
  console.log(`Order #${id}: ${order.status} | ciphertext + commitment on chain`);
  console.log('No trigger plaintext in the transaction.');
} else {
  if (!record || record.network !== 'testnet' || record.account !== trader.accountId || record.contract !== CONTRACT) throw new Error('Matching film record required.');
  if (record.cancel) throw new Error('Cancellation already recorded.');
  const order = await view(CONTRACT, 'get_order', { id: record.order_id });
  if (order.owner !== trader.accountId || order.status !== 'Open') throw new Error('Film order is not open and owned by this trader.');
  console.log(`Cancel sealed order #${record.order_id}.`);
  const result = await call(trader, CONTRACT, 'cancel_order', { id: record.order_id }, { gas: 30_000_000_000_000n, step: 'cancel_order' });
  record.cancel = result;
  record.balance_after = (await viewAccount(trader.accountId)).amount;
  await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
  if (!result.ok) throw new Error('Cancellation failed; inspect the public transaction.');
  console.log(`Order #${record.order_id}: ${(await view(CONTRACT, 'get_order', { id: record.order_id })).status}`);
  console.log('Trigger was never revealed.');
}
