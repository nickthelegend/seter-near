import { useMemo, useState } from 'react';
import { ago, e6, near, nsToMs, shortAccount, txForOrder, type Order } from './lib';
import { useOrders, useStats } from './live';
import { CountUp, EnclavePulse, LiveTick, StreamDot } from './motion';
import { AppHeader, Hidden } from './Terminal';
import { Link, Obj, State, Tx, shortHex } from './ui';
import { PairLogo } from './logos';
import type { Wallet } from './wallet';

type Filter = 'armed' | 'fired' | 'cancelled' | 'all';
const status = (o: Order) => (o.status === 'Open' ? 'armed' : o.status.toLowerCase());

/** The whole sealed book as a stop hunter would read it from chain: every order, no armed level. */
export default function Book({ wallet }: { wallet: Wallet }) {
  const orders = useOrders();
  const stats = useStats();
  const [filter, setFilter] = useState<Filter>('armed');
  const list = useMemo(() => [...(orders.data ?? [])].sort((a, b) => b.id - a.id), [orders.data]);
  const shown = list.filter((o) => filter === 'all' || status(o) === filter || (filter === 'fired' && o.status === 'Unfilled'));
  const s = stats.data;
  const b = s?.bands;
  const count = (f: Filter) => list.filter((o) => f === 'all' || status(o) === f || (f === 'fired' && o.status === 'Unfilled')).length;
  return <div className="term-page">
    <AppHeader wallet={wallet} />
    <main className="page" id="main">
      <header className="page-head">
        <div><h1>Sealed book</h1><p>Every order on the contract, exactly as anyone can read it. Armed orders carry no price.</p></div>
        <div className="page-head-r"><EnclavePulse stats={s} /><StreamDot /></div>
      </header>
      <section className="bk-top">
        <div className="bk-price dark">
          <span className="tamt"><PairLogo base="NEAR" quote="USD" size={26} /><b>NEAR / USD</b></span>
          <p className="bk-last"><LiveTick /></p>
          <small>Coinbase, streamed live · the enclave reads the same product</small>
        </div>
        <dl className="bk-stats">
          <div><dt>Armed orders</dt><dd>{s ? <CountUp value={s.open} /> : '…'}</dd></div>
          <div><dt>Armed levels anyone can read</dt><dd className="gold">{s ? '0' : '…'}</dd></div>
          <div><dt>Revealed by fires</dt><dd>{s ? <CountUp value={s.fired + s.unfilled} /> : '…'}</dd></div>
          <div><dt>Band report (k = {b?.k ?? 5})</dt><dd className="bk-band">{b ? `${b.suppressed} of ${b.total} suppressed` : s ? 'none yet' : '…'}<small>{b ? ` · bands of $${e6(b.width_e6)}` : ''}</small></dd></div>
        </dl>
      </section>
      <section className="pnl" aria-label="Orders">
        <header className="pnl-tabs" role="tablist">
          {([['armed', 'Armed'], ['fired', 'Fired'], ['cancelled', 'Cancelled'], ['all', 'All']] as [Filter, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={`pnl-tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}{orders.data && <small>{count(k)}</small>}</button>)}
          <span className="pnl-note">get_orders · NEAR testnet</span>
        </header>
        <div className="tbl-wrap">{!orders.data ? <State kind={orders.error ? 'error' : 'loading'} art={orders.error ? 'warning' : undefined} title={orders.error ? 'Could not read the sealed book' : 'Reading the sealed book…'}>{orders.error}</State>
          : !shown.length ? <State kind="empty" art="tray-empty" title={`No ${filter === 'all' ? '' : filter + ' '}orders`}>{filter === 'armed' ? 'Seal a stop in the trading screen and it appears here, without its price.' : 'Nothing in this group yet.'}</State>
          : <table className="tbl bk-tbl"><thead><tr><th>Order</th><th>Owner</th><th>Sealed</th><th>Ciphertext</th><th>Trigger</th><th>Size</th><th>Status</th><th>Tx</th><th /></tr></thead>
            <tbody>{shown.map((o) => { const f = o.fire; const tx = txForOrder(o.id); return <tr key={o.id}>
              <td><b className="mono">№{o.id}</b></td>
              <td className="mono">{shortAccount(o.owner)}</td>
              <td className="mono" title={new Date(nsToMs(o.created_ns)).toISOString()}>{ago(nsToMs(o.created_ns))}</td>
              <td><code className="bk-ct">{shortHex(o.ct, 14, 6)}</code><small>{o.ct.length} chars</small></td>
              <td>{f ? <span className="mono gold">{e6(f.trigger_e6)} <small className="dim">revealed</small></span> : <Hidden label={o.status === 'Cancelled' ? 'never revealed' : 'sealed'} />}</td>
              <td className="mono">{f ? `${near(f.amount, 2)} NEAR` : <Hidden label="" />}</td>
              <td><span className={`st st-${status(o)}`}><i />{o.status === 'Open' ? 'Armed' : o.status}</span></td>
              <td>{tx ? <Tx hash={tx} /> : <span className="dim">—</span>}</td>
              <td className="acts"><Link to={`/order/${o.id}`} className="btn btn-ghost btn-xs">View</Link></td>
            </tr>; })}</tbody></table>}
        </div>
      </section>
      <div className="act-note"><Obj name="candle-hidden" size={56} float={false} /><p>On a public exchange this table would list every stop price. Here a hunter learns who placed an order and when, and nothing about where it fires.</p></div>
    </main>
  </div>;
}
