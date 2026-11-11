/** Test-only wallet adapter. Vite removes this module from ordinary production builds. */
import { connect, keyStores, KeyPair, transactions } from 'near-api-js';
import { CONTRACT, TOKEN } from './lib';
import type { WalletPort } from './wallet';

type SignAndSendTransactionParams = Parameters<WalletPort['signAndSendTransaction']>[0];
type SignAndSendTransactionsParams = Parameters<WalletPort['signAndSendTransactions']>[0];
type Injection = { accountId: string; secretKey: string; rpcUrl: string; budgetYocto?: string };
declare global { interface Window { __SETER_QA_SIGNER__?: Injection } }
const MARKER = 'SETER_QA_SIGNER_TESTNET_ONLY';
const RPCS = new Set(['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org', 'https://near-testnet.drpc.org']);
const METHODS: Record<string, Set<string>> = {
  [CONTRACT]: new Set(['deposit_near', 'place_order', 'check', 'cancel_order', 'withdraw_near', 'withdraw_usd']),
  [TOKEN]: new Set(['faucet', 'ft_transfer_call', 'storage_deposit']),
};
let instance: Promise<WalletPort> | undefined;
export function getQaSigner(): Promise<WalletPort> {
  return instance ??= create();
}
async function create(): Promise<WalletPort> {
  if (import.meta.env.MODE !== 'qa' || import.meta.env.VITE_QA_SIGNER !== '1') throw new Error(`${MARKER}: disabled`);
  const input = window.__SETER_QA_SIGNER__;
  delete window.__SETER_QA_SIGNER__;
  if (!input || !/^[a-z0-9._-]+\.testnet$/.test(input.accountId) || !CONTRACT.endsWith('.testnet') || !TOKEN.endsWith('.testnet')) throw new Error(`${MARKER}: inject a testnet account`);
  if (!RPCS.has(input.rpcUrl)) throw new Error(`${MARKER}: refusing a non-testnet RPC`);
  // Memory only: neither localStorage nor a disk-backed keystore ever receives the signing key.
  const store = new keyStores.InMemoryKeyStore();
  await store.setKey('testnet', input.accountId, KeyPair.fromString(input.secretKey as `ed25519:${string}`));
  input.secretKey = '';
  const accountId = input.accountId;
  const near = await connect({ networkId: 'testnet', nodeUrl: input.rpcUrl, keyStore: store });
  const account = await near.account(accountId);
  let connected = sessionStorage.getItem('seter:qa:connected') === accountId;
  let pending = false, count = 0, attached = 0n;
  const walletStart = BigInt((await account.state()).amount);
  const cap = BigInt(input.budgetYocto || '300000000000000000000000');
  if (cap <= 0n || cap > 300_000_000_000_000_000_000_000n) throw new Error('QA signer budget must be at most 0.3 testnet NEAR.');
  const getAccounts = async () => connected ? [{ accountId }] : [];
  async function signAndSendTransaction(p: SignAndSendTransactionParams) {
    if (!connected) throw new Error('Connect the QA signer first.');
    if (pending) throw new Error('Wait for the pending QA transaction.');
    const receiverId = p.receiverId || CONTRACT;
    if ((p.signerId && p.signerId !== accountId) || !receiverId.endsWith('.testnet') || !METHODS[receiverId] || p.actions.length !== 1) throw new Error('QA signer refuses this transaction.');
    const action = p.actions[0];
    if (action.enum !== 'functionCall' || !action.functionCall || !METHODS[receiverId].has(action.functionCall.methodName)) throw new Error('QA signer permits only demo function calls.');
    const f = action.functionCall, deposit = BigInt(f.deposit), gas = BigInt(f.gas);
    if (deposit < 0n || gas <= 0n || gas > 300_000_000_000_000n || count >= 12 || attached + deposit > 120_000_000_000_000_000_000_000n) throw new Error('QA signer transaction budget exceeded.');
    pending = true;
    try {
      const balance = BigInt((await account.state()).amount);
      if (balance < cap || walletStart - balance + deposit + 10_000_000_000_000_000_000_000n > cap) throw new Error('QA signer balance is low or the 0.3 NEAR budget would be exceeded.');
      ++count; attached += deposit;
      const submitted = await account.signAndSendTransaction({ receiverId, actions: [transactions.functionCall(f.methodName, f.args, gas, deposit)], returnError: true });
      // Public outcomes only. The Playwright runner persists each hash before making another call.
      const publish = (result: typeof submitted, final: boolean) => dispatchEvent(new CustomEvent('seter:qa-outcome', { detail: { method: f.methodName, receiver: receiverId, deposit: deposit.toString(), result, final } }));
      publish(submitted, false);
      const result = await near.connection.provider.txStatus(submitted.transaction.hash, accountId, 'FINAL');
      publish(result, true);
      return result;
    } finally { pending = false; }
  }
  return {
    getAccounts,
    async signIn(p) {
      if (p.contractId !== CONTRACT) throw new Error('QA signer contract mismatch.');
      connected = true; sessionStorage.setItem('seter:qa:connected', accountId); return getAccounts();
    },
    async signOut() { connected = false; sessionStorage.removeItem('seter:qa:connected'); },
    signAndSendTransaction,
    async signAndSendTransactions(p: SignAndSendTransactionsParams) {
      const results = [];
      for (const tx of p.transactions) results.push(await signAndSendTransaction(tx));
      return results;
    },
  };
}
