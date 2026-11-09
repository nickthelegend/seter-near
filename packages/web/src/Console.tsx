import { useMemo, useState } from 'react';
import { openView } from '@mienai/sdk/crypto';
import { CONTRACT, accountUrl, ago, buildLog, e6, enclaveUpload, near, nsToMs, short, shortAccount, toYocto, txForRequest, usd6, type Config, type EventKind, type LogEvent, type Order, type Stats } from './lib';
import { useBalance, useConfig, useMedia, useMine, useOrders, useRequests, useStats, useTicker } from './live';
import { Icon, Link, Num, State, Ticket, Tx, Wordmark, type Plain } from './ui';
import { SealSheet, VaultSheet, viewKeyFor } from './Sheets';
import type { Wallet } from './wallet';

export function decrypt(o: Order, account: string): Plain | null {
  if (o.fire) return { cond: o.fire.cond, trigger_e6: o.fire.trigger_e6, amount: o.fire.amount, side: o.fire.side };
  if (!account || o.owner !== account) return null;
  const key = viewKeyFor(account);
  if (!key || !o.view_ct) return null;
  try { return JSON.parse(openView(key, account, o.view_ct)); } catch { return null; }
}

/** Shared top bar for the console and order pages. */
export function TopBar({ wallet }: { wallet: Wallet }) {
  const t = useTicker();
  return <header className="topbar">
    <Link to="/" aria-label="Mienai home"><Wordmark small /></Link>
    <nav className="topbar-nav" aria-label="App">
      <Link to="/app">Console</Link>
      <Link to="/#how">How it works</Link>
    </nav>
    <div className="topbar-right">
      <span className="ticker mono" aria-label="Live NEAR price from Coinbase"><i className="live" />NEAR {t.data ? <Num value={Number(t.data.price).toFixed(4)} /> : t.error ? 'unavailable' : '…'}</span>
      {wallet.account
        ? <button className="btn btn-ghost btn-sm" onClick={wallet.disconnect} title="Sign out">{shortAccount(wallet.account)}</button>
        : <button className="btn btn-light btn-sm" onClick={wallet.connect} disabled={!wallet.ready}>{wallet.ready ? 'Connect' : 'Loading'}</button>}
    </div>
  </header>;
}

const KINDS: { k: EventKind | 'all'; label: string }[] = [{ k: 'all', label: 'All' }, { k: 'sealed', label: 'Sealed' }, { k: 'checked', label: 'Checked' }, { k: 'fired', label: 'Fired' }, { k: 'attested', label: 'Attested' }];
const GLYPH: Record<EventKind, string> = { sealed: 'lock', checked: 'eye', fired: 'bolt', attested: 'seal', cancelled: 'ban' };
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/** The enclave log, grouped by UTC day. Every row is read from the contract or a recorded, linked transaction. */
export function EnclaveLog({ events, error, limit }: { events: LogEvent[] | null; error?: string; limit?: number }) {
  const [kind, setKind] = useState<EventKind | 'all'>('all');
  if (!events) return <State kind={error ? 'error' : 'loading'} title={error ? 'Could not read the contract' : 'Reading the enclave log…'}>{error}</State>;
  const list = events.filter((e) => kind === 'all' || e.kind === kind || (kind === 'sealed' && e.kind === 'cancelled')).slice(0, limit);
  const days = list.reduce<[string, LogEvent[]][]>((acc, e) => { const d = dayKey(e.at); const last = acc[acc.length - 1]; if (last && last[0] === d) last[1].push(e); else acc.push([d, [e]]); return acc; }, []);
  return <div className="log">
    <div className="log-filter" role="tablist" aria-label="Filter the log">
      {KINDS.map(({ k, label }) => { const n = k === 'all' ? events.length : events.filter((e) => e.kind === k || (k === 'sealed' && e.kind === 'cancelled')).length; return <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{label}<small>{n}</small></button>; })}
    </div>
    {!list.length ? <State kind="empty" title="Nothing of this kind yet" /> : days.map(([d, evs]) => <section key={d} className="log-day">
      <h3 className="log-date"><span>{d}</span><small className="mono">UTC</small></h3>
      <ol>{evs.map((e) => <li key={e.key} className={`log-row k-${e.kind}`}>
        <time className="mono">{hhmm(e.at)}</time>
        <span className="log-glyph" aria-hidden="true"><Icon name={GLYPH[e.kind]} size={15} /></span>
        <div className="log-text">{e.order ? <Link to={`/order/${e.order}`}><b>{e.title}</b></Link> : <b>{e.title}</b>}<span>{e.detail}</span></div>
        {e.tx ? <Tx hash={e.tx} /> : <span className="log-src mono">view call</span>}
      </li>)}</ol>
    </section>)}
  </div>;
}

