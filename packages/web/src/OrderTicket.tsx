import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { orderPlaintext, sealToEnclave, commitment, newViewKey, sealView } from '@mienai/sdk/crypto';
import { e6, near, toTokenUnits, toYocto, usd6, view, type Balance, type Config, type MarketFill, type Stats } from './lib';
import { usePoll, useTicker } from './live';
import { Icon, State } from './ui';
import { viewKeyFor } from './Sheets';
import type { Wallet } from './wallet';
import { WithLogo, type Sym } from './logos';

export type Kind = 'market' | 'limit' | 'stop' | 'tp' | 'oco';
type Mode = 'sealed' | 'public';
const TABS: [Kind, string][] = [['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop'], ['tp', 'Take-profit'], ['oco', 'OCO']];
const DEFAULT: Record<Kind, number> = { market: 1, limit: 0.99, stop: 0.97, tp: 1.03, oco: 0.97 };
const num = (s: string) => /^\d+(\.\d+)?$/.test(s) && Number(s) > 0 && Number.isFinite(Number(s));
const fix4 = (v: number) => v.toFixed(4);

function ensureViewKey(account: string): string {
  let key = viewKeyFor(account);
  if (key) return key;
  key = newViewKey();
  try { localStorage.setItem(`mienai:view:${account}`, key); }
  catch { throw new Error('Allow browser storage before sealing, so you can read your own order levels.'); }
  return key;
}

function Field({ label, value, onChange, unit, aria, hint, warn, nudge }: { label: string; value: string; onChange: (v: string) => void; unit: Sym; aria: string; hint?: ReactNode; warn?: boolean; nudge?: (d: number) => void }) {
  return <label className="fld">
    <span>{label}</span>
    <div className="fld-in">
      {nudge && <button type="button" className="step" onClick={() => nudge(-0.005)} aria-label={`Lower ${label.toLowerCase()} by 0.5%`}>−</button>}
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.trim())} aria-label={aria} />
      <em><WithLogo sym={unit}>{unit}</WithLogo></em>
      {nudge && <button type="button" className="step" onClick={() => nudge(0.005)} aria-label={`Raise ${label.toLowerCase()} by 0.5%`}>+</button>}
    </div>
    {hint && <small className={warn ? 'warn' : ''}>{hint}</small>}
  </label>;
}

/** The order ticket: market, limit, stop, take-profit and one-cancels-the-other. Stop, take-profit and limit can be
 * sealed (Seter) or placed as a public order with no seal, so the two can be compared on chain. */
