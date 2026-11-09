import { useEffect, useState } from 'react';
import type { WalletSelector } from '@near-wallet-selector/core';
import { CONTRACT } from './lib';

let selectorPromise: Promise<WalletSelector> | null = null;
// Loaded on demand so the landing page does not pay for the wallet bundle.
const getSelector = () => (selectorPromise ??= Promise.all([import('@near-wallet-selector/core'), import('@near-wallet-selector/my-near-wallet')])
  .then(([core, mnw]) => core.setupWalletSelector({ network: 'testnet', modules: [mnw.setupMyNearWallet()] })));

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
    try { const w = await (await getSelector()).wallet('my-near-wallet'); await (w as unknown as { signIn: (p: { contractId: string; methodNames: string[] }) => Promise<unknown> }).signIn({ contractId: CONTRACT, methodNames: [] }); }
    catch (e) { setError((e as Error).message); }
  }
  async function disconnect() { const w = await (await getSelector()).wallet(); await w.signOut(); setAccount(''); }
  async function call(methodName: string, args: object, depositYocto: string, tgas = 50, receiverId = CONTRACT) {
    const w = await (await getSelector()).wallet();
    return w.signAndSendTransaction({ receiverId, actions: [{ type: 'FunctionCall', params: { methodName, args, gas: String(BigInt(tgas) * 10n ** 12n), deposit: depositYocto } }] });
  }
  return { account, error, ready, connect, disconnect, call, setError };
}
export type Wallet = ReturnType<typeof useWallet>;
