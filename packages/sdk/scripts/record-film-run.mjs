// Records a film's in-app testnet transactions as public evidence, and verifies the fired check's Intel TDX
// attestation end to end (same verifier as real-run.mjs). Reads only public data; signs nothing.
// usage: node packages/sdk/scripts/record-film-run.mjs <film live.json> <out deployments/*.json>
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './signer.mjs';
import { outlayerIo } from './receipts.mjs';
import { verifyExecution } from '../src/attestation.mjs';
import { view } from '../src/index.mjs';
const [src, dst] = process.argv.slice(2);
const out = resolve(root, dst);
if (existsSync(out)) throw new Error(`${out} exists`);
const live = JSON.parse(await readFile(src, 'utf8'));
if (live.status !== 'PASS') throw new Error('Film run did not pass.');
const dep = JSON.parse(await readFile(resolve(root, 'deployments/testnet-2026-11-09.json'), 'utf8'));
const steps = [];
for (const s of live.steps) {
  const st = { step: s.label === 'seal-stop' ? `trader seals a stop (sell ${live.sell_near} NEAR) in the app; trigger hidden on chain` : s.label === 'check' ? 'trader pays for a check in the app (OutLayer TEE run)' : `trader cancels order №${live.cancel_id} in the app; its trigger stays sealed`, method: s.method, tx: s.tx, at: s.at, return: s.return, explorer: `https://testnet.nearblocks.io/txns/${s.tx}` };
  if (s.method === 'cancel_order') st.args = { id: live.cancel_id };
  if (s.method === 'check') {
    const order = await view(dep.contract_id, 'get_order', { id: live.order_id });
    const req = order.fire.request;
    const stats = await view(dep.contract_id, 'get_stats');
    st.last_check = stats.last_check?.request === req ? stats.last_check : { request: req, price_e6: order.fire.price_e6, fired: [live.order_id], block_ts: order.fire.block_ts, outlayer_request: order.fire.outlayer_request };
    const io = await outlayerIo(s.tx, live.account);
    st.attestation = await verifyExecution({ txHash: s.tx, input: io.input, output: io.output, wasmHash: dep.enclave.sha256 });
    console.log('attestation ok:', st.attestation.ok, JSON.stringify(st.attestation.checks));
  }
  steps.push(st);
}
await writeFile(out, JSON.stringify({ network: 'testnet', contract: dep.contract_id, source: 'film v3, real app UI with the build-gated QA signer', account: live.account, order_id: live.order_id, trigger: live.trigger, placement_quote: live.placement_quote, fire: (await view(dep.contract_id, 'get_order', { id: live.order_id })).fire, wallet_debit_yocto: live.wallet_debit_yocto, steps }, null, 2) + '\n');
console.log('wrote', out);
