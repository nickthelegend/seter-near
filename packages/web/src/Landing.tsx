import { useMemo } from 'react';
import { CONTRACT, TOKEN, accountUrl, ago, deployment, e6, enclaveUpload, firedStep, nsToMs, runSteps, shortAccount, type Order } from './lib';
import { useConfig, useOrders, useStats, useTicker } from './live';
import { Icon, Link, Num, Redacted, State, Tx, Wordmark } from './ui';
import { EnclavePanel } from './Console';
import { Certificate } from './OrderPage';

function HangingTicket({ o, i }: { o: Order; i: number }) {
  const fired = o.status === 'Fired';
  return <Link to={`/order/${o.id}`} className={`hang hang-${fired ? 'fired' : o.status === 'Open' ? 'armed' : 'gone'}`} aria-label={`Order ${o.id}, ${o.status}`}>
    <i className="hang-clip" aria-hidden="true" />
    <span className="hang-slip" style={{ rotate: `${[-4, 3, -2, 5, -3, 2][i % 6]}deg` }}>
      <span className="hang-no">№{String(o.id).padStart(2, '0')}</span>
      <span className="hang-st">{fired ? 'Fired' : o.status === 'Open' ? 'Armed' : o.status}</span>
      {o.fire ? <b className="hang-val">{e6(o.fire.trigger_e6)}</b> : <Redacted size="sm" label="hidden" />}
    </span>
  </Link>;
}

const TECH = [
  { code: 'outlayer.testnet · request_execution', title: 'OutLayer TEE run', body: 'check() calls OutLayer with a WasmUrl pinned by SHA-256. OutLayer yields, a TDX worker runs the enclave, and the result resumes into the contract’s callback.' },
  { code: '#[private] fn on_result', title: 'Promise origin', body: 'The only door for a result is the promise of the contract’s own request. Calling on_result directly fails: “Method on_result is private”.' },
  { code: 'env::ed25519_verify', title: 'Enclave signature', body: 'Every report is signed by a key OutLayer’s keystore releases only to this WASM hash called by this contract. The contract verifies it before anything moves.' },
  { code: 'encryption_keys · bind: wasm', title: 'Keys only the build holds', body: 'The order key is derived inside the TEE from the WASM hash and the calling contract. Another build or caller derives another key and opens nothing.' },
  { code: 'callers.contract.only', title: 'Who may run it', body: 'The manifest, covered by the WASM hash, admits runs only from the Mienai contract, with HTTPS egress only to api.exchange.coinbase.com.' },
  { code: 'NEP-141 · x·y = k', title: 'Settlement on testnet', body: 'NEAR Intents has no testnet, so a fire swaps against the vault’s NEAR / tUSD constant-product pool (0.3% fee). tUSD is a test token.' },
];

