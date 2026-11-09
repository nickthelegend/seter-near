import { useEffect, useMemo, useState } from 'react';
import { orderPlaintext, sealToEnclave, commitment, newViewKey, sealView } from '@mienai/sdk/crypto';
import { CONTRACT, TOKEN, near, short, toYocto, usd6, type Balance, type Config } from './lib';
import { Icon, Num, Redacted, Sheet, State } from './ui';
import type { Wallet } from './wallet';

export const viewKeyFor = (account: string) => { try { return localStorage.getItem(`mienai:view:${account}`) || ''; } catch { return ''; } };

/** Seal a stop-loss or take-profit: the ticket preview fills in as you type, then the trigger is sealed before it leaves the browser. */
export function SealSheet({ wallet, config, configError, price, onClose }: { wallet: Wallet; config: Config | null; configError: string; price: number | null; onClose: () => void }) {
  const [kind, setKind] = useState<'lte' | 'gte'>('lte');
  const [trigger, setTrigger] = useState('');
  const [size, setSize] = useState('0.5');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (price && !trigger) setTrigger((price * 0.97).toFixed(4)); }, [price, trigger]);
  const pick = (k: 'lte' | 'gte') => { setKind(k); if (price) setTrigger((price * (k === 'lte' ? 0.97 : 1.03)).toFixed(4)); };
  const owner = wallet.account || 'your-account.testnet';
  const valid = /^\d+(\.\d+)?$/.test(trigger) && /^\d+(\.\d+)?$/.test(size) && Number(trigger) > 0 && Number(size) > 0;
  const preview = useMemo(() => {
    if (!config?.tee || !valid) return null;
    try {
      const pt = orderPlaintext({ cond: kind, triggerUsd: trigger, side: 'sell', amount: toYocto(size) });
      return { pt, ct: sealToEnclave(config.tee.order_pub, owner, pt) as string, commit: commitment(owner, pt) as string };
    } catch { return null; }
  }, [config, kind, trigger, size, owner, valid]);
  const distance = price && Number(trigger) > 0 ? (Number(trigger) / price - 1) * 100 : null;
  const wrongSide = distance !== null && ((kind === 'lte' && distance >= 0) || (kind === 'gte' && distance <= 0));
  const nudge = (d: number) => { const v = Number(trigger) || price || 0; setTrigger(Math.max(0.0001, v * (1 + d)).toFixed(4)); };

  async function place() {
    if (!preview || !wallet.account) return;
    setErr(''); setBusy(true);
    try {
      let key = viewKeyFor(wallet.account);
      if (!key) { key = newViewKey(); try { localStorage.setItem(`mienai:view:${wallet.account}`, key); } catch { /* private window */ } }
      await wallet.call('place_order', { ct: preview.ct, commit: preview.commit, view_ct: sealView(key, wallet.account, preview.pt) }, toYocto('0.02'), 30);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return <Sheet label="Seal a new order" onClose={onClose}>
    <header className="sheet-head">
      <span className="pair pair-dark"><i aria-hidden="true" />NEAR / USD · sell from your vault</span>
      <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
    </header>
    <h2 className="sheet-title">Seal an order the market can’t see</h2>
    {!config ? <State kind={configError ? 'error' : 'loading'} title={configError ? 'Could not read the enclave key' : 'Reading the enclave key…'}>{configError}</State>
      : !config.tee ? <State kind="setup" title="Setup required: enclave keys">The enclave has not published its keys yet. The contract owner runs <code>refresh_keys</code>.</State>
      : <>
        <div className="kind" role="radiogroup" aria-label="Order type">
          <button role="radio" aria-checked={kind === 'lte'} className={kind === 'lte' ? 'on' : ''} onClick={() => pick('lte')}><b>Stop-loss</b><span>sell if price ≤ trigger</span></button>
          <button role="radio" aria-checked={kind === 'gte'} className={kind === 'gte' ? 'on' : ''} onClick={() => pick('gte')}><b>Take-profit</b><span>sell if price ≥ trigger</span></button>
        </div>
        <div className="field">
          <label htmlFor="trig">Trigger <span>USD per NEAR</span></label>
          <div className="stepper">
            <button className="icon-btn" onClick={() => nudge(-0.005)} aria-label="Lower the trigger by 0.5%">−</button>
            <input id="trig" inputMode="decimal" value={trigger} onChange={(e) => setTrigger(e.target.value.trim())} />
            <button className="icon-btn" onClick={() => nudge(0.005)} aria-label="Raise the trigger by 0.5%"><Icon name="plus" size={16} /></button>
          </div>
          <p className={`hint${wrongSide ? ' hint-warn' : ''}`}>{distance === null ? 'Live Coinbase price loading' : <>{Math.abs(distance).toFixed(2)}% {distance < 0 ? 'below' : 'above'} live <b className="mono">{price!.toFixed(4)}</b>{wrongSide ? ' · this would fire on the next check' : ''}</>}</p>
        </div>
        <div className="field">
          <label htmlFor="size">Sell <span>NEAR from your vault</span></label>
          <input id="size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value.trim())} />
        </div>
        <div className="sealing">
          <div className="sealing-row"><span className="label">You see</span><span className="mono">{kind === 'lte' ? '≤' : '≥'} {valid ? Number(trigger).toFixed(4) : '—'} · {valid ? Number(size) : '—'} NEAR</span></div>
          <div className="sealing-row"><span className="label">Chain sees</span>{preview ? <Redacted size="sm" label={`${preview.ct.length} chars`} /> : <span className="dim">enter a trigger and size</span>}</div>
          {preview && <code className="cipher">{preview.ct.slice(0, 96)}<span>{preview.ct.slice(96, 130)}</span></code>}
          {preview && <p className="mono dim small">commit {short(preview.commit, 10)}{!wallet.account && ' · preview sealed for “your-account.testnet”'}</p>}
        </div>
        {err && <p className="sheet-err" role="alert">{err}</p>}
        {wallet.account
          ? <button className="btn btn-primary btn-block" onClick={place} disabled={!preview || busy}>{busy ? 'Opening wallet…' : <>Seal and place <span className="btn-sub">0.02 NEAR storage</span></>}</button>
          : <button className="btn btn-primary btn-block" onClick={wallet.connect} disabled={!wallet.ready}>Connect a NEAR testnet wallet</button>}
        <p className="sheet-note">Encrypted in this browser to the enclave’s X25519 key (XChaCha20-Poly1305, bound to your account). A second copy is sealed to a view key that stays on this device.</p>
      </>}
  </Sheet>;
}

/** Vault: deposit and withdraw NEAR or tUSD, the tUSD faucet, and the device view key. */
export function VaultSheet({ wallet, balance, onClose }: { wallet: Wallet; balance: Balance | null; onClose: () => void }) {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [asset, setAsset] = useState<'NEAR' | 'tUSD'>('NEAR');
  const [amount, setAmount] = useState('1');
  const [err, setErr] = useState('');
  const [importKey, setImportKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const key = wallet.account ? viewKeyFor(wallet.account) : '';
  async function submit() {
    setErr('');
    try {
      if (mode === 'deposit' && asset === 'NEAR') await wallet.call('deposit_near', {}, toYocto(amount), 30);
      else if (mode === 'deposit') await wallet.call('ft_transfer_call', { receiver_id: CONTRACT, amount: String(Math.round(Number(amount) * 1e6)), msg: 'deposit' }, '1', 100, TOKEN);
      else if (asset === 'NEAR') await wallet.call('withdraw_near', { amount: toYocto(amount) }, '0', 30);
      else await wallet.call('withdraw_usd', { amount: String(Math.round(Number(amount) * 1e6)) }, '0', 60);
    } catch (e) { setErr((e as Error).message); }
  }
  return <Sheet label="Vault" onClose={onClose}>
    <header className="sheet-head">
      <span className="pair pair-dark"><i aria-hidden="true" />Vault · {wallet.account || 'not connected'}</span>
      <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
    </header>
    <h2 className="sheet-title">Your vault</h2>
    {!wallet.account ? <State kind="setup" title="No wallet connected" action={<button className="btn btn-primary" onClick={wallet.connect} disabled={!wallet.ready}>Connect with MyNearWallet</button>}>Orders sell from a balance held by the contract. A testnet account is free at testnet.mynearwallet.com.</State> : <>
      <dl className="receipt">
        <div><dt>NEAR in vault</dt><dd>{balance ? <Num value={near(balance.near)} /> : '…'}</dd></div>
        <div><dt>tUSD in vault <small>test token, no value</small></dt><dd>{balance ? <Num value={usd6(balance.usd)} /> : '…'}</dd></div>
      </dl>
      <div className="seg" role="tablist" aria-label="Vault action">
        {(['deposit', 'withdraw'] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'deposit' ? 'Deposit' : 'Withdraw'}</button>)}
      </div>
      <div className="field field-row">
        <label htmlFor="vault-amt" className="sr">Amount</label>
        <input id="vault-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
        <select aria-label="Asset" value={asset} onChange={(e) => setAsset(e.target.value as 'NEAR' | 'tUSD')}><option>NEAR</option><option>tUSD</option></select>
      </div>
      <button className="btn btn-primary btn-block" onClick={submit}>{mode === 'deposit' ? 'Deposit' : 'Withdraw'} {amount || '0'} {asset}</button>
      {asset === 'tUSD' && mode === 'deposit' && <p className="sheet-note">Need test tUSD? <button className="link" onClick={() => wallet.call('faucet', {}, toYocto('0.01'), 30, TOKEN).catch((e) => setErr((e as Error).message))}>Take 1,000 from the faucet</button> (once an hour).</p>}
      {err && <p className="sheet-err" role="alert">{err}</p>}
      <details className="viewkey">
        <summary>View key on this device: {key ? 'present' : 'none yet'}</summary>
        <p className="sheet-note">Your orders carry a second copy sealed to this key, which never leaves your browser. Export it to read your levels on another device.</p>
        {key && <button className="btn btn-ghost btn-sm" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'} key</button>}
        {showKey && <code className="cipher">{key}</code>}
        <div className="field field-row">
          <label htmlFor="vk" className="sr">Import view key</label>
          <input id="vk" placeholder="Paste a 64-character view key" value={importKey} onChange={(e) => setImportKey(e.target.value.trim())} />
          <button className="btn btn-ghost btn-sm" disabled={!/^[0-9a-f]{64}$/.test(importKey)} onClick={() => { try { localStorage.setItem(`mienai:view:${wallet.account}`, importKey); location.reload(); } catch { setErr('This browser blocks storage'); } }}>Import</button>
        </div>
      </details>
      <button className="btn btn-ghost btn-block" onClick={wallet.disconnect}>Sign out {wallet.account}</button>
    </>}
  </Sheet>;
}
