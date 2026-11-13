import { useMemo, useState } from 'react';
import { ago, e6, near, nsToMs, short, txForOrder, usd6, type Order } from './lib';
import { useConfig, useMine, useOrders, useStats } from './live';
import { EnclavePulse } from './motion';
import { AppHeader, Hidden } from './Terminal';
import TwoViews from './TwoViews';
import { Link, Obj, State, Tx, type ObjName } from './ui';
import type { Wallet } from './wallet';

/** Labelled illustration, not market data: price drifts toward a public cluster of stops, one wick takes them, it recovers. */
export function StopHunt() {
  const pts = [[0, 60], [40, 66], [80, 58], [120, 72], [160, 70], [200, 84], [240, 80], [270, 96], [292, 168], [312, 104], [350, 92], [390, 78], [430, 82], [470, 66], [520, 60]];
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  return <figure className="hunt" aria-label="Illustration: a public stop level being hunted">
    <svg viewBox="0 0 520 200" role="img">
      <defs><linearGradient id="hunt-f" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#5a46d4" stopOpacity=".18" /><stop offset="1" stopColor="#5a46d4" stopOpacity="0" /></linearGradient></defs>
      <line x1="0" x2="520" y1="150" y2="150" className="hunt-level" />
      <text x="8" y="142" className="hunt-label">visible stops at $3.30 · 4,200 NEAR</text>
      <path d={`${d} L520 200 L0 200 Z`} fill="url(#hunt-f)" />
      <path d={d} className="hunt-line" pathLength={1} />
      <circle cx="292" cy="168" r="6" className="hunt-hit" />
      <text x="512" y="190" textAnchor="end" className="hunt-label hunt-label-hit">stops taken, then the price recovers</text>
    </svg>
    <figcaption>Illustration · stop hunting on a public order book</figcaption>
  </figure>;
}

const STEPS: { obj: ObjName; where: string; title: string }[] = [
  { obj: 'envelope-lock', where: 'In your browser', title: 'Your stop is encrypted before it leaves the page' },
  { obj: 'candle-hidden', where: 'On NEAR', title: 'The contract stores only ciphertext and a commitment' },
  { obj: 'badge', where: 'Inside Intel TDX', title: 'A protected computer opens it and compares it to the price' },
  { obj: 'bell', where: 'When the price crosses', title: 'It fires, sells on the pool and publishes the level' },
];

export default function HowItWorks({ wallet }: { wallet: Wallet }) {
  const config = useConfig();
  const stats = useStats();
  const all = useOrders();
  const mine = useMine(wallet.account);
  const orders = useMemo(() => [...(all.data ?? [])].sort((a, b) => b.id - a.id), [all.data]);
  const latest = orders[0];
  const fire = orders.find((o) => o.fire);
  const c = stats.data?.last_check;
  const ownOpen = [...(mine.data ?? [])].sort((a, b) => b.id - a.id).find((o) => o.status === 'Open');
  const picks = useMemo(() => { const list: Order[] = []; for (const o of [ownOpen, ...orders.filter((o) => o.status === 'Open'), ...orders.filter((o) => o.fire)]) if (o && !list.some((x) => x.id === o.id)) list.push(o); return list.slice(0, 6); }, [ownOpen, orders]);
  const [pick, setPick] = useState<number | null>(null);
  const chosen = picks.find((o) => o.id === pick) ?? picks[0];
  const live: React.ReactNode[] = [
    config.data?.tee ? <>Enclave key <code>{short(config.data.tee.order_pub, 8)}</code>, published by an attested run</> : config.error ? 'Enclave key unavailable' : 'Reading the enclave key…',
    latest ? <>Latest: order <Link to={`/order/${latest.id}`}>№{latest.id}</Link> · {latest.ct.length}-char ciphertext {txForOrder(latest.id) && <Tx hash={txForOrder(latest.id)!} />}</> : 'Reading orders…',
    c ? <>Last check {ago(nsToMs(c.block_ts))}: read <b className="mono">{e6(c.price_e6)}</b> from Coinbase, opened {c.checked} orders, fired {c.fired.length}</> : stats.data ? 'No check yet' : 'Reading checks…',
    fire?.fire ? <>Order <Link to={`/order/${fire.id}`}>№{fire.id}</Link> fired at <b className="mono gold">{e6(fire.fire.trigger_e6)}</b>: sold {near(fire.fire.filled_in, 2)} NEAR for {usd6(fire.fire.filled_out)} tUSD</> : 'No fire yet',
  ];
  return <div className="term-page">
    <AppHeader wallet={wallet} />
    <main className="page" id="main">
      <header className="page-head"><div><h1>How it works</h1><p>A normal stop-loss tells the whole market where you will sell. Seter keeps it sealed until it fires.</p></div><div className="page-head-r"><EnclavePulse stats={stats.data} /></div></header>

      <section className="hw-problem">
        <div className="hw-copy">
          <h2>Your stop-loss is public.</h2>
          <p>On a public order book, a resting stop shows its trigger price to everyone. Traders with size can push the price to that level, take the stops, and let it bounce back.</p>
          <div className="hw-public">
            <span className="label">A normal stop order publishes · illustration</span>
            <pre className="view-json"><span className="k">type</span>    <span>stop_loss</span>{'\n'}<span className="k">trigger</span> <span className="bad">3.30</span>{'\n'}<span className="k">size</span>    <span className="bad">4,200 NEAR</span>{'\n'}<span className="k">side</span>    <span className="bad">sell</span></pre>
          </div>
        </div>
        <StopHunt />
      </section>

      <section className="hw-flow" aria-label="The four steps, with live data">
        <h2>Four steps, all on the record</h2>
        <ol className="rail">{STEPS.map((s, i) => <li key={s.where}>
          <Obj name={s.obj} size={64} float={false} />
          <div><span className="label">{s.where}</span><h3>{s.title}</h3><p className="rail-live">{live[i]}</p></div>
        </li>)}</ol>
      </section>

      <section className="hw-views">
        <div className="hw-views-head"><h2>What you see, and what everyone else sees</h2>
          {picks.length > 1 && <div className="seg" role="tablist" aria-label="Order">{picks.map((o) => <button key={o.id} role="tab" aria-selected={chosen?.id === o.id} className={chosen?.id === o.id ? 'on' : ''} onClick={() => setPick(o.id)}>№{o.id}{o.fire ? ' · fired' : ''}</button>)}</div>}
        </div>
        {chosen ? <TwoViews order={chosen} account={wallet.account} title={false} /> : <State kind={all.error ? 'error' : 'loading'} title={all.error ? 'Could not read orders' : 'Reading orders…'}>{all.error}</State>}
      </section>

      <section className="hw-ledger">
        <h2>What is public, and what is not</h2>
        <div className="ledger">
          <div><h3>Anyone can read</h3><ul><li>Owner account, time placed, status</li><li>Ciphertext and commitment</li><li>When checks run and the price each one read</li><li>Fills, and the level, after an order fires</li></ul></div>
          <div><h3>Sealed until it fires</h3><ul><li>Trigger price <Hidden label="" /></li><li>Stop or take-profit <Hidden label="" /></li><li>Size <Hidden label="" /></li><li>Cancelled orders stay sealed forever</li></ul></div>
          <div><h3>Known limits</h3><ul><li>A check that fires nothing tells watchers no level was crossed</li><li>Band reports group levels only when 5 or more share a band</li><li>One price source: Coinbase NEAR-USD</li><li>Fills settle on a test pool; mainnet is not built</li></ul></div>
        </div>
      </section>
    </main>
  </div>;
}