/** The enclave column: what only the TEE reads, what it published, and the code it is pinned to. */
export function EnclavePanel({ config, configError, stats, wallet }: { config: Config | null; configError: string; stats: Stats | null; wallet?: Wallet }) {
  const [err, setErr] = useState('');
  const c = stats?.last_check;
  const b = stats?.bands;
  const pinned = config?.enclave_hash;
  const bands = b ? (JSON.parse(b.bands) as unknown[]).length : 0;
  return <aside className="enclave" aria-labelledby="enclave-h">
    <div className="enclave-art" aria-hidden="true"><img src="/art/mienai-st-cube.webp" alt="" /></div>
    <header className="enclave-head">
      <p className="label">OutLayer · Intel TDX</p>
      <h2 id="enclave-h">The enclave</h2>
      {pinned ? (pinned === enclaveUpload.sha256 ? <span className="badge badge-ok"><Icon name="check" size={13} />Code hash matches the build</span> : <span className="badge badge-bad">Code hash differs from the build</span>) : <span className="badge">{configError ? 'Contract unreadable' : 'Reading the pin…'}</span>}
    </header>
    <div className="enclave-block">
      <p className="label">Last check · price read inside the TEE</p>
      {!stats ? <p className="dim">Loading</p> : !c ? <p className="dim">No check has run yet.</p> : <>
        <p className="enclave-price"><Num value={e6(c.price_e6)} unit="USD" /></p>
        <p className="enclave-sub">opened <b>{c.checked}</b> · fired <b className={c.fired.length ? 'mint' : ''}>{c.fired.length}</b> · {ago(nsToMs(c.block_ts))}</p>
        <p className="enclave-sub mono">Coinbase trade #{c.trade_id} · request {c.request}{txForRequest(c.request) ? <> · <Tx hash={txForRequest(c.request)!} /></> : null}</p>
      </>}
    </div>
    <div className="enclave-block">
      <p className="label">Band report · k-anonymous</p>
      {!b ? <p className="dim">{stats ? 'No band report yet.' : 'Loading'}</p> : <>
        <div className="bandgrid" role="img" aria-label={`${b.total} orders counted, ${b.suppressed} suppressed`}>{Array.from({ length: Math.max(b.total, b.k) }, (_, i) => <i key={i} className={i < b.total ? (i < b.total - b.suppressed ? 'pub' : 'sup') : ''} />)}</div>
        <p className="enclave-sub"><b>{bands}</b> band{bands === 1 ? '' : 's'} published · <b>{b.suppressed}</b> of {b.total} orders suppressed (fewer than {b.k} per ${(b.width_e6 / 1e6).toFixed(2)} band)</p>
      </>}
    </div>
    <dl className="enclave-keys">
      <div><dt>Order key</dt><dd className="mono">{config?.tee ? short(config.tee.order_pub, 8) : config ? 'not published' : '…'}</dd></div>
      <div><dt>Report key</dt><dd className="mono">{config?.tee ? short(config.tee.attest_pub, 8) : config ? 'not published' : '…'}</dd></div>
      <div><dt>Pinned WASM</dt><dd className="mono">{pinned ? short(pinned, 8) : '…'}</dd></div>
      <div><dt>Egress</dt><dd className="mono">api.exchange.coinbase.com</dd></div>
      <div><dt>Runs / rejected</dt><dd className="mono">{stats ? `${stats.requests_total} / ${stats.rejected_reports}` : '…'}</dd></div>
    </dl>
    {wallet?.account
      ? <button className="btn btn-ghost btn-block" onClick={() => wallet.call('check', {}, toYocto('0.02'), 300).catch((e) => setErr((e as Error).message))}><Icon name="eye" size={16} />Pay for a check · 0.02 NEAR</button>
      : <p className="enclave-note">Anyone with a testnet wallet can pay for a check (about 0.02 NEAR).</p>}
    {err && <p className="sheet-err" role="alert">{err}</p>}
    <p className="enclave-note">Mainnet settlement through NEAR Intents: <b>Setup required: NEAR_MAINNET_ACCOUNT</b>. Testnet fires settle on the vault’s tUSD pool.</p>
  </aside>;
}

