import { useMemo, useState } from 'react';
import { accountUrl, e6, near, nsToMs, shortAccount, usd6, view, type Balance, type Order } from './lib';
import { useBalance, useMine, useNow, usePoll } from './live';
import { CountUp, LiveTick } from './motion';
import { useLivePrice } from './price';
import { AppHeader, Hidden, decrypt } from './Terminal';
import { VaultSheet } from './Sheets';
import { FireCard } from './Activity';
import { Icon, Link, Obj, State } from './ui';
import { PairLogo, TokenLogo, WithLogo } from './logos';
import type { Wallet } from './wallet';

const nearNum = (yocto: string) => Number(BigInt(yocto) / 10n ** 18n) / 1e6;
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/** One account's vault, sealed orders and fills. Balances and orders are public on chain; trigger levels open only
 * on the owner's device. ?account= shows any account read-only. */
export default function Portfolio({ wallet }: { wallet: Wallet }) {
  const param = new URLSearchParams(location.search).get('account') ?? '';
  const account = wallet.account || (/^[a-z0-9._-]+\.testnet$/.test(param) ? param : '');
  const own = Boolean(wallet.account && account === wallet.account);
  const bal = useBalance(account);
  const mine = useMine(account);
  const live = useLivePrice();
  const [vault, setVault] = useState(false);
  useNow(10_000);
  const pool = usePoll<{ near: string; usd: string }>(() => view('get_pool'), 30_000);
  const b: Balance | null = bal.data;
  const px = live.price;
  const nearV = b ? nearNum(b.near) : null;
  const usdV = b ? Number(b.usd) / 1e6 : null;
  const total = nearV !== null && usdV !== null && px ? nearV * px + usdV : null;
  const orders = useMemo(() => [...(mine.data ?? [])].sort((a, b) => b.id - a.id), [mine.data]);
  const open = orders.filter((o) => o.status === 'Open');
  const fired = orders.filter((o) => o.fire);
  const closed = orders.filter((o) => o.status === 'Cancelled');
  const lockedNear = open.reduce((n, o) => { const p = decrypt(o, wallet.account); return p ? n + nearNum(p.amount) : n; }, 0);
  const received = fired.reduce((n, o) => n + Number(o.fire!.filled_out) / 1e6, 0);
  const soldNear = fired.reduce((n, o) => n + nearNum(o.fire!.filled_in), 0);
  if (!account) return <div className="term-page"><AppHeader wallet={wallet} /><main className="page" id="main">
    <header className="page-head"><div><h1>Portfolio</h1><p>Your vault, your sealed orders and every fill, in one place.</p></div></header>
    <State kind="empty" art="envelope-lock" title="Connect a wallet to see your portfolio" action={<button className="btn btn-primary btn-sm" onClick={wallet.connect} disabled={!wallet.ready}>{wallet.ready ? 'Connect wallet' : 'Loading'}</button>}>Balances and orders are public on chain; your trigger levels open only on the device that sealed them.</State>
  </main></div>;
  return <div className="term-page">
    <AppHeader wallet={wallet} onVault={own ? () => setVault(true) : undefined} />
    <main className="page" id="main">
      <header className="page-head">
        <div><h1>Portfolio</h1><p><a href={accountUrl(account)} target="_blank" rel="noreferrer" className="mono">{account}</a>{own ? ' · connected' : ' · read-only view'}</p></div>
        {own && <div className="page-head-r"><button className="btn btn-primary btn-sm" onClick={() => setVault(true)}><Icon name="wallet" size={15} />Deposit · Withdraw</button><Link to="/app" className="btn btn-ghost btn-sm">Seal an order</Link></div>}
      </header>
      <section className="pf-hero dark">
        <div className="pf-total">
          <span className="label">Vault value at the live price</span>
          <b className="num">{total !== null ? <>$<CountUp value={total} digits={2} /></> : bal.error ? '—' : '…'}</b>
          <small>NEAR valued at Coinbase <LiveTick digits={4} dimmed={false} /> · tUSD counted at $1, test token</small>
        </div>
        <dl className="pf-assets">
          <div><dt><TokenLogo sym="NEAR" />NEAR</dt><dd className="mono">{nearV !== null ? <CountUp value={nearV} digits={4} /> : '…'}</dd><small>{nearV !== null && px ? `$${(nearV * px).toFixed(2)}` : ''}</small></div>
          <div><dt><TokenLogo sym="tUSD" />tUSD</dt><dd className="mono">{usdV !== null ? <CountUp value={usdV} digits={4} /> : '…'}</dd><small>test dollars</small></div>
          <div><dt><Icon name="lock" size={14} />Behind sealed stops</dt><dd className="mono">{own ? `${lockedNear.toFixed(4)} NEAR` : <Hidden label="owner only" />}</dd><small>{open.length} armed order{open.length === 1 ? '' : 's'}</small></div>
          <div><dt><Icon name="bolt" size={14} />Sold by fires</dt><dd className="mono">{soldNear.toFixed(4)} NEAR</dd><small>→ {received.toFixed(4)} tUSD received</small></div>
        </dl>
      </section>
      {bal.error && <p className="sheet-err" role="alert">{bal.error}</p>}
      <div className="pf-grid">
        <section className="pnl" aria-label="Armed orders">
          <header className="pnl-tabs"><span className="pnl-tab on">Armed sealed orders<small>{mine.data ? open.length : '…'}</small></span><span className="pnl-note">{own ? 'levels shown only on this device' : 'levels hidden'}</span></header>
          <div className="tbl-wrap">{!mine.data ? <State kind={mine.error ? 'error' : 'loading'} title={mine.error ? 'Could not read orders' : 'Reading orders…'}>{mine.error}</State>
            : !open.length ? <State kind="empty" art="tray-empty" title="No armed orders" action={<Link to="/app" className="btn btn-ghost btn-sm">Seal a stop</Link>}>Seal a stop or take-profit to protect this vault.</State>
            : <table className="tbl"><thead><tr><th>Order</th><th>Type</th><th>Trigger</th><th>Size</th><th>From live</th><th>Placed (UTC)</th><th /></tr></thead>
              <tbody>{open.map((o) => { const p = decrypt(o, wallet.account); const d = p && px ? (p.trigger_e6 / 1e6 / px - 1) * 100 : null; return <tr key={o.id}>
                <td><b className="mono">№{o.id}</b></td>
                <td>{p ? (p.cond === 'lte' ? 'Sealed stop' : 'Sealed take-profit') : 'Sealed'}</td>
                <td>{p ? <span className="mono">{e6(p.trigger_e6)} <small className="dim">only you</small></span> : <Hidden />}</td>
                <td className="mono">{p ? <WithLogo sym="NEAR">{near(p.amount, 4)}</WithLogo> : <Hidden label="" />}</td>
                <td className="mono">{d !== null ? <span className={d < 0 ? 'down' : 'up'}>{d >= 0 ? '+' : ''}{d.toFixed(2)}%</span> : '—'}</td>
                <td className="mono">{utc(nsToMs(o.created_ns))}</td>
                <td className="acts"><Link to={`/order/${o.id}`} className="btn btn-ghost btn-xs">View</Link></td>
              </tr>; })}</tbody></table>}</div>
        </section>
        <section className="pnl" aria-label="Fills">
          <header className="pnl-tabs"><span className="pnl-tab on">Fills<small>{mine.data ? fired.length : '…'}</small></span><span className="pnl-note">pool <PairLogo base="NEAR" quote="USD" size={14} /> {pool.data ? `${near(pool.data.near, 2)} / ${usd6(pool.data.usd, 2)}` : '…'}</span></header>
          <div className="fire-list">{!mine.data ? <State kind="loading" title="Reading fills…" /> : fired.length ? fired.map((o) => <FireCard key={o.id} o={o} now={px} />) : <State kind="empty" art="bell" title="No fills yet">When a sealed order fires, its sale lands here with the price the enclave read.</State>}</div>
        </section>
      </div>
      <section className="pnl" aria-label="Closed orders">
        <header className="pnl-tabs"><span className="pnl-tab on">Cancelled<small>{mine.data ? closed.length : '…'}</small></span><span className="pnl-note">their triggers were never published</span></header>
        <div className="tbl-wrap">{mine.data && !closed.length ? <State kind="empty" art="tray-empty" title="No cancelled orders" /> : <ul className="chips">{closed.map((o) => <li key={o.id}><Link to={`/order/${o.id}`}><b className="mono">№{o.id}</b><Hidden label="never revealed" /><span className="dim mono">{utc(nsToMs(o.created_ns))}</span></Link></li>)}</ul>}</div>
      </section>
      <div className="pf-foot"><Obj name="coin" size={48} float={false} /><p>Viewing {shortAccount(account)}. NEAR testnet only; tUSD is a test token with no value.</p></div>
    </main>
    {vault && own && <VaultSheet wallet={wallet} balance={b} onClose={() => setVault(false)} />}
  </div>;
}
