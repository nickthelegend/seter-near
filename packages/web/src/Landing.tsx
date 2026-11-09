import { CONTRACT, TOKEN, accountUrl, ago, deployment, e6, enclaveUpload, firedStep, near, nsToMs, runSteps, short } from './lib';
import { useConfig, useOrders, useStats, useTicker } from './live';
import { useCandles, useStats24h } from './market';
import Chart from './Chart';
import { Icon, Link, Num, State, Tx, Wordmark } from './ui';
import { Hidden } from './Terminal';
import { Certificate } from './OrderPage';
import { art } from './art';

function Art({ subject, className, fallback }: { subject: string; className?: string; fallback?: string }) {
  const a = art(subject, fallback);
  return <div className={`art ${a.generated ? 'art-gen' : 'art-fallback'} ${className ?? ''}`} aria-hidden="true"><img src={a.src} alt="" decoding="async" /></div>;
}

const TECH = [
  { icon: 'cube', code: 'outlayer.testnet · request_execution', title: 'OutLayer TEE execution', body: 'check() asks OutLayer to run a WASM pinned by SHA-256. A TDX worker runs it and the result resumes into the contract’s callback.' },
  { icon: 'lock', code: '#[private] fn on_result', title: 'Promise-origin check', body: 'The only door for a result is the promise of the contract’s own request. A direct call fails with “Method on_result is private”.' },
  { icon: 'seal', code: 'env::ed25519_verify', title: 'Enclave signature', body: 'Every report is signed by a key OutLayer’s keystore releases only to this WASM hash, called by this contract.' },
  { icon: 'eye', code: 'encryption_keys · bind: wasm', title: 'Keys only the build holds', body: 'The order key is derived inside the TEE from the WASM hash and the calling contract. Any other build or caller opens nothing.' },
  { icon: 'ban', code: 'callers.contract.only', title: 'Locked-down runs', body: 'The manifest admits runs only from the Mienai contract, with HTTPS egress only to api.exchange.coinbase.com.' },
  { icon: 'wallet', code: 'NEP-141 · x·y = k', title: 'Testnet settlement', body: 'NEAR Intents has no testnet, so a fire swaps on the vault’s NEAR / tUSD pool (0.3% fee). tUSD is a test token.' },
];

