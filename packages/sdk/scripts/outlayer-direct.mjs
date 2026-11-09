// Runs a FastFS-hosted enclave build on OutLayer directly from the deployer account (no contract),
// to check the code on real TEE workers. Only the direct-probe build admits a direct call.
// Usage: node packages/sdk/scripts/outlayer-direct.mjs <record-name> <operation> [orders.json]
import { actions } from 'near-api-js';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signerFor, root } from './signer.mjs';
import { explorerTx } from '../src/index.mjs';

const [recordName, operation, ordersFile] = process.argv.slice(2);
if (!recordName || !operation) throw new Error('usage: outlayer-direct.mjs <record-name> <operation> [orders.json]');
const record = JSON.parse(await readFile(resolve(root, `deployments/${recordName}.json`), 'utf8'));
const account = await signerFor('deployer');
const orders = ordersFile ? JSON.parse(await readFile(resolve(root, ordersFile), 'utf8')) : [];
const input = JSON.stringify({ operation, contract: account.accountId, request: Date.now(), orders });
const args = { source: { WasmUrl: { url: record.url, hash: record.sha256, build_target: 'wasm32-wasip2' } }, input_data: input, resource_limits: { max_instructions: 20_000_000_000, max_memory_mb: 128, max_execution_seconds: 60 }, response_format: 'Json' };
const result = await account.signAndSendTransaction({ receiverId: 'outlayer.testnet', actions: [actions.functionCall('request_execution', args, 300_000_000_000_000n, 30n * 10n ** 21n)], waitUntil: 'FINAL', throwOnFailure: false });
const output = result.status.SuccessValue !== undefined ? Buffer.from(result.status.SuccessValue, 'base64').toString() : null;
const out = { tx: result.transaction.hash, explorer: explorerTx(result.transaction.hash), input, output, failure: result.status.Failure ?? null, logs: result.receipts_outcome.flatMap((r) => r.outcome.logs).filter((l) => !l.startsWith('EVENT_JSON')).slice(0, 12) };
await writeFile(resolve(root, `deployments/outlayer-direct-${operation}-${result.transaction.hash}.json`), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
