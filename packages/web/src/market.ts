import { usePoll } from './live';

/** Coinbase Exchange public market data (CORS-open). The enclave reads the same product's ticker. */
const CB = 'https://api.exchange.coinbase.com/products/NEAR-USD';
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Stats24h = { open: number; high: number; low: number; last: number; volume: number };
export const GRANULARITY = { '15m': 900, '1h': 3600, '6h': 21600, '1D': 86400 } as const;
export type Tf = keyof typeof GRANULARITY;

export async function candles(tf: Tf): Promise<Candle[]> {
  const res = await fetch(`${CB}/candles?granularity=${GRANULARITY[tf]}`);
  if (!res.ok) throw new Error(`Coinbase candles HTTP ${res.status}`);
  const rows = (await res.json()) as [number, number, number, number, number, number][];
  return rows.map(([time, low, high, open, close, volume]) => ({ time, open, high, low, close, volume })).sort((a, b) => a.time - b.time);
}
export async function stats24h(): Promise<Stats24h> {
  const res = await fetch(`${CB}/stats`);
  if (!res.ok) throw new Error(`Coinbase stats HTTP ${res.status}`);
  const s = await res.json();
  return { open: Number(s.open), high: Number(s.high), low: Number(s.low), last: Number(s.last), volume: Number(s.volume) };
}
export const useCandles = (tf: Tf) => usePoll(() => candles(tf), 30_000, [tf]);
export const useStats24h = () => usePoll(stats24h, 30_000);
