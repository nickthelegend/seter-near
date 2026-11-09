import { useEffect, useMemo, useState } from 'react';
import { orderPlaintext, sealToEnclave, commitment, newViewKey, sealView, openView } from '@mienai/sdk/crypto';
import { CONTRACT, TOKEN, accountUrl, ago, enclaveUpload, e6, firedStep, near, nsToMs, runSteps, short, shortAccount, toYocto, usd6, view, type Balance, type Config, type Order, type Stats } from './lib';
import { useConfig, useFired, useOrders, usePoll, useStats, useTicker } from './live';
import { Chip, Ciphertext, Logo, Num, Redacted, State, Tx, statusTone } from './ui';
import { useWallet, type Wallet } from './wallet';
import { FireCard } from './Landing';

const SECTIONS = [
  { id: 'vault', label: 'Vault', icon: 'M4 7h16v11H4zM4 7l2-3h12l2 3M15 12h2' },
  { id: 'ticket', label: 'New stop', icon: 'M12 3v18M5 12h14' },
  { id: 'orders', label: 'Orders', icon: 'M5 6h14M5 12h14M5 18h9' },
  { id: 'audit', label: 'Audit', icon: 'M5 4h10l4 4v12H5zM9 13l2 2 4-4' },
  { id: 'enclave', label: 'Enclave', icon: 'M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z' },
];

const viewKeyFor = (account: string) => {
  try { return localStorage.getItem(`mienai:view:${account}`) || ''; } catch { return ''; }
};

export default function AppPage({ go }: { go: (path: string) => void }) {
  const wallet = useWallet();
  const config = useConfig();
  const stats = useStats();
  const ticker = useTicker();
  const [active, setActive] = useState('vault');
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.id);
    }, { rootMargin: '-30% 0px -60% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  const price = ticker.data ? Number(ticker.data.price) : null;

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <div className="topbar__right">
          <span className="netchip"><i aria-hidden="true" />NEAR testnet</span>
          <span className="topbar__price mono" aria-label="Live NEAR price">{price ? <>NEAR <Num value={price.toFixed(4)} /></> : ticker.error ? 'price unavailable' : 'price loading'}</span>
          {wallet.account
            ? <button className="btn btn--ghost btn--sm" onClick={wallet.disconnect} title="Disconnect">{shortAccount(wallet.account)}</button>
            : <button className="btn btn--primary btn--sm" onClick={wallet.connect} disabled={!wallet.ready}>{wallet.ready ? 'Connect wallet' : 'Loading wallet'}</button>}
        </div>
      </header>

      <aside className="rail" aria-label="App sections">
        <nav>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={active === s.id ? 'is-active' : ''}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={s.icon} /></svg><span>{s.label}</span>
            </a>
          ))}
        </nav>
        <div className="rail__foot">
          <span className="label">Contract</span>
          <a className="mono" href={accountUrl(CONTRACT)} target="_blank" rel="noreferrer">{shortAccount(CONTRACT)}</a>
          <a className="rail__back" href="/" onClick={(e) => { e.preventDefault(); go('/'); }}>← Landing</a>
        </div>
      </aside>

      <main className="main">
        {wallet.error && <State kind="error">{wallet.error}</State>}
        <div className="main__intro">
          <h1>Your invisible orders</h1>
          <p>Deposit, seal a stop or take-profit to the enclave, and audit every fire. Everything on this page is read live from <span className="mono">{CONTRACT}</span>.</p>
        </div>
        <div className="grid2">
          <div className="stack">
            <VaultCard wallet={wallet} stats={stats.data} />
            <PulseCard stats={stats.data} error={stats.error} />
          </div>
          <TicketCard wallet={wallet} config={config.data} configError={config.error} price={price} />
        </div>
        <OrdersCard wallet={wallet} />
        <AuditCard wallet={wallet} />
        <EnclaveCard config={config.data} configError={config.error} stats={stats.data} />
      </main>

      <nav className="tabbar" aria-label="App sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={active === s.id ? 'is-active' : ''} aria-label={s.label}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={s.icon} /></svg><span>{s.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

