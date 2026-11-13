// Deepens the vault's NEAR / tUSD test pool and moves its price back to the live Coinbase price, so fills land near
// the market. Owner-only seeding, the same two calls deploy-testnet.mjs used: seed_pool_near from the vault owner, then
// tUSD minted by the issuer and sent with msg "seed". The pool can only grow; nothing is withdrawn.
// usage: node packages/sdk/scripts/rebalance-pool.mjs <extra NEAR, default 6>
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signerFor, root } from './signer.mjs';
import { call } from './tx.mjs';
import { view, PRICE_SOURCE } from '../src/index.mjs';

const extra = Number(process.argv[2] ?? 6);
if (!(extra > 0 && extra <= 8)) throw new Error('Add between 0 and 8 NEAR.');
const out = resolve(root, `deployments/pool-rebalance-${new Date().toISOString().slice(0, 10)}.json`);
if (existsSync(out)) throw new Error(`${out} exists; one rebalance per day, inspect it first.`);
const deployer = await signerFor('deployer');
const token = await signerFor('token');
const before = await view(deployer.accountId, 'get_pool');
const ticker = await (await fetch(PRICE_SOURCE, { headers: { 'user-agent': 'seter-rebalance/0.1' } })).json();
const price = Number(ticker.price);
if (!(price > 0)) throw new Error('Coinbase price unavailable.');
const addNear = BigInt(Math.round(extra * 1e6)) * 10n ** 18n;
const nearAfter = BigInt(before.near) + addNear;
const targetUsd = (nearAfter * BigInt(Math.round(price * 1e6))) / 10n ** 24n;
const addUsd = targetUsd - BigInt(before.usd);
if (addUsd <= 0n) throw new Error('Pool already holds enough tUSD for this price; add NEAR only by hand.');
const steps = [];
const must = (s) => { steps.push(s); if (!s.ok) throw new Error(`${s.step} failed`); return s; };
must(await call(deployer, deployer.accountId, 'seed_pool_near', {}, { deposit: addNear, step: `seed pool: +${extra} NEAR` }));
must(await call(token, token.accountId, 'mint', { account_id: token.accountId, amount: String(addUsd) }, { step: 'mint pool tUSD to the issuer' }));
must(await call(token, token.accountId, 'ft_transfer_call', { receiver_id: deployer.accountId, amount: String(addUsd), msg: 'seed' }, { deposit: 1n, gas: 100_000_000_000_000n, step: `seed pool: +${Number(addUsd) / 1e6} tUSD at Coinbase ${ticker.price}` }));
const after = await view(deployer.accountId, 'get_pool');
await writeFile(out, JSON.stringify({ network: 'testnet', contract: deployer.accountId, reason: 'deepen the test pool and return its price to the live Coinbase price before filming', coinbase: { source: PRICE_SOURCE, price: ticker.price, trade_id: ticker.trade_id, time: ticker.time }, pool_before: before, pool_after: after, pool_price_before: Number(before.usd) / 1e6 / (Number(BigInt(before.near) / 10n ** 18n) / 1e6), pool_price_after: Number(after.usd) / 1e6 / (Number(BigInt(after.near) / 10n ** 18n) / 1e6), steps }, null, 2) + '\n');
console.log(`pool ${JSON.stringify(before)} -> ${JSON.stringify(after)}; record ${out}`);
