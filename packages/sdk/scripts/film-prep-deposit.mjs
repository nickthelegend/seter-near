// Off-camera top-up before the v4 film: the repo's trader deposits 0.3 testnet NEAR into its own vault.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signerFor, root } from './signer.mjs';
import { call } from './tx.mjs';
const C = 'mienai-3013a230.testnet', trader = await signerFor('trader');
if (trader.accountId !== 'mienai-4e6b1225.testnet') throw new Error('Repo trader only.');
const r = await call(trader, C, 'deposit_near', {}, { deposit: 3n * 10n ** 23n, gas: 30_000_000_000_000n, step: 'film v4 prep: trader deposits 0.3 testnet NEAR into its vault (off camera)' });
await writeFile(resolve(root, 'deployments/film-v4-prep-2026-11-14.json'), JSON.stringify({ network: 'testnet', contract: C, steps: [r] }, null, 2) + '\n');
if (!r.ok) process.exitCode = 1;