function VaultCard({ wallet, stats }: { wallet: Wallet; stats: Stats | null }) {
  const bal = usePoll<Balance | null>(() => (wallet.account ? view('balance_of', { account_id: wallet.account }) : Promise.resolve(null)), 15_000, [wallet.account]);
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [asset, setAsset] = useState<'NEAR' | 'tUSD'>('NEAR');
  const [amount, setAmount] = useState('1');
  const [err, setErr] = useState('');
  const poolPrice = stats && BigInt(stats.pool.near) > 0n ? (Number(stats.pool.usd) / 1e6) / (Number(BigInt(stats.pool.near) / 10n ** 18n) / 1e6) : null;

  async function submit() {
    setErr('');
    try {
      if (mode === 'deposit' && asset === 'NEAR') await wallet.call('deposit_near', {}, toYocto(amount), 30);
      else if (mode === 'deposit') await wallet.call('ft_transfer_call', { receiver_id: CONTRACT, amount: String(Math.round(Number(amount) * 1e6)), msg: 'deposit' }, '1', 100, TOKEN);
      else if (asset === 'NEAR') await wallet.call('withdraw_near', { amount: toYocto(amount) }, '0', 30);
      else await wallet.call('withdraw_usd', { amount: String(Math.round(Number(amount) * 1e6)) }, '0', 60);
      bal.refresh();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <section className="card card--vault" id="vault" aria-labelledby="vault-h">
      <div className="card__head"><h2 id="vault-h">Vault</h2><Chip tone="accent">testnet</Chip></div>
      {!wallet.account ? (
        <div className="vault__empty">
          <p>Connect a NEAR testnet wallet to see your vault balance. Orders draw from it when they fire.</p>
          <button className="btn btn--primary" onClick={wallet.connect} disabled={!wallet.ready}>Connect wallet</button>
        </div>
      ) : (
        <>
          <div className="vault__balances">
            <div><span className="label">NEAR in vault</span><strong>{bal.data ? <Num value={near(bal.data.near)} /> : '—'}</strong></div>
            <div><span className="label">tUSD in vault</span><strong>{bal.data ? <Num value={usd6(bal.data.usd)} /> : '—'}</strong></div>
          </div>
          <div className="seg" role="tablist" aria-label="Vault action">
            {(['deposit', 'withdraw'] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'is-on' : ''} onClick={() => setMode(m)}>{m === 'deposit' ? 'Deposit' : 'Withdraw'}</button>)}
          </div>
          <div className="field field--row">
            <label htmlFor="vault-amt" className="sr">Amount</label>
            <input id="vault-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <select aria-label="Asset" value={asset} onChange={(e) => setAsset(e.target.value as 'NEAR' | 'tUSD')}><option>NEAR</option><option>tUSD</option></select>
          </div>
          <button className="btn btn--primary btn--block" onClick={submit}>{mode === 'deposit' ? 'Deposit' : 'Withdraw'} {amount || '0'} {asset}</button>
          {asset === 'tUSD' && mode === 'deposit' && <p className="hint">Need test tUSD? <button className="link" onClick={() => wallet.call('faucet', {}, toYocto('0.01'), 30, TOKEN)}>Take 1,000 from the faucet</button> (once an hour).</p>}
          {(err || bal.error) && <State kind="error">{err || bal.error}</State>}
        </>
      )}
      <div className="vault__pool">
        <span className="label">Test pool a fire swaps against</span>
        {stats ? <span className="mono">{near(stats.pool.near, 3)} NEAR · {usd6(stats.pool.usd, 3)} tUSD{poolPrice ? ` · ${poolPrice.toFixed(4)} tUSD/NEAR` : ''}</span> : <span className="muted">Loading</span>}
      </div>
    </section>
  );
}

function PulseCard({ stats, error }: { stats: Stats | null; error: string }) {
  const c = stats?.last_check;
  return (
    <section className="card card--pulse" aria-labelledby="pulse-h">
      <div className="card__head"><h2 id="pulse-h">Last enclave check</h2>{c && <span className="mono muted small">{ago(nsToMs(c.block_ts))}</span>}</div>
      {!stats ? <State kind={error ? 'error' : 'loading'}>{error || 'Reading the contract'}</State> : !c ? <State kind="empty">No check has run yet.</State> : (
        <>
          <div className="pulse">
            <div><span className="label">Price read in TEE</span><strong><Num value={e6(c.price_e6)} /></strong></div>
            <div><span className="label">Opened</span><strong>{c.checked}</strong></div>
            <div><span className="label">Fired</span><strong className={c.fired.length ? 'signal' : ''}>{c.fired.length}</strong></div>
          </div>
          <p className="mono small muted">request #{c.request} · OutLayer run #{c.outlayer_request} · block {c.block_height} · Coinbase trade #{c.trade_id}</p>
        </>
      )}
    </section>
  );
}

