// One paid refresh of OutLayer's price oracle (price-oracle.testnet) from the trader account, to prove
// request_price_data works on testnet before Seter depends on it. Testnet only; keys never printed.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signerFor, root } from './signer.mjs';
import { call } from './tx.mjs';
import { view } from '../src/index.mjs';

const ORACLE = 'price-oracle.testnet';
const trader = await signerFor('trader');
if (!trader.accountId.endsWith('.testnet')) throw new Error('Testnet trader required.');
const before = await view(ORACLE, 'get_price_data', { asset_ids: ['wrap.near'] });
const coinbase = await (await fetch('https://api.exchange.coinbase.com/products/NEAR-USD/ticker')).json();
const r = await call(trader, ORACLE, 'request_price_data', { asset_ids: ['wrap.near'] }, { deposit: 10n ** 22n, gas: 200_000_000_000_000n, step: 'probe: request_price_data(wrap.near)' });
const after = await view(ORACLE, 'get_price_data', { asset_ids: ['wrap.near'] });
const out = { network: 'testnet', oracle: ORACLE, at: new Date().toISOString(), coinbase_price_at_send: coinbase.price, before, tx: r, after };
await writeFile(resolve(root, `deployments/second-source/oracle-probe-${Date.now()}.json`), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ ok: r.ok, return: r.return, after: after.prices[0], coinbase: coinbase.price }));
