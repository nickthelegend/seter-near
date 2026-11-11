import { useRef, useState } from 'react';
import { CONTRACT, TOKEN, near, toTokenUnits, toYocto, usd6, view, type Balance } from './lib';
import { Icon, Num, Obj, Sheet, State } from './ui';
import type { Wallet } from './wallet';
import { WithLogo } from './logos';

export const viewKeyFor = (account: string) => { try { return localStorage.getItem(`mienai:view:${account}`) || ''; } catch { return ''; } };

/** Vault: deposit and withdraw NEAR or tUSD, the tUSD faucet, and the device view key. */
export function VaultSheet({ wallet, balance, onClose }: { wallet: Wallet; balance: Balance | null; onClose: () => void }) {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [asset, setAsset] = useState<'NEAR' | 'tUSD'>('NEAR');
  const [amount, setAmount] = useState('1');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [done, setDone] = useState('');
  const [claimed, setClaimed] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const key = wallet.account ? viewKeyFor(wallet.account) : '';
  async function submit() {
    if (pending.current) return;
    setErr('');
    setDone('');
    try {
      const units = asset === 'NEAR' ? toYocto(amount) : toTokenUnits(amount);
      if (BigInt(units) <= 0n || BigInt(units) > (1n << 128n) - 1n) throw new Error('Enter a positive amount within the asset limit.');
      if (mode === 'withdraw') {
        if (!balance) throw new Error('Wait for your vault balance to load, then try again.');
        if (BigInt(units) > BigInt(asset === 'NEAR' ? balance.near : balance.usd)) throw new Error(`Not enough ${asset} in your vault.`);
      }
      pending.current = true;
      setBusy(true);
      if (mode === 'deposit' && asset === 'NEAR') await wallet.call('deposit_near', {}, units, 30);
      else if (mode === 'deposit') await wallet.call('ft_transfer_call', { receiver_id: CONTRACT, amount: units, msg: 'deposit' }, '1', 100, TOKEN);
      else if (asset === 'NEAR') await wallet.call('withdraw_near', { amount: units }, '0', 30);
      else {
        const storage = await view('storage_balance_of', { account_id: wallet.account }, TOKEN);
        if (!storage) {
          const bounds = await view<{ min: string }>('storage_balance_bounds', {}, TOKEN);
          await wallet.call('storage_deposit', { account_id: wallet.account, registration_only: true }, bounds.min, 30, TOKEN);
        }
        const result = await wallet.call('withdraw_usd', { amount: units }, '0', 60);
        if (result && 'status' in result && typeof result.status === 'object' && 'SuccessValue' in result.status && typeof result.status.SuccessValue === 'string' && atob(result.status.SuccessValue) === 'false') throw new Error('The token transfer failed. Your tUSD was returned to the vault.');
      }
      setDone(mode === 'deposit' ? 'Deposit complete' : 'Withdrawal complete');
    } catch (e) { setErr((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  async function faucet() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setErr('');
    try { await wallet.call('faucet', {}, toYocto('0.01'), 30, TOKEN); setClaimed(true); }
    catch (e) { setErr((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Sheet label="Vault" onClose={onClose}>
    <header className="sheet-head">
      <span className="pair pair-dark"><i aria-hidden="true" />Vault · {wallet.account || 'not connected'}</span>
      <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
    </header>
    <h2 className="sheet-title">Your vault</h2>
    {!wallet.account ? <State kind="setup" art="coin" title="No wallet connected" action={<button className="btn btn-primary" onClick={wallet.connect} disabled={!wallet.ready}>Connect with Meteor Wallet</button>}>Orders sell from a balance held by the contract. A testnet account is free in Meteor Wallet (wallet.meteorwallet.app).</State> : <>
      <dl className="receipt">
        <div><dt><WithLogo sym="NEAR" size={20}>NEAR in vault</WithLogo></dt><dd>{balance ? <Num value={near(balance.near)} /> : '…'}</dd></div>
        <div><dt><WithLogo sym="tUSD" size={20}>tUSD in vault</WithLogo> <small>test token, no value</small></dt><dd>{balance ? <Num value={usd6(balance.usd)} /> : '…'}</dd></div>
      </dl>
      <div className="seg" role="tablist" aria-label="Vault action">
        {(['deposit', 'withdraw'] as const).map((m) => <button key={m} role="tab" disabled={busy} aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setDone(''); setErr(''); }}>{m === 'deposit' ? 'Deposit' : 'Withdraw'}</button>)}
      </div>
      <div className="field field-row">
        <label htmlFor="vault-amt" className="sr">Amount</label>
        <input id="vault-amt" inputMode="decimal" disabled={busy} value={amount} onChange={(e) => { setAmount(e.target.value.trim()); setDone(''); setErr(''); }} />
        <select aria-label="Asset" disabled={busy} value={asset} onChange={(e) => { setAsset(e.target.value as 'NEAR' | 'tUSD'); setDone(''); setErr(''); }}><option>NEAR</option><option>tUSD</option></select>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>{busy ? 'Waiting for wallet…' : done || `${mode === 'deposit' ? 'Deposit' : 'Withdraw'} ${amount || '0'} ${asset}`}</button>
      {asset === 'tUSD' && mode === 'deposit' && <p className="sheet-note">Need test tUSD? <button className="link" disabled={busy || claimed} onClick={faucet}>{claimed ? '1,000 tUSD claimed' : 'Take 1,000 from the faucet'}</button> (once an hour).</p>}
      {done && <p className="sheet-ok" role="status"><Obj name="success" size={40} float={false} />{done}</p>}
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
