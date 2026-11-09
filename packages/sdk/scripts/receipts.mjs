// Pulls the exact OutLayer input and output of a contract-driven run out of a transaction's receipts.
import { rpc } from '../src/index.mjs';

export async function outlayerIo(txHash, senderId) {
  const r = await rpc('EXPERIMENTAL_tx_status', { tx_hash: txHash, sender_account_id: senderId, wait_until: 'FINAL' });
  let input = null;
  for (const rc of r.receipts || []) {
    if (rc.receiver_id !== 'outlayer.testnet') continue;
    for (const a of rc.receipt?.Action?.actions || []) {
      if (a.FunctionCall?.method_name === 'request_execution') input = JSON.parse(Buffer.from(a.FunctionCall.args, 'base64').toString()).input_data;
    }
  }
  let output = null;
  for (const ro of r.receipts_outcome) {
    const v = ro.outcome.status?.SuccessValue;
    if (ro.outcome.executor_id !== 'outlayer.testnet' || !v) continue;
    const text = Buffer.from(v, 'base64').toString();
    if (text.includes('"sig"') || text.includes('"error"')) output = text;
  }
  return { input, output };
}
