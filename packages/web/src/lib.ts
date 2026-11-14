import deployment from '../../../deployments/testnet-2026-11-09.json';
import run from '../../../deployments/real-run-2026-11-09.json';
import enclaveUpload from '../../../deployments/enclave-fastfs.json';
import book from '../../../deployments/book-2026-11-09.json';
import qa from '../../../deployments/flow-qa-2026-11-11.json';
import film from '../../../deployments/film-2026-11-13.json';
import film4 from '../../../deployments/film-2026-11-14-v4.json';
import film5 from '../../../deployments/film-2026-11-14-v5.json';
import { readReceipts } from './receipts';

export const CONTRACT: string = import.meta.env.VITE_MIENAI_CONTRACT || deployment.contract_id;
export const TOKEN: string = deployment.token_id;
export const RPC = 'https://test.rpc.fastnear.com';
export const PRICE_SOURCE = 'https://api.exchange.coinbase.com/products/NEAR-USD/ticker';
export { deployment, run, enclaveUpload };

export const txUrl = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
export const accountUrl = (a: string) => `https://testnet.nearblocks.io/address/${a}`;

export type FireRecord = {
  request: number; path: string; plaintext: string; cond: 'lte' | 'gte'; trigger_e6: number; side: 'sell' | 'buy'; amount: string;
  price_e6: number; price_ts_ms: number; trade_id: number; source: string; block_height: string; block_ts: string;
  filled_in: string; filled_out: string; note: string; report_sha256: string; outlayer_request: string;
};
export type Order = { id: number; owner: string; ct: string; commit: string; view_ct: string | null; created_ns: string; status: 'Open' | 'Fired' | 'Unfilled' | 'Cancelled'; fire: FireRecord | null };
export type TeeKeys = { order_pub: string; attest_pub: string; request: number; set_at_ns: string };
export type Config = { owner: string; token: string; outlayer: string; enclave_url: string; enclave_hash: string; tee: TeeKeys | null; price_source: string; max_price_age_s: number; fee_bps: number; order_deposit: string; max_open: number; second_source?: { oracle: string; asset: string; enabled: boolean; tolerance_bps: number } };
export type CheckSummary = { request: number; path: string; price_e6: number; price_ts_ms: number; trade_id: number; checked: number; unreadable: number; fired: number[]; block_height: string; block_ts: string; outlayer_request: string };
export type Stats = { orders_total: number; open: number; fired: number; unfilled: number; cancelled: number; checks: number; rejected_reports: number; requests_total: number; last_check: CheckSummary | null; pool: { near: string; usd: string }; bands: null | { request: number; price_e6: number; k: number; width_e6: number; bands: string; suppressed: number; total: number; block_height: string } };
export type Balance = { near: string; usd: string };
/** A public (unsealed) order: its trigger is in the transaction arguments and in contract state. */
export type PublicFill = { request: number; path: string; price_e6: number; price_ts_ms: number; block_height: string; block_ts: string; filled_in: string; filled_out: string; note: string; report_sha256: string };
export type PublicOrder = { id: number; owner: string; kind: 'stop' | 'take_profit' | 'limit'; cond: 'lte' | 'gte'; trigger_e6: number; side: 'sell' | 'buy'; amount: string; created_ns: string; status: Order['status']; fire: PublicFill | null };
/** A market order, filled at once against the vault's test pool. */
export type MarketFill = { id: number; owner: string; side: 'sell' | 'buy'; amount_in: string; amount_out: string; price_e6: number; block_height: string; block_ts: string; note: string };

/** Plain words for an order from its condition and side (sealed orders carry these inside the ciphertext). */
export function orderType(cond: string, side = 'sell'): string {
  if (side === 'buy') return cond === 'lte' ? 'limit buy' : 'stop buy';
  return cond === 'lte' ? 'stop' : 'take-profit';
}
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Size in the unit the order spends: NEAR for a sell, tUSD for a buy. */
export const orderSize = (amount: string, side = 'sell', digits = 2) => side === 'buy' ? `${usd6(amount, 2)} tUSD` : `${near(amount, digits)} NEAR`;

