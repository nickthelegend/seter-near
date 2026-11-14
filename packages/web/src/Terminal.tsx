import { useEffect, useMemo, useRef, useState } from 'react';
import { openView } from '@mienai/sdk/crypto';
import OrderTicket from './OrderTicket';
import { CONTRACT, OUTLAYER_API, accountUrl, ago, buildLog, e6, enclaveUpload, near, nsToMs, orderSize, orderType, outlayerRuns, short, shortAccount, toYocto, txForMarket, txForPublic, txForRequest, usd6, type Balance, type Config, type LogEvent, type MarketFill, type Order, type OutlayerRun, type PublicOrder, type Stats } from './lib';
import { useBalance, useConfig, useKeeper, useMarketFills, useMedia, useMine, useOcoPairs, useOrders, usePublicOrders, useQuote, useRequests, useStats, useTicker } from './live';
import { GRANULARITY, useCandles, useStats24h, type Tf } from './market';
import Chart, { type ChartMark } from './Chart';
import { Icon, Link, State, Tx, Wordmark, shortHex } from './ui';
export { orderType };
import { VaultSheet, viewKeyFor } from './Sheets';
import type { Wallet } from './wallet';
import { art } from './art';
import { CountUp, EnclavePulse, LiveTick, StreamDot } from './motion';
import { PairLogo, WithLogo } from './logos';

export type Plain = { cond: string; trigger_e6: number; amount: string; side?: string };
export function decrypt(o: Order, account: string): Plain | null {
  if (o.fire) return { cond: o.fire.cond, trigger_e6: o.fire.trigger_e6, amount: o.fire.amount, side: o.fire.side };
  if (!account || o.owner !== account) return null;
  const key = viewKeyFor(account);
  if (!key || !o.view_ct) return null;
  try { return JSON.parse(openView(key, account, o.view_ct)); } catch { return null; }
}
export const Hidden = ({ label = 'hidden' }: { label?: string }) => <span className="hidden-pill" title="Encrypted to the enclave; not on chain in plaintext"><i aria-hidden="true">••••</i>{label}</span>;
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/* ---------------- header ---------------- */
const NAV: [string, string][] = [['/app', 'Trade'], ['/book', 'Sealed book'], ['/portfolio', 'Portfolio'], ['/activity', 'Activity'], ['/how-it-works', 'How it works']];
export function AppHeader({ wallet, onVault }: { wallet: Wallet; onVault?: () => void }) {
  return <header className="ahead">
    <Link to="/" aria-label="Seter home"><Wordmark small /></Link>
    <nav className="ahead-nav" aria-label="App">{NAV.map(([to, label]) => <Link key={to} to={to} aria-current={location.pathname.startsWith(to) ? 'page' : undefined}>{label}</Link>)}</nav>
    <div className="ahead-right">
      <span className="net"><i className="live" />NEAR testnet</span>
      {wallet.account && onVault && <button className="btn btn-ghost btn-sm" onClick={onVault}><Icon name="wallet" size={15} />Vault</button>}
      {wallet.account
        ? <button className="btn btn-ghost btn-sm account-button" onClick={wallet.disconnect} title={`Sign out ${wallet.account}`}><span>{shortAccount(wallet.account)}</span></button>
        : <button className="btn btn-primary btn-sm" onClick={wallet.connect} disabled={!wallet.ready}>{wallet.ready ? 'Connect wallet' : 'Loading'}</button>}
    </div>
    <nav className="mnav" aria-label="App sections">{NAV.map(([to, label]) => <Link key={to} to={to} aria-current={location.pathname.startsWith(to) ? 'page' : undefined}>{label}</Link>)}</nav>
  </header>;
}

