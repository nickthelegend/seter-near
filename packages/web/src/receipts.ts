/** Public transaction metadata only. Never store signing keys, view keys or order plaintext here. */
export const TRANSACTION_EVENT = 'seter:transaction';
export type Receipt = { tx: string; at: string; method: string; signer: string; receiver: string; order?: number; orders?: number[]; request?: number };
const memory = new Map<string, Receipt[]>();
const key = (contract: string) => `seter:receipts:testnet:${contract}`;
export function readReceipts(contract: string): Receipt[] {
  let stored: Receipt[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key(contract)) || '[]');
    if (Array.isArray(parsed)) stored = parsed.filter((r) => r && typeof r.tx === 'string' && typeof r.at === 'string' && typeof r.method === 'string');
  } catch { /* a blocked or corrupt cache must not break the app */ }
  return [...new Map([...stored, ...(memory.get(contract) || [])].map((r) => [r.tx, r])).values()];
}
export function rememberReceipt(contract: string, method: string, args: object, receiver: string, signer: string, result: unknown) {
  const r = result as { transaction?: { hash?: string; signer_id?: string }; status?: { SuccessValue?: string }; receipts_outcome?: { outcome?: { logs?: string[] } }[] } | undefined;
  if (!r?.transaction?.hash) return;
  const receipt: Receipt = { tx: r.transaction.hash, at: new Date().toISOString(), method, receiver, signer: r.transaction.signer_id || signer };
  if (['place_order', 'place_public_order', 'place_oco', 'market_order'].includes(method) && r.status?.SuccessValue) {
    try {
      const v = JSON.parse(atob(r.status.SuccessValue));
      const id = Array.isArray(v) ? v[0] : v && typeof v === 'object' ? v.id : v;
      if (Number.isSafeInteger(id)) receipt.order = id;
      if (Array.isArray(v) && v.every(Number.isSafeInteger)) receipt.orders = v;
    } catch { /* no scalar result */ }
  }
  if ((method === 'cancel_order' || method === 'cancel_public_order') && 'id' in args && Number.isSafeInteger(args.id)) receipt.order = args.id as number;
  for (const outcome of r.receipts_outcome || []) for (const line of outcome.outcome?.logs || []) {
    if (!line.startsWith('EVENT_JSON:')) continue;
    try {
      const event = JSON.parse(line.slice(11));
      if (event.standard === 'mienai' && event.event === 'enclave_request' && Number.isSafeInteger(event.data?.[0]?.request)) receipt.request = event.data[0].request;
    } catch { /* unrelated log */ }
  }
  const all = [...readReceipts(contract).filter((x) => x.tx !== receipt.tx), receipt].slice(-200);
  memory.set(contract, all);
  try { localStorage.setItem(key(contract), JSON.stringify(all)); } catch { /* retain the successful receipt in memory */ }
  dispatchEvent(new Event(TRANSACTION_EVENT));
}