/** FastNEAR first; a 429 from it carries no CORS header and surfaces as a network error, so fall over to the next RPC. */
export const RPCS = [RPC, 'https://near-testnet.drpc.org', 'https://rpc.testnet.near.org'];
let preferred = 0;
/** Bound public reads so a stalled provider cannot leave a screen loading forever. */
export async function publicJson(url: string, label: string, init: RequestInit = {}): Promise<any> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error('HTTP error');
    return await res.json();
  } catch { throw new Error(`${label} is unavailable. Check your connection; the app will retry.`); }
}
export async function view<T>(method: string, args: object = {}, contract = CONTRACT): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'mienai-web', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } });
  for (let i = 0; i < RPCS.length; i++) {
    const idx = (preferred + i) % RPCS.length;
    let json;
    try {
      json = await publicJson(RPCS[idx], 'NEAR testnet', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    } catch { continue; }
    if (json.result?.error) throw new Error('The contract could not answer this request. Check the account or order and try again.');
    if (json.error || !Array.isArray(json.result?.result)) continue;
    try {
      const value = JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result))) as T;
      preferred = idx;
      return value;
    } catch { /* try another provider if its response is incomplete */ }
  }
  throw new Error('NEAR testnet is unavailable. Check your connection; the app will retry.');
}

/** Any JSON-RPC read on the same provider list, for records the contract views do not return (transaction args). */
export async function rpcRead<T>(method: string, params: object): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'seter-web', method, params });
  for (let i = 0; i < RPCS.length; i++) {
    const idx = (preferred + i) % RPCS.length;
    try {
      const json = await publicJson(RPCS[idx], 'NEAR testnet', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (json.result) return json.result as T;
    } catch { /* next provider */ }
  }
  throw new Error('NEAR testnet is unavailable. Check your connection; the app will retry.');
}
/** The arguments a transaction actually carried on chain, decoded from the signed transaction itself. */
export type ChainTx = { hash: string; signer: string; receiver: string; method: string; args: Record<string, unknown>; block: string; status: 'Success' | 'Failure' | 'Pending' };
export async function chainTx(hash: string, sender: string): Promise<ChainTx> {
  const r = await rpcRead<{ transaction: { signer_id: string; receiver_id: string; actions: { FunctionCall?: { method_name: string; args: string } }[] }; transaction_outcome: { block_hash: string }; status: Record<string, unknown> }>('tx', { tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL' });
  const fc = r.transaction.actions.find((a) => a.FunctionCall)?.FunctionCall;
  let args: Record<string, unknown> = {};
  try { args = fc ? JSON.parse(atob(fc.args)) : {}; } catch { /* non-JSON args stay empty */ }
  return { hash, signer: r.transaction.signer_id, receiver: r.transaction.receiver_id, method: fc?.method_name ?? '', args, block: r.transaction_outcome.block_hash, status: !r.status ? 'Pending' : 'Failure' in r.status ? 'Failure' : 'SuccessValue' in r.status ? 'Success' : 'Pending' };
}

export type Ticker = { price: string; time: string; trade_id: number };
export async function ticker(): Promise<Ticker> {
  const t = await publicJson(PRICE_SOURCE, 'Coinbase price', { headers: { accept: 'application/json' } });
  if (!(Number(t.price) > 0) || !Number.isFinite(Number(t.price)) || !Number.isFinite(Date.parse(t.time)) || !Number.isSafeInteger(t.trade_id)) throw new Error('Coinbase returned an invalid price. The app will retry.');
  return t as Ticker;
}

const YOCTO = 10n ** 24n;
export function near(yocto: string | bigint, digits = 4): string {
  const v = BigInt(yocto);
  const whole = v / YOCTO;
  const frac = (v % YOCTO).toString().padStart(24, '0').slice(0, digits);
  return `${whole}.${frac}`;
}
export const usd6 = (units: string | number, digits = 4) => (Number(units) / 1e6).toFixed(digits);
export const e6 = (v: number) => (v / 1e6).toFixed(4);
export function toYocto(decimal: string): string {
  const m = /^(\d+)(?:\.(\d{0,24}))?$/.exec(decimal.trim());
  if (!m) throw new Error('Enter an amount like 0.5');
  return (BigInt(m[1]) * YOCTO + BigInt((m[2] || '').padEnd(24, '0'))).toString();
}
/** Exact six-decimal token units; never rounds a small amount to zero or serializes NaN. */
export function toTokenUnits(decimal: string): string {
  const m = /^(\d+)(?:\.(\d{0,6}))?$/.exec(decimal.trim());
  if (!m) throw new Error('Enter a positive tUSD amount with at most 6 decimal places.');
  const units = BigInt(m[1]) * 1_000_000n + BigInt((m[2] || '').padEnd(6, '0'));
  if (units <= 0n || units > (1n << 128n) - 1n) throw new Error('Enter a positive tUSD amount within the token limit.');
  return units.toString();
}
export const short = (s: string, n = 6) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
export const shortAccount = (a: string) => (a.length > 22 ? `${a.slice(0, 12)}…${a.slice(-8)}` : a);
export const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
export const nsToMs = (ns: string) => Number(BigInt(ns) / 1_000_000n);

/** The keeper check that fired the recorded stop, its attestation and the step list. */
type Step = { step: string; tx?: string; explorer?: string; ok?: boolean; return?: string | null; at?: string; attestation?: Attestation; last_check?: CheckSummary };
export type Attestation = { request_id: number; attestation_id: number; tx: string; block_height: number; wasm_hash: string; input_hash: string; output_hash: string; measurements: { mrtd: string; rtmr3: string }; tcb: { status?: string; error?: string }; checks: Record<string, boolean>; ok: boolean; source: string };
export const runSteps = (run as unknown as { steps: Step[] }).steps.filter((s) => s.tx);
export const firedStep = (run as unknown as { steps: Step[] }).steps.find((s) => s.attestation);
export const deploySteps = (deployment as unknown as { steps: Step[] }).steps;

/** An OutLayer request the contract issued, read live with get_request. */
export type Request = { id: number; kind: 'Keys' | 'Check' | 'Bands'; caller: string; created_ns: string; order_ids: number[]; status: string; note: string };

export const OUTLAYER_API = 'https://testnet-api.outlayer.ai';
/** Recorded transaction for a step, found in the run or book records. */
type RecStep = { step: string; tx?: string; at?: string; method?: string; return?: string | null; args?: unknown; last_check?: CheckSummary; attestation?: Attestation };
const allSteps = [...((deployment as unknown as { steps: RecStep[] }).steps ?? []), ...((run as unknown as { steps: RecStep[] }).steps ?? []), ...((qa as unknown as { steps: RecStep[] }).steps ?? []), ...((film as unknown as { steps: RecStep[] }).steps ?? []), ...((film4 as unknown as { steps: RecStep[] }).steps ?? []), ...((film5 as unknown as { steps: RecStep[] }).steps ?? [])];
export const txForOrder = (id: number) => readReceipts(CONTRACT).find((r) => r.method === 'place_order' && r.order === id)?.tx ?? allSteps.find((s) => s.method === 'place_order' && s.return === String(id))?.tx;
export const txForPublic = (id: number) => readReceipts(CONTRACT).find((r) => r.method === 'place_public_order' && r.order === id)?.tx ?? allSteps.find((s) => s.method === 'place_public_order' && s.return === String(id))?.tx;
export const txForMarket = (id: number) => readReceipts(CONTRACT).find((r) => r.method === 'market_order' && r.order === id)?.tx ?? allSteps.find((s) => s.method === 'market_order' && (s as { fill_id?: number }).fill_id === id)?.tx;
export const txForRequest = (request: number) => readReceipts(CONTRACT).find((r) => r.method === 'check' && r.request === request)?.tx ?? allSteps.find((s) => s.last_check?.request === request)?.tx;
export const attestationFor = (request: number) => allSteps.find((s) => s.last_check?.request === request)?.attestation ?? null;

export type EventKind = 'sealed' | 'checked' | 'fired' | 'attested' | 'cancelled';
export type LogEvent = { key: string; at: number; kind: EventKind; title: string; detail: string; order?: number; tx?: string };

/** The enclave log: every event the contract (and the recorded attestation check) can prove, newest first. */
export function buildLog(orders: Order[], requests: Request[]): LogEvent[] {
  const out: LogEvent[] = [];
  for (const o of orders) {
    out.push({ key: `s${o.id}`, at: nsToMs(o.created_ns), kind: 'sealed', title: `Order №${o.id} sealed`, detail: `${o.ct.length}-char ciphertext · trigger hidden`, order: o.id, tx: txForOrder(o.id) });
    if (o.fire) out.push({ key: `f${o.id}`, at: nsToMs(o.fire.block_ts), kind: 'fired', title: `Order №${o.id} ${o.status === 'Unfilled' ? 'crossed but did not fill' : 'fired'}`, detail: `price ${e6(o.fire.price_e6)} crossed ${o.fire.cond === 'lte' ? '≤' : '≥'} ${e6(o.fire.trigger_e6)} · trigger revealed`, order: o.id, tx: txForRequest(o.fire.request) });
    if (o.status === 'Cancelled') {
      const c = readReceipts(CONTRACT).find((r) => r.method === 'cancel_order' && r.order === o.id) ?? allSteps.find((s) => s.method === 'cancel_order' && s.at && String(JSON.stringify(s.args)).match(new RegExp(`id\\D+${o.id}\\b`)));
      if (c?.at) out.push({ key: `c${o.id}`, at: Date.parse(c.at), kind: 'cancelled', title: `Order №${o.id} cancelled`, detail: 'its trigger was never revealed · recorded tx', order: o.id, tx: c.tx });
    }
  }
  for (const r of requests) {
    const at = nsToMs(r.created_ns);
    if (r.kind === 'Keys') out.push({ key: `r${r.id}`, at, kind: 'attested', title: 'Enclave published its keys', detail: `attested OutLayer run · request ${r.id} · ${r.status.toLowerCase()}` });
    else if (r.kind === 'Check') out.push({ key: `r${r.id}`, at, kind: 'checked', title: `Check ${r.id}: ${r.order_ids.length} orders requested`, detail: r.note.replace('callback: ', '') || r.status, tx: txForRequest(r.id) });
    else out.push({ key: `r${r.id}`, at, kind: 'checked', title: `Band report ${r.id}: ${r.order_ids.length} orders requested`, detail: r.note || r.status });
  }
  const a = firedStep?.attestation;
  if (a) out.push({ key: `a${a.request_id}`, at: (a as unknown as { timestamp: number }).timestamp * 1000, kind: 'attested', title: 'TDX attestation verified', detail: `OutLayer run #${a.request_id} · TCB ${a.tcb.status ?? 'unknown'} · recorded check`, tx: a.tx });
  return out.sort((x, y) => y.at - x.at);
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The TDX quote of an OutLayer run, fetched live from OutLayer's public API and hashed in the browser. */
export type LiveQuote = { quoteSha256: string; quoteBytes: number; mrtd: string; rtmr0: string; rtmr1: string; rtmr2: string; rtmr3: string; reportData: string; wasm: string; requestId: number; tx: string };
/** By OutLayer request id when known: since 14 Nov a fire transaction holds two OutLayer runs (the vault's enclave and
 * the price oracle's refresh), and a lookup by transaction alone can return the oracle's run. */
export async function fetchQuote(tx: string | undefined, outlayerRequest?: string | number): Promise<LiveQuote> {
  const url = outlayerRequest !== undefined ? `${OUTLAYER_API}/attestations/by-request/${outlayerRequest}` : `${OUTLAYER_API}/attestations/by-tx/${tx}`;
  const a = await publicJson(url, 'OutLayer quote') as { tdx_quote: string; executed_wasm_sha256?: string; wasm_hash?: string; request_id: string | number; transaction_hash?: string };
  if (tx && a.transaction_hash && a.transaction_hash !== tx) throw new Error('OutLayer returned a run from another transaction. Try reloading the page.');
  let quote: Uint8Array;
  try { quote = Uint8Array.from(atob(a.tdx_quote), (c) => c.charCodeAt(0)); } catch { throw new Error('OutLayer returned an invalid quote. Try reloading the page.'); }
  if (quote.length < 632) throw new Error('OutLayer returned an incomplete quote. Try reloading the page.');
  const hex = (o: number, n = 48) => Array.from(quote.subarray(o, o + n), (b) => b.toString(16).padStart(2, '0')).join('');
  return { quoteSha256: await sha256Hex(quote), quoteBytes: quote.length, mrtd: hex(48 + 136), rtmr0: hex(48 + 328), rtmr1: hex(48 + 376), rtmr2: hex(48 + 424), rtmr3: hex(48 + 472), reportData: hex(48 + 520, 64), wasm: String(a.executed_wasm_sha256 ?? a.wasm_hash ?? ''), requestId: Number(a.request_id), tx: String(a.transaction_hash ?? tx ?? '') };
}

/** Every recorded OutLayer TEE run (keys, checks, band report) with its transaction. */
export type OutlayerRun = { tx: string; at: string; kind: 'Keys' | 'Check' | 'Bands'; label: string; attestation: Attestation | null; price_e6?: number; order?: number };
const recordedRuns: OutlayerRun[] = [...allSteps, ...((book as unknown as { steps: RecStep[] }).steps ?? [])]
  .filter((s) => s.tx && s.at && ['refresh_keys', 'check', 'publish_bands'].includes(s.method ?? ''))
  .map((s) => ({ tx: s.tx!, at: s.at!, kind: s.method === 'refresh_keys' ? 'Keys' : s.method === 'check' ? 'Check' : 'Bands', label: s.step.replace(' (OutLayer TEE run)', '').replace(' (OutLayer TEE run, k = 5)', ''), attestation: s.attestation ?? null, price_e6: s.last_check?.price_e6, order: s.last_check?.fired?.[0] }) as OutlayerRun)
  .reverse();
export function outlayerRuns(): OutlayerRun[] {
  const recent = readReceipts(CONTRACT).filter((r) => r.method === 'check').map((r): OutlayerRun => ({ tx: r.tx, at: r.at, kind: 'Check', label: 'Wallet price check', attestation: null }));
  return [...new Map([...recent, ...recordedRuns].map((r) => [r.tx, r])).values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