export default function Console({ wallet }: { wallet: Wallet }) {
  const wide = useMedia('(min-width: 1024px)');
  const config = useConfig();
  const stats = useStats();
  const book = useOrders();
  const mine = useMine(wallet.account);
  const bal = useBalance(wallet.account);
  const ticker = useTicker();
  const requests = useRequests(stats.data?.requests_total);
  const [tab, setTab] = useState<'tickets' | 'log' | 'enclave'>('tickets');
  const [filter, setFilter] = useState<'armed' | 'fired' | 'all'>('all');
  const [sheet, setSheet] = useState<'seal' | 'vault' | null>(null);
  const price = ticker.data ? Number(ticker.data.price) : null;

  const orders = wallet.account ? mine.data : book.data;
  const ordersErr = wallet.account ? mine.error : book.error;
  const crowd = stats.data ? stats.data.open : null;
  const k = stats.data?.bands?.k ?? null;
  const shown = (orders ?? []).filter((o) => (filter === 'armed' ? o.status === 'Open' : filter === 'fired' ? o.status === 'Fired' : true)).sort((a, b) => Number(b.status === 'Open') - Number(a.status === 'Open') || b.id - a.id);
  const log = useMemo(() => (book.data && requests.data ? buildLog(book.data, requests.data) : null), [book.data, requests.data]);
  const counts = { armed: (orders ?? []).filter((o) => o.status === 'Open').length, fired: (orders ?? []).filter((o) => o.status === 'Fired').length, all: orders?.length ?? 0 };

  const tickets = <section className="panel" aria-labelledby="tk-h">
    <header className="panel-head">
      <div><h2 id="tk-h">{wallet.account ? 'Your sealed tickets' : 'The public book'}</h2><p>{wallet.account ? 'Levels decrypted on this device with your view key.' : 'Not connected: every order on the contract, exactly as a stop hunter sees it.'}</p></div>
      <div className="seg seg-sm" role="tablist" aria-label="Filter tickets">
        {(['all', 'armed', 'fired'] as const).map((f) => <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'armed' ? 'Armed' : 'Fired'}<small>{counts[f]}</small></button>)}
      </div>
    </header>
    {!orders ? <State kind={ordersErr ? 'error' : 'loading'} title={ordersErr ? 'Could not read orders' : 'Reading orders from NEAR testnet…'}>{ordersErr}</State>
      : !shown.length ? <State kind="empty" title={orders.length ? 'Nothing under this filter' : wallet.account ? 'No sealed orders yet' : 'No orders on chain yet'} action={<button className="btn btn-primary btn-sm" onClick={() => setSheet('seal')}>Seal an order</button>}>A sealed order shows here as soon as its transaction lands.</State>
      : <div className="tickets">{shown.map((o) => <Ticket key={o.id} order={o} plain={decrypt(o, wallet.account)} crowd={crowd} k={k} />)}</div>}
  </section>;
  const logPanel = <section className="panel" aria-labelledby="log-h">
    <header className="panel-head"><div><h2 id="log-h">Enclave log</h2><p>Sealed, checked, fired and attested, by UTC day. Rows without a link come from contract view calls.</p></div></header>
    <EnclaveLog events={log} error={book.error || requests.error} />
  </section>;
  const enclave = <EnclavePanel config={config.data} configError={config.error} stats={stats.data} wallet={wallet} />;

  return <div className="console">
    <TopBar wallet={wallet} />
    <section className="acct" aria-label="Account">
      <div className="acct-bal">
        <p className="label">{wallet.account ? `Vault · ${shortAccount(wallet.account)}` : 'Vault'}</p>
        {!wallet.account ? <p className="acct-big acct-none">Not connected</p>
          : bal.data ? <p className="acct-big"><Num value={near(bal.data.near)} unit="NEAR" /><span className="acct-usd"><Num value={usd6(bal.data.usd, 2)} unit="tUSD" /></span></p>
          : <p className="acct-big acct-none">{bal.error ? 'Balance unavailable' : 'Loading…'}</p>}
      </div>
      <dl className="acct-tally">
        <div><dt>Armed</dt><dd>{stats.data ? stats.data.open : '—'}</dd></div>
        <div><dt>Fired</dt><dd className="mint">{stats.data ? stats.data.fired : '—'}</dd></div>
        <div><dt>Levels on chain</dt><dd>{stats.data ? 0 : '—'}</dd></div>
      </dl>
      <div className="acct-act">
        {wallet.account ? <button className="btn btn-ghost" onClick={() => setSheet('vault')}><Icon name="wallet" size={16} />Vault</button>
          : <button className="btn btn-ghost" onClick={wallet.connect} disabled={!wallet.ready}><Icon name="wallet" size={16} />Connect</button>}
        <button className="btn btn-primary" onClick={() => setSheet('seal')}><Icon name="lock" size={16} />Seal an order</button>
      </div>
    </section>

    {wide ? <div className="console-grid">
      <div className="console-main" id="main">{tickets}{logPanel}</div>
      {enclave}
    </div> : <>
      <div className="console-tabs" role="tablist" aria-label="Console">
        {(['tickets', 'log', 'enclave'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}><Icon name={t === 'tickets' ? 'ticket' : t === 'log' ? 'log' : 'cube'} size={16} />{t === 'tickets' ? 'Tickets' : t === 'log' ? 'Log' : 'Enclave'}</button>)}
      </div>
      <div className="console-main" id="main">{tab === 'tickets' ? tickets : tab === 'log' ? logPanel : enclave}</div>
    </>}

    <footer className="console-foot mono"><a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">{CONTRACT} <Icon name="external" size={12} /></a><span>NEAR testnet · tUSD has no value</span></footer>
    {sheet === 'seal' && <SealSheet wallet={wallet} config={config.data} configError={config.error} price={price} onClose={() => setSheet(null)} />}
    {sheet === 'vault' && <VaultSheet wallet={wallet} balance={bal.data} onClose={() => setSheet(null)} />}
  </div>;
}
