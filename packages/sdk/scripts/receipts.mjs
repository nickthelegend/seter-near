// Pulls the exact OutLayer input and output of a contract-driven run out of a transaction's receipts.
import { rpc } from '../src/index.mjs';

// `requester` (default: the Seter vault) picks the vault's own run when the transaction also holds
// the price oracle's OutLayer run. Returns the OutLayer request id from the execution_requested event.
export async function outlayerIo(txHash, senderId, requester = 'mienai-3013a230.testnet') {
  const r = await rpc('EXPERIMENTAL_tx_status', { tx_hash: txHash, sender_account_id: senderId, wait_until: 'FINAL' });
  let input = null;
  for (const rc of r.receipts || []) {
    if (rc.receiver_id !== 'outlayer.testnet' || rc.predecessor_id !== requester) continue;
    for (const a of rc.receipt?.Action?.actions || []) {
      if (a.FunctionCall?.method_name === 'request_execution') input = JSON.parse(Buffer.from(a.FunctionCall.args, 'base64').toString()).input_data;
    }
  }
  let output = null;
  for (const ro of r.receipts_outcome) {
    const v = ro.outcome.status?.SuccessValue;
    if (ro.outcome.executor_id !== 'outlayer.testnet' || !v) continue;
    const text = Buffer.from(v, 'base64').toString();
    // The vault's enclave answers {body, sig} or {error}; the oracle's run answers prices.
    if (text.includes('"sig"') || (output == null && text.includes('"error"') && !text.includes('"prices"'))) output = text;
  }
  let requestId = null;
  for (const ro of r.receipts_outcome) for (const l of ro.outcome.logs) {
    if (!l.startsWith('EVENT_JSON:') || !l.includes('execution_requested')) continue;
    const d = JSON.parse(JSON.parse(l.slice(11)).data[0].request_data);
    if (d.predecessor_id === requester) requestId = d.request_id;
  }
  return { input, output, requestId };
}
