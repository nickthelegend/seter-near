// Deploys tUSD and the Seter vault on testnet, pins the uploaded enclave, asks the enclave for its
// keys (a real OutLayer run) and seeds the test pool at the live Coinbase price.
// Prereqs: .near-credentials/{deployer,token}.json (create-account.mjs), deployments/enclave-fastfs.json (upload-enclave.mjs),
// both contracts built (pnpm build:contract).
import { actions } from 'near-api-js';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { signerFor, root } from './signer.mjs';
import { call, record } from './tx.mjs';
import { view, viewAccount, PRICE_SOURCE } from '../src/index.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const deployer = await signerFor('deployer');
const tokenAcct = await signerFor('token');
const enclave = JSON.parse(await readFile(resolve(root, 'deployments/enclave-fastfs.json'), 'utf8'));
const localEnclave = sha(await readFile(resolve(root, 'packages/enclave/target/wasm32-wasip2/release/mienai-enclave.wasm')));
if (localEnclave !== enclave.sha256) throw new Error(`uploaded enclave ${enclave.sha256} differs from the local build ${localEnclave}`);
const mienaiWasm = await readFile(resolve(root, 'packages/contract/target/near/mienai.wasm'));
const tokenWasm = await readFile(resolve(root, 'packages/token/target/near/mienai_tusd.wasm'));
for (const id of [deployer.accountId, tokenAcct.accountId]) {
  const a = await viewAccount(id);
  if (a.code_hash !== '11111111111111111111111111111111') throw new Error(`${id} already has a contract; use fresh accounts`);
}
const steps = [];
const must = (s) => { steps.push(s); if (!s.ok) throw new Error(`${s.step} failed`); return s; };
const deploy = async (account, wasm, step) => must(record(account, await account.signAndSendTransaction({ receiverId: account.accountId, actions: [actions.deployContract(wasm)], waitUntil: 'FINAL', throwOnFailure: false }), { step }));

await deploy(tokenAcct, tokenWasm, 'deploy tUSD (test NEP-141)');
must(await call(tokenAcct, tokenAcct.accountId, 'new', { owner_id: tokenAcct.accountId }, { step: 'init tUSD' }));
await deploy(deployer, mienaiWasm, 'deploy Seter vault');
must(await call(deployer, deployer.accountId, 'new', { owner_id: deployer.accountId, token_id: tokenAcct.accountId, outlayer_id: 'outlayer.testnet', enclave_url: enclave.url, enclave_hash: enclave.sha256 }, { step: 'init Seter with the pinned enclave' }));
must(await call(deployer, deployer.accountId, 'refresh_keys', {}, { deposit: 20n * 10n ** 21n, gas: 300_000_000_000_000n, step: 'enclave keys (OutLayer TEE run)' }));
const config = await view(deployer.accountId, 'get_config');
if (!config.tee) throw new Error(`enclave keys not set: ${JSON.stringify(await view(deployer.accountId, 'get_request', { id: 1 }))}`);

// Seed the pool at the live price: 3 NEAR and 3 x price tUSD.
const ticker = await (await fetch(PRICE_SOURCE, { headers: { 'user-agent': 'mienai-deploy/0.1' } })).json();
const priceE6 = Math.round(Number(ticker.price) * 1e6);
const usd = String(3 * priceE6);
must(await call(deployer, deployer.accountId, 'seed_pool_near', {}, { deposit: 3n * 10n ** 24n, step: 'seed pool: 3 NEAR' }));
must(await call(tokenAcct, tokenAcct.accountId, 'mint', { account_id: tokenAcct.accountId, amount: usd }, { step: 'mint pool tUSD to the issuer' }));
must(await call(tokenAcct, tokenAcct.accountId, 'mint', { account_id: deployer.accountId, amount: '0' }, { step: 'register vault on tUSD' }));
must(await call(tokenAcct, tokenAcct.accountId, 'ft_transfer_call', { receiver_id: deployer.accountId, amount: usd, msg: 'seed' }, { deposit: 1n, gas: 100_000_000_000_000n, step: `seed pool: ${Number(usd) / 1e6} tUSD at Coinbase ${ticker.price}` }));

const out = { network: 'testnet', contract_id: deployer.accountId, token_id: tokenAcct.accountId, outlayer: 'outlayer.testnet', enclave: { url: enclave.url, sha256: enclave.sha256, upload_tx: enclave.tx }, contract_sha256: sha(mienaiWasm), token_sha256: sha(tokenWasm), tee: config.tee, pool_seed_price: { source: PRICE_SOURCE, price: ticker.price, trade_id: ticker.trade_id, time: ticker.time }, steps };
const path = resolve(root, `deployments/testnet-${new Date().toISOString().slice(0, 10)}.json`);
await writeFile(path, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${path}`);