/** A live, read-only preview of the terminal: real Coinbase candles, the sealed book and the order panel's sealed tab. */
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
  return <div className="frame" aria-label="Live preview of the Mienai terminal">
    <div className="frame-bar"><i /><i /><i /><span className="mono">mienai · trade NEAR/USD</span></div>
    <div className="prev">
      <div className="prev-mbar">
        <b>NEAR / USD</b>
        <span className={`mono ${chg === null ? '' : chg >= 0 ? 'up' : 'down'}`}>{last ? last.toFixed(4) : '…'}</span>
        <span className="mono dim">{chg === null ? '' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% 24h`}</span>
        <span className="mono dim prev-src">Coinbase</span>
      </div>
      <div className="prev-chart">{c.data ? <Chart data={c.data.slice(-120)} enclavePrice={stats.data?.last_check ? stats.data.last_check.price_e6 / 1e6 : null} marks={fired.map((o) => ({ time: Math.floor(nsToMs(o.fire!.block_ts) / 1000), label: `№${o.id} fired`, tone: 'fire' as const }))} compact /> : <State kind={c.error ? 'error' : 'loading'} title={c.error ? 'Candles unavailable' : 'Loading candles…'}>{c.error}</State>}</div>
      <div className="prev-side">
        <p className="prev-h">Sealed book</p>
        <ul>{armed.slice(0, 4).map((o) => <li key={o.id}><span className="mono">№{o.id}</span><Hidden label="" /><span className="mono dim">{ago(nsToMs(o.created_ns))}</span></li>)}{orders.data && !armed.length && <li className="dim">No armed orders</li>}</ul>
        <p className="prev-mid mono">{last ? last.toFixed(4) : '…'}</p>
        <ul>{fired.slice(0, 2).map((o) => <li key={o.id}><span className="mono">№{o.id}</span><span className="mono mint">{e6(o.fire!.trigger_e6)}</span><span className="mono dim">fired</span></li>)}</ul>
      </div>
      <div className="prev-form">
        <div className="prev-tabs"><span>Market</span><span>Limit</span><span className="on"><Icon name="lock" size={11} />Sealed stop</span></div>
        <div className="prev-field"><span>Trigger</span><Hidden label="sealed" /></div>
        <div className="prev-field"><span>Chain sees</span><code>ciphertext · 276 chars</code></div>
        <Link to="/app" className="btn btn-primary btn-block btn-sm">Seal order</Link>
      </div>
    </div>
  </div>;
}

export default function Landing() {
  const ticker = useTicker();
  const d = useStats24h();
  const stats = useStats();
  const orders = useOrders();
  const config = useConfig();
  const s = stats.data;
  const price = ticker.data ? Number(ticker.data.price) : null;
  const chg = d.data && price ? ((price - d.data.open) / d.data.open) * 100 : null;
  const fired = orders.data?.find((o) => o.fire);
  const att = firedStep?.attestation;
  const stat = (v: number | undefined) => (s ? v : stats.error ? '—' : '…');

  return <>
    <header className="l-nav">
      <div className="l-nav-in">
        <Link to="/" aria-label="Mienai home"><Wordmark /></Link>
        <nav aria-label="Primary" className="l-links">
          <a href="#product">Product</a><a href="#hunter">Privacy</a><a href="#how">How it works</a><a href="#proof">Proof</a><a href="#tech">NEAR tech</a>
        </nav>
        <Link to="/app" className="btn btn-primary btn-sm">Launch app</Link>
      </div>
    </header>

    <main id="main" className="l-main">
      <section className="hero-card">
        <Art subject="enclave" className="hero-art" />
        <div className="hero-copy">
          <p className="pill-live"><i className="live" />Live on NEAR testnet · OutLayer TEE (Intel TDX)</p>
          <h1>Stop-losses the market can’t see.</h1>
          <p className="hero-lede">Mienai seals your stop or take-profit to an enclave. The chain stores only ciphertext, so nobody can hunt your level. It is revealed only after it fires, with an Intel TDX attestation.</p>
          <div className="hero-cta"><Link to="/app" className="btn btn-primary btn-lg">Start trading <Icon name="arrow" size={17} /></Link><a href="#proof" className="btn btn-ghost btn-lg">See a real fire</a></div>
        </div>
      </section>

      <section className="tiles" aria-label="Live markets">
        <div className="tile"><span className="coin" aria-hidden="true">N</span><div><b>NEAR / USD</b><small>Coinbase last</small></div><p className="mono">{price ? <Num value={price.toFixed(4)} /> : '…'}<small className={chg === null ? '' : chg >= 0 ? 'up' : 'down'}>{chg === null ? '' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`}</small></p></div>
        <div className="tile"><span className="coin coin-lock" aria-hidden="true"><Icon name="lock" size={16} /></span><div><b>Sealed orders armed</b><small>levels visible on chain: 0</small></div><p className="mono">{stat(s?.open)}</p></div>
        <div className="tile"><span className="coin coin-eye" aria-hidden="true"><Icon name="eye" size={16} /></span><div><b>Last enclave check</b><small>{s?.last_check ? ago(nsToMs(s.last_check.block_ts)) : 'price read inside TDX'}</small></div><p className="mono">{s?.last_check ? e6(s.last_check.price_e6) : stat(undefined)}</p></div>
      </section>

      <section className="l-sec bigstats" aria-label="Live contract stats">
        <h2>Live on NEAR testnet</h2>
        <p className="l-lede">Read from <a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer" className="mono">{CONTRACT}</a> every 15 seconds.</p>
        <dl>
          <div><dt>Orders sealed</dt><dd>{stat(s?.orders_total)}</dd></div>
          <div><dt>Fired and audited</dt><dd>{stat(s?.fired)}</dd></div>
          <div><dt>Levels visible on chain</dt><dd className="mint">{s ? 0 : stat(undefined)}</dd></div>
          <div><dt>Enclave runs · rejected</dt><dd>{s ? <>{s.requests_total}<small> · {s.rejected_reports}</small></> : stat(undefined)}</dd></div>
        </dl>
      </section>

      <section className="l-sec" id="hunter">
        <header className="l-head l-head-row hunter-head">
          <div><p className="kicker">What a stop hunter sees</p><h2>The whale reads the chain. It finds no levels.</h2></div>
          <Art subject="whale" className="whale" />
        </header>
        <div className="views">
          <article className="view">
            <Art subject="camera" className="view-art" />
            <p className="kicker">Public contract state · live</p>
            <h3>Ciphertexts and counts</h3>
            {!orders.data ? <State kind={orders.error ? 'error' : 'loading'} title={orders.error ? 'Could not read the contract' : 'Reading the book…'}>{orders.error}</State>
              : <ul className="view-rows">{[...orders.data].reverse().slice(0, 5).map((o) => <li key={o.id}><span className="mono">№{o.id}</span><code>{o.ct.slice(0, 30)}</code>{o.fire ? <span className="mono mint">{e6(o.fire.trigger_e6)}</span> : <Hidden label="" />}</li>)}</ul>}
            <p className="view-foot">Levels visible on chain: <b className="mint">{s ? 0 : '…'}</b> · a level is published only after its order fires</p>
          </article>
          <article className="view view-enc">
            <Art subject="enclave" className="view-art" />
            <p className="kicker">Inside Intel TDX · last check</p>
            <h3>Only the enclave opens them</h3>
            {s?.last_check ? <dl className="view-kv">
              <div><dt>Price read</dt><dd className="mono">{e6(s.last_check.price_e6)} USD</dd></div>
              <div><dt>Orders opened</dt><dd className="mono">{s.last_check.checked}</dd></div>
              <div><dt>Fired</dt><dd className="mono">{s.last_check.fired.length ? s.last_check.fired.map((i) => `№${i}`).join(', ') : 'none'}</dd></div>
              <div><dt>When</dt><dd className="mono">{ago(nsToMs(s.last_check.block_ts))} · block {s.last_check.block_height}</dd></div>
              <div><dt>Band report (k = {s.bands?.k ?? 5})</dt><dd className="mono">{s.bands ? `${s.bands.suppressed} of ${s.bands.total} suppressed` : 'none yet'}</dd></div>
            </dl> : <State kind={stats.error ? 'error' : 'loading'} title={stats.error ? 'Could not read the contract' : 'Reading the last check…'}>{stats.error}</State>}
          </article>
        </div>
      </section>

      <section className="l-sec center" id="product">
        <p className="kicker">Sealed orders · public settlement</p>
        <h2>Trade without showing your hand.</h2>
        <p className="l-lede">A familiar terminal: Coinbase NEAR/USD candles, a sealed book whose levels nobody can read, and an order panel with sealed stop and take-profit orders.</p>
        <TerminalPreview />
      </section>

      <section className="l-sec" aria-label="Features">
        <div className="features">
          <article className="feat"><Art subject="envelope" className="feat-art" /><div><p className="kicker">Hidden</p><h3>Invisible until it fires</h3><p>Trigger, side and size are encrypted in your browser to the enclave’s X25519 key and bound to your account. Anyone reading the contract sees ciphertext and a commitment.</p></div></article>
          <article className="feat"><Art subject="tripwire" className="feat-art" /><div><p className="kicker">Executed</p><h3>Checked inside Intel TDX</h3><p>On each check, OutLayer runs the pinned enclave. It reads the Coinbase price inside TDX, opens every order and reports only the ones the price crossed.</p></div></article>
          <article className="feat"><Art subject="seal" className="feat-art" /><div><p className="kicker">Proven</p><h3>Audited after the fact</h3><p>The contract accepts a fire only with the enclave’s signature, a fresh price and a matching commitment. Then the trigger is published so anyone can check the crossing.</p></div></article>
        </div>
      </section>

      <section className="l-sec" id="how">
        <header className="l-head"><p className="kicker">How it works</p><h2>Seal, check, fire and reveal.</h2></header>
        <ol className="steps">
          <li><span className="mono">01</span><h3>Seal</h3><p><code>place_order(ct, commit, view_ct)</code> stores the ciphertext, a SHA-256 commitment and a copy only your device can open.</p></li>
          <li><span className="mono">02</span><h3>Check</h3><p>Anyone can pay about 0.02 NEAR for <code>check()</code>. The enclave reads Coinbase NEAR-USD inside TDX and opens every armed order.</p></li>
          <li><span className="mono">03</span><h3>Fire and reveal</h3><p>A crossed order returns signed into <code>on_result</code>. The contract verifies everything, swaps on the vault pool and records the trigger.</p></li>
        </ol>
      </section>

      <section className="l-sec" id="proof">
        <header className="l-head l-head-row"><div><p className="kicker">Live proof · recorded 9 Nov 2026</p><h2>A real stop, fired by a real price.</h2></div><p className="l-lede">Sealed while NEAR traded at 3.6021. The first enclave check read 3.6003 and fired nothing; the second read 3.5886 and fired it.</p></header>
        <div className="proof">
          {att && fired?.fire ? <Certificate att={att} pinned={config.data?.enclave_hash ?? enclaveUpload.sha256} subject={`The pinned program ran inside Intel TDX, read NEAR/USD at ${e6(fired.fire.price_e6)} and fired order №${fired.id} at its sealed trigger ${e6(fired.fire.trigger_e6)}, selling ${near(fired.fire.filled_in, 2)} NEAR.`} /> : <State kind={orders.error ? 'error' : 'loading'} title={orders.error ? 'Could not read the contract' : 'Reading the fired order…'}>{orders.error}</State>}
          <div className="pnl runlist">
            <p className="runlist-h">Recorded transactions</p>
            <ol>{runSteps.map((st) => <li key={st.tx} className={st.attestation ? 'is-fire' : ''}>
              <span className="mono dim">{st.at ? new Date(st.at).toISOString().slice(11, 19) : ''}</span>
              <p>{st.step.replace('; trigger hidden on chain', '').replace(' (OutLayer TEE run)', '')}{st.last_check ? <small className="mono"> · read {e6(st.last_check.price_e6)}</small> : null}</p>
              <Tx hash={st.tx!} />
            </li>)}</ol>
          </div>
        </div>
      </section>

      <section className="l-sec" id="tech">
        <header className="l-head center"><p className="kicker">The NEAR tech, concretely</p><h2>Two independent origin checks, both on chain.</h2></header>
        <div className="tech">{TECH.map((t) => <article key={t.code}><span className="tech-ic"><Icon name={t.icon} size={18} /></span><h3>{t.title}</h3><p>{t.body}</p><code>{t.code}</code></article>)}</div>
      </section>

      <section className="cta">
        <Art subject="tripwire" className="cta-art" />
        <div><h2>Set a stop the market can’t see.</h2><p>Live on NEAR testnet. Connect a testnet wallet, deposit and seal.</p><Link to="/app" className="btn btn-primary btn-lg">Launch app <Icon name="arrow" size={17} /></Link></div>
      </section>
    </main>

    <footer className="l-foot">
      <div className="l-foot-in">
        <div className="l-foot-brand"><Wordmark small /><p>Sealed stop and take-profit orders on NEAR testnet, fired by an attested OutLayer enclave.</p></div>
        <div><h4>Product</h4><Link to="/app">Trade NEAR/USD</Link><a href="#how">How it works</a><a href="#proof">Proof</a></div>
        <div><h4>Contracts</h4><a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">Vault {short(CONTRACT, 8)}</a><a href={accountUrl(TOKEN)} target="_blank" rel="noreferrer">tUSD {short(TOKEN, 8)}</a><span className="mono">WASM {(config.data?.enclave_hash ?? deployment.enclave.sha256).slice(0, 12)}…</span></div>
        <div><h4>Status</h4><span>Mainnet via NEAR Intents: <b>Setup required: NEAR_MAINNET_ACCOUNT</b></span><a href="https://outlayer.ai" target="_blank" rel="noreferrer">OutLayer <Icon name="external" size={11} /></a></div>
      </div>
      <p className="l-legal">MIT · © 2026 Nivesh Gajengi · NEAR testnet only; tUSD has no value.</p>
    </footer>
  </>;
}
