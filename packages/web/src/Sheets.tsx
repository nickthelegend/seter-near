import { useState } from 'react';
import { CONTRACT, TOKEN, near, toYocto, usd6, type Balance } from './lib';
import { Icon, Num, Sheet, State } from './ui';
import type { Wallet } from './wallet';

export const viewKeyFor = (account: string) => { try { return localStorage.getItem(`mienai:view:${account}`) || ''; } catch { return ''; } };

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
