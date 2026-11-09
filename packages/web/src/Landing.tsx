import { useEffect, useState } from 'react';
import { CONTRACT, TOKEN, accountUrl, ago, deployment, e6, firedStep, near, nsToMs, runSteps, shortAccount, usd6, type Order } from './lib';
import { useConfig, useFired, useOrders, useStats, useTicker } from './live';
import { Chip, Ciphertext, Eyebrow, Logo, Num, Redacted, State, Tx, statusTone } from './ui';

export default function Landing({ go }: { go: (path: string) => void }) {
  const ticker = useTicker();
  const stats = useStats();
  const orders = useOrders();
  const fired = useFired();
  const config = useConfig();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const lastFire = fired.data?.[fired.data.length - 1];
  const open = (e: React.MouseEvent) => { e.preventDefault(); go('/app'); };

  return (
    <div className="landing">
      <header className={`nav${scrolled ? ' nav--solid' : ''}`}>
        <div className="nav__inner">
          <Logo />
          <nav className="nav__links" aria-label="Sections">
            <a href="#attacker">Attacker's view</a>
            <a href="#how">How it works</a>
            <a href="#proof">Proof</a>
            <a href="#near">NEAR tech</a>
          </nav>
          <a className="btn btn--primary btn--sm" href="/app" onClick={open}>Open app</a>
        </div>
      </header>

      <section className="hero">
        <div className="hero__art" aria-hidden="true" />
        <div className="hero__inner">
          <Eyebrow>Private stop-loss · NEAR testnet · OutLayer TEE</Eyebrow>
          <h1 className="hero__title">Nobody can hunt <span className="hero__sealed">your stops.<i aria-hidden="true" /></span></h1>
          <p className="hero__lede">Your stop-loss is invisible until it fires. Levels are sealed to an enclave; the NEAR contract holds only ciphertexts. The enclave watches the price and fires through a verified callback, then the trigger goes public for audit.</p>
          <div className="hero__cta">
            <a className="btn btn--primary" href="/app" onClick={open}>Set an invisible stop</a>
            <a className="btn btn--ghost" href="#attacker">See what an attacker sees</a>
          </div>
        </div>
        <div className="strip" aria-label="Live numbers">
          <div className="strip__cell">
            <span className="label">NEAR / USD · Coinbase</span>
            {ticker.data ? <strong><Num value={Number(ticker.data.price).toFixed(4)} /></strong> : <strong className="muted">{ticker.error ? 'Unavailable' : 'Loading'}</strong>}
            <span className="sub">{ticker.data ? `trade #${ticker.data.trade_id}` : ticker.error || 'public ticker'}</span>
          </div>
          <div className="strip__cell">
            <span className="label">Sealed orders open</span>
            <strong>{stats.data ? stats.data.open : '—'}</strong>
            <span className="sub">{stats.data ? `${stats.data.orders_total} placed in total` : stats.error || 'Loading'}</span>
          </div>
          <div className="strip__cell">
            <span className="label">Fired and audited</span>
            <strong className="signal">{stats.data ? stats.data.fired : '—'}</strong>
            <span className="sub">{stats.data ? `${stats.data.rejected_reports} reports rejected` : 'Loading'}</span>
          </div>
          <div className="strip__cell">
            <span className="label">Enclave runs</span>
            <strong>{stats.data ? stats.data.requests_total : '—'}</strong>
            <span className="sub">{stats.data?.last_check ? `last check ${ago(nsToMs(stats.data.last_check.block_ts))}` : 'OutLayer · Intel TDX'}</span>
          </div>
        </div>
      </section>

      <section className="section" id="attacker">
        <div className="section__head">
          <Eyebrow>What a stop hunter sees</Eyebrow>
          <h2>Ciphertexts and counts. Never a level.</h2>
          <p>This is the contract's public state, read live from <a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">{CONTRACT}</a>. Anyone, including a whale looking for liquidity, sees exactly this.</p>
        </div>
        <div className="split">
          <div className="panel panel--book">
            <div className="panel__head">
              <h3>Public order book</h3>
              <span className="mono muted">{orders.data ? `${orders.data.length} orders` : ''}</span>
            </div>
            <BookTable orders={orders.data} error={orders.error} />
            <div className="tally" aria-label="Counts anyone can read">
              <div><span className="label">Open</span><strong>{stats.data?.open ?? '—'}</strong></div>
              <div><span className="label">Fired</span><strong>{stats.data?.fired ?? '—'}</strong></div>
              <div><span className="label">Cancelled</span><strong>{stats.data?.cancelled ?? '—'}</strong></div>
              <div><span className="label">Levels visible</span><strong className="signal">0</strong></div>
            </div>
          </div>
          <div className="panel panel--enclave">
            <div className="panel__head"><h3>What only the enclave reads</h3><Chip tone="accent">Intel TDX</Chip></div>
            <p className="panel__lede">The enclave opens every sealed order on each check, and says only which ones the price crossed.</p>
            {stats.data?.last_check ? (
              <dl className="facts">
                <div><dt>Last check</dt><dd>request #{stats.data.last_check.request} · block {stats.data.last_check.block_height}</dd></div>
                <div><dt>Price it read</dt><dd><Num value={e6(stats.data.last_check.price_e6)} unit="USD" /></dd></div>
                <div><dt>Orders opened</dt><dd>{stats.data.last_check.checked} ({stats.data.last_check.unreadable} unreadable)</dd></div>
                <div><dt>Fired</dt><dd>{stats.data.last_check.fired.length ? stats.data.last_check.fired.map((id) => `#${id}`).join(', ') : 'none'}</dd></div>
              </dl>
            ) : <State kind={stats.error ? 'error' : 'loading'}>{stats.error || 'Reading the contract'}</State>}
            <div className="bands">
              <span className="label">Liquidity bands (k ≥ 5)</span>
              {stats.data?.bands ? (
                <p>{JSON.parse(stats.data.bands.bands).length} bands published, {stats.data.bands.suppressed} orders suppressed (fewer than {stats.data.bands.k} in their band).</p>
              ) : (
                <p className="muted">No band report yet. The enclave publishes order counts per $0.05 band only when a band holds at least 5 orders, so no single stop can be located.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section__head">
          <Eyebrow>How it works</Eyebrow>
          <h2>Seal. Watch. Fire, then reveal.</h2>
        </div>
        <div className="beats">
          <article className="beat">
            <div className="beat__art beat__art--enclave" role="img" aria-label="A frosted enclave cube receiving sealed order threads" />
            <span className="beat__n">01</span>
            <h3>Seal in your browser</h3>
            <p>Your trigger, side and size are encrypted to the enclave's X25519 key (XChaCha20-Poly1305, bound to your account). The contract stores the ciphertext and a SHA-256 commitment.</p>
          </article>
          <article className="beat">
            <div className="beat__art beat__art--tripwire" role="img" aria-label="A mint tripwire crossing frosted glass panes" />
            <span className="beat__n">02</span>
            <h3>The enclave watches</h3>
            <p>A keeper pays for a check. OutLayer runs the pinned WASM in Intel TDX; it reads NEAR/USD from Coinbase inside the enclave and opens every order. Unfired levels never leave it.</p>
          </article>
          <article className="beat beat--record">
            <span className="beat__n">03</span>
            <h3>Fire, then reveal</h3>
            <p>A crossed order comes back signed by the enclave's key into a private callback. The contract checks signature, freshness, commitment and the crossing, swaps, and publishes the trigger.</p>
            {lastFire?.fire ? <FireCard order={lastFire} /> : <State kind={fired.error ? 'error' : 'loading'}>{fired.error || 'Loading the latest fire'}</State>}
          </article>
        </div>
      </section>

      <section className="section" id="proof">
        <div className="section__head">
          <Eyebrow>Live proof</Eyebrow>
          <h2>A real stop, fired by a real price.</h2>
          <p>Recorded on NEAR testnet on 9 Nov 2026. A stop was sealed while NEAR traded near 3.60; the first enclave check read 3.6003 and fired nothing, the second read 3.5886 and fired it.</p>
        </div>
        <div className="proof">
          <ol className="timeline">
            {runSteps.map((s) => (
              <li key={s.tx} className={s.attestation ? 'is-fire' : ''}>
                <span className="timeline__dot" aria-hidden="true" />
                <div>
                  <p>{s.step.replace('; trigger hidden on chain', '')}</p>
                  <span className="mono muted">{s.return ? `returned ${s.return.replace(/"/g, '')}` : 'ok'}{s.last_check ? ` · price ${e6(s.last_check.price_e6)}` : ''}</span>
                </div>
                <Tx hash={s.tx!} />
              </li>
            ))}
          </ol>
          <div className="panel attest">
            <div className="panel__head"><h3>Attestation of the fire</h3>{firedStep?.attestation?.ok ? <Chip tone="signal">All checks pass</Chip> : <Chip tone="warn">Not verified</Chip>}</div>
            {firedStep?.attestation ? (
              <>
                <ul className="checks">
                  {Object.entries(firedStep.attestation.checks).map(([k, v]) => <li key={k} className={v ? 'ok' : 'bad'}><span aria-hidden="true">{v ? '✓' : '✕'}</span>{k.replaceAll('_', ' ')}</li>)}
                </ul>
                <dl className="facts facts--mono">
                  <div><dt>TCB</dt><dd>{firedStep.attestation.tcb.status ?? firedStep.attestation.tcb.error}</dd></div>
                  <div><dt>OutLayer request</dt><dd>#{firedStep.attestation.request_id}</dd></div>
                  <div><dt>MRTD</dt><dd>{firedStep.attestation.measurements.mrtd.slice(0, 24)}…</dd></div>
                  <div><dt>Source</dt><dd><a href={firedStep.attestation.source} target="_blank" rel="noreferrer">testnet-api.outlayer.ai ↗</a></dd></div>
                </dl>
              </>
            ) : <State kind="empty">No recorded fire yet.</State>}
          </div>
        </div>
      </section>

      <section className="section" id="near">
        <div className="section__head">
          <Eyebrow>The NEAR tech, concretely</Eyebrow>
          <h2>Two independent origin checks, both on chain.</h2>
        </div>
        <div className="tech">
          {TECH.map((t) => (
            <article key={t.code} className="tech__card">
              <code>{t.code}</code>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </article>
          ))}
        </div>
        <p className="footnote">Contracts: <a href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">{CONTRACT}</a> (vault) and <a href={accountUrl(TOKEN)} target="_blank" rel="noreferrer">{TOKEN}</a> (tUSD). Enclave hash <span className="mono">{(config.data?.enclave_hash ?? deployment.enclave.sha256).slice(0, 16)}…</span>. Mainnet NEAR Intents execution is Setup required: <span className="mono">NEAR_MAINNET_ACCOUNT</span>.</p>
      </section>

      <section className="closer">
        <div className="closer__art" aria-hidden="true" />
        <div className="closer__inner">
          <h2>Set a stop the market can't see.</h2>
          <a className="btn btn--primary" href="/app" onClick={open}>Open the app</a>
        </div>
      </section>
      <footer className="footer"><Logo small /><span>MIT · © 2026 Nivesh Gajengi · NEAR testnet only; tUSD has no value.</span></footer>
    </div>
  );
}

const TECH = [
  { code: 'outlayer.testnet · request_execution', title: 'OutLayer TEE run', body: 'check() calls OutLayer with a WasmUrl pinned by SHA-256. OutLayer yields, a TDX worker runs the enclave, and the result resumes into our callback.' },
  { code: '#[private] fn on_result', title: 'Promise origin', body: 'The only door for a result is the promise of the contract’s own request. Calling on_result directly fails: “Method on_result is private”.' },
  { code: 'env::ed25519_verify', title: 'Enclave signature', body: 'Every report is signed by an ed25519 key OutLayer’s keystore releases only to this WASM hash, called by this contract. The contract verifies it before anything moves.' },
  { code: 'encryption_keys · bind: wasm', title: 'Keys only the build holds', body: 'The order key is derived inside the TEE from the WASM hash and the calling contract (caller: predecessor). Another build or caller derives another key and opens nothing.' },
  { code: 'callers.contract.only', title: 'Who may run it', body: 'The manifest, covered by the WASM hash, admits runs only from the Mienai contract, and only HTTPS egress to api.exchange.coinbase.com.' },
  { code: 'NEP-141 · x·y = k', title: 'Settlement on testnet', body: 'NEAR Intents has no testnet, so a fire swaps against the vault’s NEAR / tUSD constant-product pool (0.3% fee). tUSD is a test NEP-141 token.' },
];

function BookTable({ orders, error }: { orders: Order[] | null; error: string }) {
  if (!orders) return <State kind={error ? 'error' : 'loading'}>{error || 'Reading the contract'}</State>;
  if (!orders.length) return <State kind="empty">No orders on chain yet.</State>;
  return (
    <div className="book" role="table" aria-label="Public order book">
      <div className="book__row book__row--head" role="row">
        <span role="columnheader">#</span><span role="columnheader">Owner</span><span role="columnheader">Ciphertext on chain</span><span role="columnheader">Trigger</span><span role="columnheader">Status</span>
      </div>
      {[...orders].reverse().slice(0, 6).map((o) => (
        <div className="book__row" role="row" key={o.id}>
          <span className="mono" role="cell">{o.id}</span>
          <span className="mono book__owner" role="cell">{shortAccount(o.owner)}</span>
          <span role="cell" className="book__ct"><Ciphertext value={o.ct} chars={28} /></span>
          <span role="cell">{o.fire ? <span className="mono revealed">{o.fire.cond === 'lte' ? '≤' : '≥'} {e6(o.fire.trigger_e6)}</span> : <Redacted />}</span>
          <span role="cell"><Chip tone={statusTone(o.status)}>{o.status}</Chip></span>
        </div>
      ))}
    </div>
  );
}

export function FireCard({ order }: { order: Order }) {
  const f = order.fire!;
  return (
    <div className="firecard">
      <div className="firecard__top">
        <span className="label">Order #{order.id} · {f.cond === 'lte' ? 'stop-loss' : 'take-profit'}</span>
        <Chip tone="signal">Fired</Chip>
      </div>
      <div className="firecard__nums">
        <div><span className="label">Trigger (revealed)</span><strong><Num value={e6(f.trigger_e6)} /></strong></div>
        <div><span className="label">Price read</span><strong className="signal"><Num value={e6(f.price_e6)} /></strong></div>
      </div>
      <p className="mono muted small">{f.side} {near(f.filled_in, 2)} NEAR → {usd6(f.filled_out)} tUSD · Coinbase trade #{f.trade_id} · block {f.block_height}</p>
    </div>
  );
}