function TicketCard({ wallet, config, configError, price }: { wallet: Wallet; config: Config | null; configError: string; price: number | null }) {
  const [kind, setKind] = useState<'lte' | 'gte'>('lte');
  const [trigger, setTrigger] = useState('');
  const [size, setSize] = useState('0.5');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (price && !trigger) setTrigger((price * 0.97).toFixed(4)); }, [price, trigger]);
  const pick = (k: 'lte' | 'gte') => { setKind(k); if (price) setTrigger((price * (k === 'lte' ? 0.97 : 1.03)).toFixed(4)); };
  const owner = wallet.account || 'your-account.testnet';
  const preview = useMemo(() => {
    if (!config?.tee || !/^\d+(\.\d+)?$/.test(trigger) || !/^\d+(\.\d+)?$/.test(size) || Number(trigger) <= 0 || Number(size) <= 0) return null;
    try {
      const pt = orderPlaintext({ cond: kind, triggerUsd: trigger, side: 'sell', amount: toYocto(size) });
      return { pt, ct: sealToEnclave(config.tee.order_pub, owner, pt) as string, commit: commitment(owner, pt) as string };
    } catch { return null; }
  }, [config, kind, trigger, size, owner]);
  const distance = price && Number(trigger) > 0 ? ((Number(trigger) / price - 1) * 100) : null;
  const wrongSide = distance !== null && ((kind === 'lte' && distance >= 0) || (kind === 'gte' && distance <= 0));

  async function place() {
    if (!preview || !wallet.account) return;
    setErr(''); setBusy(true);
    try {
      let key = viewKeyFor(wallet.account);
      if (!key) { key = newViewKey(); try { localStorage.setItem(`mienai:view:${wallet.account}`, key); } catch { /* private window */ } }
      await wallet.call('place_order', { ct: preview.ct, commit: preview.commit, view_ct: sealView(key, wallet.account, preview.pt) }, toYocto('0.02'), 30);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="card card--ticket" id="ticket" aria-labelledby="ticket-h">
      <div className="card__head"><h2 id="ticket-h">Set an invisible order</h2><span className="mono muted small">sell NEAR</span></div>
      {!config ? <State kind={configError ? 'error' : 'loading'}>{configError || 'Reading the enclave key'}</State> : !config.tee ? <State kind="setup">Setup required: the enclave has not published its keys (owner runs refresh_keys).</State> : (
        <>
          <div className="seg seg--wide" role="tablist" aria-label="Order type">
            <button role="tab" aria-selected={kind === 'lte'} className={kind === 'lte' ? 'is-on' : ''} onClick={() => pick('lte')}>Stop-loss <span className="mono">≤</span></button>
            <button role="tab" aria-selected={kind === 'gte'} className={kind === 'gte' ? 'is-on' : ''} onClick={() => pick('gte')}>Take-profit <span className="mono">≥</span></button>
          </div>
          <div className="field">
            <label htmlFor="trig">Trigger price <span className="muted">USD per NEAR</span></label>
            <input id="trig" inputMode="decimal" value={trigger} onChange={(e) => setTrigger(e.target.value)} />
            <span className={`hint${wrongSide ? ' hint--warn' : ''}`}>{distance === null ? 'Live price loading' : `${Math.abs(distance).toFixed(2)}% ${distance < 0 ? 'below' : 'above'} live ${price!.toFixed(4)}${wrongSide ? ' · this would fire on the next check' : ''}`}</span>
          </div>
          <div className="field">
            <label htmlFor="size">Sell <span className="muted">NEAR from your vault</span></label>
            <input id="size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
          </div>
          <div className="onchain">
            <div className="onchain__head"><span className="label">What the chain will store</span><span className="mono muted small">{preview ? `${preview.ct.length} chars` : ''}</span></div>
            {preview ? <><Ciphertext value={preview.ct} chars={72} /><span className="mono small muted">commit {short(preview.commit, 10)}</span></> : <span className="muted small">Enter a trigger and size.</span>}
            {!wallet.account && <span className="small muted">Preview sealed for “your-account.testnet”; connecting binds it to your account.</span>}
          </div>
          {wallet.account
            ? <button className="btn btn--primary btn--block" onClick={place} disabled={!preview || busy}>{busy ? 'Opening wallet…' : 'Seal and place · 0.02 NEAR storage'}</button>
            : <button className="btn btn--primary btn--block" onClick={wallet.connect} disabled={!wallet.ready}>Connect wallet to place</button>}
          {err && <State kind="error">{err}</State>}
        </>
      )}
    </section>
  );
}

