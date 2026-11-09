import { useEffect, useMemo, useState } from 'react';
import { openView, orderPlaintext, sealToEnclave, commitment, newViewKey, sealView } from '@mienai/sdk/crypto';
import { CONTRACT, OUTLAYER_API, accountUrl, ago, buildLog, e6, enclaveUpload, near, nsToMs, outlayerRuns, short, shortAccount, toYocto, txForRequest, usd6, type Balance, type Config, type LogEvent, type Order, type OutlayerRun, type Stats } from './lib';
import { useBalance, useConfig, useMedia, useMine, useOrders, useQuote, useRequests, useStats, useTicker } from './live';
import { GRANULARITY, useCandles, useStats24h, type Tf } from './market';
import Chart, { type ChartMark } from './Chart';
import { Icon, Link, Num, State, Tx, Wordmark, shortHex } from './ui';
import { VaultSheet, viewKeyFor } from './Sheets';
import type { Wallet } from './wallet';
import { art } from './art';

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
export function AppHeader({ wallet, onVault }: { wallet: Wallet; onVault?: () => void }) {
  return <header className="ahead">
    <Link to="/" aria-label="Seter home"><Wordmark small /></Link>
    <nav className="ahead-nav" aria-label="App">
      <Link to="/app" aria-current={location.pathname.startsWith('/app') ? 'page' : undefined}>Trade</Link>
      <Link to="/#how">How it works</Link>
      <Link to="/#proof">Proof</Link>
    </nav>
    <div className="ahead-right">
      <span className="net"><i className="live" />NEAR testnet</span>
      {wallet.account && onVault && <button className="btn btn-ghost btn-sm" onClick={onVault}><Icon name="wallet" size={15} />Vault</button>}
      {wallet.account
        ? <button className="btn btn-ghost btn-sm" onClick={wallet.disconnect} title="Sign out">{shortAccount(wallet.account)}</button>
        : <button className="btn btn-primary btn-sm" onClick={wallet.connect} disabled={!wallet.ready}>{wallet.ready ? 'Connect wallet' : 'Loading'}</button>}
    </div>
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
  return <section className="mbar" aria-label="Market">
    <div className="mb-pair"><span className="coin" aria-hidden="true">N</span><div><b>NEAR / USD</b><small>Sealed spot · vault</small></div></div>
    <div className={`mb-last ${chg === null ? '' : up ? 'up' : 'down'}`}>{last ? <Num value={last.toFixed(4)} /> : <span className="dim">{t.error ? 'unavailable' : '…'}</span>}<small>Coinbase last</small></div>
    <div className="mb-cells">
      {cell('24h change', chg === null ? '…' : <span className={up ? 'up' : 'down'}>{up ? '+' : ''}{chg.toFixed(4)} / {up ? '+' : ''}{pct!.toFixed(2)}%</span>)}
      {cell('24h high', d.data ? d.data.high.toFixed(4) : '…')}
      {cell('24h low', d.data ? d.data.low.toFixed(4) : '…')}
      {cell('24h volume (NEAR)', d.data ? Math.round(d.data.volume).toLocaleString('en-US') : '…')}
      {cell('Enclave read', stats?.last_check ? <>{e6(stats.last_check.price_e6)} <small>{ago(nsToMs(stats.last_check.block_ts))}</small></> : stats ? 'no check yet' : '…')}
      {cell('Armed', stats ? stats.open : '…')}
      {cell('Levels on chain', stats ? <span className="mint">0</span> : '…')}
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
function SealedBook({ orders, stats, last }: { orders: Order[] | null; stats: Stats | null; last: number | null }) {
  const armed = (orders ?? []).filter((o) => o.status === 'Open').sort((a, b) => b.id - a.id);
  const revealed = (orders ?? []).filter((o) => o.fire).sort((a, b) => b.id - a.id);
  const b = stats?.bands;
  return <section className="pnl book" aria-label="Sealed book">
    <header className="pnl-tabs"><span className="pnl-tab on">Sealed book</span><span className="pnl-note">dark</span></header>
    <div className="book-cols mono"><span>Trigger</span><span>Size</span><span>Age</span></div>
    {!orders ? <p className="book-empty dim">Loading…</p> : <>
      <ul className="book-rows">{armed.length ? armed.map((o) => <li key={o.id}><Link to={`/order/${o.id}`}><span><Hidden label="" /></span><span><Hidden label="" /></span><span className="mono dim">{ago(nsToMs(o.created_ns))}</span></Link></li>) : <li className="book-empty dim">No armed orders</li>}</ul>
      <div className="book-mid"><b className="mono">{last ? last.toFixed(4) : '…'}</b><span>Coinbase last · {armed.length} sealed level{armed.length === 1 ? '' : 's'} around it</span></div>
      <p className="book-sub mono">Revealed after firing</p>
      <ul className="book-rows">{revealed.length ? revealed.map((o) => <li key={o.id}><Link to={`/order/${o.id}`}><span className="mono mint">{e6(o.fire!.trigger_e6)}</span><span className="mono">{near(o.fire!.amount, 2)}</span><span className="mono dim">{ago(nsToMs(o.fire!.block_ts))}</span></Link></li>) : <li className="book-empty dim">Nothing fired yet</li>}</ul>
    </>}
    <footer className="book-foot">
      <div><span>Levels visible</span><b className="mint">{stats ? 0 : '…'}</b></div>
      <div><span>Band report (k = {b?.k ?? 5})</span><b>{b ? `${b.suppressed}/${b.total} suppressed` : stats ? 'none yet' : '…'}</b></div>
    </footer>
  </section>;
}

/* ---------------- order panel ---------------- */
type Kind = 'market' | 'limit' | 'stop' | 'tp';
function OrderPanel({ wallet, config, configError, balance, stats, onVault }: { wallet: Wallet; config: Config | null; configError: string; balance: Balance | null; stats: Stats | null; onVault: () => void }) {
  const t = useTicker();
  const price = t.data ? Number(t.data.price) : null;
  const [kind, setKind] = useState<Kind>('stop');
  const [trigger, setTrigger] = useState('');
  const [size, setSize] = useState('0.5');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const cond = kind === 'tp' ? 'gte' : 'lte';
  useEffect(() => { if (price && !trigger) setTrigger((price * 0.97).toFixed(4)); }, [price, trigger]);
  const pick = (k: Kind) => { setKind(k); setErr(''); if (price && (k === 'stop' || k === 'tp')) setTrigger((price * (k === 'stop' ? 0.97 : 1.03)).toFixed(4)); };
  const owner = wallet.account || 'your-account.testnet';
  const valid = /^\d+(\.\d+)?$/.test(trigger) && /^\d+(\.\d+)?$/.test(size) && Number(trigger) > 0 && Number(size) > 0;
  const preview = useMemo(() => {
    if (!config?.tee || !valid || (kind !== 'stop' && kind !== 'tp')) return null;
    try {
      const pt = orderPlaintext({ cond, triggerUsd: trigger, side: 'sell', amount: toYocto(size) });
      return { pt, ct: sealToEnclave(config.tee.order_pub, owner, pt) as string, commit: commitment(owner, pt) as string };
    } catch { return null; }
  }, [config, cond, trigger, size, owner, valid, kind]);
  const dist = price && Number(trigger) > 0 ? (Number(trigger) / price - 1) * 100 : null;
  const wrong = dist !== null && ((cond === 'lte' && dist >= 0) || (cond === 'gte' && dist <= 0));
  const availNear = balance ? Number(BigInt(balance.near) / 10n ** 18n) / 1e6 : null;
  const nudge = (d: number) => { const v = Number(trigger) || price || 0; setTrigger(Math.max(0.0001, v * (1 + d)).toFixed(4)); };
  async function place() {
    if (!preview || !wallet.account) return;
    setErr(''); setBusy(true);
    try {
      let key = viewKeyFor(wallet.account);
      if (!key) { key = newViewKey(); try { localStorage.setItem(`mienai:view:${wallet.account}`, key); } catch { /* private window */ } }
      await wallet.call('place_order', { ct: preview.ct, commit: preview.commit, view_ct: sealView(key, wallet.account, preview.pt) }, toYocto('0.02'), 30);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const sealed = kind === 'stop' || kind === 'tp';
  return <aside className="pnl form" aria-label="Order panel">
    <div className="otabs" role="tablist" aria-label="Order type">
      {([['market', 'Market'], ['limit', 'Limit'], ['stop', 'Sealed stop'], ['tp', 'Sealed take-profit']] as [Kind, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} className={`${kind === k ? 'on' : ''}${k === 'stop' || k === 'tp' ? ' sealed' : ''}`} onClick={() => pick(k)}>{(k === 'stop' || k === 'tp') && <Icon name="lock" size={12} />}{l}</button>)}
    </div>
    {!sealed ? <div className="form-body">
      <div className="notice">
        <h3>{kind === 'market' ? 'Market orders' : 'Limit orders'} are not offered here</h3>
        <p>A {kind} order shows its price to everyone before it fills, which is exactly what stop hunters read. Seter only takes sealed orders: a stop or take-profit whose trigger stays encrypted until the enclave fires it, then settles on the vault’s NEAR / tUSD test pool.</p>
        <button className="btn btn-primary btn-block" onClick={() => pick(kind === 'limit' ? 'tp' : 'stop')}><Icon name="lock" size={15} />Use a sealed {kind === 'limit' ? 'take-profit' : 'stop'}</button>
      </div>
    </div> : <div className="form-body">
      <div className="side-row"><span className="side-chip">Sell NEAR → tUSD</span><span className="dim small">{kind === 'stop' ? 'fires if price ≤ trigger' : 'fires if price ≥ trigger'}</span></div>
      <div className="frow"><span>Available</span><b className="mono">{wallet.account ? (availNear !== null ? `${availNear.toFixed(4)} NEAR` : '…') : 'Connect to see'}</b></div>
      {!config ? <State kind={configError ? 'error' : 'loading'} title={configError ? 'Could not read the enclave key' : 'Reading the enclave key…'}>{configError}</State>
        : !config.tee ? <State kind="setup" title="Setup required: enclave keys">The enclave has not published its keys yet (owner runs refresh_keys).</State>
        : <>
          <label className="fld">
            <span>Trigger price</span>
            <div className="fld-in"><button type="button" className="step" onClick={() => nudge(-0.005)} aria-label="Lower the trigger by 0.5%">−</button><input inputMode="decimal" value={trigger} onChange={(e) => setTrigger(e.target.value.trim())} aria-label="Trigger price in USD per NEAR" /><em>USD</em><button type="button" className="step" onClick={() => nudge(0.005)} aria-label="Raise the trigger by 0.5%">+</button></div>
            <small className={wrong ? 'warn' : ''}>{dist === null ? 'Live price loading' : <>{Math.abs(dist).toFixed(2)}% {dist < 0 ? 'below' : 'above'} last {price!.toFixed(4)}{wrong ? ' · would fire on the next check' : ''}</>}</small>
          </label>
          <label className="fld">
            <span>Amount</span>
            <div className="fld-in"><input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value.trim())} aria-label="Amount of NEAR to sell" /><em>NEAR</em></div>
          </label>
          <div className="pcts">{[25, 50, 75, 100].map((p) => <button key={p} type="button" disabled={!availNear} onClick={() => availNear && setSize((availNear * p / 100).toFixed(4))}>{p === 100 ? 'Max' : `${p}%`}</button>)}</div>
          <div className="chain-sees">
            <div className="cs-head"><span>Chain sees</span>{preview ? <span className="cs-badge"><Icon name="lock" size={11} />ciphertext · {preview.ct.length} chars</span> : null}</div>
            {preview ? <code className="cipher">{preview.ct.slice(0, 92)}<span>{preview.ct.slice(92, 124)}</span></code> : <p className="dim small">Enter a trigger and amount.</p>}
            <div className="cs-you"><span>You see</span><b className="mono">{cond === 'lte' ? '≤' : '≥'} {valid ? Number(trigger).toFixed(4) : '—'} · {valid ? Number(size) : '—'} NEAR</b></div>
          </div>
          <dl className="summ">
            <div><dt>Est. proceeds at trigger</dt><dd className="mono">{valid ? `${(Number(size) * Number(trigger)).toFixed(4)} tUSD` : '—'}</dd></div>
            <div><dt>Pool fee</dt><dd className="mono">{config.fee_bps / 100}%</dd></div>
            <div><dt>Storage deposit</dt><dd className="mono">0.02 NEAR</dd></div>
            <div><dt>Max price age</dt><dd className="mono">{config.max_price_age_s} s</dd></div>
          </dl>
          {err && <p className="sheet-err" role="alert">{err}</p>}
          {wallet.account
            ? <button className="btn btn-primary btn-block btn-lg" disabled={!preview || busy} onClick={place}>{busy ? 'Opening wallet…' : <><Icon name="lock" size={16} />Seal {kind === 'stop' ? 'stop' : 'take-profit'} order</>}</button>
            : <button className="btn btn-primary btn-block btn-lg" onClick={wallet.connect} disabled={!wallet.ready}>Connect wallet to seal</button>}
          <p className="form-note">Encrypted in your browser to the enclave’s X25519 key. The NEAR contract stores only the ciphertext and a commitment.</p>
        </>}
    </div>}
    <div className="vault-box">
      <div className="vb-head"><span>Vault</span>{wallet.account ? <button className="link" onClick={onVault}>Deposit · Withdraw</button> : <button className="link" onClick={wallet.connect} disabled={!wallet.ready}>Connect</button>}</div>
      <div className="frow"><span>NEAR</span><b className="mono">{wallet.account ? (balance ? near(balance.near) : '…') : '—'}</b></div>
      <div className="frow"><span>tUSD <small className="dim">test token</small></span><b className="mono">{wallet.account ? (balance ? usd6(balance.usd) : '…') : '—'}</b></div>
    </div>
    <EnclaveBox config={config} stats={stats} wallet={wallet} />
  </aside>;
}

function EnclaveBox({ config, stats, wallet }: { config: Config | null; stats: Stats | null; wallet: Wallet }) {
  const [err, setErr] = useState('');
  const pinned = config?.enclave_hash;
  return <div className="vault-box enclave-box">
    <div className="vb-head"><span className="vb-title"><img src={art('enclave').src} alt="" aria-hidden="true" />Enclave · Intel TDX</span>{pinned ? (pinned === enclaveUpload.sha256 ? <span className="ok-chip"><Icon name="check" size={12} />hash = build</span> : <span className="bad-chip">hash ≠ build</span>) : null}</div>
    <div className="frow"><span>Last check</span><b className="mono">{stats?.last_check ? `${e6(stats.last_check.price_e6)} · ${ago(nsToMs(stats.last_check.block_ts))}` : stats ? 'none yet' : '…'}</b></div>
    <div className="frow"><span>Runs / rejected</span><b className="mono">{stats ? `${stats.requests_total} / ${stats.rejected_reports}` : '…'}</b></div>
    <div className="frow"><span>Pinned WASM</span><b className="mono">{pinned ? short(pinned, 6) : '…'}</b></div>
    {wallet.account && <button className="btn btn-ghost btn-sm btn-block" onClick={() => wallet.call('check', {}, toYocto('0.02'), 300).catch((e) => setErr((e as Error).message))}><Icon name="eye" size={15} />Pay for a check · 0.02 NEAR</button>}
    {err && <p className="sheet-err" role="alert">{err}</p>}
    <p className="form-note">Mainnet settlement through NEAR Intents: <b>Setup required: NEAR_MAINNET_ACCOUNT</b>.</p>
  </div>;
}

/* ---------------- bottom panel ---------------- */
type Tab = 'open' | 'history' | 'log' | 'att';
function typeLabel(p: Plain | null) { return p ? (p.cond === 'lte' ? 'Sealed stop' : 'Sealed take-profit') : 'Sealed'; }

function AttRow({ r }: { r: OutlayerRun }) {
  const q = useQuote(r.tx);
  return <tr>
    <td><span className="ocell"><img src={art(r.attestation ? 'seal' : 'enclave').src} alt="" aria-hidden="true" /><span><b>{r.kind === 'Keys' ? 'Key publication' : r.kind === 'Check' ? 'Price check' : 'Band report'}</b><small>{r.label}</small></span></span></td>
    <td className="mono">{utc(Date.parse(r.at))}</td>
    <td>{r.attestation ? <span className="ok-chip"><Icon name="check" size={12} />{Object.values(r.attestation.checks).filter(Boolean).length}/{Object.keys(r.attestation.checks).length} · TCB {r.attestation.tcb.status}</span> : <span className="dim">quote only</span>}</td>
    <td className="mono">{q.data ? shortHex(q.data.quoteSha256, 10, 6) : q.error ? <span className="dim">unavailable</span> : '…'}</td>
    <td><Tx hash={r.tx} /></td>
    <td>{r.attestation ? <Link to="/order/1" className="btn btn-ghost btn-xs">Certificate</Link> : <a className="btn btn-ghost btn-xs" href={`${OUTLAYER_API}/attestations/by-tx/${r.tx}`} target="_blank" rel="noreferrer">Raw <Icon name="external" size={11} /></a>}</td>
  </tr>;
}

function BottomPanel({ wallet, orders, ordersErr, log, logErr }: { wallet: Wallet; orders: Order[] | null; ordersErr: string; log: LogEvent[] | null; logErr: string }) {
  const [tab, setTab] = useState<Tab>('open');
  const [err, setErr] = useState('');
  const open = (orders ?? []).filter((o) => o.status === 'Open').sort((a, b) => b.id - a.id);
  const hist = (orders ?? []).filter((o) => o.status !== 'Open').sort((a, b) => b.id - a.id);
  const tabs: [Tab, string, number | null][] = [['open', 'Open orders', orders ? open.length : null], ['history', 'Order history', orders ? hist.length : null], ['log', 'Enclave log', log ? log.length : null], ['att', 'Attestations', outlayerRuns.length]];
  const loading = (e: string, what: string) => <State kind={e ? 'error' : 'loading'} title={e ? `Could not read ${what}` : `Reading ${what}…`}>{e}</State>;
  return <section className="pnl bottom" aria-label="Orders and enclave">
    <header className="pnl-tabs btabs" role="tablist">
      {tabs.map(([k, l, n]) => <button key={k} role="tab" aria-selected={tab === k} className={`pnl-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}{n !== null && <small>{n}</small>}</button>)}
      <span className="pnl-note">{wallet.account ? `Account ${shortAccount(wallet.account)}` : 'All accounts · not connected'}</span>
    </header>
    <div className="tbl-wrap">
      {tab === 'open' && (!orders ? loading(ordersErr, 'orders') : !open.length ? <State kind="empty" title={wallet.account ? 'No open sealed orders' : 'No armed orders on chain'}>Seal a stop or take-profit in the order panel.</State> : <table className="tbl">
        <thead><tr><th>Order</th><th>Market</th><th>Type</th><th>Side</th><th>Size</th><th>Trigger</th><th>Status</th><th>Placed (UTC)</th><th /></tr></thead>
        <tbody>{open.map((o) => { const p = decrypt(o, wallet.account); return <tr key={o.id}>
          <td><span className="ocell"><img src={art('slip').src} alt="" aria-hidden="true" /><span><b className="mono">№{o.id}</b><small className="mono">{shortAccount(o.owner)}</small></span></span></td>
          <td>NEAR/USD</td>
          <td>{typeLabel(p)}</td>
          <td>{p ? <span className="down">Sell</span> : <Hidden label="" />}</td>
          <td className="mono">{p ? `${near(p.amount, 2)} NEAR` : <Hidden label="" />}</td>
          <td>{p ? <span className="mono">{e6(p.trigger_e6)} <small className="dim">only you</small></span> : <Hidden />}</td>
          <td><span className="st st-armed"><i />Armed</span></td>
          <td className="mono">{utc(nsToMs(o.created_ns))}</td>
          <td className="acts">{wallet.account === o.owner && <button className="btn btn-ghost btn-xs" onClick={() => wallet.call('cancel_order', { id: o.id }, '0', 30).catch((e) => setErr((e as Error).message))}>Cancel</button>}<Link to={`/order/${o.id}`} className="btn btn-ghost btn-xs">View</Link></td>
        </tr>; })}</tbody>
      </table>)}
      {tab === 'history' && (!orders ? loading(ordersErr, 'orders') : !hist.length ? <State kind="empty" title="No fired or cancelled orders yet" /> : <table className="tbl">
        <thead><tr><th>Order</th><th>Type</th><th>Trigger</th><th>Price read</th><th>Filled</th><th>Status</th><th>Time (UTC)</th><th>Tx</th><th /></tr></thead>
        <tbody>{hist.map((o) => { const f = o.fire; return <tr key={o.id}>
          <td><span className="ocell"><img src={art(f ? 'slip-fired' : 'slip').src} alt="" aria-hidden="true" className={f ? '' : 'faded'} /><span><b className="mono">№{o.id}</b><small className="mono">{shortAccount(o.owner)}</small></span></span></td>
          <td>{f ? (f.cond === 'lte' ? 'Sealed stop' : 'Sealed take-profit') : 'Sealed'}</td>
          <td>{f ? <span className="mono mint">{e6(f.trigger_e6)} <small className="dim">revealed</small></span> : <Hidden label="never revealed" />}</td>
          <td className="mono">{f ? e6(f.price_e6) : '—'}</td>
          <td className="mono">{f ? `${near(f.filled_in, 2)} NEAR → ${usd6(f.filled_out)} tUSD` : '—'}</td>
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
        <tbody>{outlayerRuns.map((r) => <AttRow key={r.tx} r={r} />)}</tbody>
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
  const [vault, setVault] = useState(false);
  const [mobileView, setMobileView] = useState<'chart' | 'book'>('chart');
  const log = useMemo(() => (book.data && requests.data ? buildLog(book.data, requests.data) : null), [book.data, requests.data]);
  const orders = wallet.account ? mine.data : book.data;
  const last = t.data ? Number(t.data.price) : null;
  const fired = (book.data ?? []).filter((o) => o.fire);
  const chart = <ChartPanel stats={stats.data} fired={fired} requestsLog={log} />;
  const sealedBook = <SealedBook orders={book.data} stats={stats.data} last={last} />;
  return <div className="term-page">
    <AppHeader wallet={wallet} onVault={() => setVault(true)} />
    <main className={`term ${wide ? 'term-wide' : ''}`} id="main">
      <MarketBar stats={stats.data} />
      {wide ? <>{chart}{sealedBook}</> : <div className="term-center">
        <div className="seg seg-mob" role="tablist" aria-label="View"><button role="tab" aria-selected={mobileView === 'chart'} className={mobileView === 'chart' ? 'on' : ''} onClick={() => setMobileView('chart')}>Chart</button><button role="tab" aria-selected={mobileView === 'book'} className={mobileView === 'book' ? 'on' : ''} onClick={() => setMobileView('book')}>Sealed book</button></div>
        {mobileView === 'chart' ? chart : sealedBook}
      </div>}
      <OrderPanel wallet={wallet} config={config.data} configError={config.error} balance={bal.data} stats={stats.data} onVault={() => setVault(true)} />
      <BottomPanel wallet={wallet} orders={orders} ordersErr={wallet.account ? mine.error : book.error} log={log} logErr={book.error || requests.error} />
    </main>
    <footer className="term-foot mono"><span><i className="live" />Live · NEAR testnet</span><a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">{CONTRACT} <Icon name="external" size={11} /></a><span>tUSD has no value</span></footer>
    {vault && <VaultSheet wallet={wallet} balance={bal.data} onClose={() => setVault(false)} />}
  </div>;
}
