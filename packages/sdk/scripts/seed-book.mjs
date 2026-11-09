// Places a few long-lived sealed orders from the trader account (levels far from the price, so they stay open)
// and asks the enclave for its k-anonymous band report. Unfired triggers are never written to this record.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signerFor, root, loadCredentials } from './signer.mjs';
import { call } from './tx.mjs';
import { view, PRICE_SOURCE, orderPlaintext, sealToEnclave, commitment, sealView } from '../src/index.mjs';

const dep = JSON.parse(await readFile(resolve(root, 'deployments/testnet-2026-11-09.json'), 'utf8'));
const C = dep.contract_id;
const trader = await signerFor('trader');
const keeper = await signerFor('deployer');
const { view_key } = await loadCredentials('trader-view');
const cfg = await view(C, 'get_config');
const t = await (await fetch(PRICE_SOURCE, { headers: { 'user-agent': 'mienai-seed/0.1' } })).json();
const p = Number(t.price);
const steps = [];
for (const [cond, mult, label] of [['lte', 0.88, 'deep stop-loss'], ['lte', 0.92, 'stop-loss'], ['gte', 1.12, 'take-profit']]) {
  const pt = orderPlaintext({ cond, triggerUsd: (p * mult).toFixed(4), side: 'sell', amount: String(10n ** 23n) });
  steps.push(await call(trader, C, 'place_order', { ct: sealToEnclave(cfg.tee.order_pub, trader.accountId, pt), commit: commitment(trader.accountId, pt), view_ct: sealView(view_key, trader.accountId, pt) }, { deposit: 20n * 10n ** 21n, step: `trader seals a ${label} (sell 0.1 NEAR); level not recorded` }));
}
steps.push(await call(keeper, C, 'publish_bands', {}, { deposit: 20n * 10n ** 21n, gas: 300_000_000_000_000n, step: 'enclave band report (OutLayer TEE run, k = 5)' }));
const stats = await view(C, 'get_stats');
await writeFile(resolve(root, 'deployments/book-2026-11-09.json'), JSON.stringify({ network: 'testnet', contract: C, price_at_placement: { source: PRICE_SOURCE, price: t.price, trade_id: t.trade_id, time: t.time }, steps, bands: stats.bands }, null, 2) + '\n');
console.log(JSON.stringify(stats.bands));
