import { orderType, accountUrl, ago, attestationFor, e6, enclaveUpload, near, nsToMs, short, txForOrder, txForRequest, usd6, view, type Attestation, type Order } from './lib';
import { useConfig, useFireSecond, usePoll, useQuote, useStats } from './live';
import { Copy, Icon, Link, Num, Obj, State, Tx, shortHex } from './ui';
import { AppHeader, Hidden, decrypt } from './Terminal';
import type { Wallet } from './wallet';
import { art } from './art';
import { PairLogo, WithLogo } from './logos';
import TwoViews from './TwoViews';
import { useLivePrice } from './price';

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

/** A fire with no recorded CLI verification: fetch its TDX quote from OutLayer now and compare the enclave
 * measurements with the run that was fully verified (Intel signature chain included) on 9 Nov. */
function LiveAttestation({ tx, request }: { tx?: string; request?: string }) {
  const q = useQuote(tx, request);
  const config = useConfig();
  const approved = usePoll<boolean | null>(() => (q.data ? view<boolean>('is_measurements_approved', { measurements: { mrtd: q.data.mrtd, rtmr0: q.data.rtmr0, rtmr1: q.data.rtmr1, rtmr2: q.data.rtmr2, rtmr3: q.data.rtmr3 } }, 'worker.outlayer.testnet') : Promise.resolve(null)), 0, [q.data?.quoteSha256]);
  if (q.error) return <State kind="error" art="warning" title="Could not fetch this run’s TDX quote">{q.error} Verify it with <code>node packages/sdk/scripts/verify-attestation.mjs</code>.</State>;
  if (!q.data) return <State kind="loading" title="Fetching this run’s TDX quote from OutLayer…" />;
  const pinned = q.data.wasm === (config.data?.enclave_hash ?? enclaveUpload.sha256);
  const ok = pinned && approved.data === true;
  return <article className="cert"><div className="cert-inner">
    <header className="cert-head">
      <img className="cert-seal" src={art('seal').src} alt="" aria-hidden="true" />
      <div><p className="label">Intel TDX quote · fetched live</p><h3>OutLayer run #{q.data.requestId}</h3><p className="cert-stmt">A protected computer ran the pinned Seter program for this check. Its quote was fetched from OutLayer just now and hashed in this browser.</p></div>
      <span className={`cert-verdict ${ok ? 'ok' : approved.data === null ? '' : 'bad'}`}>{ok ? 'Checks pass' : approved.data === null ? 'Checking…' : 'Check failed'}</span>
    </header>
    <ul className="cert-checks">
      <li className={pinned ? 'ok' : 'bad'}><Icon name={pinned ? 'check' : 'x'} size={15} />Executed WASM equals the hash pinned on the contract</li>
      <li className={approved.data ? 'ok' : 'bad'}><Icon name={approved.data ? 'check' : 'x'} size={15} />Enclave measurements approved on worker.outlayer.testnet{approved.data === null ? ' (checking…)' : ''}</li>
      <li className="ok"><Icon name="check" size={15} />Contract accepted the report signed by the enclave key</li>
    </ul>
    <dl className="cert-fields">
      <Field label="TDX quote SHA-256" value={q.data.quoteSha256} live />
      <Field label="MRTD" value={q.data.mrtd} />
      <Field label="RTMR3 (app)" value={q.data.rtmr3} />
      <Field label="Report data" value={q.data.reportData} />
    </dl>
    <p className="cert-live">The Intel signature chain for this quote is checked by the CLI (<code>verify-attestation.mjs</code>), not in the browser.</p>
  </div></article>;
}

/** The fill in money terms: what left the vault, what came back, the price it got, and holding at today's price. */
function Money({ o }: { o: Order }) {
  const f = o.fire!;
  const live = useLivePrice();
  const sold = Number(BigInt(f.filled_in) / 10n ** 18n) / 1e6, got = Number(f.filled_out) / 1e6;
  const held = live.price ? sold * live.price : null;
  return <dl className="money">
    <div><dt>Sold</dt><dd className="mono"><WithLogo sym="NEAR">{sold.toFixed(4)} NEAR</WithLogo></dd></div>
    <div><dt>Received</dt><dd className="mono gold"><WithLogo sym="tUSD">{got.toFixed(4)} tUSD</WithLogo></dd></div>
    <div><dt>Price per NEAR</dt><dd className="mono">{sold ? (got / sold).toFixed(4) : '—'}</dd></div>
    <div><dt>Holding instead, at today’s price</dt><dd className="mono">{held !== null ? held.toFixed(4) : '…'}<small>{held !== null ? `selling is ${got >= held ? 'ahead' : 'behind'} by ${Math.abs(got - held).toFixed(4)}` : ''}</small></dd></div>
  </dl>;
}