/* ---------------- market bar ---------------- */
function MarketBar({ stats }: { stats: Stats | null }) {
  const t = useTicker();
  const d = useStats24h();
  const last = t.data ? Number(t.data.price) : d.data?.last ?? null;
  const chg = d.data && last ? last - d.data.open : null;
  const pct = chg !== null && d.data ? (chg / d.data.open) * 100 : null;
  const up = (chg ?? 0) >= 0;
  const cell = (label: string, value: React.ReactNode, cls = '') => <div className={`mb-cell ${cls}`}><span>{label}</span><b>{value}</b></div>;
  return <section className="mbar dark" aria-label="Market">
    <div className="mb-pair"><PairLogo base="NEAR" quote="USD" size={28} /><div><b>NEAR / USD</b><small>Sealed spot · vault</small></div></div>
    <div className={`mb-last ${chg === null ? '' : up ? 'up' : 'down'}`}><LiveTick /><small><StreamDot /></small></div>
    <div className="mb-cells">
      {cell('24h change', chg === null ? '…' : <span className={up ? 'up' : 'down'}>{up ? '+' : ''}{chg.toFixed(4)} / {up ? '+' : ''}{pct!.toFixed(2)}%</span>)}
      {cell('24h high', d.data ? d.data.high.toFixed(4) : '…')}
      {cell('24h low', d.data ? d.data.low.toFixed(4) : '…')}
      {cell('24h volume (NEAR)', d.data ? Math.round(d.data.volume).toLocaleString('en-US') : '…')}
      {cell('Enclave read', stats?.last_check ? <>{e6(stats.last_check.price_e6)} <EnclavePulse stats={stats} compact /></> : stats ? 'no check yet' : '…')}
      {cell('Armed', stats ? <CountUp value={stats.open} /> : '…')}
      {cell('Open levels exposed', stats ? <span className="gold">0</span> : '…')}
      <div className="mb-cell"><span>Source</span><b><a href="https://api.exchange.coinbase.com/products/NEAR-USD/ticker" target="_blank" rel="noreferrer">Coinbase <Icon name="external" size={11} /></a></b></div>
    </div>
    {(d.error || t.error) && <p className="mb-err" role="status">{d.error || t.error}</p>}
  </section>;
}

/* ---------------- chart panel ---------------- */
function ChartPanel({ stats, fired, requestsLog }: { stats: Stats | null; fired: Order[]; requestsLog: LogEvent[] | null }) {
  const [tf, setTf] = useState<Tf>('1h');
  const c = useCandles(tf);
  const lastC = c.data?.[c.data.length - 1];
  const marks = useMemo<ChartMark[]>(() => [
    ...fired.filter((o) => o.fire).map((o) => ({ time: Math.floor(nsToMs(o.fire!.block_ts) / 1000), label: `№${o.id} fired`, tone: 'fire' as const })),
    ...(requestsLog ?? []).filter((e) => e.kind === 'checked' && e.title.startsWith('Check')).map((e) => ({ time: Math.floor(e.at / 1000), label: 'check', tone: 'check' as const })),
  ], [fired, requestsLog]);
  return <section className="pnl chartp" aria-label="Price chart">
    <header className="pnl-tabs">
      <span className="pnl-tab on">Chart</span>
      <div className="tfs" role="tablist" aria-label="Timeframe">{(Object.keys(GRANULARITY) as Tf[]).map((k) => <button key={k} role="tab" aria-selected={tf === k} className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>{k}</button>)}</div>
      {lastC && <p className="ohlc mono"><span>O <b>{lastC.open.toFixed(4)}</b></span><span>H <b>{lastC.high.toFixed(4)}</b></span><span>L <b>{lastC.low.toFixed(4)}</b></span><span>C <b className={lastC.close >= lastC.open ? 'up' : 'down'}>{lastC.close.toFixed(4)}</b></span></p>}
    </header>
    <div className="chart-box">
      {c.data ? <Chart data={c.data} enclavePrice={stats?.last_check ? stats.last_check.price_e6 / 1e6 : null} marks={marks} />
        : <State kind={c.error ? 'error' : 'loading'} title={c.error ? 'Could not load Coinbase candles' : 'Loading Coinbase candles…'}>{c.error}</State>}
    </div>
    <p className="chart-foot mono">NEAR-USD candles from Coinbase Exchange · dashed line: the last price the enclave read inside Intel TDX · markers: enclave checks and fires</p>
  </section>;
}

