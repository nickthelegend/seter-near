import { useEffect, useRef, useState } from 'react';
import { ago, e6, nsToMs, type Stats } from './lib';
import { useNow } from './live';
import { useLivePrice } from './price';
import { Num } from './ui';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts from the previous value to the new one when a real reading changes; the first value appears as is. */
export function CountUp({ value, digits = 0, ms = 900 }: { value: number; digits?: number; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    if (reduced()) { setShown(value); return; }
    setBump(true);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(step); else setBump(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <span className={`count${bump ? ' count-bump' : ''}`}>{shown.toFixed(digits)}</span>;
}

/** The live Coinbase price; each new trade flashes green or red for the direction it moved. */
export function LiveTick({ digits = 4, dimmed = true, className = '' }: { digits?: number; dimmed?: boolean; className?: string }) {
  const p = useLivePrice();
  const [flash, setFlash] = useState(0);
  useEffect(() => { if (p.prev !== null && p.price !== p.prev) setFlash((n) => n + 1); }, [p.price, p.prev]);
  if (p.price === null) return <span className={`tick ${className}`}>{p.error ? '—' : '…'}</span>;
  const v = p.price.toFixed(digits);
  return <span key={flash} className={`tick ${className} ${flash ? `tick-${p.dir}` : ''}`}>{dimmed ? <Num value={v} /> : <span className="num">{v}</span>}</span>;
}

/** Stream status: green while Coinbase trades arrive over the socket, amber on the REST fallback. */
export function StreamDot() {
  const p = useLivePrice();
  const now = useNow(1000);
  const fresh = p.source === 'stream' && now - p.at < 60_000;
  return <span className={`stream ${fresh ? 'on' : p.source === 'rest' ? 'slow' : 'off'}`} title={fresh ? 'Coinbase trade stream connected' : 'Polling the Coinbase ticker'}><i className={fresh ? 'live' : ''} />{fresh ? 'Streaming' : p.source === 'rest' ? 'Polling' : 'Connecting'}</span>;
}

/** The enclave keeper's heartbeat: when the contract last ran a sealed check inside Intel TDX, read live. */
export function EnclavePulse({ stats, compact = false }: { stats: Stats | null; compact?: boolean }) {
  useNow(5000);
  const c = stats?.last_check;
  const at = c ? nsToMs(c.block_ts) : null;
  const age = at ? Date.now() - at : null;
  const tone = age === null ? 'idle' : age < 10 * 60_000 ? 'hot' : age < 24 * 3600_000 ? 'warm' : 'idle';
  return <span className={`pulse-chip pulse-${tone}${compact ? ' pulse-compact' : ''}`}>
    <i aria-hidden="true" />
    {compact ? <>Enclave {at ? ago(at) : stats ? 'idle' : '…'}</> : <><b>Enclave check</b>{c ? <> {ago(at!)} · read {e6(c.price_e6)} · {c.checked} orders opened</> : stats ? ' none yet' : ' …'}</>}
  </span>;
}
