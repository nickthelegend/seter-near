// Upgrades the live Seter vault in place (same account, same state) to the two-source build, funds
// the keeper budget and adds a function-call key limited to `check`. Testnet only. Keys are loaded
// from gitignored files and never printed; the new keeper key is written to
// .near-credentials/keeper-fc.json (mode 600) before the AddKey transaction is sent.
// Usage: node packages/sdk/scripts/upgrade-second-source.mjs deploy|fund|key|rekey
// rekey replaces only the keeper key this script added (0.25 NEAR was below the 0.30 NEAR the
// protocol reserves up front for a 300 Tgas call) with one allowed 2 NEAR. Other keys are untouched.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { actions, KeyPair } from 'near-api-js';
import { signerFor, root } from './signer.mjs';
import { call, record } from './tx.mjs';
import { view, rpc } from '../src/index.mjs';

const C = 'mienai-3013a230.testnet';
const step = process.argv[2];
if (!['deploy', 'fund', 'key', 'rekey'].includes(step)) throw new Error('Use deploy, fund, key or rekey.');
const out = resolve(root, 'deployments/second-source/upgrade-2026-11-14.json');
const log = existsSync(out) ? JSON.parse(await readFile(out, 'utf8')) : { network: 'testnet', contract: C, steps: [] };
const save = () => writeFile(out, JSON.stringify(log, null, 2) + '\n');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const deployer = await signerFor('deployer');
if (deployer.accountId !== C) throw new Error('Deployer credentials must be the vault account.');
const keyList = async () => (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: C })).keys.map((k) => ({ public_key: k.public_key, permission: k.access_key.permission }));

if (step === 'deploy') {
  const wasm = await readFile(resolve(root, 'packages/contract/target/near/mienai.wasm'));
  const before = { code_hash: (await rpc('query', { request_type: 'view_account', finality: 'final', account_id: C })).code_hash, stats: await view(C, 'get_stats'), config: await view(C, 'get_config') };
  // Keep the running code locally so the upgrade can be rolled back (gitignored .demo/).
  const code = await rpc('query', { request_type: 'view_code', finality: 'final', account_id: C });
  await mkdir(resolve(root, '.demo'), { recursive: true });
  await writeFile(resolve(root, `.demo/mienai-before-${before.code_hash}.wasm`), Buffer.from(code.code_base64, 'base64'));
  const result = await deployer.signAndSendTransaction({ receiverId: C, actions: [actions.deployContract(wasm)], waitUntil: 'FINAL', throwOnFailure: false });
  const r = record(deployer, result, { step: 'upgrade the vault in place to the two-source build', receiverId: C, method: 'DeployContract' });
  if (!r.ok) throw new Error('Deploy failed; nothing else sent.');
  const after = { code_hash: (await rpc('query', { request_type: 'view_account', finality: 'final', account_id: C })).code_hash, stats: await view(C, 'get_stats'), second_source: await view(C, 'get_second_source') };
  for (const k of ['orders_total', 'open', 'fired', 'cancelled', 'checks', 'requests_total']) if (after.stats[k] !== before.stats[k]) throw new Error(`State changed across the upgrade: ${k}`);
  log.steps.push({ ...r, wasm_sha256: sha(wasm), code_hash_before: before.code_hash, code_hash_after: after.code_hash, state_preserved: true, stats_after: after.stats, second_source: after.second_source });
  await save();
  console.log(JSON.stringify(after.second_source));
} else if (step === 'fund') {
  const r = await call(deployer, C, 'fund_keeper', {}, { deposit: 2n * 10n ** 23n, gas: 30_000_000_000_000n, step: 'fund the keeper budget with 0.2 NEAR' });
  if (!r.ok) throw new Error('Funding failed.');
  log.steps.push({ ...r, second_source: await view(C, 'get_second_source') });
  await save();
} else if (step === 'rekey') {
  const path = resolve(root, '.near-credentials/keeper-fc.json');
  const old = JSON.parse(await readFile(path, 'utf8'));
  const before = await keyList();
  const mine = before.find((k) => k.public_key === old.public_key);
  if (!mine || mine.permission === 'FullAccess' || JSON.stringify(mine.permission.FunctionCall.method_names) !== '["check"]') throw new Error('The recorded keeper key is not a check-only key on the vault; refusing.');
  const kp = KeyPair.fromRandom('ed25519');
  const publicKey = kp.getPublicKey().toString();
  await writeFile(path + '.new', JSON.stringify({ account_id: C, public_key: publicKey, secret_key: kp.toString(), permission: { receiver_id: C, method_names: ['check'], allowance_near: '2' } }) + '\n', { mode: 0o600, flag: 'wx' });
  const result = await deployer.signAndSendTransaction({ receiverId: C, actions: [actions.deleteKey(KeyPair.fromString(old.secret_key).getPublicKey()), actions.addFunctionCallAccessKey(kp.getPublicKey(), C, ['check'], 2n * 10n ** 24n)], waitUntil: 'FINAL', throwOnFailure: false });
  old.secret_key = '';
  const r = record(deployer, result, { step: 'replace the 0.25 NEAR keeper key with a check-only key allowed 2 NEAR of gas', receiverId: C, method: 'DeleteKey+AddKey' });
  if (!r.ok) throw new Error('Rekey failed; the old key file is unchanged.');
  await writeFile(path, await readFile(path + '.new', 'utf8'), { mode: 0o600 });
  const { unlink } = await import('node:fs/promises'); await unlink(path + '.new');
  const after = await keyList();
  log.steps.push({ ...r, removed_key: old.public_key, keeper_public_key: publicKey, keys_before: before, keys_after: after, note: 'Only the keeper key added by this script was removed; the full-access key was kept.' });
  await save();
  console.log(JSON.stringify(after.map((k) => [k.public_key.slice(0, 16), k.permission])));
} else {
  const path = resolve(root, '.near-credentials/keeper-fc.json');
  if (existsSync(path)) throw new Error('keeper-fc.json already exists; refusing to make a second key.');
  const kp = KeyPair.fromRandom('ed25519');
  const publicKey = kp.getPublicKey().toString();
  await writeFile(path, JSON.stringify({ account_id: C, public_key: publicKey, secret_key: kp.toString(), permission: { receiver_id: C, method_names: ['check'], allowance_near: '0.25' } }) + '\n', { mode: 0o600 });
  const before = await keyList();
  const result = await deployer.signAndSendTransaction({ receiverId: C, actions: [actions.addFunctionCallAccessKey(kp.getPublicKey(), C, ['check'], 25n * 10n ** 22n)], waitUntil: 'FINAL', throwOnFailure: false });
  const r = record(deployer, result, { step: 'add a function-call key limited to check (0.25 NEAR gas allowance)', receiverId: C, method: 'AddKey' });
  if (!r.ok) throw new Error('AddKey failed.');
  const after = await keyList();
  log.steps.push({ ...r, keeper_public_key: publicKey, keys_before: before, keys_after: after, note: 'The full-access key was kept (deleting it is Nick\'s call).' });
  await save();
  console.log(JSON.stringify(after, null, 1));
}