function decrypt(o: Order, account: string): { cond: string; trigger_e6: number; amount: string } | null {
  if (o.fire) return { cond: o.fire.cond, trigger_e6: o.fire.trigger_e6, amount: o.fire.amount };
  const key = viewKeyFor(account);
  if (!key || !o.view_ct) return null;
  try { return JSON.parse(openView(key, account, o.view_ct)); } catch { return null; }
}

function OrdersCard({ wallet }: { wallet: Wallet }) {
  const mine = usePoll<Order[] | null>(() => (wallet.account ? view('get_orders_of', { owner: wallet.account }) : Promise.resolve(null)), 15_000, [wallet.account]);
  const book = useOrders();
  const [err, setErr] = useState('');
  const list = wallet.account ? mine.data : book.data;
  return (
    <section className="card" id="orders" aria-labelledby="orders-h">
      <div className="card__head">
        <h2 id="orders-h">{wallet.account ? 'Your orders' : 'Order book'}</h2>
        <span className="muted small">{wallet.account ? 'Decrypted on this device with your view key' : 'Not connected: the public book, as anyone sees it'}</span>
      </div>
      {!list ? <State kind={(wallet.account ? mine.error : book.error) ? 'error' : 'loading'}>{(wallet.account ? mine.error : book.error) || 'Reading orders'}</State>
        : !list.length ? <State kind="empty">No orders yet. Seal one above; it shows here as soon as the transaction lands.</State> : (
          <div className="rows">
            <div className="rows__head"><span>Order</span><span>Level</span><span>On chain</span><span>Placed</span><span>Status</span><span /></div>
            {[...list].reverse().map((o) => {
              const p = wallet.account ? decrypt(o, wallet.account) : (o.fire ? { cond: o.fire.cond, trigger_e6: o.fire.trigger_e6, amount: o.fire.amount } : null);
              return (
                <div className="rows__row" key={o.id}>
                  <span className="rows__id"><strong>#{o.id}</strong><span className="mono muted small">{shortAccount(o.owner)}</span></span>
                  <span>{p ? <><span className="muted small">{p.cond === 'lte' ? 'Stop ≤' : 'Take-profit ≥'}</span> <Num value={e6(p.trigger_e6)} /> <span className="muted small">· {near(p.amount, 2)} NEAR</span></> : <><Redacted />{wallet.account && <span className="muted small"> view key not on this device</span>}</>}</span>
                  <span className="rows__ct"><Ciphertext value={o.ct} chars={20} /></span>
                  <span className="mono small muted">{ago(nsToMs(o.created_ns))}</span>
                  <span><Chip tone={statusTone(o.status)}>{o.status}</Chip></span>
                  <span className="rows__act">{wallet.account === o.owner && o.status === 'Open' && <button className="btn btn--ghost btn--xs" onClick={() => wallet.call('cancel_order', { id: o.id }, '0', 30).catch((e) => setErr((e as Error).message))}>Cancel</button>}</span>
                </div>
              );
            })}
          </div>
        )}
      {err && <State kind="error">{err}</State>}
      {wallet.account && <ViewKey account={wallet.account} />}
    </section>
  );
}

