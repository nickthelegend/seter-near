import { CONTRACT, TOKEN, accountUrl, ago, deployment, e6, enclaveUpload, firedStep, nsToMs, runSteps, short } from './lib';
import { useConfig, useOrders, useQuote, useRequests, useStats, useTicker } from './live';
import { useMemo } from 'react';
import { buildLog, nsToMs as toMs } from './lib';
import { CountUp, EnclavePulse, LiveTick, StreamDot } from './motion';
import { useLivePrice } from './price';
import { StopHunt } from './HowItWorks';
import { FireCard } from './Activity';
import { useCandles, useStats24h } from './market';
import Chart from './Chart';
import { Icon, Link, Num, Obj, State, Tx, Wordmark, shortHex, type ObjName } from './ui';
import { Hidden } from './Terminal';
import { Certificate } from './OrderPage';
import { art } from './art';
import { PairLogo, TokenLogo } from './logos';

const Art = ({ subject, className }: { subject: string; className?: string }) => <div className={`art ${className ?? ''}`} aria-hidden="true"><img src={art(subject).src} alt="" decoding="async" /></div>;

const TECH: { code: string; title: string; body: string; obj: ObjName }[] = [
  { code: 'outlayer.testnet · request_execution', title: 'OutLayer TEE execution', body: 'check() runs a WASM pinned by SHA-256 on an Intel TDX worker; the result resumes into the contract.', obj: 'badge' },
  { code: '#[private] fn on_result', title: 'Promise-origin check', body: 'Callback results answer the contract’s own request. Signed reports can also use the relay.', obj: 'success' },
  { code: 'env::ed25519_verify', title: 'Enclave signature', body: 'Every report is signed by a key released only to this WASM hash, called by this contract.', obj: 'certificate' },
  { code: 'encryption_keys · bind: wasm', title: 'Keys only the build holds', body: 'The order key is derived inside the TEE; any other build or caller opens nothing.', obj: 'lock' },
  { code: 'callers.contract.only', title: 'Locked-down runs', body: 'Only the Seter contract may start runs; egress only to api.exchange.coinbase.com.', obj: 'shield-price' },
  { code: 'NEP-141 · x·y = k', title: 'Testnet settlement', body: 'NEAR Intents has no testnet, so fires swap on the vault’s NEAR / tUSD test pool.', obj: 'coin' },
];