export default function Landing() {
  const ticker = useTicker();
  const stats = useStats();
  const orders = useOrders();
  const config = useConfig();
  const price = ticker.data ? Number(ticker.data.price) : null;
  const hanging = useMemo(() => [...(orders.data ?? [])].sort((a, b) => Number(b.status === 'Open') - Number(a.status === 'Open') || b.id - a.id).slice(0, 5), [orders.data]);
  const fired = orders.data?.find((o) => o.fire);
  const latest = orders.data?.[orders.data.length - 1];
  const s = stats.data;
  const c = s?.last_check;
  const att = firedStep?.attestation;

  return <>
    <header className="l-nav">
      <Link to="/" aria-label="Mienai home"><Wordmark /></Link>
      <nav aria-label="Primary">
        <a href="#how" className="l-link">How it works</a>
        <a href="#proof" className="l-link">Proof</a>
        <Link to="/app" className="btn btn-light btn-sm">Open console</Link>
      </nav>
    </header>

    <main id="main">
      <section className="hero">
        <div className="hero-object" aria-hidden="true"><img src="/art/mienai-feature-enclave.webp" alt="" fetchPriority="high" /></div>
        <div className="hero-copy">
          <p className="eyebrow mono"><span lang="ja">見えない</span> · sealed orders · NEAR testnet</p>
          <h1>Your stop-loss is <span className="h-sealed">invisible</span><br />until it fires.</h1>
          <p className="hero-lede">Stop hunters push the price to where stops sit. With Mienai the level is sealed to an Intel TDX enclave; the chain stores only ciphertext.</p>
          <div className="hero-cta">
            <Link to="/app" className="btn btn-primary btn-lg">Seal a stop <Icon name="arrow" size={17} /></Link>
            <a href="#hunter" className="btn btn-quiet btn-lg">What a stop hunter sees</a>
          </div>
        </div>
        <div className="wire" aria-label="Live order book hanging on the NEAR price line">
          <div className="wire-label mono"><i className="live" />NEAR / USD {price ? <b><Num value={price.toFixed(4)} /></b> : <b>{ticker.error ? 'unavailable' : '…'}</b>}<span>Coinbase · live</span></div>
          <div className="wire-line" aria-hidden="true" />
          <div className="wire-tickets">{orders.data ? hanging.map((o, i) => <HangingTicket key={o.id} o={o} i={i} />) : <span className="wire-wait mono">{orders.error ? 'contract unreadable' : 'reading the book…'}</span>}</div>
          <p className="wire-note">{s ? <>{s.open} armed · {s.fired} fired · <b>0 levels on chain</b></> : 'Reading the contract…'}</p>
        </div>
      </section>

      <section className="l-sec" id="how">
        <header className="l-head"><p className="eyebrow mono">How it works</p><h2>Seal. Watch. Fire, then reveal.</h2></header>
        <div className="bento">
          <article className="b-card b-seal">
            <span className="b-n mono">01</span>
            <h3>Sealed in your browser</h3>
            <p>Trigger, side and size are encrypted to the enclave’s X25519 key, bound to your account. The contract keeps the ciphertext and a SHA-256 commitment.</p>
            <div className="b-live">
              <p className="label">Latest order on chain · №{latest?.id ?? '—'}</p>
              {latest ? <code className="cipher cipher-flow">{latest.ct.slice(0, 180)}</code> : <p className="dim">{orders.error || 'Loading'}</p>}
            </div>
            <img className="b-art b-art-shield" src="/art/mienai-st-shield.webp" alt="" aria-hidden="true" />
          </article>
          <article className="b-card b-watch">
            <img className="b-photo" src="/art/mienai-feature-tripwire.webp" alt="" aria-hidden="true" />
            <span className="b-n mono">02</span>
            <h3>The enclave watches</h3>
            <p>A keeper pays for a check. OutLayer runs the pinned WASM in Intel TDX; it reads NEAR/USD from Coinbase inside the enclave and opens every order. Unfired levels never leave it.</p>
            <div className="b-live">
              <p className="label">Last check · price read in the TEE</p>
              {c ? <><p className="b-big"><Num value={e6(c.price_e6)} /></p><p className="dim">opened {c.checked} · fired {c.fired.length} · {ago(nsToMs(c.block_ts))}</p></> : <p className="dim">{stats.error || 'Loading'}</p>}
            </div>
          </article>
          <article className="b-card b-fire">
            <img className="b-art b-art-ticket" src="/art/mienai-st-ticket.webp" alt="" aria-hidden="true" />
            <span className="b-n mono">03</span>
            <h3>Fire, then reveal</h3>
            <p>A crossed order returns signed by the enclave into a private callback. The contract checks signature, freshness, commitment and the crossing, swaps, then publishes the trigger.</p>
            {fired?.fire ? <div className="b-reveal"><div><span className="label">Trigger №{fired.id}</span><b><Num value={e6(fired.fire.trigger_e6)} /></b></div><div><span className="label">Price read</span><b className="mint"><Num value={e6(fired.fire.price_e6)} /></b></div></div> : <p className="dim">{orders.data ? 'Nothing has fired yet.' : 'Loading'}</p>}
          </article>
          <article className="b-card b-band">
            <span className="b-n mono">04</span>
            <h3>Only crowds get counted</h3>
            <p>The enclave can publish how many stops sit in each $0.05 band, but only for bands with at least k = {s?.bands?.k ?? 5} orders. A lone stop is never located.</p>
            {s?.bands ? <><div className="bandgrid" role="img" aria-label={`${s.bands.suppressed} of ${s.bands.total} suppressed`}>{Array.from({ length: Math.max(s.bands.total, s.bands.k) }, (_, i) => <i key={i} className={i < s.bands!.total ? (i < s.bands!.total - s.bands!.suppressed ? 'pub' : 'sup') : ''} />)}</div><p className="dim">{s.bands.suppressed} of {s.bands.total} orders suppressed in the last report</p></> : <p className="dim">{s ? 'No band report yet.' : 'Loading'}</p>}
          </article>
        </div>
      </section>

      <section className="l-sec" id="hunter">
        <header className="l-head l-head-row">
          <div><p className="eyebrow mono">Live · {CONTRACT}</p><h2>Two views of the same contract.</h2></div>
          <Link to="/app" className="l-more">Open the console <Icon name="arrow" size={16} /></Link>
        </header>
        <div className="views">
          <div className="hunter">
            <img className="hunter-cam" src="/art/mienai-st-camera.webp" alt="" aria-hidden="true" />
            <header><Icon name="eye" size={18} /><div><h3>What a stop hunter sees</h3><p>The contract’s public state, read live. Anyone can call these views.</p></div></header>
            <dl className="tally">
              <div><dt>Orders</dt><dd>{s ? s.orders_total : '—'}</dd></div>
              <div><dt>Armed</dt><dd>{s ? s.open : '—'}</dd></div>
              <div><dt>Cancelled</dt><dd>{s ? s.cancelled : '—'}</dd></div>
              <div><dt>Levels visible</dt><dd className="mint">{s ? 0 : '—'}</dd></div>
            </dl>
            {!orders.data ? <State kind={orders.error ? 'error' : 'loading'} title={orders.error ? 'Could not read the contract' : 'Reading the book…'}>{orders.error}</State>
              : <ul className="book">{[...orders.data].reverse().slice(0, 6).map((o) => <li key={o.id}>
                <span className="mono book-no">№{String(o.id).padStart(2, '0')}</span>
                <span className="book-ct"><code>{o.ct.slice(0, 40)}</code><small className="mono">{shortAccount(o.owner)}</small></span>
                <span>{o.fire ? <b className="mono mint">{o.fire.cond === 'lte' ? '≤' : '≥'} {e6(o.fire.trigger_e6)}</b> : <Redacted size="sm" />}</span>
              </li>)}</ul>}
          </div>
          <EnclavePanel config={config.data} configError={config.error} stats={s} />
        </div>
      </section>

      <section className="l-sec" id="proof">
        <header className="l-head"><p className="eyebrow mono">Live proof · recorded 9 Nov 2026</p><h2>A real stop, fired by a real price.</h2><p className="l-lede">Sealed while NEAR traded at 3.6021. The first enclave check read 3.6003 and fired nothing; the second read 3.5886 and fired it.</p></header>
        <div className="proof">
          {att && fired?.fire ? <Certificate att={att} pinned={config.data?.enclave_hash ?? enclaveUpload.sha256} subject={`The pinned program ran inside Intel TDX, read NEAR/USD at ${e6(fired.fire.price_e6)} and fired order №${fired.id} at its sealed trigger ${e6(fired.fire.trigger_e6)}.`} /> : <State kind="empty" title="No recorded fire yet" />}
          <ol className="rail">
            {runSteps.map((st) => <li key={st.tx} className={st.attestation ? 'is-fire' : ''}>
              <span className="rail-dot" aria-hidden="true" />
              <div><p>{st.step.replace('; trigger hidden on chain', '').replace(' (OutLayer TEE run)', '')}</p><span className="mono dim">{st.at ? new Date(st.at).toISOString().slice(11, 19) + ' UTC' : ''}{st.last_check ? ` · read ${e6(st.last_check.price_e6)}` : ''}</span></div>
              <Tx hash={st.tx!} />
            </li>)}
          </ol>
        </div>
      </section>

      <section className="l-sec" id="tech">
        <header className="l-head"><p className="eyebrow mono">The NEAR tech, concretely</p><h2>Two independent origin checks, both on chain.</h2></header>
        <dl className="spec">{TECH.map((t) => <div key={t.code}><dt><code>{t.code}</code></dt><dd><b>{t.title}</b><span>{t.body}</span></dd></div>)}</dl>
        <p className="l-foot-note">Contracts <a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">{CONTRACT}</a> (vault) and <a href={accountUrl(TOKEN)} target="_blank" rel="noreferrer">{TOKEN}</a> (tUSD). Enclave hash <span className="mono">{(config.data?.enclave_hash ?? deployment.enclave.sha256).slice(0, 16)}…</span>. Mainnet execution through NEAR Intents is <b>Setup required: NEAR_MAINNET_ACCOUNT</b>.</p>
      </section>

      <section className="closer">
        <img src="/art/mienai-hero.webp" alt="" aria-hidden="true" />
        <div><h2>Set a stop the market can’t see.</h2><Link to="/app" className="btn btn-primary btn-lg">Open the console <Icon name="arrow" size={17} /></Link></div>
      </section>
    </main>
    <footer className="l-foot">
      <Wordmark small />
      <p>Sealed stop and limit orders on NEAR testnet, fired by an attested OutLayer enclave. MIT · © 2026 Nivesh Gajengi · tUSD has no value.</p>
      <div className="l-foot-links"><a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">Contract <Icon name="external" size={12} /></a><a href="https://outlayer.ai" target="_blank" rel="noreferrer">OutLayer <Icon name="external" size={12} /></a></div>
    </footer>
  </>;
}
