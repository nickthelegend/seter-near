import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQuote, view, ticker, type Balance, type Config, type LiveQuote, type Order, type Request, type Stats, type Ticker } from './lib';
import { TRANSACTION_EVENT } from './receipts';

export type Loadable<T> = { data: T | null; error: string; loading: boolean };
const init = <T,>(): Loadable<T> => ({ data: null, error: '', loading: true });

/** Polls one async source; keeps the last good value and shows the error next to it. */
export function usePoll<T>(fn: () => Promise<T>, everyMs: number, deps: unknown[] = []): Loadable<T> & { refresh: () => void } {
  const [state, setState] = useState<Loadable<T>>(init);
  const active = useRef(false);
  const latest = useRef(0);
  const run = useCallback(() => {
    const request = ++latest.current;
    fn().then((data) => {
      if (active.current && request === latest.current) setState({ data, error: '', loading: false });
    }).catch((e: unknown) => {
      if (active.current && request === latest.current) setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : 'Data could not be refreshed.', loading: false }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    active.current = true;
    setState(init<T>());
    run();
    addEventListener(TRANSACTION_EVENT, run);
    const id = everyMs ? setInterval(() => { if (!document.hidden) run(); }, everyMs) : undefined;
    return () => { active.current = false; ++latest.current; if (id !== undefined) clearInterval(id); removeEventListener(TRANSACTION_EVENT, run); };
  }, [run, everyMs]);
  return { ...state, refresh: run };
}

export const useConfig = () => usePoll<Config>(() => view('get_config'), 60_000);
export const useStats = () => usePoll<Stats>(() => view('get_stats'), 15_000);
export const useOrders = () => usePoll<Order[]>(() => view('get_orders', { limit: 50 }), 15_000);
export const useFired = () => usePoll<Order[]>(() => view('get_fired', {}), 20_000);
export const useTicker = () => usePoll<Ticker>(ticker, 10_000);
export const useBalance = (account: string) => usePoll<Balance | null>(() => (account ? view('balance_of', { account_id: account }) : Promise.resolve(null)), 15_000, [account]);
export const useMine = (account: string) => usePoll<Order[] | null>(() => (account ? view('get_orders_of', { owner: account }) : Promise.resolve(null)), 15_000, [account]);
/** Every OutLayer request the contract has issued (keys, checks, band reports). */
export const useRequests = (total: number | undefined) => usePoll<Request[] | null>(async () => {
  if (total === undefined) return null;
  const ids = Array.from({ length: total }, (_, i) => i + 1);
  const all = await Promise.all(ids.map((id) => view<Request | null>('get_request', { id })));
  return all.filter(Boolean) as Request[];
}, 30_000, [total]);
export const useQuote = (tx: string | undefined) => usePoll<LiveQuote | null>(() => (tx ? fetchQuote(tx) : Promise.resolve(null)), 0, [tx]);

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => { const mq = matchMedia(query); const on = () => setMatch(mq.matches); mq.addEventListener('change', on); on(); return () => mq.removeEventListener('change', on); }, [query]);
  return match;
}