export default function OrderTicket({ wallet, config, configError, balance, stats, children }: { wallet: Wallet; config: Config | null; configError: string; balance: Balance | null; stats: Stats | null; children?: ReactNode }) {
  const t = useTicker();
  const price = t.data ? Number(t.data.price) : null;
  const [kind, setKind] = useState<Kind>('stop');
  const [mode, setMode] = useState<Mode>('sealed');
  const [trigger, setTrigger] = useState('');
  const [trigger2, setTrigger2] = useState('');
  const [size, setSize] = useState('0.5');
  const [spend, setSpend] = useState('0.50');
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastFill, setLastFill] = useState<MarketFill | null>(null);
  const seeded = useRef(false);
  const pending = useRef(false);
  const seed = (k: Kind, p: number) => { setTrigger(fix4(p * DEFAULT[k])); setTrigger2(fix4(p * 1.03)); };
  useEffect(() => { if (price && !seeded.current) { seeded.current = true; seed('stop', price); } }, [price]);
  const pick = (k: Kind) => { setKind(k); setErr(''); setLastFill(null); if (k === 'oco') setMode('sealed'); if (price) seed(k, price); };

  const owner = wallet.account || 'your-account.testnet';
  const buying = kind === 'limit' || (kind === 'market' && side === 'buy');
  const cond = kind === 'tp' ? 'gte' : 'lte';
  const orderSide = kind === 'limit' ? 'buy' : 'sell';
  const amountOk = buying ? num(spend) : num(size);
  const amount = useMemo(() => { try { return amountOk ? (buying ? toTokenUnits(spend) : toYocto(size)) : null; } catch { return null; } }, [amountOk, buying, spend, size]);
  const validTrig = num(trigger) && (kind !== 'oco' || num(trigger2));
  const sealedKind = kind === 'stop' || kind === 'tp' || kind === 'limit';
  const isPublic = sealedKind && mode === 'public';

  const preview = useMemo(() => {
    if (!config?.tee || !amount || !validTrig || kind === 'market' || isPublic) return null;
    try {
      const mk = (c: 'lte' | 'gte', trig: string, s: string) => { const pt = orderPlaintext({ cond: c, triggerUsd: trig, side: s, amount }); return { pt, ct: sealToEnclave(config.tee!.order_pub, owner, pt) as string, commit: commitment(owner, pt) as string }; };
      return kind === 'oco' ? [mk('lte', trigger, 'sell'), mk('gte', trigger2, 'sell')] : [mk(cond, trigger, orderSide)];
    } catch { return null; }
  }, [config, amount, validTrig, kind, isPublic, cond, trigger, trigger2, orderSide, owner]);
  const publicArgs = isPublic && amount && validTrig ? { kind: kind === 'tp' ? 'take_profit' : kind, cond, trigger_usd: fix4(Number(trigger)), side: orderSide, amount } : null;

  const qSide = kind === 'market' ? side : orderSide;
  const poolQuote = usePoll<string | null>(() => (amount ? view('quote', { side: qSide, amount }) : Promise.resolve(null)), 15_000, [amount, qSide, stats?.pool.near, stats?.pool.usd]);
  const dist = price && num(trigger) ? (Number(trigger) / price - 1) * 100 : null;
  const wrong = dist !== null && ((cond === 'lte' && dist >= 0) || (cond === 'gte' && dist <= 0));
  const dist2 = price && num(trigger2) ? (Number(trigger2) / price - 1) * 100 : null;
  const availNear = balance ? Number(BigInt(balance.near) / 10n ** 18n) / 1e6 : null;
  const availUsd = balance ? Number(balance.usd) / 1e6 : null;
  const nudge = (set: (v: string) => void, cur: string) => (d: number) => set(fix4(Math.max(0.0001, (Number(cur) || price || 0) * (1 + d))));
  const distHint = (d: number | null, w = false) => d === null ? 'Live price loading' : <>{Math.abs(d).toFixed(2)}% {d < 0 ? 'below' : 'above'} last {price!.toFixed(4)}{w ? ' · would fire on the next check' : ''}</>;

  async function place() {
    if (!wallet.account || pending.current || !amount) return;
    if (!balance) { setErr('Wait for your vault balance to load, then try again.'); return; }
    if (buying ? BigInt(amount) > BigInt(balance.usd) : BigInt(amount) * (kind === 'oco' ? 1n : 1n) > BigInt(balance.near)) { setErr(`Deposit enough ${buying ? 'tUSD' : 'NEAR'} in your vault first.`); return; }
    pending.current = true; setErr(''); setBusy(true); setLastFill(null);
    try {
      if (kind === 'market') {
        const q = poolQuote.data ? BigInt(poolQuote.data) : 0n;
        if (q <= 0n) throw new Error('The pool quote is not ready yet. Try again in a moment.');
        const r = await wallet.call('market_order', { side, amount, min_out: (q * 99n / 100n).toString() }, '0', 30) as { status?: { SuccessValue?: string } };
        try { setLastFill(JSON.parse(atob(r.status!.SuccessValue!))); } catch { /* fill shown in history */ }
      } else if (isPublic && publicArgs) {
        await wallet.call('place_public_order', publicArgs, toYocto('0.02'), 30);
      } else if (preview) {
        const key = ensureViewKey(wallet.account);
        const leg = (l: { pt: string; ct: string; commit: string }) => ({ ct: l.ct, commit: l.commit, view_ct: sealView(key, wallet.account, l.pt) });
        if (kind === 'oco') await wallet.call('place_oco', { a: leg(preview[0]), b: leg(preview[1]) }, toYocto('0.04'), 50);
        else await wallet.call('place_order', leg(preview[0]), toYocto('0.02'), 30);
      }
    } catch (e) { setErr((e as Error).message); } finally { pending.current = false; setBusy(false); }
  }

  const word = kind === 'tp' ? 'take-profit' : kind === 'oco' ? 'OCO pair' : kind === 'limit' ? 'limit buy' : 'stop';
  const label = kind === 'market' ? `${side === 'sell' ? 'Sell' : 'Buy'} now at the pool price` : isPublic ? `Place public ${word} (no seal)` : `Seal ${word}`;
  const ready = kind === 'market' ? Boolean(amount && poolQuote.data) : isPublic ? Boolean(publicArgs) : Boolean(preview);
  return <aside className="pnl form" aria-label="Order panel">
    <div className="otabs" role="tablist" aria-label="Order type">
      {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} className={`${kind === k ? 'on' : ''}${k !== 'market' && !(isPublic && kind === k) ? ' sealed' : ''}`} onClick={() => pick(k)}>{k !== 'market' && <Icon name="lock" size={11} />}{l}</button>)}
    </div>
    <div className="form-body">
      {sealedKind && <div className="seal-mode" role="radiogroup" aria-label="Privacy">
        <button role="radio" aria-checked={mode === 'sealed'} className={mode === 'sealed' ? 'on' : ''} onClick={() => setMode('sealed')}><Icon name="lock" size={13} />Sealed · Seter</button>
        <button role="radio" aria-checked={mode === 'public'} className={mode === 'public' ? 'on pub' : ''} onClick={() => setMode('public')}><Icon name="eye" size={13} />Public order (no seal)</button>
      </div>}
      <div className="side-row">
        {kind === 'market' ? <div className="side-tog" role="radiogroup" aria-label="Side">
          <button role="radio" aria-checked={side === 'sell'} className={side === 'sell' ? 'on sell' : ''} onClick={() => setSide('sell')}>Sell NEAR</button>
          <button role="radio" aria-checked={side === 'buy'} className={side === 'buy' ? 'on buy' : ''} onClick={() => setSide('buy')}>Buy NEAR</button>
        </div> : <span className={`side-chip ${orderSide === 'buy' ? 'side-buy' : ''}`}><span>{orderSide === 'buy' ? <>Buy <WithLogo sym="NEAR">NEAR</WithLogo> with <WithLogo sym="tUSD">tUSD</WithLogo></> : <>Sell <WithLogo sym="NEAR">NEAR</WithLogo> → <WithLogo sym="tUSD">tUSD</WithLogo></>}</span></span>}
        <span className="dim small">{kind === 'market' ? 'fills now · nothing to seal' : kind === 'oco' ? 'one fires · other cancels' : kind === 'limit' ? 'fills if price ≤ limit' : kind === 'stop' ? 'fires if price ≤ trigger' : 'fires if price ≥ trigger'}</span>
      </div>
      <div className="frow"><span>Available</span><b className="mono">{wallet.account ? (balance ? (buying ? <WithLogo sym="tUSD">{availUsd!.toFixed(4)} tUSD</WithLogo> : <WithLogo sym="NEAR">{availNear!.toFixed(4)} NEAR</WithLogo>) : '…') : 'Connect to see'}</b></div>
      {!config ? <State kind={configError ? 'error' : 'loading'} art={configError ? 'warning' : undefined} title={configError ? 'Could not read the enclave key' : 'Reading the enclave key…'}>{configError}</State>
        : !config.tee ? <State kind="setup" art="lock" title="Setup required: enclave keys">The enclave has not published its keys yet (owner runs refresh_keys).</State>
        : <>
          {kind === 'oco' ? <>
            <Field label="Stop trigger" value={trigger} onChange={setTrigger} unit="USD" aria="Stop trigger price in USD per NEAR" nudge={nudge(setTrigger, trigger)} hint={distHint(dist, dist !== null && dist >= 0)} warn={dist !== null && dist >= 0} />
            <Field label="Take-profit trigger" value={trigger2} onChange={setTrigger2} unit="USD" aria="Take-profit trigger price in USD per NEAR" nudge={nudge(setTrigger2, trigger2)} hint={distHint(dist2, dist2 !== null && dist2 <= 0)} warn={dist2 !== null && dist2 <= 0} />
          </> : kind !== 'market' && <Field label={kind === 'limit' ? 'Limit price' : 'Trigger price'} value={trigger} onChange={setTrigger} unit="USD" aria={kind === 'limit' ? 'Limit price in USD per NEAR' : 'Trigger price in USD per NEAR'} nudge={nudge(setTrigger, trigger)} hint={distHint(dist, wrong)} warn={wrong} />}
          {buying ? <Field label="Spend" value={spend} onChange={setSpend} unit="tUSD" aria="Amount of tUSD to spend" hint={price && num(spend) ? `≈ ${(Number(spend) / (kind === 'limit' && num(trigger) ? Number(trigger) : price)).toFixed(4)} NEAR at ${kind === 'limit' ? 'the limit' : 'the last price'}` : undefined} />
            : <Field label={kind === 'oco' ? 'Amount (each leg)' : 'Amount'} value={size} onChange={setSize} unit="NEAR" aria="Amount of NEAR to sell" />}
          <div className="pcts">{[25, 50, 75, 100].map((p) => <button key={p} type="button" disabled={buying ? !availUsd : !availNear} onClick={() => buying ? availUsd && setSpend((availUsd * p / 100).toFixed(2)) : availNear && setSize((availNear * p / 100).toFixed(4))}>{p === 100 ? 'Max' : `${p}%`}</button>)}</div>
          {kind === 'market' ? <div className="mkt-box">
            <div className="cs-head"><span>Fills now on the test pool</span><span className="cs-badge pub-badge">nothing to seal</span></div>
            <div className="cs-you"><span>You receive (pool quote)</span><b className="mono">{poolQuote.data ? (side === 'sell' ? `${usd6(poolQuote.data)} tUSD` : `${near(poolQuote.data)} NEAR`) : poolQuote.error ? 'unavailable' : '…'}</b></div>
            <div className="cs-you"><span>Minimum (1% slippage)</span><b className="mono">{poolQuote.data ? (side === 'sell' ? `${usd6(String(BigInt(poolQuote.data) * 99n / 100n))} tUSD` : `${near(String(BigInt(poolQuote.data) * 99n / 100n))} NEAR`) : '…'}</b></div>
            {lastFill && <p className="mkt-fill" role="status"><Icon name="check" size={14} />Filled: {lastFill.side === 'sell' ? `${near(lastFill.amount_in)} NEAR → ${usd6(lastFill.amount_out)} tUSD` : `${usd6(lastFill.amount_in)} tUSD → ${near(lastFill.amount_out)} NEAR`} at {e6(lastFill.price_e6)}</p>}
          </div> : isPublic ? <div className="chain-sees chain-public">
            <div className="cs-head"><span>Chain sees</span><span className="cs-badge pub-badge"><Icon name="eye" size={11} />readable by anyone</span></div>
            {publicArgs ? <pre className="plain-args" aria-label="Public transaction arguments">{'{ '}<span>"kind"</span>: "{publicArgs.kind}", <span>"cond"</span>: "{publicArgs.cond}",{'\n  '}<mark>"trigger_usd": "{publicArgs.trigger_usd}"</mark>,{'\n  '}<span>"side"</span>: "{publicArgs.side}", <span>"amount"</span>: "{buying ? usd6(publicArgs.amount, 2) + ' tUSD' : near(publicArgs.amount, 2) + ' NEAR'}"{' }'}</pre> : <p className="dim small">Enter a trigger and amount.</p>}
            <div className="cs-you"><span>A bot sees</span><b className="mono">{cond === 'lte' ? '≤' : '≥'} {num(trigger) ? fix4(Number(trigger)) : '—'} · {buying ? `${num(spend) ? spend : '—'} tUSD` : `${num(size) ? size : '—'} NEAR`}</b></div>
          </div> : <div className="chain-sees">
            <div className="cs-head"><span>Chain sees</span>{preview ? <span className="cs-badge"><Icon name="lock" size={11} />{preview.length === 2 ? `two ciphertexts · ${preview[0].ct.length} chars each` : `ciphertext · ${preview[0].ct.length} chars`}</span> : null}</div>
            {preview ? <code className="cipher">{preview[0].ct.slice(0, 92)}<span>{preview[0].ct.slice(92, 124)}</span></code> : <p className="dim small">Enter a trigger and amount.</p>}
            <div className="cs-you"><span>You see</span><b className="mono">{kind === 'oco' ? `≤ ${num(trigger) ? fix4(Number(trigger)) : '—'} or ≥ ${num(trigger2) ? fix4(Number(trigger2)) : '—'}` : `${cond === 'lte' ? '≤' : '≥'} ${num(trigger) ? fix4(Number(trigger)) : '—'}`} · {buying ? `${num(spend) ? spend : '—'} tUSD` : `${num(size) ? Number(size) : '—'} NEAR`}</b></div>
          </div>}
          <dl className="summ">
            {kind !== 'market' && <div><dt>Current pool quote</dt><dd className="mono">{!amount ? '—' : poolQuote.data ? (orderSide === 'sell' ? <WithLogo sym="tUSD">{usd6(poolQuote.data)} tUSD</WithLogo> : <WithLogo sym="NEAR">{near(poolQuote.data)} NEAR</WithLogo>) : poolQuote.error ? 'unavailable' : '…'}</dd></div>}
            <div><dt>Pool fee</dt><dd className="mono">{config.fee_bps / 100}%</dd></div>
            <div><dt>Storage deposit</dt><dd className="mono">{kind === 'market' ? 'none' : <WithLogo sym="NEAR">{kind === 'oco' ? '0.04' : '0.02'} NEAR</WithLogo>}</dd></div>
            {kind !== 'market' && <div><dt>Max price age</dt><dd className="mono">{config.max_price_age_s} s</dd></div>}
          </dl>
          {err && <p className="sheet-err" role="alert">{err}</p>}
          {wallet.account
            ? <button className={`btn btn-block btn-lg ${isPublic ? 'btn-public' : 'btn-primary'}`} disabled={!ready || busy} onClick={place}>{busy ? 'Opening wallet…' : <><Icon name={kind === 'market' ? 'bolt' : isPublic ? 'eye' : 'lock'} size={16} />{label}</>}</button>
            : <button className="btn btn-primary btn-block btn-lg" onClick={wallet.connect} disabled={!wallet.ready}>Connect wallet to trade</button>}
          <p className="form-note">{kind === 'market' ? 'A market order has no trigger, so there is nothing to seal: it swaps now against the vault’s NEAR / tUSD test pool.' : isPublic ? 'No seal: the trigger goes into the transaction arguments and contract state, where every explorer and bot can read it. Shown for comparison.' : kind === 'oco' ? 'Both legs are encrypted in your browser. When one fires the contract cancels the other in the same transaction; only the link between the two order numbers is public.' : 'Encrypted in your browser to the enclave’s X25519 key. The contract stores ciphertext and a commitment; owner, time and status are public.'}</p>
        </>}
    </div>
    {children}
  </aside>;
}
