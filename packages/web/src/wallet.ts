import { useEffect, useState } from 'react';
import type { InjectedWallet, WalletSelector } from '@near-wallet-selector/core';
import { CONTRACT } from './lib';

/** Meteor Wallet (testnet) is the wallet: it opens in a pop-up (or its browser extension) and posts the result back to this
 * page, so there is no redirect route. MyNearWallet was dropped on 2026-11-10: its testnet pop-up now answers
 * "MyNearWallet can't connect to apps anymore" and sends people to Meteor. */
export const WALLET = { id: 'meteor-wallet', name: 'Meteor Wallet', url: 'https://wallet.meteorwallet.app' } as const;

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
  return e instanceof Error ? e : new Error(message);
}

export function useWallet() {
  const [account, setAccount] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let unsub: (() => void) | undefined;
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
    try { const w = await (await getSelector()).wallet<InjectedWallet>(WALLET.id); await w.signIn({ contractId: CONTRACT, methodNames: [] }); }
    catch (e) { setError(walletError(e, true).message); }
  }
  async function disconnect() { const w = await (await getSelector()).wallet(); await w.signOut(); setAccount(''); }
  /** Calls with no deposit to the contract are signed by the function-call key Meteor issued at sign-in; anything that
   * attaches NEAR, or goes to another contract, opens Meteor for approval. */
  async function call(methodName: string, args: object, depositYocto: string, tgas = 50, receiverId = CONTRACT) {
    const [selector, { actionCreators }] = await Promise.all([getSelector(), import('@near-wallet-selector/core')]);
    const w = await selector.wallet();
    try { return await w.signAndSendTransaction({ receiverId, actions: [actionCreators.functionCall(methodName, args, BigInt(tgas) * 10n ** 12n, BigInt(depositYocto))] }); }
    catch (e) { throw walletError(e); }
  }
  return { account, error, ready, connect, disconnect, call, setError };
}
export type Wallet = ReturnType<typeof useWallet>;
