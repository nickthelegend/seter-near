import { accountUrl, ago, attestationFor, e6, enclaveUpload, near, nsToMs, short, txForOrder, txForRequest, usd6, view, type Attestation, type Order } from './lib';
import { useConfig, usePoll, useQuote, useStats } from './live';
import { Copy, Icon, Link, Num, State, Tx, shortHex } from './ui';
import { AppHeader, Hidden, decrypt } from './Terminal';
import type { Wallet } from './wallet';
import { art } from './art';
import { PairLogo, WithLogo } from './logos';

const CHECK_LABEL: Record<string, string> = {
  wasm_hash_pinned: 'Executed WASM equals the hash pinned on the contract',
  input_hash: 'Input hash matches what the contract sent',
  output_hash: 'Output hash matches what the contract received',
  report_data_binds_task: 'Quote report data binds the task fields',
  measurements_approved_on_chain: 'Enclave measurements approved on worker.outlayer.testnet',
  intel_signature_chain: 'Intel signature chain valid',
};

function Field({ label, value, live }: { label: string; value: string | null; live?: boolean }) {
  return <div className="cert-field">
    <dt>{label}{live && <small className="live-tag">live</small>}</dt>
    <dd>{value === null ? <span className="dim">fetching…</span> : <><code>{shortHex(value, 14, 10)}</code><Copy value={value} label={label} /></>}</dd>
  </div>;
}

/** The attestation as a certificate: recorded checks, plus the TDX quote fetched from OutLayer and hashed in this browser. */
export function Certificate({ att, pinned, subject }: { att: Attestation; pinned: string | null; subject: string }) {
  const q = useQuote(att.tx);
  const live = q.data;
  const same = live ? live.mrtd === att.measurements.mrtd && live.rtmr3 === att.measurements.rtmr3 : null;
  const ts = (att as unknown as { timestamp: number }).timestamp * 1000;
  return <article className="cert" aria-labelledby="cert-h">
    <div className="cert-inner">
      <header className="cert-head">
        <img className="cert-seal" src={art('seal').src} alt="" aria-hidden="true" />
        <div>
          <p className="label">Certificate of sealed execution</p>
          <h3 id="cert-h">Intel TDX · OutLayer run #{att.request_id}</h3>
          <p className="cert-stmt">{subject}</p>
        </div>
        <span className={`cert-verdict ${att.ok ? 'ok' : 'bad'}`}>{att.ok ? 'All checks pass' : 'Check failed'}</span>
      </header>
      <ul className="cert-checks">
        {Object.entries(att.checks).map(([k, v]) => <li key={k} className={v ? 'ok' : 'bad'}><Icon name={v ? 'check' : 'x'} size={15} />{CHECK_LABEL[k] ?? k.replaceAll('_', ' ')}</li>)}
      </ul>
      <dl className="cert-fields">
        <Field label="TDX quote SHA-256" value={live ? live.quoteSha256 : q.error ? 'unavailable' : null} live />
        <Field label="MRTD" value={att.measurements.mrtd} />
        <Field label="RTMR3 (app)" value={att.measurements.rtmr3} />
        <Field label="Report data" value={(att as unknown as { report_data: string }).report_data} />
        <Field label="WASM SHA-256" value={att.wasm_hash} />
        <Field label="Output hash" value={att.output_hash} />
      </dl>
      <footer className="cert-foot">
        <div><span className="label">TCB</span><b>{att.tcb.status ?? att.tcb.error}</b></div>
        <div><span className="label">Block</span><b className="mono">{att.block_height}</b></div>
        <div><span className="label">WASM = contract pin</span><b>{pinned ? (pinned === att.wasm_hash ? 'yes' : 'no') : '…'}</b></div>
        <div><span className="label">Signed</span><b className="mono">{new Date(ts).toISOString().slice(0, 16).replace('T', ' ')} UTC</b></div>
      </footer>
      <p className="cert-live">{q.error ? <>Live re-fetch failed: {q.error}. The recorded result above is from <code>packages/sdk/src/attestation.mjs</code>.</>
        : !live ? 'Fetching the TDX quote from OutLayer…'
        : <><Icon name="check" size={14} /> Quote fetched from <a href={att.source} target="_blank" rel="noreferrer">OutLayer’s API</a> just now ({live.quoteBytes} bytes), hashed in this browser; its MRTD and RTMR3 {same ? 'match' : 'do not match'} the recorded verification. The Intel signature chain was checked by the CLI (dcap-qvl).</>}</p>
    </div>
  </article>;
}

