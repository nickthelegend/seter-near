import { useMemo } from 'react';
import { accountUrl, ago, chainTx, e6, near, nsToMs, orderSize, orderType, shortAccount, txForOrder, txForPublic, txUrl, usd6, type ChainTx, type Order, type PublicOrder } from './lib';
import { usePoll } from './live';
import { useLivePrice } from './price';
import { Hidden } from './Terminal';
import { Icon, State } from './ui';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A stop hunter's view of the chain: public orders give away a price ladder; sealed orders give away nothing. */
export function HunterView({ pub, sealed, error }: { pub: PublicOrder[] | null; sealed: Order[] | null; error: string }) {
  const live = useLivePrice();
  const open = (pub ?? []).filter((o) => o.status === 'Open');
  const armed = (sealed ?? []).filter((o) => o.status === 'Open').sort((a, b) => b.id - a.id);
  const levels = useMemo(() => {
    const m = new Map<string, { price: number; count: number; near: bigint; usd: bigint; stops: number }>();
    for (const o of open) {
      const k = (o.trigger_e6 / 1e6).toFixed(2);
      const l = m.get(k) ?? { price: Number(k), count: 0, near: 0n, usd: 0n, stops: 0 };
      l.count += 1; if (o.side === 'sell') l.near += BigInt(o.amount); else l.usd += BigInt(o.amount);
      if (o.cond === 'lte' && o.side === 'sell') l.stops += 1;
      m.set(k, l);
    }
    return [...m.values()].sort((a, b) => b.price - a.price);
  }, [open]);
  const top = [...levels].sort((a, b) => b.count - a.count || Number(b.near - a.near))[0];
  const max = levels.reduce((x, l) => (l.near > x ? l.near : x), 1n);
  const gap = top && live.price ? (top.price / live.price - 1) * 100 : null;
  const rows: ({ kind: 'level'; l: (typeof levels)[number] } | { kind: 'price' })[] = [];
  let placed = false;
  for (const l of levels) { if (!placed && live.price && l.price < live.price) { rows.push({ kind: 'price' }); placed = true; } rows.push({ kind: 'level', l }); }
  if (!placed && live.price) rows.push({ kind: 'price' });
  return <section className="hunter" id="hunter" aria-label="Public order vs Seter sealed order: what a bot reads">
    <header className="hunter-head"><h2>Public order vs Seter sealed order</h2><p>The same bot reads both from NEAR testnet. One gives it a target.</p></header>
    <div className="hunter-grid">
      <article className="hunt-card hunt-pub">
        <header><span className="view-tag pub-tag"><Icon name="eye" size={14} />Public orders · what a bot reads</span><span className="dim small mono">get_public_orders</span></header>
        {!pub ? <State kind={error ? 'error' : 'loading'} title={error ? 'Could not read public orders' : 'Reading public orders…'}>{error}</State>
          : !levels.length ? <State kind="empty" art="tray-empty" title="No open public orders">Place one with “Public order (no seal)” in the trading screen to compare.</State>
          : <>
            {top && <p className="hunt-call"><b>Stops clustered at ${top.price.toFixed(2)}</b><span>{top.count} order{top.count === 1 ? '' : 's'} · {near(top.near.toString(), 2)} NEAR of forced selling{gap !== null ? ` · ${Math.abs(gap).toFixed(2)}% ${gap < 0 ? 'below' : 'above'} the market` : ''}</span></p>}
            <ul className="ladder" aria-label="Public trigger ladder">{rows.map((r, i) => r.kind === 'price'
              ? <li key="price" className="ladder-price"><span className="mono">{live.price!.toFixed(4)}</span><i /><small>Coinbase last</small></li>
              : <li key={i} className={r.l === top ? 'hot' : ''}><span className="mono">{r.l.price.toFixed(2)}</span><span className="bar"><i style={{ width: `${Math.max(6, Number((r.l.near * 100n) / max))}%` }} /></span><small className="mono">{r.l.count}× · {r.l.near > 0n ? `${near(r.l.near.toString(), 2)} NEAR` : `${usd6(r.l.usd.toString(), 2)} tUSD`}</small></li>)}</ul>
            <p className="hunt-foot">A bot pushes the price to ${top?.price.toFixed(2)}, the stops sell into it, and it buys back cheaper.</p>
          </>}
      </article>
      <article className="hunt-card hunt-sealed dark">
        <header><span className="view-tag"><Icon name="lock" size={14} />Seter sealed orders · what the same bot reads</span><span className="dim small mono">get_orders</span></header>
        {!sealed ? <State kind="loading" title="Reading sealed orders…" /> : <>
          <p className="hunt-call"><b>{armed.length} armed · 0 levels to aim at</b><span>Owner and time are public. Trigger, size and side are ciphertext.</span></p>
          <ul className="ladder ladder-sealed">{armed.length ? armed.slice(0, 6).map((o) => <li key={o.id}><span className="mono">№{o.id}</span><Hidden label="trigger" /><small className="mono">{shortAccount(o.owner)} · {ago(nsToMs(o.created_ns))}</small></li>) : <li className="ladder-empty dim">No armed sealed orders right now.</li>}</ul>
          <p className="hunt-foot">Nothing to push the price toward: the trigger only becomes public after the enclave fires it.</p>
        </>}
      </article>
    </div>
  </section>;
}

