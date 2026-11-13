// Live testnet run of the two-source fire with the scoped keeper key:
//  1. the trader seals a small stop 2% above market (so the next check crosses it; trigger stays sealed),
//  2. the function-call keeper key (only `check`, no deposit) pays for a check from the keeper budget,
//  3. the enclave reports the crossing, price-oracle.testnet is asked, and the fire executes only
//     because the two prices agree; the Intel TDX attestation of the enclave run is verified,
//  4. the same keeper key is refused by the protocol for withdraw_near and for an attached deposit.
// Keys come from gitignored files and are never printed. Testnet only.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { actions, baseEncode } from 'near-api-js';
import { signerFor, accountFrom, loadCredentials, root, provider } from './signer.mjs';
import { call, record } from './tx.mjs';
import { outlayerIo } from './receipts.mjs';
import { verifyExecution } from '../src/attestation.mjs';
import { rpc, view, viewAccount, PRICE_SOURCE, orderPlaintext, sealToEnclave, commitment } from '../src/index.mjs';

const C = 'mienai-3013a230.testnet';
const out = resolve(root, `deployments/second-source/two-source-fire-${new Date().toISOString().slice(0, 10)}.json`);
// A run whose check was refused before broadcast (e.g. key allowance) resumes from its sealed order.
const prior = existsSync(out) ? JSON.parse(await readFile(out, 'utf8')) : null;
if (prior && (prior.steps.length !== 1 || prior.order_id === undefined)) throw new Error(`${out} is complete; refusing a second run.`);
const trader = await signerFor('trader');
const keeperCreds = await loadCredentials('keeper-fc');
const keeper = accountFrom(keeperCreds);
keeperCreds.secret_key = '';
if (keeper.accountId !== C || !trader.accountId.endsWith('.testnet')) throw new Error('Testnet accounts required.');
const config = await view(C, 'get_config');
if (!config.second_source?.enabled) throw new Error('Second source is off; nothing to prove.');
const run = prior ? { ...prior, keeper_key: keeperCreds.public_key, resumed_at: new Date().toISOString() } : { network: 'testnet', contract: C, trader: trader.accountId, keeper_key: keeperCreds.public_key, at: new Date().toISOString(), steps: [] };
const save = () => writeFile(out, JSON.stringify(run, null, 2) + '\n');

// 1. Seal a stop 2% above the Coinbase price.
const orderId = prior ? prior.order_id : await seal();
async function seal() {
const tick = await (await fetch(PRICE_SOURCE)).json();
const triggerUsd = (Number(tick.price) * 1.02).toFixed(6);
const plaintext = orderPlaintext({ cond: 'lte', triggerUsd, side: 'sell', amount: '50000000000000000000000' });
const place = await call(trader, C, 'place_order', { ct: sealToEnclave(config.tee.order_pub, trader.accountId, plaintext), commit: commitment(trader.accountId, plaintext), view_ct: null }, { deposit: 20n * 10n ** 21n, gas: 50_000_000_000_000n, step: `trader seals a stop (sell 0.05 NEAR) 2% above Coinbase ${tick.price}; trigger hidden on chain` });
if (!place.ok) throw new Error('Placement failed.');
const id = JSON.parse(place.return);
run.order_id = id; run.placement_quote = { price: tick.price, trade_id: tick.trade_id, time: tick.time };
run.steps.push(place); await save();
return id;
}

// 2. Keeper check signed by the function-call key, no deposit.
const budgetBefore = (await view(C, 'get_second_source')).keeper_budget;
const keeperBefore = await viewAccount(C);
const chk = await call(keeper, C, 'check', {}, { deposit: 0n, gas: 300_000_000_000_000n, step: 'keeper check signed by the function-call key (check only, no deposit; paid from the keeper budget)' });
run.steps.push({ ...chk, keeper_budget_before: budgetBefore, keeper_budget_after: (await view(C, 'get_second_source')).keeper_budget, vault_balance_before: keeperBefore.amount });
await save();
if (!chk.ok) throw new Error(`Check failed: ${JSON.stringify(chk.failure).slice(0, 300)}`);

// 3. Read back the fire and both prices; verify the enclave's TDX attestation.
const order = await view(C, 'get_order', { id: orderId });
run.fire = order.fire; run.status = order.status;
run.second_source = await view(C, 'get_fire_second_source', { id: orderId });
run.request = order.fire ? await view(C, 'get_request', { id: order.fire.request }) : null;
try {
  const io = await outlayerIo(chk.tx, C);
  run.attestation = await verifyExecution({ txHash: chk.tx, input: io.input, output: io.output, wasmHash: config.enclave_hash, requestId: io.requestId });
} catch (e) { run.attestation = { ok: false, error: String(e.message || e).slice(0, 300) }; }
await save();
console.log(`order #${orderId}: ${order.status}; enclave ${order.fire?.price_e6} vs oracle ${run.second_source?.oracle_price_e6} (${run.second_source?.diff_bps} bps); attestation ${run.attestation.ok}`);

// 4. The keeper key is refused for anything but a zero-deposit check (invalid transactions; never included).
async function refused(step, receiverId, action) {
  const signed = await keeper.createSignedTransaction({ receiverId, actions: [action] });
  const hash = baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
  let error;
  try { await provider.sendTransaction(signed); error = 'ACCEPTED (unexpected)'; }
  catch (e) { error = String(e?.message || e).slice(0, 400); }
  const r = { step, signed_hash_never_included: hash, rpc_error: error, refused: !error.startsWith('ACCEPTED') };
  console.log(`${r.refused ? 'refused' : 'ACCEPTED'}: ${step}: ${error.slice(0, 120)}`);
  run.steps.push(r); await save();
}
await refused('keeper key tries withdraw_near on the vault', C, actions.functionCall('withdraw_near', { amount: '1' }, 30_000_000_000_000n, 0n));
await refused('keeper key tries check with 0.02 NEAR attached', C, actions.functionCall('check', {}, 300_000_000_000_000n, 2n * 10n ** 22n));
await refused('keeper key tries a call on another contract (tUSD faucet)', config.token, actions.functionCall('faucet', {}, 30_000_000_000_000n, 0n));
run.keys = (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: C })).keys;
await save();
console.log('wrote', out);
