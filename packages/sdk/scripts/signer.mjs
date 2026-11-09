// Loads gitignored keys for scripts. Never prints a key.
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider } from 'near-api-js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TESTNET_RPC } from '../src/index.mjs';

export const root = resolve(import.meta.dirname, '../../..');
// FastNEAR rate-limits shared IPs (HTTP 429); back off and retry instead of failing a run.
export const provider = new JsonRpcProvider({ url: process.env.NEAR_TESTNET_RPC || TESTNET_RPC }, { retries: 12, backoff: 1.6, wait: 1500 });

export async function loadCredentials(name = 'deployer') {
  const file = resolve(root, `.near-credentials/${name}.json`);
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`Setup required: .near-credentials/${name}.json`); }
}

export function accountFrom(credentials) {
  if (!credentials.account_id || !credentials.secret_key) throw new Error('Setup required: account_id and secret_key');
  return new Account(credentials.account_id, provider, new KeyPairSigner(KeyPair.fromString(credentials.secret_key)));
}

export async function signerFor(name = 'deployer') { return accountFrom(await loadCredentials(name)); }
