import { useEffect, useMemo, useRef, useState } from 'react';
import { buildLog, e6, near, nsToMs, ago, usd6, type LogEvent, type Order } from './lib';
import { useNow, useOrders, useRequests, useStats } from './live';
import { CountUp, EnclavePulse, LiveTick, StreamDot } from './motion';
import { useLivePrice } from './price';
import { Hidden, AppHeader } from './Terminal';
import { Icon, Link, Obj, State, Tx } from './ui';
import { PairLogo, WithLogo } from './logos';
import type { Wallet } from './wallet';

type Filter = 'all' | 'sealed' | 'fired' | 'cancelled' | 'checked';
const ICON: Record<LogEvent['kind'], string> = { sealed: 'lock', checked: 'eye', fired: 'bolt', attested: 'seal', cancelled: 'ban' };

/** Fires as money: what was sold, what came back, and what holding would be worth at the live price. */
export function FireCard({ o, now }: { o: Order; now: number | null }) {
  const f = o.fire!;
  const sold = Number(BigInt(f.filled_in) / 10n ** 18n) / 1e6;
  const got = Number(f.filled_out) / 1e6;
  const held = now ? sold * now : null;
  return <Link to={`/order/${o.id}`} className="fire-card">
    <span className="fire-top"><b className="mono">№{o.id}</b><span className="st st-fired"><i />{o.status === 'Unfilled' ? 'Crossed, unfilled' : 'Fired'}</span><span className="dim mono">{ago(nsToMs(f.block_ts))}</span></span>
    <span className="fire-cross mono">{e6(f.price_e6)} <i>{f.cond === 'lte' ? '≤' : '≥'}</i> <span className="gold">{e6(f.trigger_e6)}</span></span>
    <span className="fire-money">{o.status === 'Unfilled' ? <span className="dim">{f.note}</span> : <>Sold <WithLogo sym="NEAR">{near(f.filled_in, 4)}</WithLogo> → <b><WithLogo sym="tUSD">{usd6(f.filled_out, 4)}</WithLogo></b>{held !== null && <small className="dim"> · {(got / Math.max(sold, 1e-9)).toFixed(4)} per NEAR · holding instead: {held.toFixed(4)}</small>}</>}</span>
  </Link>;
}