function ViewKey({ account }: { account: string }) {
  const [shown, setShown] = useState(false);
  const [input, setInput] = useState('');
  const key = viewKeyFor(account);
  return (
    <details className="viewkey">
      <summary>View key on this device: {key ? 'present' : 'none yet'}</summary>
      <p className="small muted">Your orders carry a second copy sealed to this key, which never leaves your browser. Export it to read your levels on another device.</p>
      {key && <button className="btn btn--ghost btn--xs" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'} key</button>}
      {shown && <code className="cipher">{key}</code>}
      <div className="field field--row">
        <label htmlFor="vk" className="sr">Import view key</label>
        <input id="vk" placeholder="Paste a 64-character view key" value={input} onChange={(e) => setInput(e.target.value.trim())} />
        <button className="btn btn--ghost btn--sm" disabled={!/^[0-9a-f]{64}$/.test(input)} onClick={() => { try { localStorage.setItem(`mienai:view:${account}`, input); location.reload(); } catch { /* storage blocked */ } }}>Import</button>
      </div>
    </details>
  );
}

function AuditCard({ wallet }: { wallet: Wallet }) {
  const fired = useFired();
  const [err, setErr] = useState('');
  const txFor = (request: number) => runSteps.find((s) => s.last_check?.request === request)?.tx;
  return (
    <section className="card" id="audit" aria-labelledby="audit-h">
      <div className="card__head">
        <h2 id="audit-h">Fired-order audit</h2>
        {wallet.account && <button className="btn btn--ghost btn--sm" onClick={() => wallet.call('check', {}, toYocto('0.02'), 300).catch((e) => setErr((e as Error).message))}>Run an enclave check · 0.02 NEAR</button>}
      </div>
      <p className="card__lede">After a fire the trigger is public, next to the price the enclave read, its source and the block, so anyone can check the price really crossed it.</p>
      {!fired.data ? <State kind={fired.error ? 'error' : 'loading'}>{fired.error || 'Reading fired orders'}</State>
        : !fired.data.length ? <State kind="empty">Nothing has fired yet.</State> : (
          <div className="audit">
            {[...fired.data].reverse().map((o) => {
              const f = o.fire!;
              const tx = txFor(f.request);
              const verified = firedStep?.attestation && firedStep.last_check?.request === f.request ? firedStep.attestation : null;
              return (
                <article className="audit__item" key={o.id}>
                  <FireCard order={o} />
                  <dl className="facts facts--mono">
                    <div><dt>Crossed</dt><dd>{e6(f.price_e6)} {f.cond === 'lte' ? '≤' : '≥'} {e6(f.trigger_e6)} ✓</dd></div>
                    <div><dt>Price time</dt><dd>{new Date(f.price_ts_ms).toISOString().replace('T', ' ').slice(0, 19)} UTC</dd></div>
                    <div><dt>Source</dt><dd><a href={f.source} target="_blank" rel="noreferrer">Coinbase NEAR-USD ↗</a></dd></div>
                    <div><dt>Delivered</dt><dd>{f.path === 'callback' ? 'private callback' : 'signed relay'} · request #{f.request}</dd></div>
                    <div><dt>OutLayer run</dt><dd>#{f.outlayer_request}</dd></div>
                    <div><dt>Report hash</dt><dd>{short(f.report_sha256, 8)}</dd></div>
                    {tx && <div><dt>Transaction</dt><dd><Tx hash={tx} /></dd></div>}
                    <div><dt>TDX attestation</dt><dd>{verified ? (verified.ok ? `verified · ${verified.tcb.status}` : 'failed') : 'not verified here'}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      {err && <State kind="error">{err}</State>}
    </section>
  );
}

function EnclaveCard({ config, configError, stats }: { config: Config | null; configError: string; stats: Stats | null }) {
  const pinned = config?.enclave_hash;
  const built = enclaveUpload.sha256;
  return (
    <section className="card card--enclave" id="enclave" aria-labelledby="enclave-h">
      <div className="card__head"><h2 id="enclave-h">Enclave and code hash</h2>{pinned ? (pinned === built ? <Chip tone="signal">Hash matches the build</Chip> : <Chip tone="danger">Hash differs from the build</Chip>) : null}</div>
      {!config ? <State kind={configError ? 'error' : 'loading'}>{configError || 'Reading the contract'}</State> : (
        <div className="enclave">
          <div className="hashes">
            <div><span className="label">Pinned on the contract</span><code className="hash">{pinned}</code></div>
            <div><span className="label">Reproducible build (<span className="mono">bash scripts/build-enclave.sh</span>)</span><code className="hash">{built}</code></div>
            <a className="small" href={config.enclave_url} target="_blank" rel="noreferrer">Download the WASM from FastFS ↗</a>
          </div>
          <dl className="facts facts--mono">
            <div><dt>Order key (X25519)</dt><dd>{config.tee ? short(config.tee.order_pub, 10) : 'not published'}</dd></div>
            <div><dt>Report key (ed25519)</dt><dd>{config.tee ? short(config.tee.attest_pub, 10) : 'not published'}</dd></div>
            <div><dt>Keys bound to</dt><dd>WASM hash + caller {CONTRACT.slice(0, 14)}…</dd></div>
            <div><dt>Network allowlist</dt><dd>api.exchange.coinbase.com</dd></div>
            <div><dt>Max price age</dt><dd>{config.max_price_age_s} s</dd></div>
            <div><dt>Runs / rejected</dt><dd>{stats ? `${stats.requests_total} / ${stats.rejected_reports}` : '—'}</dd></div>
          </dl>
          <div className="mainnet">
            <span className="label">Mainnet execution</span>
            <p className="small">NEAR Intents has no testnet, so this build settles on the tUSD pool. On mainnet the swap would route through 1Click. <strong>Setup required: NEAR_MAINNET_ACCOUNT</strong> (funded); nothing on mainnet is live.</p>
          </div>
        </div>
      )}
    </section>
  );
}
