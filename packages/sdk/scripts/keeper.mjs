// One testnet check per invocation. Credentials come only from a named environment secret or an existing file.
import { mkdir, readFile, readdir, writeFile, rename, rmdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { baseEncode, actions } from 'near-api-js';
import { root, loadCredentials, accountFrom } from './signer.mjs';
import { CHECK_DEPOSIT, CHECK_GAS, amount, plan } from './keeper-policy.mjs';

const C = 'mienai-3013a230.testnet';
const RPCS = ['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org', 'https://rpc.testnet.near.org'];
const rpcUrl = process.env.NEAR_TESTNET_RPC || RPCS[0];
if (!RPCS.includes(rpcUrl)) throw new Error('Keeper refuses a non-testnet RPC.');
async function rpc(method, params, url = rpcUrl) {
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'seter-keeper', method, params }) });
  if (!response.ok) throw new Error(`Testnet RPC HTTP ${response.status}`);
  const json = await response.json();
  if (json.error) throw Object.assign(new Error('Testnet RPC has not confirmed this operation.'), { rejected: /InvalidNonce|Expired|InvalidSignature|NotEnoughBalance/.test(JSON.stringify(json.error)) });
  return json.result;
}
const view = async (method, args = {}) => {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: C, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (r.error) throw new Error(`Contract read failed: ${method}`);
  return JSON.parse(Buffer.from(r.result).toString());
};
const balance = (account) => rpc('query', { request_type: 'view_account', finality: 'final', account_id: account });
const dir = resolve(root, 'deployments/keeper');
await mkdir(dir, { recursive: true });
const lock = resolve(dir, '.lock');
try { await mkdir(lock); } catch { throw new Error('Keeper journal is locked; another run or an interrupted run needs review.'); }
const save = async (path, value) => { await writeFile(path + '.tmp', JSON.stringify(value, null, 2) + '\n'); await rename(path + '.tmp', path); };
let record, path, broadcastAttempted = false;
const reconciling = process.argv[2] === '--reconcile';
async function finalize(result) {
  const burn = [result.transaction_outcome, ...result.receipts_outcome].reduce((n, r) => n + BigInt(r.outcome.tokens_burnt || '0'), 0n);
  const gross = CHECK_DEPOSIT + burn;
  const after = await balance(record.account);
  const logs = result.receipts_outcome.flatMap((r) => r.outcome.logs);
  const event = logs.filter((s) => s.startsWith('EVENT_JSON:')).map((s) => JSON.parse(s.slice(11))).find((e) => e.event === 'enclave_request');
  const request = event ? await view('get_request', { id: event.data[0].request }) : null;
  const value = result.status.SuccessValue === undefined ? null : Buffer.from(result.status.SuccessValue, 'base64').toString();
  const checkOk = !result.status.Failure && request?.status === 'Done' && /^"fired \d+"$/.test(value || '');
  record = { ...record, status: 'final', finalized_at: new Date().toISOString(), transaction_ok: !result.status.Failure, ok: checkOk, request, return: value, failure: result.status.Failure || null, logs, receipt_failures: result.receipts_outcome.filter((r) => r.outcome.status.Failure).map((r) => ({ executor: r.outcome.executor_id, failure: r.outcome.status.Failure })), gas_burn_yocto: String(burn), charged_yocto: String(gross), overrun: gross > BigInt(record.reserved_yocto), balance_after: after.amount, wallet_debit_yocto: String(BigInt(record.balance_before) - BigInt(after.amount)), last_check: (await view('get_stats')).last_check };
  await save(path, record);
  if (gross > BigInt(record.reserved_yocto)) throw new Error('Actual charge exceeded its reservation; journal retained, stop further runs.');
  if (!record.ok) throw new Error(`Enclave check did not complete; inspect saved transaction ${record.tx}.`);
}
async function poll() {
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline) {
    for (const url of RPCS) {
      let result;
      try { result = await rpc('tx', { tx_hash: record.tx, sender_account_id: record.account, wait_until: 'FINAL' }, url); } catch { continue; }
      if (result.final_execution_status === 'FINAL') { await finalize(result); return; }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Finality not confirmed. The saved hash holds its full reservation; reconcile it before another paid check.');
}
try {
  if (process.argv[2] === '--reconcile') {
    const name = process.argv[3];
    if (!name || basename(name) !== name || !name.endsWith('.json')) throw new Error('Use --reconcile <journal-filename.json>.');
    path = resolve(dir, name); record = JSON.parse(await readFile(path, 'utf8'));
    if (record.network !== 'testnet' || record.contract !== C || !record.account.endsWith('.testnet') || !['pending', 'reserved'].includes(record.status) || !record.tx) throw new Error('Only an unresolved testnet journal can be reconciled.');
    await poll();
  } else {
    const cap = amount(process.env.KEEPER_DAILY_CAP_NEAR ?? '0.05');
    const reserve = amount(process.env.KEEPER_RESERVE_NEAR ?? '1');
    const runCap = amount(process.env.KEEPER_RUN_CAP_NEAR ?? '0.045');
    if (cap <= 0n || cap > amount('0.3') || runCap <= 0n || runCap > amount('0.05')) throw new Error('Daily cap must be >0 and <=0.3; per-run cap must be >0 and <=0.05 NEAR.');
    let credentials;
    if (process.env.SETER_KEEPER_KEY) credentials = { account_id: process.env.KEEPER_ACCOUNT_ID || C, secret_key: process.env.SETER_KEEPER_KEY };
    else {
      if (process.env.GITHUB_ACTIONS === 'true') throw new Error('SETER_KEEPER_KEY is absent; scheduled keeper stays disabled.');
      credentials = await loadCredentials('deployer'); // this account signed the recorded keeper checks
    }
    if (!/^[a-z0-9._-]+\.testnet$/.test(credentials.account_id)) throw new Error('Keeper accepts testnet accounts only.');
    let signer;
    try { signer = accountFrom(credentials); }
    catch { throw new Error('Keeper signing key could not be loaded; check its named secret or credential file.'); }
    finally { credentials.secret_key = ''; }
    const day = new Date().toISOString().slice(0, 10);
    const records = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.json')).map(async (f) => JSON.parse(await readFile(resolve(dir, f), 'utf8'))));
    if (records.some((r) => r.network !== 'testnet' || r.contract !== C || !r.day || !r.account || r.reserved_yocto === undefined)) throw new Error('Invalid keeper journal; restore the complete journal before spending.');
    const stats = await view('get_stats');
    if (!stats.open) throw new Error('No armed orders; no paid check needed.');
    const before = await balance(signer.accountId);
    const gas = BigInt((await rpc('gas_price', [null])).gas_price);
    const budget = plan({ records, account: signer.accountId, day, spendable: BigInt(before.amount) - BigInt(before.storage_usage) * 10n ** 19n, gasPrice: gas, reserve, dailyCap: cap, runCap });
    record = { schema: 1, network: 'testnet', contract: C, account: signer.accountId, day, at: new Date().toISOString(), status: 'reserved', balance_before: before.amount, reserve_yocto: String(reserve), daily_cap_yocto: String(cap), run_cap_yocto: String(runCap), prior_day_charge_yocto: String(budget.spent), reserved_yocto: String(budget.worst), deposit_yocto: String(CHECK_DEPOSIT) };
    path = resolve(dir, `${day}-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    await writeFile(path, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    const signed = await signer.createSignedTransaction({ receiverId: C, actions: [actions.functionCall('check', {}, CHECK_GAS, CHECK_DEPOSIT)] });
    record.tx = baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
    record.explorer = `https://testnet.nearblocks.io/txns/${record.tx}`;
    await save(path, record); // durable hash before the single broadcast
    // Re-check the account immediately before the write, preserving its reserve even if a concurrent operator spent funds.
    const fresh = await balance(signer.accountId);
    if (new Date().toISOString().slice(0, 10) !== day || BigInt(fresh.amount) - BigInt(fresh.storage_usage) * 10n ** 19n < reserve + budget.worst) {
      record.status = 'not_broadcast'; record.charged_yocto = '0'; await save(path, record); throw new Error('Reserve or UTC day changed before broadcast; no transaction sent.');
    }
    record.status = 'pending'; await save(path, record);
    console.log(`Keeper: one check from ${record.account}; journal ${basename(path)}; hash ${record.tx}`);
    broadcastAttempted = true;
    try { await rpc('send_tx', { signed_tx_base64: Buffer.from(signed.encode()).toString('base64'), wait_until: 'NONE' }); }
    catch (e) {
      if (e.rejected) { record.status = 'rejected'; record.charged_yocto = '0'; await save(path, record); throw new Error('Transaction rejected before acceptance; no second broadcast.'); }
      // A lost response never causes a second transaction: poll only the already-saved hash.
    }
    await poll();
  }
  console.log(`PASS ${record.explorer} | charged ${(Number(record.charged_yocto) / 1e24).toFixed(8)} NEAR (deposit + all burned gas)`);
} catch (error) {
  if (record && path && !reconciling && !broadcastAttempted && record.status === 'reserved') { record.status = 'not_broadcast'; record.charged_yocto = '0'; await save(path, record); }
  throw error;
} finally { await rmdir(lock); }
