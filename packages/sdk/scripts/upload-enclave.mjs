// Uploads the enclave WASM to FastFS on NEAR testnet, where OutLayer workers fetch WasmUrl sources.
// FastFS records the bytes from the transaction arguments; the call is sent with 1 gas and fails by
// design (as `outlayer upload` does, github.com/out-layer/outlayer-cli src/commands/upload.rs).
// Usage: node packages/sdk/scripts/upload-enclave.mjs [wasm-path] [record-name]
import { actions } from 'near-api-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { signerFor, root } from './signer.mjs';
import { explorerTx } from '../src/index.mjs';

const CHUNK = 1 << 20;
const RECEIVER = 'outlayer.testnet';
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
const bytes = (b) => Buffer.concat([u32(b.length), b]);

const wasmPath = resolve(root, process.argv[2] || 'packages/enclave/target/wasm32-wasip2/release/mienai-enclave.wasm');
const recordName = process.argv[3] || 'enclave-fastfs';
const wasm = await readFile(wasmPath);
const hash = createHash('sha256').update(wasm).digest('hex');
const path = `${hash}.wasm`;
if (wasm.length > CHUNK) throw new Error('enclave larger than one FastFS chunk; add chunking');
const payload = Buffer.concat([Buffer.from([0]), str(path), Buffer.from([1]), str('application/wasm'), bytes(wasm)]);
const account = await signerFor('deployer');
const url = `https://test.fastfs.io/${account.accountId}/${RECEIVER}/${path}`;
console.log(`Uploading ${wasm.length} bytes (sha256 ${hash}) from ${account.accountId}`);
const result = await account.signAndSendTransaction({ receiverId: RECEIVER, actions: [actions.functionCall('__fastdata_fastfs', new Uint8Array(payload), 1n, 0n)], waitUntil: 'FINAL', throwOnFailure: false });
const tx = { hash: result.transaction.hash, explorer: explorerTx(result.transaction.hash) };
console.log(`upload tx: ${tx.explorer}`);
let served = '';
for (let attempt = 0; attempt < 40 && served !== hash; attempt++) {
  await new Promise((r) => setTimeout(r, 6000));
  const response = await fetch(url).catch(() => null);
  if (response?.ok) served = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
}
if (served !== hash) throw new Error(`FastFS did not serve matching bytes at ${url} (got ${served || 'nothing'})`);
await mkdir(resolve(root, 'deployments'), { recursive: true });
await writeFile(resolve(root, `deployments/${recordName}.json`), JSON.stringify({ url, sha256: hash, bytes: wasm.length, tx, uploaded_at: new Date().toISOString() }, null, 2) + '\n');
console.log(JSON.stringify({ url, sha256: hash, verified: true }, null, 2));