/* ---------------- sealed book ---------------- */
function SealedBook({ orders, error, stats, last, pub }: { orders: Order[] | null; error: string; stats: Stats | null; last: number | null; pub: PublicOrder[] }) {
  const pubOpen = pub.filter((o) => o.status === 'Open').sort((a, b) => b.trigger_e6 - a.trigger_e6);
  const armed = (orders ?? []).filter((o) => o.status === 'Open').sort((a, b) => b.id - a.id);
  const revealed = (orders ?? []).filter((o) => o.fire).sort((a, b) => b.id - a.id);
  const b = stats?.bands;
  return <section className="pnl book" aria-label="Sealed book">
    <header className="pnl-tabs"><span className="pnl-tab on">Sealed book</span><span className="pnl-note">dark</span></header>
    <div className="book-cols mono"><span>Trigger</span><span>Size</span><span>Age</span></div>
    {!orders ? <p className="book-empty dim" role={error ? 'alert' : 'status'}>{error || 'Loading…'}</p> : <>
      <ul className="book-rows">{armed.length ? armed.map((o) => <li key={o.id}><Link to={`/order/${o.id}`}><span><Hidden label="" /></span><span><Hidden label="" /></span><span className="mono dim">{ago(nsToMs(o.created_ns))}</span></Link></li>) : <li className="book-empty dim">No armed orders</li>}</ul>
      <div className="book-mid"><b className="mono">{last ? last.toFixed(4) : '…'}</b><span>Coinbase last · {armed.length} sealed level{armed.length === 1 ? '' : 's'} around it</span></div>
      {pubOpen.length > 0 && <><p className="book-sub book-sub-pub mono">Public orders · no seal · readable</p>
      <ul className="book-rows book-pub">{pubOpen.map((o) => <li key={`p${o.id}`}><a href={txForPublic(o.id) ? `https://testnet.nearblocks.io/txns/${txForPublic(o.id)}` : '/book#hunter'}><span className="mono pub-trig">{e6(o.trigger_e6)}</span><span className="mono">{orderSize(o.amount, o.side)}</span><span className="mono dim">{ago(nsToMs(o.created_ns))}</span></a></li>)}</ul></>}
      <p className="book-sub mono">Revealed after firing</p>
      <ul className="book-rows">{revealed.length ? revealed.map((o) => <li key={o.id}><Link to={`/order/${o.id}`}><span className="mono gold">{e6(o.fire!.trigger_e6)}</span><span className="mono">{near(o.fire!.amount, 2)}</span><span className="mono dim">{ago(nsToMs(o.fire!.block_ts))}</span></Link></li>) : <li className="book-empty dim">Nothing fired yet</li>}</ul>
    </>}
    <footer className="book-foot">
      <div><span>Open levels visible</span><b className="gold">{stats ? 0 : '…'}</b></div>
      <div><span>Band report (k = {b?.k ?? 5})</span><b>{b ? `${b.suppressed}/${b.total} suppressed` : stats ? 'none yet' : '…'}</b></div>
    </footer>
  </section>;
}

/* ---------------- order panel ---------------- */
function OrderPanel({ wallet, config, configError, balance, stats, onVault }: { wallet: Wallet; config: Config | null; configError: string; balance: Balance | null; stats: Stats | null; onVault: () => void }) {
  return <OrderTicket wallet={wallet} config={config} configError={configError} balance={balance} stats={stats}>
    <div className="vault-box">
      <div className="vb-head"><span>Vault</span>{wallet.account ? <button className="link" onClick={onVault}>Deposit · Withdraw</button> : <button className="link" onClick={wallet.connect} disabled={!wallet.ready}>Connect</button>}</div>
      <div className="frow"><span><WithLogo sym="NEAR">NEAR</WithLogo></span><b className="mono">{wallet.account ? (balance ? near(balance.near) : '…') : '—'}</b></div>
      <div className="frow"><span><WithLogo sym="tUSD">tUSD</WithLogo> <small className="dim">test token</small></span><b className="mono">{wallet.account ? (balance ? usd6(balance.usd) : '…') : '—'}</b></div>
    </div>
    <EnclaveBox config={config} stats={stats} wallet={wallet} />
  </OrderTicket>;
}

