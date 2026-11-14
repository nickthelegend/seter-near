// Off-camera setup before the v5 film (14 Nov), so the "what a bot reads" view has a real book to read:
// the repo's trader tops up its vault, then places two small PUBLIC stops and two small SEALED stops at the same level,
// about 1% under the live Coinbase price. The film then places a third public stop at that level on camera.
// Testnet only; keys loaded from gitignored files and never printed. Refuses to run twice.
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { signerFor, root } from './signer.mjs';
import { call } from './tx.mjs';
import { view, PRICE_SOURCE, orderPlaintext, sealToEnclave, commitment } from '../src/index.mjs';

const C = 'mienai-3013a230.testnet';
const out = resolve(root, 'deployments/film-v5-prep-2026-11-14.json');
if (existsSync(out)) throw new Error('Prep already recorded; inspect it first.');
const trader = await signerFor('trader');
if (trader.accountId !== 'mienai-4e6b1225.testnet') throw new Error('Repo trader only.');
const tick = await (await fetch(PRICE_SOURCE)).json();
const price = Number(tick.price);
if (!(price > 0)) throw new Error('Coinbase price unavailable.');
const level = (Math.floor(price * 0.99 * 100) / 100).toFixed(2);
const rec = { network: 'testnet', contract: C, account: trader.accountId, at: new Date().toISOString(), coinbase: { price: tick.price, time: tick.time, trade_id: tick.trade_id }, level_usd: level, steps: [] };
const save = () => writeFile(out, JSON.stringify(rec, null, 2) + '\n');
const must = async (p) => { const r = await p; rec.steps.push(r); await save(); if (!r.ok) throw new Error(`${r.step} failed`); return r; };
const gas = 30_000_000_000_000n, storage = 20n * 10n ** 21n;
await must(call(trader, C, 'deposit_near', {}, { deposit: 15n * 10n ** 23n, gas, step: 'film v5 prep: trader deposits 1.5 testnet NEAR into its vault (off camera)' }));
for (const near of ['0.10', '0.15']) {
  const amount = (BigInt(Math.round(Number(near) * 100)) * 10n ** 22n).toString();
  await must(call(trader, C, 'place_public_order', { kind: 'stop', cond: 'lte', trigger_usd: level, side: 'sell', amount }, { deposit: storage, gas, step: `film v5 prep: public stop, sell ${near} NEAR at ${level} (off camera)` }));
}
const config = await view(C, 'get_config');
for (const near of ['0.10', '0.15']) {
  const amount = (BigInt(Math.round(Number(near) * 100)) * 10n ** 22n).toString();
  const pt = orderPlaintext({ cond: 'lte', triggerUsd: level, side: 'sell', amount, salt: randomBytes(16).toString('hex') });
  await must(call(trader, C, 'place_order', { ct: sealToEnclave(config.tee.order_pub, trader.accountId, pt), commit: commitment(trader.accountId, pt), view_ct: null }, { deposit: storage, gas, step: `film v5 prep: sealed stop, same level and size as a public one (sell ${near} NEAR; level not in the transaction) (off camera)` }));
}
rec.vault_after = await view(C, 'balance_of', { account_id: trader.accountId });
rec.public_orders = await view(C, 'get_public_orders', {});
await save();
console.log('level', level, 'vault', JSON.stringify(rec.vault_after), 'public', rec.public_orders.length);
