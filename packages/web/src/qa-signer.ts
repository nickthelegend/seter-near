/** Test-only wallet adapter. Vite removes this module from ordinary production builds. */
import { Account, connect, keyStores, KeyPair, transactions, utils } from 'near-api-js';
import { CONTRACT, TOKEN } from './lib';
import type { WalletPort } from './wallet';

type SignAndSendTransactionParams = Parameters<WalletPort['signAndSendTransaction']>[0];
type SignAndSendTransactionsParams = Parameters<WalletPort['signAndSendTransactions']>[0];
type Injection = { accountId: string; secretKey: string; rpcUrl: string; budgetYocto?: string };
type PublicOutcome = { method: string; receiver: string; deposit: string; tx: string; final: boolean; result?: unknown; rejection?: string };
declare global { interface Window { __SETER_QA_SIGNER__?: Injection; __qaPublicOutcome?: (detail: PublicOutcome) => Promise<void> } }
class PreparedAccount extends Account {
  prepare(receiver: string, actions: transactions.Action[]) { this.accessKeyByPublicKeyCache = {}; return this.signTransaction(receiver, actions); }
}
async function jsonRpc(url: string, method: string, params: object) {
  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(6000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'qa-signer', method, params }) });
  if (!res.ok) throw new Error('QA testnet provider unavailable.');
  const json = await res.json();
  if (json.error) {
    const rejection = ['InvalidNonce', 'Expired', 'InvalidSignature', 'NotEnoughBalance'].find((name) => JSON.stringify(json.error).includes(name));
    throw Object.assign(new Error(rejection ? `QA transaction rejected: ${rejection}` : 'QA testnet transaction status is not available yet.'), { rejection });
  }
  return json.result;
}
const MARKER = 'SETER_QA_SIGNER_TESTNET_ONLY';
const RPCS = new Set(['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org', 'https://near-testnet.drpc.org']);
const METHODS: Record<string, Set<string>> = {
  [CONTRACT]: new Set(['deposit_near', 'place_order', 'place_oco', 'place_public_order', 'cancel_public_order', 'market_order', 'check', 'cancel_order', 'withdraw_near', 'withdraw_usd']),
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
  const rpcUrl = input.rpcUrl;
  const near = await connect({ networkId: 'testnet', nodeUrl: input.rpcUrl, keyStore: store });
  const account = new PreparedAccount(near.connection, accountId);
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
      // Visible approval before anything is signed: the test wallet's equivalent of a wallet pop-up.
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(new TextDecoder().decode(f.args as Uint8Array)); } catch { /* non-JSON args are shown by method only */ }
      await (await import('./QaApprove')).approve({ signer: accountId, receiver: receiverId, method: f.methodName, args, deposit, gas });
      const balance = BigInt((await account.state()).amount);
      if (balance < cap || walletStart - balance + deposit + 10_000_000_000_000_000_000_000n > cap) throw new Error('QA signer balance is low or the 0.3 NEAR budget would be exceeded.');
      ++count; attached += deposit;
      if (!window.__qaPublicOutcome) throw new Error('QA public-ledger recorder is required before signing.');
      const [hash, signed] = await account.prepare(receiverId, [transactions.functionCall(f.methodName, f.args, gas, deposit)]);
      const tx = utils.serialize.base_encode(hash);
      const publish = (result?: unknown, final = false) => window.__qaPublicOutcome!({ method: f.methodName, receiver: receiverId, deposit: deposit.toString(), tx, final, result });
      // Persist the deterministic hash BEFORE the single broadcast. A lost response cannot hide it.
      await publish();
      const bytes = transactions.encodeTransaction(signed);
      const signed_tx_base64 = btoa(Array.from(bytes, (v) => String.fromCharCode(v)).join(''));
      try { await jsonRpc(rpcUrl, 'send_tx', { signed_tx_base64, wait_until: 'NONE' }); }
      catch (error) {
        const rejection = (error as { rejection?: string }).rejection;
        if (rejection) {
          await window.__qaPublicOutcome!({ method: f.methodName, receiver: receiverId, deposit: deposit.toString(), tx, final: false, rejection });
          throw error;
        }
        // Acceptance may be uncertain: poll the same hash, never sign or broadcast another transaction.
      }
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        for (const url of RPCS) {
          try {
            const result = await jsonRpc(url, 'tx', { tx_hash: tx, sender_account_id: accountId, wait_until: 'FINAL' });
            if (result?.final_execution_status !== 'FINAL') continue;
            await publish(result, true);
            return result;
          } catch { /* read-only fallback; no second broadcast */ }
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`QA transaction ${tx} is still pending. Inspect its saved hash before retrying.`);
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
