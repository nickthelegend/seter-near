/** Approval sheet for the build-gated test wallet (QA mode only; imported by qa-signer.ts, so ordinary production
 * builds never contain it). It shows what is about to be signed and waits for Approve or Reject, like a wallet pop-up. */
import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CONTRACT, near } from './lib';
import { Icon, Sheet } from './ui';

export type ApproveRequest = { signer: string; receiver: string; method: string; args: Record<string, unknown>; deposit: bigint; gas: bigint };

const short = (s: string, n = 18) => s.length > n ? `${s.slice(0, n)}…` : s;
/** Plain words for each method the test wallet is allowed to sign. */
function describe(r: ApproveRequest): { action: string; rows: [string, string][]; depositNote: string } {
  const a = r.args;
  switch (r.method) {
    case 'place_order': {
      const bytes = Math.floor(String(a.ct ?? '').length * 3 / 4);
      return { action: 'Seal a stop order', rows: [['Trigger and size', `encrypted, ${bytes}-byte sealed blob`], ['Price in the arguments', 'none']], depositNote: 'storage for the order record' };
    }
    case 'cancel_order': return { action: `Cancel order №${a.id}`, rows: [['Order', `№${a.id}`], ['Trigger after cancel', 'never published']], depositNote: '' };
    case 'check': return { action: 'Pay for an enclave check', rows: [['Orders checked', 'every open order']], depositNote: 'enclave run and price oracle' };
    case 'deposit_near': return { action: 'Deposit NEAR into your vault', rows: [], depositNote: 'moves into your vault' };
    case 'withdraw_near': return { action: 'Withdraw NEAR from your vault', rows: [['Amount', `${near(String(a.amount ?? '0'))} NEAR`]], depositNote: '' };
    case 'withdraw_usd': return { action: 'Withdraw tUSD from your vault', rows: [['Amount', `${(Number(a.amount ?? 0) / 1e6).toFixed(2)} tUSD`]], depositNote: '' };
    case 'ft_transfer_call': return { action: 'Deposit tUSD into your vault', rows: [['Amount', `${(Number(a.amount ?? 0) / 1e6).toFixed(2)} tUSD`]], depositNote: 'required 1 yocto' };
    case 'faucet': return { action: 'Claim test tUSD', rows: [], depositNote: 'faucet fee' };
    case 'storage_deposit': return { action: 'Register for tUSD', rows: [], depositNote: 'token storage' };
    default: return { action: r.method, rows: [], depositNote: '' };
  }
}

function ApproveSheet({ req, onDone }: { req: ApproveRequest; onDone: (ok: boolean) => void }) {
  const d = describe(req);
  const approveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { approveRef.current?.focus({ preventScroll: true }); }, []);
  const dep = req.deposit === 0n ? '0 NEAR' : `${near(req.deposit.toString(), req.deposit % 10n ** 20n === 0n ? 2 : 6)} NEAR`;
  return <Sheet label="Approve transaction" onClose={() => onDone(false)}>
    <header className="sheet-head">
      <span className="pair pair-dark"><i aria-hidden="true" />Test wallet · NEAR testnet</span>
      <button className="icon-btn" onClick={() => onDone(false)} aria-label="Reject and close"><Icon name="x" /></button>
    </header>
    <div className="ap-head">
      <span className="ap-icon" aria-hidden="true"><Icon name={req.method === 'cancel_order' ? 'ban' : req.method === 'place_order' ? 'lock' : 'bolt'} /></span>
      <div><h2 className="sheet-title">Approve transaction</h2><p className="ap-action">{d.action}</p></div>
    </div>
    <dl className="receipt ap-receipt">
      <div><dt>Network</dt><dd>NEAR testnet</dd></div>
      <div><dt>From</dt><dd className="ap-mono">{req.signer}</dd></div>
      <div><dt>To{req.receiver === CONTRACT ? <small>Seter vault contract</small> : null}</dt><dd className="ap-mono">{req.receiver}</dd></div>
      <div><dt>Method</dt><dd className="ap-mono">{req.method}</dd></div>
      {d.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      <div><dt>Deposit{d.depositNote && req.deposit > 0n ? <small>{d.depositNote}</small> : null}</dt><dd>{dep}</dd></div>
      <div><dt>Gas limit<small>unused gas is refunded</small></dt><dd>{(req.gas / 10n ** 12n).toString()} Tgas</dd></div>
    </dl>
    {req.method === 'place_order' && <code className="cipher cipher-block ap-cipher">{short(String(req.args.ct ?? ''), 220)}</code>}
    <div className="ap-actions">
      <button className="btn btn-ghost" onClick={() => onDone(false)}>Reject</button>
      <button ref={approveRef} className="btn btn-primary" onClick={() => onDone(true)}>Approve</button>
    </div>
  </Sheet>;
}

/** Resolves when the user approves; rejects with the wallet's own cancel wording (mapped to "Nothing was sent"). */
export function approve(req: ApproveRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    host.id = 'qa-approve';
    document.body.append(host);
    const root = createRoot(host);
    const done = (ok: boolean) => { root.unmount(); host.remove(); if (ok) resolve(); else reject(new Error('User cancelled the transaction')); };
    root.render(<StrictMode><ApproveSheet req={req} onDone={done} /></StrictMode>);
  });
}
