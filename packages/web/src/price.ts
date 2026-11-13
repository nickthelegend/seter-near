import { useEffect, useSyncExternalStore } from 'react';
import { ticker } from './lib';

/** Live NEAR-USD from Coinbase Exchange's public WebSocket ticker (one message per trade). The REST ticker is the
 * fallback while the socket connects or if it drops; the enclave reads the same product. Nothing here is simulated. */
export type Trade = { price: number; size: number; side: 'buy' | 'sell'; time: number; id: number };
export type LivePrice = { price: number | null; prev: number | null; dir: 'up' | 'down' | null; at: number; source: 'stream' | 'rest' | 'none'; bid: number | null; ask: number | null; trades: Trade[]; error: string };

let state: LivePrice = { price: null, prev: null, dir: null, at: 0, source: 'none', bid: null, ask: null, trades: [], error: '' };
const subs = new Set<() => void>();
const emit = (next: Partial<LivePrice>) => { state = { ...state, ...next }; subs.forEach((f) => f()); };
function setPrice(price: number, at: number, source: LivePrice['source'], extra: Partial<LivePrice> = {}) {
  if (!(price > 0) || !Number.isFinite(price)) return;
  const dir = state.price === null || price === state.price ? state.dir : price > state.price ? 'up' : 'down';
  emit({ price, prev: state.price, dir, at, source, error: '', ...extra });
}

let ws: WebSocket | null = null;
let restTimer: number | undefined;
let retry: number | undefined;
let users = 0;
let backoff = 1000;
async function rest() {
  if (state.source === 'stream' && Date.now() - state.at < 20_000) return;
  try { const t = await ticker(); setPrice(Number(t.price), Date.parse(t.time), state.source === 'stream' ? 'stream' : 'rest'); }
  catch (e) { emit({ error: (e as Error).message }); }
}
function open() {
  if (ws || typeof WebSocket === 'undefined') return;
  try { ws = new WebSocket('wss://ws-feed.exchange.coinbase.com'); } catch { ws = null; return; }
  ws.onopen = () => { backoff = 1000; ws?.send(JSON.stringify({ type: 'subscribe', product_ids: ['NEAR-USD'], channels: ['ticker'] })); };
  ws.onmessage = (ev) => {
    let m: { type?: string; price?: string; time?: string; trade_id?: number; last_size?: string; side?: string; best_bid?: string; best_ask?: string };
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.type !== 'ticker' || !m.price) return;
    const price = Number(m.price), at = m.time ? Date.parse(m.time) : Date.now();
    const trade: Trade = { price, size: Number(m.last_size ?? 0), side: m.side === 'sell' ? 'sell' : 'buy', time: at, id: Number(m.trade_id ?? 0) };
    const trades = trade.id && !state.trades.some((t) => t.id === trade.id) ? [trade, ...state.trades].slice(0, 30) : state.trades;
    setPrice(price, at, 'stream', { bid: Number(m.best_bid) || null, ask: Number(m.best_ask) || null, trades });
  };
  ws.onclose = () => {
    ws = null;
    if (users > 0) { retry = window.setTimeout(open, backoff); backoff = Math.min(backoff * 2, 30_000); }
  };
  ws.onerror = () => ws?.close();
}
/** Seed the trade list with Coinbase's latest public trades so the panel is never empty while the socket warms up. */
async function seedTrades() {
  try {
    const res = await fetch('https://api.exchange.coinbase.com/products/NEAR-USD/trades?limit=20', { signal: AbortSignal.timeout(6000) });
    const rows = await res.json() as { trade_id: number; price: string; size: string; side: string; time: string }[];
    if (!Array.isArray(rows)) return;
    const older = rows.map((r) => ({ price: Number(r.price), size: Number(r.size), side: r.side === 'sell' ? 'sell' as const : 'buy' as const, time: Date.parse(r.time), id: r.trade_id })).filter((t) => t.price > 0 && t.id);
    const merged = [...state.trades, ...older.filter((t) => !state.trades.some((x) => x.id === t.id))].sort((a, b) => b.id - a.id).slice(0, 30);
    emit({ trades: merged });
  } catch { /* the stream still fills the list */ }
}
function start() {
  if (users++ > 0) return;
  rest(); open(); seedTrades();
  restTimer = window.setInterval(() => { if (!document.hidden) rest(); }, 10_000);
}
function stop() {
  if (--users > 0) return;
  clearInterval(restTimer); clearTimeout(retry);
  const s = ws; ws = null; s?.close();
}

export function useLivePrice(): LivePrice {
  useEffect(() => { start(); return stop; }, []);
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
}
