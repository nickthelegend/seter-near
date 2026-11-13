// Independent check of an OutLayer per-execution Intel TDX attestation (method first worked out in our
// sibling project Kotoba, from github.com/out-layer/outlayer WORKER_ATTESTATION.md and worker/src/tdx_attestation.rs):
//   report_data[0..32] = SHA-256(task_type ‖ task_id(i64 LE) ‖ build_target ‖ wasm_hash ‖ input_hash ‖ output_hash ‖
//                                block_height(u64 LE) ‖ caller ‖ timestamp(i64 LE) ‖ attached_usd)
// The quote's signature chain is verified with Phala's dcap-qvl against Intel collateral; the TD measurements
// are checked against worker.outlayer.testnet `is_measurements_approved`.
import { createHash } from 'node:crypto';
import { getCollateralAndVerify } from '@phala/dcap-qvl';
import { OUTLAYER_TESTNET_API, view } from './index.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const le64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const leU64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
// TDX quote v4: 48-byte header, then the TD report body. Offsets are into the whole quote.
const MRTD = 48 + 136, RTMR0 = 48 + 328, REPORT_DATA = 48 + 520, M = 48;

// A transaction can hold more than one OutLayer run (since 14 Nov a fire also refreshes
// price-oracle.testnet through OutLayer); pass the run's request id to pick the right one.
export async function fetchAttestationByTx(txHash, api = OUTLAYER_TESTNET_API, requestId = null) {
  const url = requestId == null ? `${api}/attestations/by-tx/${txHash}` : `${api}/attestations/by-request/${requestId}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (response.ok) return response.json();
    if (response.status !== 404) throw new Error(`OutLayer attestation HTTP ${response.status} for ${txHash}`);
    await new Promise((r) => setTimeout(r, 4000)); // indexed a few seconds after the execution
  }
  throw new Error(`OutLayer has no attestation for ${txHash}`);
}

export function taskHash(a) {
  const parts = [Buffer.from(a.task_type), le64(a.task_id)];
  for (const k of ['repo_url', 'commit_hash', 'build_target', 'wasm_hash', 'input_hash']) if (a[k] != null) parts.push(Buffer.from(a[k]));
  parts.push(Buffer.from(a.output_hash));
  if (a.block_height != null) parts.push(leU64(a.block_height));
  for (const k of ['caller_account_id', 'project_id', 'secrets_ref']) if (a[k] != null) parts.push(Buffer.from(a[k]));
  parts.push(le64(a.timestamp));
  if (a.attached_usd != null) parts.push(Buffer.from(a.attached_usd));
  return sha(Buffer.concat(parts));
}

export function quoteFields(quote) {
  const hex = (o) => quote.subarray(o, o + M).toString('hex');
  return { mrtd: hex(MRTD), rtmr0: hex(RTMR0), rtmr1: hex(RTMR0 + M), rtmr2: hex(RTMR0 + 2 * M), rtmr3: hex(RTMR0 + 3 * M), report_data: quote.subarray(REPORT_DATA, REPORT_DATA + 64).toString('hex') };
}

/** Verifies one execution. `input` and `output` are the exact strings OutLayer received and returned. */
export async function verifyExecution({ txHash, input, output, wasmHash, requestId = null }) {
  const a = await fetchAttestationByTx(txHash, OUTLAYER_TESTNET_API, requestId);
  if (a.transaction_hash && a.transaction_hash !== txHash) throw new Error(`Attestation ${a.id} belongs to ${a.transaction_hash}, not ${txHash}`);
  const quote = Buffer.from(a.tdx_quote, 'base64');
  const fields = quoteFields(quote);
  const { mrtd, rtmr0, rtmr1, rtmr2, rtmr3 } = fields;
  const checks = {
    wasm_hash_pinned: a.wasm_hash === wasmHash && a.executed_wasm_sha256 === wasmHash,
    input_hash: input == null ? true : a.input_hash === sha(input),
    output_hash: output == null ? true : a.output_hash === sha(output),
    report_data_binds_task: fields.report_data === taskHash(a) + '0'.repeat(64),
    measurements_approved_on_chain: (await view('worker.outlayer.testnet', 'is_measurements_approved', { measurements: { mrtd, rtmr0, rtmr1, rtmr2, rtmr3 } })) === true,
  };
  let tcb;
  try {
    const verified = await getCollateralAndVerify(quote);
    tcb = { status: verified.status, advisory_ids: verified.advisory_ids ?? [] };
    checks.intel_signature_chain = true;
  } catch (error) {
    tcb = { error: String(error.message || error).slice(0, 200) };
    checks.intel_signature_chain = false;
  }
  return { request_id: a.request_id, attestation_id: a.id, tx: a.transaction_hash, caller: a.caller_account_id, block_height: a.block_height, timestamp: a.timestamp, wasm_hash: a.wasm_hash, input_hash: a.input_hash, output_hash: a.output_hash, measurements: { mrtd, rtmr3 }, report_data: fields.report_data.slice(0, 64), tcb, checks, ok: Object.values(checks).every(Boolean), source: requestId == null ? `${OUTLAYER_TESTNET_API}/attestations/by-tx/${txHash}` : `${OUTLAYER_TESTNET_API}/attestations/by-request/${requestId}` };
}