export default function OrderPage({ id, wallet }: { id: number; wallet: Wallet }) {
  const order = usePoll<Order | null>(() => view('get_order', { id }), 15_000, [id]);
  const o = order.data;
  const err = order.error;
  const stats = useStats();
  const config = useConfig();
  const second = useFireSecond(o?.id, Boolean(o?.fire));
  // A keeper's fire is not in this device's receipts: OutLayer's record of the enclave run names its transaction.
  const fireRun = useQuote(undefined, o?.fire && !txForRequest(o.fire.request) ? o.fire.outlayer_request : undefined);
  const body = (() => {
    if (err) return <State kind="error" art="warning" title="Could not read this order">{err}</State>;
    if (order.loading) return <State kind="loading" title={`Reading order №${id} from NEAR testnet…`} />;
    if (o === null) return <State kind="empty" art="tray-empty" title={`No order №${id} on the contract`} action={<Link to="/app" className="btn btn-ghost btn-sm">Back to trading</Link>} />;
    const f = o.fire;
    const att = f ? attestationFor(f.request) : null;
    const placeTx = txForOrder(o.id);
    const fireTx = f ? txForRequest(f.request) ?? (fireRun.data?.tx || undefined) : undefined;
    const c = stats.data?.last_check;
    const p = decrypt(o, wallet.account);
    return <>
      <section className="order-hero">
        <div className="pnl osum">
          <header><img className="osum-art" src={art(f ? 'slip-fired' : 'slip').src} alt="" aria-hidden="true" /><h1>Order №{o.id}</h1><span className={`st st-${o.status === 'Open' ? 'armed' : o.status.toLowerCase()}`}><i />{o.status === 'Open' ? 'Armed' : o.status}</span></header>
          <dl className="osum-grid">
            <div><dt>Market</dt><dd><span className="tamt"><PairLogo base="NEAR" quote="USD" />NEAR / USD</span></dd></div>
            <div><dt>Type</dt><dd>{p ? `Sealed ${orderType(p.cond, p.side)}` : 'Sealed'}</dd></div>
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
            <div className="verdict-top"><p className="label">The crossing, published after the check</p><Obj name="bell" size={72} /></div>
            <div className="cross">
              <div><span>Trigger</span><b><Num value={e6(f.trigger_e6)} /></b></div>
              <i aria-hidden="true">{f.cond === 'lte' ? '≥' : '≤'}</i>
              <div><span>Price read in the TEE</span><b className="gold"><Num value={e6(f.price_e6)} /></b></div>
            </div>
            {o.status !== 'Unfilled' && <Money o={o} />}
            <p className="verdict-note">{o.status === 'Unfilled' ? <>The trigger crossed, but the order did not fill: {f.note}. Coinbase trade #{f.trade_id} · block {f.block_height}</> : <>Sold <WithLogo sym="NEAR">{near(f.filled_in, 2)} NEAR</WithLogo> for <b><WithLogo sym="tUSD">{usd6(f.filled_out)} tUSD</WithLogo></b> on the vault pool · Coinbase trade #{f.trade_id} · block {f.block_height}</>}</p>
          </> : o.status === 'Open' ? <>
            <div className="verdict-top"><p className="label">Waiting inside the enclave</p><Obj name="eye-slash" size={72} /></div>
            <p className="verdict-big">Armed and invisible.</p>
            <p className="verdict-note">Every check opens this order inside Intel TDX and says nothing unless the price crosses it. {c ? <>Last check read <b className="mono">{e6(c.price_e6)}</b> {ago(nsToMs(c.block_ts))}.</> : null}</p>
          </> : <>
            <div className="verdict-top"><p className="label">{o.status}</p><Obj name="lock" size={72} /></div>
            <p className="verdict-big">Never revealed.</p>
            <p className="verdict-note">No crossing was published for this order. Its trigger remains encrypted.</p>
          </>}
        </div>
      </section>

      <TwoViews order={o} account={wallet.account} />

      {f && (att ? <section className="order-sec"><h2>The attestation</h2><Certificate att={att} pinned={config.data?.enclave_hash ?? enclaveUpload.sha256} subject={`The program pinned by SHA-256 ran inside an Intel TDX enclave, read NEAR/USD at ${e6(f.price_e6)} from Coinbase and reported the crossing for order №${o.id}, whose trigger was ${e6(f.trigger_e6)}.`} /></section>
        : fireTx || f.outlayer_request ? <section className="order-sec"><h2>The attestation</h2><LiveAttestation tx={fireTx} request={f.outlayer_request} /></section>
        : <section className="order-sec"><h2>The attestation</h2><State kind="setup" art="certificate" title="No recorded attestation for this fire">The contract accepted the report with a valid enclave signature through its private callback or signed relay. Verify the TDX quote with <code>node packages/sdk/scripts/verify-attestation.mjs</code>.</State></section>)}

      {f && <section className="order-sec">
        <h2>The fire</h2>
        <dl className="facts">
          <div><dt>Price time</dt><dd className="mono">{new Date(f.price_ts_ms).toISOString().replace('T', ' ').slice(0, 19)} UTC</dd></div>
          <div><dt>Source</dt><dd><a href={f.source} target="_blank" rel="noreferrer">Coinbase NEAR-USD <Icon name="external" size={12} /></a></dd></div>
          <div><dt>Second source</dt><dd>{second.data ? <><a href={accountUrl(second.data.oracle)} target="_blank" rel="noreferrer" className="mono">{second.data.oracle}</a> read <b className="mono">{e6(second.data.oracle_price_e6)}</b> · {second.data.diff_bps} bps apart (limit {second.data.tolerance_bps})</> : second.loading ? 'reading…' : <span className="dim">not required (fired before the 14 Nov two-source upgrade)</span>}</dd></div>
          <div><dt>Delivered</dt><dd>{f.path === 'callback' ? 'private callback' : 'signed relay'} · request {f.request}</dd></div>
          <div><dt>OutLayer run</dt><dd className="mono">#{f.outlayer_request}</dd></div>
          <div><dt>Report SHA-256</dt><dd className="mono">{short(f.report_sha256, 10)}</dd></div>
          <div><dt>Transaction</dt><dd>{fireTx ? <Tx hash={fireTx} /> : fireRun.loading ? 'reading…' : 'not recorded here'}</dd></div>
        </dl>
      </section>}

      <section className="order-sec">
        <h2 className="sec-h"><Obj name="envelope-lock" size={48} float={false} />What the chain stores</h2>
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