export default function Activity({ wallet }: { wallet: Wallet }) {
  const stats = useStats();
  const orders = useOrders();
  const requests = useRequests(stats.data?.requests_total);
  const live = useLivePrice();
  const [filter, setFilter] = useState<Filter>('all');
  useNow(15_000);
  const log = useMemo(() => (orders.data && requests.data ? buildLog(orders.data, requests.data) : null), [orders.data, requests.data]);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!log) return;
    if (seen.current) { const added = log.filter((e) => !seen.current!.has(e.key)).map((e) => e.key); if (added.length) setFresh(new Set(added)); }
    seen.current = new Set(log.map((e) => e.key));
  }, [log]);
  const shown = (log ?? []).filter((e) => filter === 'all' || e.kind === filter || (filter === 'checked' && e.kind === 'attested'));
  const fires = (orders.data ?? []).filter((o) => o.fire).sort((a, b) => b.id - a.id);
  const s = stats.data;
  const n = (k: Filter) => (log ? (k === 'all' ? log.length : log.filter((e) => e.kind === k || (k === 'checked' && e.kind === 'attested')).length) : null);
  return <div className="term-page">
    <AppHeader wallet={wallet} />
    <main className="page" id="main">
      <header className="page-head">
        <div><h1>Activity</h1><p>Every sealed order, enclave check and fire on the Seter contract, read live from NEAR testnet.</p></div>
        <div className="page-head-r"><EnclavePulse stats={s} /><StreamDot /></div>
      </header>
      <dl className="kpis">
        <div><dt>Orders sealed</dt><dd>{s ? <CountUp value={s.orders_total} /> : '…'}</dd></div>
        <div><dt>Armed now</dt><dd>{s ? <CountUp value={s.open} /> : '…'}<small> levels visible: <b className="gold">0</b></small></dd></div>
        <div><dt>Fired</dt><dd>{s ? <CountUp value={s.fired} /> : '…'}</dd></div>
        <div><dt>Cancelled, never revealed</dt><dd>{s ? <CountUp value={s.cancelled} /> : '…'}</dd></div>
        <div><dt>Enclave runs</dt><dd>{s ? <CountUp value={s.requests_total} /> : '…'}<small> · {s?.rejected_reports ?? '…'} rejected</small></dd></div>
        <div><dt><span className="tamt"><PairLogo base="NEAR" quote="USD" />NEAR / USD</span></dt><dd className="mono"><LiveTick /></dd></div>
      </dl>
      <div className="act-grid">
        <section className="pnl act-feed" aria-label="Event feed">
          <header className="pnl-tabs" role="tablist">
            {([['all', 'All'], ['sealed', 'Sealed'], ['fired', 'Fired'], ['cancelled', 'Cancelled'], ['checked', 'Checks']] as [Filter, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={`pnl-tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}{n(k) !== null && <small>{n(k)}</small>}</button>)}
            <span className="pnl-note">updates every 15 s</span>
          </header>
          {!log ? <div className="tbl-wrap"><State kind={orders.error || requests.error ? 'error' : 'loading'} art={orders.error || requests.error ? 'warning' : undefined} title={orders.error || requests.error ? 'Could not read the contract' : 'Reading the contract…'}>{orders.error || requests.error}</State></div>
            : !shown.length ? <div className="tbl-wrap"><State kind="empty" art="tray-empty" title="Nothing here yet">No events of this kind on the contract.</State></div>
            : <ol className="feed">{shown.map((e) => <li key={e.key} className={`feed-row feed-${e.kind}${fresh.has(e.key) ? ' feed-new' : ''}`}>
              <span className="feed-ic"><Icon name={ICON[e.kind]} size={16} /></span>
              <div className="feed-main">
                <p>{e.order ? <Link to={`/order/${e.order}`}>{e.title}</Link> : e.title}{e.kind === 'sealed' && <> <Hidden label="trigger hidden" /></>}</p>
                <small>{e.detail}</small>
              </div>
              <div className="feed-r"><span className="mono dim" title={new Date(e.at).toISOString()}>{ago(e.at)}</span>{e.tx ? <Tx hash={e.tx} /> : <span className="dim mono small">view call</span>}</div>
            </li>)}</ol>}
        </section>
        <aside className="act-side">
          <section className="pnl act-fires" aria-label="Recent fires">
            <header className="pnl-tabs"><span className="pnl-tab on">Recent fires</span><span className="pnl-note">in money terms</span></header>
            <div className="fire-list">{orders.data ? (fires.length ? fires.slice(0, 6).map((o) => <FireCard key={o.id} o={o} now={live.price} />) : <State kind="empty" art="bell" title="No fires yet" />) : <State kind="loading" title="Reading fires…" />}</div>
          </section>
          <section className="pnl act-trades" aria-label="Coinbase trades">
            <header className="pnl-tabs"><span className="pnl-tab on">Coinbase trades</span><span className="pnl-note">NEAR-USD · the enclave’s source</span></header>
            {live.trades.length ? <ul className="trades mono">{live.trades.slice(0, 12).map((t, i, a) => <li key={t.id} className={!a[i + 1] || t.price >= a[i + 1].price ? 'up' : 'down'}><span>{t.price.toFixed(4)}</span><span>{t.size.toFixed(1)}</span><span className="dim">{new Date(t.time).toISOString().slice(11, 19)}</span></li>)}</ul>
              : <div className="tbl-wrap"><State kind="loading" title="Waiting for the next Coinbase trade…">Trades stream in as they print on Coinbase.</State></div>}
          </section>
          <div className="act-note"><Obj name="eye-slash" size={56} float={false} /><p>A sealed order shows its owner and time, never its level. Levels appear only in the fire that published them.</p></div>
        </aside>
      </div>
    </main>
  </div>;
}
