// One place to send a function call and keep a public record of it (hash, explorer link, result, logs).
import { actions } from 'near-api-js';
import { explorerTx } from '../src/index.mjs';

export async function call(account, receiverId, method, args = {}, { deposit = 0n, gas = 100_000_000_000_000n, step } = {}) {
  let result;
  for (let i = 0; ; i++) {
    try { result = await account.signAndSendTransaction({ receiverId, actions: [actions.functionCall(method, args, gas, deposit)], waitUntil: 'FINAL', throwOnFailure: false }); break; }
    catch (error) {
      // FastNEAR answers 429 to busy shared IPs while the transaction is being built (nonce / block
      // hash lookups), before anything is broadcast, so a retry cannot double-send.
      if (error?.cause !== 429 || i >= 10) throw error;
      await new Promise((r) => setTimeout(r, 3000 * 1.5 ** i));
    }
  }
  return record(account, result, { step: step || `${method}`, receiverId, method, args, deposit });
}

export function record(account, result, extra) {
  const value = result.status.SuccessValue !== undefined ? Buffer.from(result.status.SuccessValue, 'base64').toString() : null;
  const logs = result.receipts_outcome.flatMap((r) => r.outcome.logs);
  const failures = result.receipts_outcome.map((r) => r.outcome.status.Failure).filter(Boolean);
  const out = { ...extra, signer: account.accountId, deposit: extra.deposit !== undefined ? String(extra.deposit) : undefined, tx: result.transaction.hash, explorer: explorerTx(result.transaction.hash), at: new Date().toISOString(), ok: !result.status.Failure, return: value, failure: result.status.Failure ?? null, receipt_failures: failures.length ? failures : undefined, logs };
  console.log(`${out.ok ? 'ok ' : 'ERR'} ${out.step}: ${out.explorer}${out.ok ? '' : ' ' + JSON.stringify(out.failure).slice(0, 300)}`);
  return out;
}
