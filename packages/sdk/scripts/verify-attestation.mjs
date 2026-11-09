// Verifies the Intel TDX attestation of one OutLayer execution end to end.
// Usage: node packages/sdk/scripts/verify-attestation.mjs <tx-hash> <input-json-string-file|-> <output-string-file|-> <wasm-sha256>
// or:    node packages/sdk/scripts/verify-attestation.mjs <deployments/outlayer-direct-*.json> <wasm-sha256>
import { readFile } from 'node:fs/promises';
import { verifyExecution } from '../src/attestation.mjs';
const [a, b] = process.argv.slice(2);
const record = JSON.parse(await readFile(a, 'utf8'));
const result = await verifyExecution({ txHash: record.tx, input: record.input, output: record.output, wasmHash: b });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
