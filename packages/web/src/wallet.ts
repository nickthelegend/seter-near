import { useEffect, useState } from 'react';
import type { InjectedWallet, WalletSelector } from '@near-wallet-selector/core';
import { CONTRACT } from './lib';
import { rememberReceipt } from './receipts';

/** Meteor Wallet (testnet) is the wallet: it opens in a pop-up (or its browser extension) and posts the result back to this
 * page, so there is no redirect route. MyNearWallet was dropped on 2026-11-10: its testnet pop-up now answers
 * "MyNearWallet can't connect to apps anymore" and sends people to Meteor. */
export const WALLET = { id: 'meteor-wallet', name: 'Meteor Wallet', url: 'https://wallet.meteorwallet.app' } as const;

export type WalletPort = Pick<InjectedWallet, 'getAccounts' | 'signIn' | 'signOut' | 'signAndSendTransaction' | 'signAndSendTransactions'>;
const qaEnabled = import.meta.env.MODE === 'qa' && import.meta.env.VITE_QA_SIGNER === '1';
const getQaWallet = () => qaEnabled ? import('./qa-signer').then((m) => m.getQaSigner()) : Promise.reject(new Error('Test wallet disabled'));
const getWallet = async (): Promise<WalletPort> => qaEnabled ? getQaWallet() : (await getSelector()).wallet<InjectedWallet>(WALLET.id);

let selectorPromise: Promise<WalletSelector> | null = null;
// Loaded on demand so the landing page does not pay for the wallet bundle.
const getSelector = () => (selectorPromise ??= Promise.all([import('@near-wallet-selector/core'), import('@near-wallet-selector/meteor-wallet')])
  .then(([core, meteor]) => core.setupWalletSelector({ network: 'testnet', modules: [meteor.setupMeteorWallet()] }))
  .catch((e) => { selectorPromise = null; throw e; }));

/** Plain words for the wallet window's own failures; anything else (a contract panic, an RPC error) passes through. */
function walletError(e: unknown, signingIn = false): Error {
  const message = String((e as Error)?.message ?? e);
  if (/User closed the window|didn't complete the action|User cancelled/i.test(message)) return new Error(signingIn ? 'The wallet closed before you signed in.' : 'The wallet closed before you approved. Nothing was sent.');
  if (/open popup window|Popup window blocked/i.test(message)) return new Error('Your browser blocked the wallet window. Allow pop-ups for this site, then try again.');
  if (/No Meteor (Wallet )?account found/i.test(message)) return new Error('Meteor Wallet has no testnet account yet. Create one there, then connect again.');
  if (/ERR_BALANCE|NotEnoughBalance|insufficient balance/i.test(message)) return new Error('Not enough balance for this transaction. Check your wallet and vault balances.');
  if (/ERR_FAUCET_COOLDOWN/.test(message)) return new Error('The tUSD faucet is available once an hour. Try again after the cooldown.');
  if (/Wallet not selected|No wallet selected/i.test(message)) return new Error('Connect Meteor Wallet before continuing.');
  if (/Failed to fetch|NetworkError|timeout|timed out/i.test(message)) return new Error('The wallet or testnet is not responding. Check your wallet activity before retrying.');
  if (/ERR_|ActionError|FunctionCallError|ExecutionError/.test(message)) return new Error('The contract could not complete this transaction. Check the transaction in your wallet before retrying.');
  return e instanceof Error ? e : new Error(message);
}

export function useWallet() {
  const [account, setAccount] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (qaEnabled) {
      let active = true;
      getQaWallet().then(async (w) => { const accounts = await w.getAccounts(); if (active) { setAccount(accounts[0]?.accountId || ''); setReady(true); } }).catch(() => { if (active) setError('QA signer unavailable: inject a funded testnet account and an allowed testnet RPC.'); });
      return () => { active = false; };
    }
    getSelector().then((s) => {
      setReady(true);
      const sync = () => setAccount(s.store.getState().accounts.find((a) => a.active)?.accountId ?? '');
      sync();
      const sub = s.store.observable.subscribe(sync);
      unsub = () => sub.unsubscribe();
    }).catch((e) => setError(`Wallet unavailable: ${e.message}`));
    return () => unsub?.();
  }, []);
  async function connect() {
    setError('');
    try { const w = await getWallet(); const accounts = await w.signIn({ contractId: CONTRACT, methodNames: [] }); if (qaEnabled) setAccount(accounts[0]?.accountId || ''); }
    catch (e) { setError(walletError(e, true).message); }
  }
  async function disconnect() {
    try { const w = await getWallet(); await w.signOut(); setAccount(''); }
    catch (e) { setError(walletError(e).message); }
  }
  /** Calls with no deposit to the contract are signed by the function-call key Meteor issued at sign-in; anything that
   * attaches NEAR, or goes to another contract, opens Meteor for approval. */
  async function call(methodName: string, args: object, depositYocto: string, tgas = 50, receiverId = CONTRACT) {
    try {
      const [w, { actionCreators }] = await Promise.all([getWallet(), import('@near-wallet-selector/core')]);
      const result = await w.signAndSendTransaction({ receiverId, actions: [actionCreators.functionCall(methodName, args, BigInt(tgas) * 10n ** 12n, BigInt(depositYocto))] });
      if (result && typeof result.status === 'object' && 'Failure' in result.status) throw new Error('ExecutionError');
      rememberReceipt(CONTRACT, methodName, args, receiverId, account, result);
      return result;
    }
    catch (e) { throw walletError(e); }
  }
  return { account, error, ready, connect, disconnect, call, setError };
}
export type Wallet = ReturnType<typeof useWallet>;
