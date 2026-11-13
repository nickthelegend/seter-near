// Verifies the TDX attestation of a filmed keeper fire (by the vault's own OutLayer request) and stores it in the film ledger.
import { readFile, writeFile } from 'node:fs/promises';
import { outlayerIo } from './receipts.mjs';
import { verifyExecution } from '../src/attestation.mjs';
import { view } from '../src/index.mjs';
const path = process.argv[2], R = JSON.parse(await readFile(path, 'utf8')), C = R.contract;
const config = await view(C, 'get_config');
const io = await outlayerIo(R.keeper.tx, C);
R.attestation = await verifyExecution({ txHash: R.keeper.tx, input: io.input, output: io.output, wasmHash: config.enclave_hash, requestId: io.requestId });
await writeFile(path, JSON.stringify(R, null, 2) + '\n');
console.log('attestation ok:', R.attestation.ok, Object.entries(R.attestation.checks || {}).map(([k, v]) => `${k}=${v}`).join(' '));