/** The two placement transactions as the chain stores them: a public order's arguments next to a sealed order's. */
export function ArgsCompare({ pub, sealed }: { pub: PublicOrder[] | null; sealed: Order[] | null }) {
  const p = (pub ?? []).filter((o) => txForPublic(o.id)).sort((a, b) => b.id - a.id)[0];
  const s = (sealed ?? []).filter((o) => txForOrder(o.id) && (!p || o.owner === p.owner)).sort((a, b) => b.id - a.id)[0];
  const pTx = usePoll<ChainTx | null>(() => (p ? chainTx(txForPublic(p.id)!, p.owner) : Promise.resolve(null)), 0, [p?.id]);
  const sTx = usePoll<ChainTx | null>(() => (s ? chainTx(txForOrder(s.id)!, s.owner) : Promise.resolve(null)), 0, [s?.id]);
  if (!p || !s) return null;
  const pa = pTx.data?.args as Record<string, string> | undefined;
  const sa = sTx.data?.args as { ct?: string; commit?: string; view_ct?: string } | undefined;
  return <section className="compare" id="compare" aria-label="The two transactions on chain">
    <header className="hunter-head"><h2>The two transactions, read back from NEAR</h2><p>Same kind of order, same size. Left: placed with no seal. Right: placed with Seter.</p></header>
    <div className="views-grid">
      <article className="view-card view-them dark cmp-pub">
        <header><span className="view-tag pub-tag"><Icon name="eye" size={14} />Public order P{p.id}</span><span className="dim small">{pTx.data ? `${pTx.data.method} · ${pTx.data.status}` : pTx.error || 'reading…'}</span></header>
        <pre className="view-json">
          <span className="k">signer</span>      <a href={accountUrl(p.owner)} target="_blank" rel="noreferrer">{p.owner}</a>{'\n'}
          <span className="k">method</span>      <span>{pTx.data?.method ?? '…'}</span>{'\n'}
          <span className="k">kind</span>        <span>"{pa?.kind ?? p.kind}"</span>{'\n'}
          <span className="k">cond</span>        <span>"{pa?.cond ?? p.cond}"</span>{'\n'}
          <mark><span className="k">trigger_usd</span> <span>"{pa?.trigger_usd ?? e6(p.trigger_e6)}"</span></mark>{'\n'}
          <span className="k">side</span>        <span>"{pa?.side ?? p.side}"</span>{'\n'}
          <span className="k">amount</span>      <span>"{pa?.amount ?? p.amount}"</span> <i>{orderSize(p.amount, p.side)}</i>{'\n'}
        </pre>
        <dl className="view-absent">
          <div><dt>Trigger price</dt><dd><span className="pub-trig mono">{e6(p.trigger_e6)} · in the arguments</span></dd></div>
          <div><dt>Size</dt><dd className="mono">{orderSize(p.amount, p.side)}</dd></div>
          <div><dt>Type</dt><dd>{orderType(p.cond, p.side)}</dd></div>
        </dl>
        <footer>{txForPublic(p.id) && <a className="tx" href={txUrl(txForPublic(p.id)!)} target="_blank" rel="noreferrer">Open on NearBlocks <Icon name="external" size={12} /></a>}</footer>
      </article>
      <div className="views-vs" aria-hidden="true"><span>vs</span></div>
      <article className="view-card view-them dark">
        <header><span className="view-tag"><Icon name="lock" size={14} />Seter sealed order №{s.id}</span><span className="dim small">{sTx.data ? `${sTx.data.method} · ${sTx.data.status}` : sTx.error || 'reading…'}</span></header>
        <pre className="view-json">
          <span className="k">signer</span>  <a href={accountUrl(s.owner)} target="_blank" rel="noreferrer">{s.owner}</a>{'\n'}
          <span className="k">method</span>  <span>{sTx.data?.method ?? '…'}</span>{'\n'}
          <span className="k">ct</span>      <span className="c">"{clip(sa?.ct ?? s.ct, 52)}"</span>{'\n'}
          <span className="k">commit</span>  <span className="c">"{clip(sa?.commit ?? s.commit, 40)}"</span>{'\n'}
          {(sa?.view_ct ?? s.view_ct) && <><span className="k">view_ct</span> <span className="c">"{clip(String(sa?.view_ct ?? s.view_ct), 40)}"</span>{'\n'}</>}
        </pre>
        <dl className="view-absent">
          <div><dt>Trigger price</dt><dd>{s.fire ? <span className="gold mono">{e6(s.fire.trigger_e6)} · published only after it fired</span> : <span className="absent">not in the arguments</span>}</dd></div>
          <div><dt>Size</dt><dd>{s.fire ? <span className="mono">{orderSize(s.fire.amount, s.fire.side)} · after the fire</span> : <span className="absent">not in the arguments</span>}</dd></div>
          <div><dt>Type</dt><dd><span className="absent">not in the arguments</span></dd></div>
        </dl>
        <footer>{txForOrder(s.id) && <a className="tx" href={txUrl(txForOrder(s.id)!)} target="_blank" rel="noreferrer">Open on NearBlocks <Icon name="external" size={12} /></a>}</footer>
      </article>
    </div>
  </section>;
}