export default function OrderPage({ id, wallet }: { id: number; wallet: Wallet }) {
  const order = usePoll<Order | null>(() => view('get_order', { id }), 15_000, [id]);
  const o = order.data;
  const err = order.error;
  const stats = useStats();
  const config = useConfig();
  const body = (() => {
    if (err) return <State kind="error" title="Could not read this order">{err}</State>;
    if (order.loading) return <State kind="loading" title={`Reading order №${id} from NEAR testnet…`} />;
    if (o === null) return <State kind="empty" title={`No order №${id} on the contract`} action={<Link to="/app" className="btn btn-ghost btn-sm">Back to trading</Link>} />;
    const f = o.fire;
    const att = f ? attestationFor(f.request) : null;
    const placeTx = txForOrder(o.id);
    const fireTx = f ? txForRequest(f.request) : undefined;
    const c = stats.data?.last_check;
    const p = decrypt(o, wallet.account);
    return <>
      <section className="order-hero">
        <div className="pnl osum">
          <header><img className="osum-art" src={art(f ? 'slip-fired' : 'slip').src} alt="" aria-hidden="true" /><h1>Order №{o.id}</h1><span className={`st st-${o.status === 'Open' ? 'armed' : o.status.toLowerCase()}`}><i />{o.status === 'Open' ? 'Armed' : o.status}</span></header>
          <dl className="osum-grid">
            <div><dt>Market</dt><dd><span className="tamt"><PairLogo base="NEAR" quote="USD" />NEAR / USD</span></dd></div>
            <div><dt>Type</dt><dd>{p ? (p.cond === 'lte' ? 'Sealed stop' : 'Sealed take-profit') : 'Sealed'}</dd></div>
            <div><dt>Side</dt><dd>{p ? <>Sell <WithLogo sym="NEAR">NEAR</WithLogo> → <WithLogo sym="tUSD">tUSD</WithLogo></> : <Hidden label="" />}</dd></div>
            <div><dt>Size</dt><dd className="mono">{p ? <WithLogo sym="NEAR">{near(p.amount, 4)} NEAR</WithLogo> : <Hidden label="" />}</dd></div>
            <div><dt>Trigger</dt><dd className="mono">{f ? <span className="gold">{e6(f.trigger_e6)} · revealed</span> : p ? <>{e6(p.trigger_e6)} <small className="dim">only you</small></> : <Hidden />}</dd></div>
            <div><dt>Placed (UTC)</dt><dd className="mono">{new Date(nsToMs(o.created_ns)).toISOString().slice(0, 19).replace('T', ' ')}</dd></div>
            <div><dt>Owner</dt><dd className="mono"><a href={accountUrl(o.owner)} target="_blank" rel="noreferrer">{o.owner}</a></dd></div>
            <div><dt>Commitment</dt><dd className="mono">{shortHex(o.commit, 10, 6)}</dd></div>
          </dl>
        </div>
        <div className="verdict">
          {f ? <>
            <p className="label">The crossing, published after the check</p>
            <div className="cross">
              <div><span>Trigger</span><b><Num value={e6(f.trigger_e6)} /></b></div>
              <i aria-hidden="true">{f.cond === 'lte' ? '≥' : '≤'}</i>
              <div><span>Price read in the TEE</span><b className="gold"><Num value={e6(f.price_e6)} /></b></div>
            </div>
            <p className="verdict-note">{o.status === 'Unfilled' ? <>The trigger crossed, but the order did not fill: {f.note}. Coinbase trade #{f.trade_id} · block {f.block_height}</> : <>Sold <WithLogo sym="NEAR">{near(f.filled_in, 2)} NEAR</WithLogo> for <b><WithLogo sym="tUSD">{usd6(f.filled_out)} tUSD</WithLogo></b> on the vault pool · Coinbase trade #{f.trade_id} · block {f.block_height}</>}</p>
          </> : o.status === 'Open' ? <>
            <p className="label">Waiting inside the enclave</p>
            <p className="verdict-big">Armed and invisible.</p>
            <p className="verdict-note">Every check opens this order inside Intel TDX and says nothing unless the price crosses it. {c ? <>Last check read <b className="mono">{e6(c.price_e6)}</b> {ago(nsToMs(c.block_ts))}.</> : null}</p>
          </> : <>
            <p className="label">{o.status}</p>
            <p className="verdict-big">Never revealed.</p>
            <p className="verdict-note">No crossing was published for this order. Its trigger remains encrypted.</p>
          </>}
        </div>
      </section>

      {f && (att ? <section className="order-sec"><h2>The attestation</h2><Certificate att={att} pinned={config.data?.enclave_hash ?? enclaveUpload.sha256} subject={`The program pinned by SHA-256 ran inside an Intel TDX enclave, read NEAR/USD at ${e6(f.price_e6)} from Coinbase and reported the crossing for order №${o.id}, whose trigger was ${e6(f.trigger_e6)}.`} /></section>
        : <section className="order-sec"><h2>The attestation</h2><State kind="setup" title="No recorded attestation for this fire">The contract accepted the report with a valid enclave signature through its private callback or signed relay. Verify the TDX quote with <code>node packages/sdk/scripts/verify-attestation.mjs</code>.</State></section>)}

      {f && <section className="order-sec">
        <h2>The fire</h2>
        <dl className="facts">
          <div><dt>Price time</dt><dd className="mono">{new Date(f.price_ts_ms).toISOString().replace('T', ' ').slice(0, 19)} UTC</dd></div>
          <div><dt>Source</dt><dd><a href={f.source} target="_blank" rel="noreferrer">Coinbase NEAR-USD <Icon name="external" size={12} /></a></dd></div>
          <div><dt>Delivered</dt><dd>{f.path === 'callback' ? 'private callback' : 'signed relay'} · request {f.request}</dd></div>
          <div><dt>OutLayer run</dt><dd className="mono">#{f.outlayer_request}</dd></div>
          <div><dt>Report SHA-256</dt><dd className="mono">{short(f.report_sha256, 10)}</dd></div>
          <div><dt>Transaction</dt><dd>{fireTx ? <Tx hash={fireTx} /> : 'not recorded here'}</dd></div>
        </dl>
      </section>}

      <section className="order-sec">
        <h2>What the chain stores</h2>
        <div className="envelope">
          <div className="envelope-flap" aria-hidden="true" />
          <dl className="facts">
            <div><dt>Owner</dt><dd><a href={accountUrl(o.owner)} target="_blank" rel="noreferrer" className="mono">{o.owner}</a></dd></div>
            <div><dt>Sealed</dt><dd className="mono">{new Date(nsToMs(o.created_ns)).toISOString().replace('T', ' ').slice(0, 19)} UTC</dd></div>
            <div><dt>Trigger</dt><dd>{f ? <span className="mono gold">{e6(f.trigger_e6)} (revealed)</span> : <Hidden />}</dd></div>
            <div><dt>Placed in</dt><dd>{placeTx ? <Tx hash={placeTx} /> : <span className="dim">tx not recorded in this app</span>}</dd></div>
          </dl>
          <p className="label">Ciphertext · {o.ct.length} chars</p>
          <code className="cipher cipher-block">{o.ct}</code>
          <p className="label">Commitment</p>
          <code className="cipher">{o.commit}</code>
          <p className="envelope-note">{o.view_ct ? 'A second copy is sealed to the owner’s device view key.' : 'No view-key copy.'} Neither copy opens without the enclave key or the owner’s device.</p>
        </div>
      </section>
    </>;
  })();
  return <div className="term-page">
    <AppHeader wallet={wallet} />
    <main className="order" id="main">
      <Link to="/app" className="back"><Icon name="back" size={16} />Trade</Link>
      {body}
    </main>
  </div>;
}
