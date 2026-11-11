import { usePoll } from './live';
import { publicJson } from './lib';

/** Coinbase Exchange public market data (CORS-open). The enclave reads the same product's ticker. */
const CB = 'https://api.exchange.coinbase.com/products/NEAR-USD';
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Stats24h = { open: number; high: number; low: number; last: number; volume: number };
export const GRANULARITY = { '15m': 900, '1h': 3600, '6h': 21600, '1D': 86400 } as const;
export type Tf = keyof typeof GRANULARITY;

export async function candles(tf: Tf): Promise<Candle[]> {
  const rows = await publicJson(`${CB}/candles?granularity=${GRANULARITY[tf]}`, 'Coinbase chart');
  if (!Array.isArray(rows) || !rows.length || rows.some((r) => !Array.isArray(r) || r.length !== 6 || r.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v)) || r.slice(0, 5).some((v: number) => v <= 0) || r[5] < 0 || r[1] > Math.min(r[3], r[4]) || r[2] < Math.max(r[3], r[4]))) throw new Error('Coinbase returned invalid candles. The app will retry.');
  return [...new Map(rows.map(([time, low, high, open, close, volume]: number[]) => [time, { time, open, high, low, close, volume }] as const)).values()].sort((a, b) => a.time - b.time);
}
export async function stats24h(): Promise<Stats24h> {
  const s = await publicJson(`${CB}/stats`, 'Coinbase market data');
  const result = { open: Number(s.open), high: Number(s.high), low: Number(s.low), last: Number(s.last), volume: Number(s.volume) };
  if (Object.values(result).some((n) => !Number.isFinite(n)) || Math.min(result.open, result.high, result.low, result.last) <= 0 || result.volume < 0) throw new Error('Coinbase returned invalid market data. The app will retry.');
  return result;
}
export const useCandles = (tf: Tf) => usePoll(() => candles(tf), 30_000, [tf]);
export const useStats24h = () => usePoll(stats24h, 30_000);
