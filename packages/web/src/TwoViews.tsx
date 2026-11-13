import { accountUrl, chainTx, e6, near, nsToMs, shortAccount, txForOrder, txUrl, view, type ChainTx, type Order } from './lib';
import { usePoll } from './live';
import { useLivePrice } from './price';
import { decrypt } from './Terminal';
import { Icon, Obj } from './ui';
import { WithLogo } from './logos';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** The same order twice: what its owner's device opens, next to the record anyone can read from NEAR testnet. */
export default function TwoViews({ order, account, title = true }: { order: Order; account: string; title?: boolean }) {
  const live = useLivePrice();
  const fresh = usePoll<Order | null>(() => view('get_order', { id: order.id }), 15_000, [order.id]);
  const o = fresh.data ?? order;
  const hash = txForOrder(o.id);
  const tx = usePoll<ChainTx | null>(() => (hash ? chainTx(hash, o.owner) : Promise.resolve(null)), 0, [hash, o.owner]);
  const p = decrypt(o, account);
  const revealed = Boolean(o.fire);
  const mine = Boolean(account && account === o.owner);
  const trig = p ? p.trigger_e6 / 1e6 : null;
  const dist = trig && live.price ? (trig / live.price - 1) * 100 : null;
  const args = tx.data?.args as { ct?: string; commit?: string; view_ct?: string } | undefined;
  return <section className="views" aria-label={`Two views of order ${o.id}`}>
    {title && <header className="views-head"><h2>Two views of order №{o.id}</h2><p>Left: what your device opens with your view key. Right: what everyone else can read on chain.</p></header>}
    <div className="views-grid">
      <article className="view-card view-you">
        <header><span className="view-tag"><Icon name="eye" size={14} />What you see</span><span className="dim small">{revealed ? 'Revealed after it fired' : mine && p ? 'Opened on this device' : 'Owner only'}</span></header>
        {p ? <>
          <p className="view-lede">{p.cond === 'lte' ? 'Sealed stop' : 'Sealed take-profit'} · sell if NEAR {p.cond === 'lte' ? 'falls to' : 'rises to'}</p>
          <p className="view-big num">${e6(p.trigger_e6)}</p>
          <dl className="view-rows">
            <div><dt>Size</dt><dd className="mono"><WithLogo sym="NEAR">{near(p.amount, 4)} NEAR</WithLogo></dd></div>
            <div><dt>Side</dt><dd>Sell NEAR → tUSD</dd></div>
            <div><dt>Live price</dt><dd className="mono">{live.price ? `${live.price.toFixed(4)}${dist !== null && !revealed ? ` · ${Math.abs(dist).toFixed(2)}% ${dist < 0 ? 'below' : 'above'}` : ''}` : '…'}</dd></div>
            <div><dt>Status</dt><dd>{o.status === 'Open' ? 'Armed in the enclave' : o.status}</dd></div>
          </dl>
          <p className="view-foot"><Icon name="lock" size={13} />{revealed ? 'Published by the contract when the enclave fired it.' : 'Opened with this device’s view key. The key never goes on chain.'}</p>
        </> : <div className="view-locked"><Obj name="lock" size={64} float={false} /><p><b>Only the owner’s device can open this order.</b> Connect as {shortAccount(o.owner)} on the device that sealed it.</p></div>}
      </article>
      <div className="views-vs" aria-hidden="true"><span>same order</span></div>
      <article className="view-card view-them dark">
        <header><span className="view-tag"><Icon name="cube" size={14} />What everyone else sees</span><span className="dim small">{tx.data ? 'Signed transaction, read from NEAR testnet' : 'Contract record, read from NEAR testnet'}</span></header>
        <pre className="view-json" aria-label="The public on-chain record">
          <span className="k">order</span>   <span>№{o.id}</span>{'\n'}
          <span className="k">owner</span>   <a href={accountUrl(o.owner)} target="_blank" rel="noreferrer">{o.owner}</a>{'\n'}
          <span className="k">placed</span>  <span>{utc(nsToMs(o.created_ns))} UTC</span>{'\n'}
          <span className="k">status</span>  <span>{o.status}</span>{'\n'}
          {tx.data && <><span className="k">method</span>  <span>{tx.data.method}</span>{'\n'}</>}
          <span className="k">ct</span>      <span className="c">"{clip(args?.ct ?? o.ct, 64)}"</span> <i>{(args?.ct ?? o.ct).length} chars</i>{'\n'}
          <span className="k">commit</span>  <span className="c">"{clip(args?.commit ?? o.commit, 40)}"</span>{'\n'}
          {(args?.view_ct ?? o.view_ct) && <><span className="k">view_ct</span> <span className="c">"{clip(String(args?.view_ct ?? o.view_ct), 40)}"</span>{'\n'}</>}
        </pre>
        <dl className="view-absent">
          <div><dt>Trigger price</dt><dd>{revealed ? <span className="gold mono">{e6(o.fire!.trigger_e6)} · published when it fired</span> : <span className="absent">not in the record</span>}</dd></div>
          <div><dt>Size</dt><dd>{revealed ? <span className="mono">{near(o.fire!.amount, 4)} NEAR</span> : <span className="absent">not in the record</span>}</dd></div>
          <div><dt>Stop or take-profit</dt><dd>{revealed ? (o.fire!.cond === 'lte' ? 'stop' : 'take-profit') : <span className="absent">not in the record</span>}</dd></div>
        </dl>
        <footer>{hash ? <a className="tx" href={txUrl(hash)} target="_blank" rel="noreferrer">Open the transaction on NearBlocks <Icon name="external" size={12} /></a> : <span className="dim small">Placement transaction not recorded in this browser; the contract record above is live.</span>}{tx.error && <span className="dim small"> · {tx.error}</span>}</footer>
      </article>
    </div>
  </section>;
}
