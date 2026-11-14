// Upgrades the live Seter vault in place (same account, same state, same enclave hash) to the build
// with public orders, market orders and one-cancels-the-other pairs. Testnet only. The deployer key is
// loaded from a gitignored file and never printed. Refuses to finish if any counter changed.
// Usage: node packages/sdk/scripts/upgrade-order-types.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { actions } from 'near-api-js';
import { signerFor, root } from './signer.mjs';
import { record } from './tx.mjs';
import { view, rpc } from '../src/index.mjs';

const C = 'mienai-3013a230.testnet';
const out = resolve(root, 'deployments/order-types/upgrade-2026-11-14.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const deployer = await signerFor('deployer');
if (deployer.accountId !== C) throw new Error('Deployer credentials must be the vault account.');
const wasm = await readFile(resolve(root, 'packages/contract/target/near/mienai.wasm'));
const snapshot = async () => ({ code_hash: (await rpc('query', { request_type: 'view_account', finality: 'final', account_id: C })).code_hash, stats: await view(C, 'get_stats'), config: await view(C, 'get_config'), second_source: await view(C, 'get_second_source') });
const before = await snapshot();
const code = await rpc('query', { request_type: 'view_code', finality: 'final', account_id: C });
await mkdir(resolve(root, '.demo'), { recursive: true });
await writeFile(resolve(root, `.demo/mienai-before-${before.code_hash}.wasm`), Buffer.from(code.code_base64, 'base64'));
const result = await deployer.signAndSendTransaction({ receiverId: C, actions: [actions.deployContract(wasm)], waitUntil: 'FINAL', throwOnFailure: false });
const r = record(deployer, result, { step: 'upgrade the vault in place: public orders, market orders, OCO pairs', receiverId: C, method: 'DeployContract' });
if (!r.ok) throw new Error('Deploy failed; nothing else sent.');
const after = await snapshot();
for (const k of ['orders_total', 'open', 'fired', 'cancelled', 'checks', 'requests_total']) if (after.stats[k] !== before.stats[k]) throw new Error(`State changed across the upgrade: ${k}`);
if (after.config.enclave_hash !== before.config.enclave_hash || JSON.stringify(after.config.tee) !== JSON.stringify(before.config.tee)) throw new Error('Enclave pin or keys changed across the upgrade');
const probe = { public_orders: await view(C, 'get_public_orders', {}), market_fills: await view(C, 'get_market_fills', {}), oco_pairs: await view(C, 'get_oco_pairs') };
await mkdir(resolve(root, 'deployments/order-types'), { recursive: true });
await writeFile(out, JSON.stringify({ network: 'testnet', contract: C, at: new Date().toISOString(), steps: [{ ...r, wasm_sha256: sha(wasm), code_hash_before: before.code_hash, code_hash_after: after.code_hash, state_preserved: true, enclave_hash: after.config.enclave_hash, stats_before: before.stats, stats_after: after.stats, keeper_budget: after.second_source.keeper_budget, new_views: probe }] }, null, 2) + '\n');
console.log(JSON.stringify({ tx: r.tx ?? r.hash, code_hash_after: after.code_hash, probe }));
