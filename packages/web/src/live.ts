import { useCallback, useEffect, useState } from 'react';
import { view, ticker, type Config, type Order, type Stats, type Ticker } from './lib';

export type Loadable<T> = { data: T | null; error: string; loading: boolean };
const init = <T,>(): Loadable<T> => ({ data: null, error: '', loading: true });

/** Polls one async source; keeps the last good value and shows the error next to it. */
export function usePoll<T>(fn: () => Promise<T>, everyMs: number, deps: unknown[] = []): Loadable<T> & { refresh: () => void } {
  const [state, setState] = useState<Loadable<T>>(init);
  const run = useCallback(() => {
    fn().then((data) => setState({ data, error: '', loading: false })).catch((e: Error) => setState((s) => ({ data: s.data, error: e.message, loading: false })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
    const id = setInterval(() => { if (!document.hidden) run(); }, everyMs);
    return () => clearInterval(id);
  }, [run, everyMs]);
  return { ...state, refresh: run };
}

export const useConfig = () => usePoll<Config>(() => view('get_config'), 60_000);
export const useStats = () => usePoll<Stats>(() => view('get_stats'), 15_000);
export const useOrders = () => usePoll<Order[]>(() => view('get_orders', { limit: 50 }), 15_000);
export const useFired = () => usePoll<Order[]>(() => view('get_fired', {}), 20_000);
export const useTicker = () => usePoll<Ticker>(ticker, 10_000);