function EnclaveBox({ config, stats, wallet }: { config: Config | null; stats: Stats | null; wallet: Wallet }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function check() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setErr('');
    try { await wallet.call('check', {}, toYocto('0.02'), 300); }
    catch (e) { setErr((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  const pinned = config?.enclave_hash;
  const keeper = useKeeper();
  return <div className="vault-box enclave-box">
    <div className="vb-head"><span className="vb-title"><img src={art('enclave').src} alt="" aria-hidden="true" />Enclave · Intel TDX</span>{pinned ? (pinned === enclaveUpload.sha256 ? <span className="ok-chip"><Icon name="check" size={12} />hash = build</span> : <span className="bad-chip">hash ≠ build</span>) : null}</div>
    <div className="frow"><span>Last check</span><b className="mono">{stats?.last_check ? `${e6(stats.last_check.price_e6)} · ${ago(nsToMs(stats.last_check.block_ts))}` : stats ? 'none yet' : '…'}</b></div>
    <div className="frow"><span>Runs / rejected</span><b className="mono">{stats ? `${stats.requests_total} / ${stats.rejected_reports}` : '…'}</b></div>
    <div className="frow keeper-row"><span>Keeper key</span><b className="mono">{keeper.data ? <><span className="keeper-only">{keeper.data.methods.join(', ')}</span> only</> : keeper.loading ? '…' : 'none'}</b></div>
    <div className="frow"><span>Keeper budget</span><b className="mono">{keeper.data ? `${near(keeper.data.budget, 2)} NEAR` : keeper.loading ? '…' : '—'}</b></div>
    <div className="frow second-row"><span>Second check</span><b className="mono">{config?.second_source?.enabled ? `price oracle ±${config.second_source.tolerance_bps / 100}%` : config ? 'off' : '…'}</b></div>
    <div className="frow"><span>Pinned WASM</span><b className="mono">{pinned ? short(pinned, 6) : '…'}</b></div>
    {wallet.account && <button className="btn btn-ghost btn-sm btn-block" disabled={busy} onClick={check}><Icon name="eye" size={15} />{busy ? 'Opening wallet…' : 'Pay for a check · 0.02 NEAR'}</button>}
    {err && <p className="sheet-err" role="alert">{err}</p>}
    <p className="form-note">Mainnet settlement through NEAR Intents: <b>Not built</b>.</p>
  </div>;
}

/* ---------------- bottom panel ---------------- */
type Tab = 'open' | 'history' | 'log' | 'att';
function typeLabel(p: Plain | null) { return p ? `Sealed ${orderType(p.cond, p.side)}` : 'Sealed'; }
const OcoChip = ({ partner }: { partner?: number }) => partner ? <small className="oco-chip" title="One cancels the other">OCO ↔ №{partner}</small> : null;
const PubChip = () => <small className="pub-chip"><Icon name="eye" size={10} />no seal</small>;

function AttRow({ r }: { r: OutlayerRun }) {
  const q = useQuote(r.tx);
  return <tr>
    <td><span className="ocell"><img src={art(r.attestation ? 'seal' : 'enclave').src} alt="" aria-hidden="true" /><span><b>{r.kind === 'Keys' ? 'Key publication' : r.kind === 'Check' ? 'Price check' : 'Band report'}</b><small>{r.label}</small></span></span></td>
    <td className="mono">{utc(Date.parse(r.at))}</td>
    <td>{r.attestation ? <span className="ok-chip"><Icon name="check" size={12} />{Object.values(r.attestation.checks).filter(Boolean).length}/{Object.keys(r.attestation.checks).length} · TCB {r.attestation.tcb.status}</span> : <span className="dim">quote only</span>}</td>
    <td className="mono">{q.data ? shortHex(q.data.quoteSha256, 10, 6) : q.error ? <span className="dim">unavailable</span> : '…'}</td>
    <td><Tx hash={r.tx} /></td>
    <td>{r.attestation && r.order !== undefined ? <Link to={`/order/${r.order}`} className="btn btn-ghost btn-xs">Certificate</Link> : <a className="btn btn-ghost btn-xs" href={`${OUTLAYER_API}/attestations/by-tx/${r.tx}`} target="_blank" rel="noreferrer">Raw <Icon name="external" size={11} /></a>}</td>
  </tr>;
}

function BottomPanel({ wallet, orders, ordersErr, log, logErr, pub, fills, pairs }: { wallet: Wallet; orders: Order[] | null; ordersErr: string; log: LogEvent[] | null; logErr: string; pub: PublicOrder[]; fills: MarketFill[]; pairs: [number, number][] }) {
  const [tab, setTab] = useState<Tab>('open');
  const [err, setErr] = useState('');
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const cancelling = useRef(new Set<number>());
  async function cancel(id: number) {
    if (cancelling.current.has(id)) return;
    cancelling.current.add(id); setPendingIds([...cancelling.current]); setErr('');
    try { await wallet.call(id < 0 ? 'cancel_public_order' : 'cancel_order', { id: Math.abs(id) }, '0', 30); }
    catch (e) { setErr((e as Error).message); }
    finally { cancelling.current.delete(id); setPendingIds([...cancelling.current]); }
  }
  const open = (orders ?? []).filter((o) => o.status === 'Open').sort((a, b) => b.id - a.id);
  const hist = (orders ?? []).filter((o) => o.status !== 'Open').sort((a, b) => b.id - a.id);
  const partner = (id: number) => pairs.find((p) => p.includes(id))?.find((x) => x !== id);
  const pubOpen = pub.filter((o) => o.status === 'Open').sort((a, b) => b.id - a.id);
  const pubHist = pub.filter((o) => o.status !== 'Open').sort((a, b) => b.id - a.id);
  const runs = outlayerRuns();
  const tabs: [Tab, string, number | null][] = [['open', 'Open orders', orders ? open.length + pubOpen.length : null], ['history', 'Order history', orders ? hist.length + pubHist.length + fills.length : null], ['log', 'Enclave log', log ? log.length : null], ['att', 'Attestations', runs.length]];
  const pubRows = pubOpen.map((o) => <tr key={`p${o.id}`} className="row-public">
    <td><span className="ocell"><span className="pub-dot" aria-hidden="true"><Icon name="eye" size={14} /></span><span><b className="mono">P{o.id}</b><small className="mono">{shortAccount(o.owner)}</small></span></span></td>
    <td><span className="tamt"><PairLogo base="NEAR" quote="USD" />NEAR/USD</span></td>
    <td>Public {orderType(o.cond, o.side)} <PubChip /></td>
    <td>{o.side === 'buy' ? <span className="up">Buy</span> : <span className="down">Sell</span>}</td>
    <td className="mono">{orderSize(o.amount, o.side)}</td>
    <td><span className="mono pub-trig">{e6(o.trigger_e6)} <small>anyone can read</small></span></td>
    <td><span className="st st-armed"><i />Armed</span></td>
    <td className="mono">{utc(nsToMs(o.created_ns))}</td>
    <td className="acts">{wallet.account === o.owner && <button className="btn btn-ghost btn-xs" disabled={pendingIds.includes(-o.id)} onClick={() => cancel(-o.id)}>{pendingIds.includes(-o.id) ? 'Cancelling…' : 'Cancel'}</button>}{txForPublic(o.id) && <Tx hash={txForPublic(o.id)!} label="Tx" />}</td>
  </tr>);
  const loading = (e: string, what: string) => <State kind={e ? 'error' : 'loading'} art={e ? 'warning' : undefined} title={e ? `Could not read ${what}` : `Reading ${what}…`}>{e}</State>;
  return <section className="pnl bottom" aria-label="Orders and enclave">
    <header className="pnl-tabs btabs" role="tablist">
      {tabs.map(([k, l, n]) => <button key={k} role="tab" aria-selected={tab === k} className={`pnl-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}{n !== null && <small>{n}</small>}</button>)}
      <span className="pnl-note">{wallet.account ? `Account ${shortAccount(wallet.account)}` : 'All accounts · not connected'}</span>
    </header>
    <div className="tbl-wrap">
      {tab === 'open' && (!orders ? loading(ordersErr, 'orders') : !open.length && !pubOpen.length ? <State kind="empty" art="tray-empty" title={wallet.account ? 'No open sealed orders' : 'No armed orders on chain'}>Seal a stop or take-profit in the order panel.</State> : <table className="tbl">
        <thead><tr><th>Order</th><th>Market</th><th>Type</th><th>Side</th><th>Size</th><th>Trigger</th><th>Status</th><th>Placed (UTC)</th><th /></tr></thead>
        <tbody>{open.map((o) => { const p = decrypt(o, wallet.account); return <tr key={o.id}>
          <td><span className="ocell"><img src={art('slip').src} alt="" aria-hidden="true" /><span><b className="mono">№{o.id}</b><small className="mono">{shortAccount(o.owner)}</small></span></span></td>
          <td><span className="tamt"><PairLogo base="NEAR" quote="USD" />NEAR/USD</span></td>
          <td>{typeLabel(p)} <OcoChip partner={partner(o.id)} /></td>
          <td>{p ? (p.side === 'buy' ? <span className="up">Buy</span> : <span className="down">Sell</span>) : <Hidden label="" />}</td>
          <td className="mono">{p ? <WithLogo sym={p.side === 'buy' ? 'tUSD' : 'NEAR'}>{orderSize(p.amount, p.side)}</WithLogo> : <Hidden label="" />}</td>
          <td>{p ? <span className="mono">{e6(p.trigger_e6)} <small className="dim">only you</small></span> : <Hidden />}</td>
          <td><span className="st st-armed"><i />Armed</span></td>
          <td className="mono">{utc(nsToMs(o.created_ns))}</td>
          <td className="acts">{wallet.account === o.owner && <button className="btn btn-ghost btn-xs" disabled={pendingIds.includes(o.id)} onClick={() => cancel(o.id)}>{pendingIds.includes(o.id) ? 'Cancelling…' : 'Cancel'}</button>}<Link to={`/order/${o.id}`} className="btn btn-ghost btn-xs">View</Link></td>
        </tr>; })}{pubRows}</tbody>
      </table>)}
      {tab === 'history' && (!orders ? loading(ordersErr, 'orders') : !hist.length && !pubHist.length && !fills.length ? <State kind="empty" art="tray-empty" title="No fired or cancelled orders yet" /> : <table className="tbl">
        <thead><tr><th>Order</th><th>Type</th><th>Trigger</th><th>Price read</th><th>Filled</th><th>Status</th><th>Time (UTC)</th><th>Tx</th><th /></tr></thead>
        <tbody>{[...fills].sort((a, b) => b.id - a.id).map((m) => <tr key={`m${m.id}`}>
          <td><span className="ocell"><span className="pub-dot mkt-dot" aria-hidden="true"><Icon name="bolt" size={14} /></span><span><b className="mono">M{m.id}</b><small className="mono">{shortAccount(m.owner)}</small></span></span></td>
          <td>Market {m.side}</td>
          <td className="dim">no trigger</td>
          <td className="mono">{e6(m.price_e6)} <small className="dim">pool</small></td>
          <td className="mono">{m.side === 'sell' ? <><WithLogo sym="NEAR">{near(m.amount_in, 2)} NEAR</WithLogo> → <WithLogo sym="tUSD">{usd6(m.amount_out)} tUSD</WithLogo></> : <><WithLogo sym="tUSD">{usd6(m.amount_in, 2)} tUSD</WithLogo> → <WithLogo sym="NEAR">{near(m.amount_out)} NEAR</WithLogo></>}</td>
          <td><span className="st st-fired"><i />Filled</span></td>
          <td className="mono">{utc(nsToMs(m.block_ts))}</td>
          <td>{txForMarket(m.id) ? <Tx hash={txForMarket(m.id)!} /> : <span className="dim">—</span>}</td>
          <td />
        </tr>)}{pubHist.map((o) => { const f = o.fire; return <tr key={`p${o.id}`} className="row-public">
          <td><span className="ocell"><span className="pub-dot" aria-hidden="true"><Icon name="eye" size={14} /></span><span><b className="mono">P{o.id}</b><small className="mono">{shortAccount(o.owner)}</small></span></span></td>
          <td>Public {orderType(o.cond, o.side)} <PubChip /></td>
          <td><span className="mono pub-trig">{e6(o.trigger_e6)} <small>always public</small></span></td>
          <td className="mono">{f ? e6(f.price_e6) : '—'}</td>
          <td className="mono">{f ? (o.side === 'sell' ? `${near(f.filled_in, 2)} NEAR → ${usd6(f.filled_out)} tUSD` : `${usd6(f.filled_in, 2)} tUSD → ${near(f.filled_out)} NEAR`) : '—'}</td>
          <td><span className={`st st-${o.status.toLowerCase()}`}><i />{o.status}</span></td>
          <td className="mono">{f ? utc(nsToMs(f.block_ts)) : utc(nsToMs(o.created_ns))}</td>
          <td>{f && txForRequest(f.request) ? <Tx hash={txForRequest(f.request)!} /> : <span className="dim">—</span>}</td>
          <td />
        </tr>; })}{hist.map((o) => { const f = o.fire; return <tr key={o.id}>
          <td><span className="ocell"><img src={art(f ? 'slip-fired' : 'slip').src} alt="" aria-hidden="true" className={f ? '' : 'faded'} /><span><b className="mono">№{o.id}</b><small className="mono">{shortAccount(o.owner)}</small></span></span></td>
          <td>{f ? `Sealed ${orderType(f.cond, f.side)}` : 'Sealed'} <OcoChip partner={partner(o.id)} /></td>
          <td>{f ? <span className="mono gold">{e6(f.trigger_e6)} <small className="dim">revealed</small></span> : <Hidden label={partner(o.id) ? 'never revealed · OCO' : 'never revealed'} />}</td>
          <td className="mono">{f ? e6(f.price_e6) : '—'}</td>
          <td className="mono">{f ? (f.side === 'buy' ? <><WithLogo sym="tUSD">{usd6(f.filled_in, 2)} tUSD</WithLogo> → <WithLogo sym="NEAR">{near(f.filled_out)} NEAR</WithLogo></> : <><WithLogo sym="NEAR">{near(f.filled_in, 2)} NEAR</WithLogo> → <WithLogo sym="tUSD">{usd6(f.filled_out)} tUSD</WithLogo></>) : '—'}</td>
          <td><span className={`st st-${o.status.toLowerCase()}`}><i />{o.status}</span></td>
          <td className="mono">{f ? utc(nsToMs(f.block_ts)) : utc(nsToMs(o.created_ns))}</td>
          <td>{f && txForRequest(f.request) ? <Tx hash={txForRequest(f.request)!} /> : <span className="dim">—</span>}</td>
          <td className="acts"><Link to={`/order/${o.id}`} className="btn btn-ghost btn-xs">View</Link></td>
        </tr>; })}</tbody>
      </table>)}
      {tab === 'log' && (!log ? loading(logErr, 'the enclave log') : <table className="tbl">
        <thead><tr><th>Time (UTC)</th><th>Event</th><th>Detail</th><th>Source</th></tr></thead>
        <tbody>{log.map((e) => <tr key={e.key}>
          <td className="mono">{utc(e.at)}</td>
          <td><span className={`ev ev-${e.kind}`}><i />{e.kind}</span> {e.order ? <Link to={`/order/${e.order}`}>{e.title}</Link> : e.title}</td>
          <td className="dim">{e.detail}</td>
          <td>{e.tx ? <Tx hash={e.tx} /> : <span className="dim mono">view call</span>}</td>
        </tr>)}</tbody>
      </table>)}
      {tab === 'att' && <table className="tbl">
        <thead><tr><th>OutLayer run</th><th>Time (UTC)</th><th>Recorded verification</th><th>TDX quote SHA-256 (live)</th><th>Tx</th><th /></tr></thead>
        <tbody>{runs.map((r) => <AttRow key={r.tx} r={r} />)}</tbody>
      </table>}
    </div>
    {err && <p className="sheet-err" role="alert">{err}</p>}
  </section>;
}

/* ---------------- page ---------------- */
export default function Terminal({ wallet }: { wallet: Wallet }) {
  const wide = useMedia('(min-width: 1200px)');
  const config = useConfig();
  const stats = useStats();
  const book = useOrders();
  const mine = useMine(wallet.account);
  const bal = useBalance(wallet.account);
  const t = useTicker();
  const requests = useRequests(stats.data?.requests_total);
  const pub = usePublicOrders(wallet.account);
  const fills = useMarketFills(wallet.account);
  const pairs = useOcoPairs();
  const [vault, setVault] = useState(false);
  const [mobileView, setMobileView] = useState<'chart' | 'book'>('chart');
  const log = useMemo(() => (book.data && requests.data ? buildLog(book.data, requests.data) : null), [book.data, requests.data]);
  const orders = wallet.account ? mine.data : book.data;
  const last = t.data ? Number(t.data.price) : null;
  const fired = (book.data ?? []).filter((o) => o.fire);
  const chart = <ChartPanel stats={stats.data} fired={fired} requestsLog={log} />;
  const allPub = usePublicOrders();
  const sealedBook = <SealedBook orders={book.data} error={book.error} stats={stats.data} last={last} pub={allPub.data ?? []} />;
  return <div className="term-page">
    <AppHeader wallet={wallet} onVault={() => setVault(true)} />
    <main className={`term ${wide ? 'term-wide' : ''}`} id="main">
      <MarketBar stats={stats.data} />
      {wide ? <>{chart}{sealedBook}</> : <div className="term-center">
        <div className="seg seg-mob" role="tablist" aria-label="View"><button role="tab" aria-selected={mobileView === 'chart'} className={mobileView === 'chart' ? 'on' : ''} onClick={() => setMobileView('chart')}>Chart</button><button role="tab" aria-selected={mobileView === 'book'} className={mobileView === 'book' ? 'on' : ''} onClick={() => setMobileView('book')}>Sealed book</button></div>
        {mobileView === 'chart' ? chart : sealedBook}
      </div>}
      <OrderPanel wallet={wallet} config={config.data} configError={config.error} balance={bal.data} stats={stats.data} onVault={() => setVault(true)} />
      <BottomPanel wallet={wallet} orders={orders} ordersErr={wallet.account ? mine.error : book.error} log={log} logErr={book.error || requests.error} pub={pub.data ?? []} fills={fills.data ?? []} pairs={pairs.data ?? []} />
    </main>
    <footer className="term-foot mono"><span><i className="live" />Live · NEAR testnet</span><a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">{CONTRACT} <Icon name="external" size={11} /></a><span>tUSD has no value</span></footer>
    {vault && <VaultSheet wallet={wallet} balance={bal.data} onClose={() => setVault(false)} />}
  </div>;
}