/** The real terminal, live and read-only, in a device frame. */
function TerminalPreview() {
  const c = useCandles('1h');
  const d = useStats24h();
  const t = useTicker();
  const stats = useStats();
  const orders = useOrders();
  const last = t.data ? Number(t.data.price) : d.data?.last ?? null;
  const chg = d.data && last ? ((last - d.data.open) / d.data.open) * 100 : null;
  const armed = (orders.data ?? []).filter((o) => o.status === 'Open');
  const fired = (orders.data ?? []).filter((o) => o.fire);
  return <div className="device" aria-label="Live preview of the Seter terminal">
    <div className="device-bar"><i /><i /><i /><span className="mono">seter · trade NEAR/USD</span></div>
    <div className="prev">
      <div className="prev-mbar">
        <PairLogo base="NEAR" quote="USD" size={24} /><b>NEAR / USD</b>
        <span className="mono prev-last">{last ? last.toFixed(4) : '…'}</span>
        <span className={`mono ${chg === null ? '' : chg >= 0 ? 'up' : 'down'}`}>{chg === null ? '' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`}</span>
        <span className="mono prev-src">Coinbase · live</span>
      </div>
      <div className="prev-chart">{c.data ? <Chart data={c.data.slice(-110)} enclavePrice={stats.data?.last_check ? stats.data.last_check.price_e6 / 1e6 : null} marks={fired.map((o) => ({ time: Math.floor(nsToMs(o.fire!.block_ts) / 1000), label: `№${o.id} fired`, tone: 'fire' as const }))} compact /> : <State kind={c.error ? 'error' : 'loading'} title={c.error ? 'Candles unavailable' : 'Loading candles…'}>{c.error}</State>}</div>
      <div className="prev-side">
        <p className="prev-h">Sealed book</p>
        <ul>{armed.slice(0, 4).map((o) => <li key={o.id}><span className="mono">№{o.id}</span><Hidden label="" /></li>)}{orders.data && !armed.length && <li className="dim">No armed orders</li>}</ul>
        <p className="prev-mid mono">{last ? last.toFixed(4) : '…'}</p>
        <ul>{fired.slice(0, 2).map((o) => <li key={o.id}><span className="mono">№{o.id}</span><span className="mono gold">{e6(o.fire!.trigger_e6)}</span></li>)}</ul>
      </div>
      <div className="prev-form">
        <div className="prev-tabs"><span>Market</span><span>Limit</span><span className="on"><Icon name="lock" size={11} />Sealed stop</span></div>
        <div className="prev-field"><span>Trigger</span><Hidden label="sealed" /></div>
        <div className="prev-field"><span>Chain sees</span><code>ciphertext</code></div>
        <Link to="/app" className="btn btn-primary btn-block btn-sm">Seal order</Link>
      </div>
    </div>
  </div>;
}

function TrustStrip() {
  const att = firedStep?.attestation;
  const q = useQuote(att?.tx);
  if (!att) return null;
  const n = Object.values(att.checks).filter(Boolean).length;
  return <section className="trust" aria-label="Attested by Intel TDX">
    <img src={art('seal').src} alt="" aria-hidden="true" className="trust-seal" />
    <div className="trust-title"><b>Attested by Intel TDX</b><span>Every fire carries an Intel-signed quote from OutLayer.</span></div>
    <dl className="trust-items">
      <div><dt>Checks</dt><dd>{n}/{Object.keys(att.checks).length} pass</dd></div>
      <div><dt>TCB</dt><dd>{att.tcb.status}</dd></div>
      <div><dt>OutLayer run</dt><dd>#{att.request_id}</dd></div>
      <div><dt>Quote SHA-256 <small>live</small></dt><dd className="mono">{q.data ? shortHex(q.data.quoteSha256, 8, 4) : q.error ? 'unavailable' : '…'}</dd></div>
    </dl>
    <Link to="/order/1" className="btn btn-ghost btn-sm">Certificate <Icon name="arrow" size={14} /></Link>
  </section>;
}

/** The problem, made visible: a public stop next to the record Seter actually puts on chain. */
function Problem() {
  const orders = useOrders();
  const o = orders.data ? [...orders.data].sort((a, b) => b.id - a.id).find((x) => x.status === 'Open') ?? orders.data[orders.data.length - 1] : undefined;
  return <section className="l-sec l-problem" id="problem">
    <header className="l-head"><p className="kicker">Why sealed</p><h2>Your stop-loss is public. Seter seals it.</h2></header>
    <div className="pr-grid">
      <article className="pr-card">
        <header><span className="view-tag pr-tag-bad">On a public order book</span></header>
        <StopHunt />
        <pre className="view-json pr-json"><span className="k">type</span>    <span>stop_loss</span>{'\n'}<span className="k">trigger</span> <span className="bad">3.30</span>{'\n'}<span className="k">size</span>    <span className="bad">4,200 NEAR</span></pre>
        <p className="pr-note">Anyone can read the level, push the price to it and take the stops. Illustration.</p>
      </article>
      <article className="pr-card pr-seter dark">
        <header><span className="view-tag">On Seter</span><span className="dim small">live from NEAR testnet</span></header>
        {o ? <>
          <pre className="view-json"><span className="k">order</span>   <span>№{o.id}</span>{'\n'}<span className="k">owner</span>   <span>{o.owner}</span>{'\n'}<span className="k">placed</span>  <span>{new Date(toMs(o.created_ns)).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>{'\n'}<span className="k">ct</span>      <span className="c">"{o.ct.slice(0, 44)}…"</span>{'\n'}<span className="k">trigger</span> <span className="absent">not in the record</span>{'\n'}<span className="k">size</span>    <span className="absent">not in the record</span></pre>
          <p className="pr-note">The level stays sealed inside an Intel TDX enclave until the price crosses it.</p>
          <ProblemStats />
          <Link to={`/order/${o.id}`} className="btn btn-primary btn-sm">Open order №{o.id} <Icon name="arrow" size={14} /></Link>
        </> : <State kind={orders.error ? 'error' : 'loading'} title={orders.error ? 'Could not read the contract' : 'Reading the latest order…'}>{orders.error}</State>}
      </article>
    </div>
  </section>;
}

function ProblemStats() {
  const stats = useStats();
  const s = stats.data;
  return <dl className="pr-stats">
    <div><dt>Armed now</dt><dd>{s ? <CountUp value={s.open} /> : '…'}</dd></div>
    <div><dt>Levels anyone can read</dt><dd className="gold">{s ? 0 : '…'}</dd></div>
    <div><dt>Enclave</dt><dd className="pr-pulse"><EnclavePulse stats={s} compact /></dd></div>
  </dl>;
}

/** What is happening on the contract right now: counts, the enclave heartbeat, recent events and fires. */
function LiveNow() {
  const stats = useStats();
  const orders = useOrders();
  const requests = useRequests(stats.data?.requests_total);
  const live = useLivePrice();
  const log = useMemo(() => (orders.data && requests.data ? buildLog(orders.data, requests.data).slice(0, 6) : null), [orders.data, requests.data]);
  const fires = (orders.data ?? []).filter((o) => o.fire).sort((a, b) => b.id - a.id).slice(0, 3);
  return <section className="l-sec" id="live">
    <header className="l-head l-head-row"><div><p className="kicker">Live on chain</p><h2>Happening on the contract now.</h2></div><div className="page-head-r"><EnclavePulse stats={stats.data} /><StreamDot /></div></header>
    <div className="live-grid">
      <div className="pnl live-feed">
        <header className="pnl-tabs"><span className="pnl-tab on">Latest events</span><Link to="/activity" className="pnl-note">All activity →</Link></header>
        {log ? <ol className="feed">{log.map((e) => <li key={e.key} className={`feed-row feed-${e.kind}`}><span className="feed-ic"><Icon name={({ sealed: 'lock', checked: 'eye', fired: 'bolt', attested: 'seal', cancelled: 'ban' } as const)[e.kind]} size={16} /></span><div className="feed-main"><p>{e.title}</p><small>{e.detail}</small></div><div className="feed-r"><span className="mono dim">{ago(e.at)}</span>{e.tx && <Tx hash={e.tx} />}</div></li>)}</ol>
          : <div className="tbl-wrap"><State kind={stats.error || orders.error ? 'error' : 'loading'} title={stats.error || orders.error ? 'Could not read the contract' : 'Reading the contract…'}>{stats.error || orders.error}</State></div>}
      </div>
      <div className="pnl live-fires">
        <header className="pnl-tabs"><span className="pnl-tab on">Recent fires</span><span className="pnl-note">in money terms</span></header>
        <div className="fire-list">{fires.length ? fires.map((o) => <FireCard key={o.id} o={o} now={live.price} />) : <State kind={orders.data ? 'empty' : 'loading'} title={orders.data ? 'No fires yet' : 'Reading fires…'} />}</div>
      </div>
    </div>
  </section>;
}

const FAQ: [string, string][] = [
  ['What is a sealed stop?', 'A stop-loss or take-profit whose trigger price is encrypted in your browser. The chain stores only ciphertext, so nobody can see where you will sell until the order fires.'],
  ['Who can open my order?', 'Only a program running inside an Intel TDX enclave on OutLayer, pinned by its SHA-256 hash on the contract, plus your own device through a separate view key.'],
  ['How does it fire?', 'Each check runs that program. It reads NEAR-USD from Coinbase, opens the armed orders, and signs a report naming only the ones the price crossed. The contract verifies the signature and the crossing, sells on the pool and publishes the level.'],
  ['Can I prove the enclave did the check?', 'Yes. Every run has an Intel-signed TDX quote. The certificate page fetches it live from OutLayer and hashes it in your browser.'],
  ['What stays public?', 'Owner, time placed, status, when checks run and every fill. A check that fires nothing tells watchers that no level was crossed at that price.'],
  ['Is this live on mainnet?', 'No. It runs on NEAR testnet, fills settle on a NEAR / tUSD test pool, and tUSD has no value. Mainnet settlement through NEAR Intents is not built.'],
];
function Faq() {
  return <section className="dark faq" id="faq">
    <div className="faq-in">
      <header><p className="kicker">FAQ</p><h2>Questions a careful trader asks.</h2></header>
      <div className="faq-list">{FAQ.map(([q, a], i) => <details key={q} open={i === 0}><summary>{q}<Icon name="plus" size={18} /></summary><p>{a}</p></details>)}</div>
    </div>
  </section>;
}

export default function Landing() {
  const t = useTicker();
  const stats = useStats();
  const orders = useOrders();
  const config = useConfig();
  const s = stats.data;
  const price = t.data ? Number(t.data.price) : null;
  const fired = orders.data?.find((o) => o.fire);
  const latest = orders.data?.[orders.data.length - 1];
  const att = firedStep?.attestation;
  const v = (n: number | undefined) => (s ? n : stats.error ? '—' : '…');

  return <>
    <div className="dark hero-wrap">
      <header className="l-nav">
        <Link to="/" aria-label="Seter home"><Wordmark /></Link>
        <nav aria-label="Primary" className="l-links"><a href="#problem">Why sealed</a><Link to="/how-it-works">How it works</Link><Link to="/activity">Activity</Link><a href="#proof">Proof</a><a href="#faq">FAQ</a></nav>
        <Link to="/app" className="btn btn-primary btn-sm">Launch app</Link>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <p className="pill-live"><i className="live" />Live on NEAR testnet<span className="pill-sep" />NEAR <LiveTick dimmed={false} /></p>
          <h1>Your stop-loss, <em>invisible</em> until it fires.</h1>
          <p className="hero-lede">Sealed to an Intel TDX enclave. Your trigger stays encrypted until the order fires.</p>
          <div className="hero-cta"><Link to="/app" className="btn btn-primary btn-lg">Start trading <Icon name="arrow" size={17} /></Link><a href="#proof" className="btn btn-ghost btn-lg">See a real fire</a></div>
        </div>
        <Art subject="enclave" className="hero-art" />
      </section>
      <div className="hero-device"><TerminalPreview /></div>
    </div>

    <main id="main" className="l-main">
      <TrustStrip />

      <dl className="numbers" aria-label="Live proof numbers">
        <div><dt><span className="tamt"><PairLogo base="NEAR" quote="USD" />NEAR / USD · Coinbase</span></dt><dd className="mono"><LiveTick /></dd></div>
        <div><dt>Orders sealed</dt><dd>{s ? <CountUp value={s.orders_total} /> : v(undefined)}</dd></div>
        <div><dt>Open levels visible on chain</dt><dd className="gold">{s ? 0 : v(undefined)}</dd></div>
        <div><dt>Fired and audited</dt><dd>{s ? <CountUp value={s.fired} /> : v(undefined)}</dd></div>
        <div><dt>Enclave runs</dt><dd>{v(s?.requests_total)}<small>{s ? ` · ${s.rejected_reports} rejected` : ''}</small></dd></div>
      </dl>

      <Problem />

      <section className="benefits" id="benefits">
        <article className="ben">
          <Art subject="envelope" className="ben-art" />
          <div className="ben-copy">
            <p className="kicker">01 · Sealed</p>
            <h2>Sealed in your browser.</h2>
            <p>Trigger, side and size are encrypted to the enclave before they leave your device.</p>
            {latest && <div className="ben-live"><span className="label">Latest order on chain · №{latest.id}</span><code className="cipher">{latest.ct.slice(0, 96)}</code></div>}
          </div>
        </article>
        <article className="ben ben-flip">
          <Art subject="camera" className="ben-art" />
          <div className="ben-copy">
            <p className="kicker">02 · Unhuntable</p>
            <h2>Nothing for a stop hunter to see.</h2>
            <p>Orders are encrypted. Owner, timing and status remain public. Levels are revealed when they fire.</p>
            {orders.data && <ul className="ben-rows">{[...orders.data].reverse().slice(0, 4).map((o) => <li key={o.id}><span className="mono">№{o.id}</span><span className="mono dim">{shortHex(o.ct, 10, 4)}</span>{o.fire ? <span className="mono gold">{e6(o.fire.trigger_e6)}</span> : <Hidden label="" />}</li>)}</ul>}
          </div>
        </article>
        <article className="ben">
          <Art subject="seal" className="ben-art" />
          <div className="ben-copy">
            <p className="kicker">03 · Attested</p>
            <h2>Fired inside Intel TDX, then proven.</h2>
            <p>The enclave reads Coinbase NEAR-USD, fires only crossed orders and signs the report. The contract checks it, then publishes the trigger.</p>
            {fired?.fire && <div className="ben-cross"><div><span className="label">Trigger №{fired.id}</span><b className="mono">{e6(fired.fire.trigger_e6)}</b></div><div><span className="label">Price read in TDX</span><b className="mono gold">{e6(fired.fire.price_e6)}</b></div><div><span className="label">Last check</span><b className="mono">{s?.last_check ? ago(nsToMs(s.last_check.block_ts)) : '…'}</b></div></div>}
          </div>
        </article>
      </section>

      <section className="l-sec" id="proof">
        <header className="l-head l-head-art"><div><p className="kicker">Live proof · NEAR testnet, 9 Nov 2026</p><h2>A real stop, fired by a real price.</h2></div><Obj name="candle-hidden" size={112} className="l-head-obj" /></header>
        <div className="proof">
          {att && fired?.fire ? <Certificate att={att} pinned={config.data?.enclave_hash ?? enclaveUpload.sha256} subject={`The pinned program read NEAR/USD at ${e6(fired.fire.price_e6)} inside Intel TDX and fired order №${fired.id} at its sealed trigger ${e6(fired.fire.trigger_e6)}.`} /> : <State kind={orders.error ? 'error' : 'loading'} art={orders.error ? 'warning' : undefined} title={orders.error ? 'Could not read the contract' : 'Reading the fired order…'}>{orders.error}</State>}
          <div className="runlist">
            <p className="runlist-h">Recorded transactions</p>
            <ol>{runSteps.map((st) => <li key={st.tx} className={st.attestation ? 'is-fire' : ''}>
              <span className="mono dim">{st.at ? new Date(st.at).toISOString().slice(11, 19) : ''}</span>
              <p>{st.step.replace('; trigger hidden on chain', '').replace(' (OutLayer TEE run)', '')}{st.last_check ? <small className="mono"> · read {e6(st.last_check.price_e6)}</small> : null}</p>
              <Tx hash={st.tx!} />
            </li>)}</ol>
          </div>
        </div>
      </section>

      <LiveNow />

      <section className="l-sec" id="tech">
        <header className="l-head"><p className="kicker">The NEAR tech</p><h2>Signed enclave reports, checked on chain.</h2></header>
        <div className="tech">{TECH.map((x) => <article key={x.code}><Obj name={x.obj} size={72} className="tech-obj" /><h3>{x.title}</h3><p>{x.body}</p><code>{x.code}</code></article>)}</div>
      </section>
    </main>

    <Faq />

    <section className="dark cta">
      <Art subject="tripwire" className="cta-art" />
      <div><h2>Set a stop the market can’t see.</h2><Link to="/app" className="btn btn-primary btn-lg">Launch app <Icon name="arrow" size={17} /></Link></div>
    </section>

    <footer className="l-foot">
      <div className="l-foot-in">
        <div className="l-foot-brand"><Wordmark small /><p>Sealed stop and take-profit orders on NEAR testnet, fired by an attested OutLayer enclave.</p></div>
        <div><h4>Product</h4><Link to="/app">Trade NEAR/USD</Link><Link to="/book">Sealed book</Link><Link to="/portfolio">Portfolio</Link><Link to="/activity">Activity</Link><Link to="/how-it-works">How it works</Link></div>
        <div><h4>Contracts</h4><a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">Vault {short(CONTRACT, 8)}</a><a href={accountUrl(TOKEN)} target="_blank" rel="noreferrer"><TokenLogo sym="tUSD" />tUSD {short(TOKEN, 8)}</a><span className="mono">WASM {(config.data?.enclave_hash ?? deployment.enclave.sha256).slice(0, 12)}…</span></div>
        <div><h4>Status</h4><span>Mainnet via NEAR Intents: <b>Not built</b></span><a href="https://outlayer.ai" target="_blank" rel="noreferrer">OutLayer <Icon name="external" size={11} /></a></div>
      </div>
      <p className="l-legal">MIT · © 2026 Nivesh Gajengi · NEAR testnet only; tUSD has no value. Formerly Mienai; on-chain account IDs keep the old prefix.</p>
    </footer>
  </>;
}
