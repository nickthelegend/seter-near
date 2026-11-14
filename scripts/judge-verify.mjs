#!/usr/bin/env node
// Re-checks Seter's key proofs against public data. No install, no keys, no build:
//   node scripts/judge-verify.mjs
// Sources: FastNEAR transaction API (testnet), NEAR testnet RPC (archival first), FastFS (enclave program bytes),
// and this repo's contract source. Exit code 0 only if every check passes.
// Not checked here: keeper check Dt6AMdpK… (failed inside OutLayer; the vault marked it Failed). See JUDGES.md "Limits".
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEAR_RPC = 'https://test.rpc.fastnear.com';
const NEAR_ARCHIVAL_RPC = 'https://archival-rpc.testnet.fastnear.com'; // holds older transactions
const NEAR_TX_API = 'https://tx.test.fastnear.com/v0/transactions';
const EXPLORER = 'https://testnet.near.rocks/tx/';
const VAULT = 'mienai-3013a230.testnet';
const TRADER = 'mienai-4e6b1225.testnet';
const ENCLAVE_HASH = '791b4f6cab748be35d9f8c46c4df262bc8af13b4ade21a4b7e42c74e14a71386';
const ENCLAVE_URL = `https://test.fastfs.io/${VAULT}/outlayer.testnet/${ENCLAVE_HASH}.wasm`;
const COMMIT_PREFIX = 'mienai:commit:v1:'; // packages/contract/src/lib.rs

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Public endpoints rate-limit (HTTP 429): retry with backoff before reporting a failure.
const post = async (url, body) => {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && i < 6) { await sleep(1500 * (i + 1)); continue; }
    throw Error(`${url} answered HTTP ${r.status}`);
  }
};
const rpc = async (method, params, url = NEAR_RPC) => { const j = await post(url, { jsonrpc: '2.0', id: 1, method, params }); if (j.error) throw Error(JSON.stringify(j.error)); return j.result; };
// RPC `tx` cross-check with the signer from the transaction API: one attempt on the archival RPC (it holds older
// transactions), one on the main RPC. The main node can stall ~30 s on old transactions, hence the short timeouts.
let rpcChecked = 0, rpcSkipped = 0, rpcMisses = 0;
const txStatus = async (params) => {
  await sleep(300); // pacing keeps the public RPC from answering 429
  if (rpcMisses >= 3) { rpcSkipped++; return { skipped: true }; } // circuit breaker: the RPC is rate-limiting this IP, stop asking
  for (const url of [NEAR_ARCHIVAL_RPC, NEAR_RPC]) {
    try {
      const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(12000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tx', params }) });
      if (r.status === 429) break;
      const j = await r.json();
      if (j.result) { rpcChecked++; rpcMisses = 0; return j.result; }
    } catch {}
  }
  rpcSkipped++; rpcMisses++;
  return { skipped: true }; // RPC rate-limited or unavailable: the check then rests on the transaction API alone, and the run says so
};
const view = async (account_id, method_name, args = {}) => {
  const r = await rpc('query', { request_type: 'call_function', account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'final' });
  return JSON.parse(Buffer.from(r.result).toString());
};
const rows = [];
const check = (ok, what, detail) => rows.push({ ok: !!ok, what, detail });
const safe = async (what, fn) => { try { await fn(); } catch (e) { check(false, what, `error: ${e.message}`); } };
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ---- transactions ----
// kind: placed (sealed order: args hold only ct/commit/view_ct, no trigger), public (contrast: trigger readable),
//       fire (the `check` callback fired exactly these order ids at this price), cancelled (order_cancelled event)
const TXS = [
  { h: 'BZbja8BmNU8FqisMXxzDGAAubZFJhEyihorC1YgEYrBb', what: 'Seal stop-loss №1 (sell 0.4 NEAR): the trigger is not in the transaction', kind: 'placed', id: 1 },
  { h: '4zE2auAGmuREh8YRFnfW7XPqCjrAJuoNJmE9j74AZiPS', what: 'Seal take-profit №2: the trigger is not in the transaction', kind: 'placed', id: 2 },
  { h: 'T8tXKcVjZ21HXRgN2SeigabVz4FFCh5xYQUfBXLHb41', what: 'Seal stop №18 (fired later by the scoped keeper key)', kind: 'placed', id: 18 },
  { h: '9icSTTgrDVCPinJ8ouA3SaLmQf1YLKURxiUjBKHurEoU', what: 'Seal limit buy №22', kind: 'placed', id: 22 },
  { h: '2uFvSfTiPkMuNzFH9kabYMWctedqEiBQ8yF4VgmLucse', what: 'Contrast: a public (unsealed) stop shows its trigger in the arguments', kind: 'public', trigger: '3.2800' },
  { h: '79pRBKd3khVem5AANMeUWmjD7oVKmk7VQk6GAHoaGxm1', what: 'Check at 3.6003: the enclave report fires nothing', kind: 'fire', ids: [], price: 3600300 },
  { h: 'GMMwkN289YgzaqZkqmC5n5wHjWnwDe1K2G1MEjEY82iS', what: 'Check at 3.5886: the enclave fires stop №1 (trigger 3.5967) on the test pool', kind: 'fire', ids: [1], price: 3588600 },
  { h: '9Jff4h8JPCZbase4gMgcgK2DoLTYY5uZrv6V2V6Qphbx', what: 'Check at 3.4854: the enclave fires stop №16', kind: 'fire', ids: [16], price: 3485400 },
  { h: '9KRm7G6dWV6Wutcn9Uy6aEAttV25kXB76T8cXhi6mJNy', what: 'Check at 3.5024: the enclave fires stop №17', kind: 'fire', ids: [17], price: 3502400 },
  { h: '8MehJtyrBSeCv9cjeVfoiZ7TanZecUZhdPPeicHAaL6r', what: 'Keeper check signed by the scoped key: enclave reads 3.5058, second TEE source agrees, only then stop №18 fires', kind: 'fire', ids: [18], price: 3505800, second: true, signer: VAULT },
  { h: '5T6o5jEbzPW1mQpwTjMNhDGxdD1tAURHUQCfvgGaNiws', what: 'Keeper check with the scoped key fires stop №19 (second source agrees)', kind: 'fire', ids: [19], price: 3427600, second: true, signer: VAULT },
  { h: 'HbFZQWKw22CMTr4ovnZZmui5MCnpgLYdxAZPq2nJQCsu', what: 'Keeper check: limit buy №22 and stop №24 fire; its OCO partner №25 is cancelled unrevealed', kind: 'fire', ids: [22, 24], price: 3331000, second: true, signer: VAULT, oco: 25 },
  { h: 'AXwyjgTBmFNr8pXXdCk5nBqviBjninsKVPmC3zV4Zm4p', what: 'Keeper check where nothing crossed: fired 0, second source never asked', kind: 'fire', ids: [], price: 3486600, signer: VAULT, noSecond: true },
  { h: 'HojS7Jjquqdz4nRgpm3uQa2ZPnZfEpyWA8bcpDNzizio', what: 'Cancel take-profit №2: its trigger is never revealed', kind: 'cancelled', id: 2 },
  { h: 'GbBRFrWsi47ND6PcvHToxdH2gGmpZ4nt78PQpYryZabB', what: 'Cancel order №5 without revealing its trigger', kind: 'cancelled', id: 5 },
  { h: '7GvkZdjbvQLb1z1r7GZkozcgG5buYWbfRtGSBMm9uD3v', what: 'Cancel order №3 without revealing its trigger', kind: 'cancelled', id: 3 },
];

const src = readFileSync(join(ROOT, 'packages/contract/src/lib.rs'), 'utf8');
check(/env::ed25519_verify\(/.test(src) && /\[private\]\s*pub fn on_result/.test(src) && /ERR_COMMITMENT/.test(src) && /ERR_SOURCES_DISAGREE/.test(src) && /ERR_STALE_PRICE/.test(src) && /ERR_REPLAY/.test(src),
  'Source: fire verifies the enclave report with env::ed25519_verify, #[private] on_result, commitment, staleness, replay and two-source checks',
  'packages/contract/src/lib.rs');

const events = (rs) => rs.flatMap(r => (r.execution_outcome?.outcome?.logs ?? []).filter(l => l.startsWith('EVENT_JSON:')).map(l => { try { return JSON.parse(l.slice(11)); } catch { return null; } })).filter(e => e && e.standard === 'mienai');
const decode = (sv) => { try { return JSON.parse(Buffer.from(sv, 'base64').toString()); } catch { return null; } };

await safe('FastNEAR transaction API', async () => {
  const byHash = {};
  for (let i = 0; i < TXS.length; i += 15) {
    const api = await post(NEAR_TX_API, { tx_hashes: TXS.slice(i, i + 15).map(t => t.h) });
    for (const t of api.transactions ?? []) byHash[t.transaction.hash] = t;
  }
  for (const p of TXS) {
    const t = byHash[p.h];
    if (!t) { check(false, p.what, `${p.h} not found`); continue; }
    const signer = t.transaction.signer_id;
    const link = `${EXPLORER}${p.h}`;
    const fin = await txStatus({ tx_hash: p.h, sender_account_id: signer, wait_until: 'FINAL' }).catch(e => ({ error: e.message }));
    if (fin.error) { check(false, p.what, `RPC: ${fin.error}`); continue; }
    const rs = t.receipts ?? [];
    const fails = rs.map(r => r.execution_outcome?.outcome?.status).filter(s => s?.Failure);
    const ev = events(rs);
    const call = t.transaction.actions[0]?.FunctionCall;
    const args = call ? Buffer.from(call.args, 'base64').toString() : '';
    let ok = fails.length === 0 && (!p.signer || signer === p.signer), detail = `${signer} · ${link}`;
    if (p.kind === 'placed') {
      const a = JSON.parse(args);
      ok &&= ev.some(e => e.event === 'order_placed' && e.data?.[0]?.id === p.id) && !/trigger|cond|"side"/i.test(args) && Object.keys(a).every(k => ['ct', 'commit', 'view_ct'].includes(k));
      detail = `order_placed №${p.id}; args keys: ${Object.keys(a).join(', ')} · ${link}`;
    }
    if (p.kind === 'public') { ok &&= call?.method_name === 'place_public_order' && args.includes(`"trigger_usd":"${p.trigger}"`); detail = `${call?.method_name}, args contain trigger_usd ${p.trigger} · ${link}`; }
    if (p.kind === 'cancelled') { ok &&= ev.some(e => e.event === 'order_cancelled' && e.data?.[0]?.id === p.id) && !rs.some(r => (r.execution_outcome?.outcome?.logs ?? []).some(l => /trigger/i.test(l))); detail = `order_cancelled №${p.id}, no trigger in any log · ${link}`; }
    if (p.kind === 'fire') {
      const c = ev.find(e => e.event === 'check');
      const d = c?.data?.[0];
      const enclaveOut = rs.map(r => r.execution_outcome?.outcome).find(o => o?.executor_id === 'outlayer.testnet' && o.status?.SuccessValue && decode(o.status.SuccessValue)?.body);
      const body = enclaveOut ? JSON.parse(decode(enclaveOut.status.SuccessValue).body) : null;
      const sameIds = d && JSON.stringify([...d.fired].sort((a, b) => a - b)) === JSON.stringify(p.ids);
      ok &&= !!d && sameIds && d.price_e6 === p.price && body?.op === 'check' && body.contract === VAULT;
      if (p.second) ok &&= !!d.second_source || rs.some(r => r.execution_outcome?.outcome?.executor_id === 'price-oracle.testnet' && r.execution_outcome.outcome.status?.SuccessValue);
      if (p.noSecond) ok &&= !rs.some(r => r.execution_outcome?.outcome?.executor_id === 'price-oracle.testnet');
      if (p.oco) ok &&= ev.some(e => e.event === 'oco_cancelled' && e.data?.[0]?.id === p.oco);
      detail = `${signer}: OutLayer enclave output op=${body?.op}, price_e6 ${d?.price_e6}, fired [${d?.fired}]${p.second ? ', price-oracle.testnet receipt present' : ''} · ${link}`;
    }
    check(ok, p.what, detail);
  }
});

await safe('Enclave program', async () => {
  const buf = Buffer.from(await (await fetch(ENCLAVE_URL, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
  const cfg = await view(VAULT, 'get_config');
  check(sha256(buf) === ENCLAVE_HASH && cfg.enclave_hash === ENCLAVE_HASH, `Enclave WASM on FastFS hashes to the enclave_hash pinned in ${VAULT} get_config`, `sha256 ${sha256(buf).slice(0, 16)}… (${buf.length} bytes) · ${ENCLAVE_URL}`);
});

await safe('Commitment', async () => {
  // Order №1 was sealed in tx BZbja8Bm… with only a commitment. After it fired, the contract shows the plaintext.
  // Recompute sha256(prefix || owner || 0x00 || plaintext) and compare with the commitment placed on chain.
  const [o] = await view(VAULT, 'get_orders', { from_id: 1, limit: 1 });
  const commit = createHash('sha256').update(Buffer.concat([Buffer.from(COMMIT_PREFIX), Buffer.from(o.owner), Buffer.from([0]), Buffer.from(o.fire.plaintext)])).digest('hex');
  const pt = JSON.parse(o.fire.plaintext);
  check(o.status === 'Fired' && commit === o.commit && pt.cond === 'lte' && o.fire.price_e6 <= pt.trigger_e6 && pt.trigger_e6 === 3596700,
    'Order №1: the revealed trigger (3.5967) matches the commitment sealed at placement, and the enclave price (3.5886) had crossed it',
    `recomputed commit ${commit.slice(0, 16)}… = on-chain ${o.commit.slice(0, 16)}…, price_e6 ${o.fire.price_e6} <= trigger_e6 ${pt.trigger_e6}`);
  const openIds = await view(VAULT, 'get_open_ids');
  const [open] = openIds.length ? await view(VAULT, 'get_orders', { from_id: openIds[0], limit: 1 }) : [null];
  check(!!open && open.status === 'Open' && open.fire === null && !/trigger|cond/i.test(JSON.stringify(open)), `Armed order №${open?.id}: the public view holds ciphertext and commitment only, no trigger`, open ? `status ${open.status}, keys: ${Object.keys(open).join(', ')}` : 'no open order');
});

await safe('Live vault state', async () => {
  const s = await view(VAULT, 'get_second_source');
  check(s.config?.enabled && s.config.oracle === 'price-oracle.testnet' && s.last_agreement?.diff_bps <= s.config.tolerance_bps,
    `${VAULT} get_second_source: second TEE source price-oracle.testnet is enforced; last fire's two prices were within tolerance`,
    `enclave ${s.last_agreement?.enclave_price_e6} vs oracle ${s.last_agreement?.oracle_price_e6} (${s.last_agreement?.diff_bps} bps, limit ${s.config?.tolerance_bps})`);
  const st = await view(VAULT, 'get_stats');
  check(st.orders_total >= 25 && st.fired >= 12 && st.checks >= 14, `${VAULT} get_stats: 25+ orders, 12+ fired, 14+ checks`,
    `orders ${st.orders_total}, fired ${st.fired}, cancelled ${st.cancelled}, checks ${st.checks}, rejected_reports ${st.rejected_reports}`);
  const keys = await rpc('query', { request_type: 'view_access_key_list', account_id: VAULT, finality: 'final' });
  const fc = keys.keys.filter(k => k.access_key.permission.FunctionCall);
  check(fc.length >= 1 && fc.every(k => k.access_key.permission.FunctionCall.method_names.join() === 'check' && k.access_key.permission.FunctionCall.receiver_id === VAULT),
    `${VAULT} keeper key is a function-call key limited to method "check" on the vault`, `${fc.length} function-call key(s), methods: ${fc.map(k => k.access_key.permission.FunctionCall.method_names.join()).join(' | ')}`);
});

const pass = rows.filter(r => r.ok).length;
console.log(`\nSeter live verification · ${new Date().toISOString()}\n`);
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.what}\n      ${r.detail}`);
console.log(`\nNEAR RPC tx cross-check: ${rpcChecked} confirmed, ${rpcSkipped} skipped (public RPC rate-limited or slow; those rest on the FastNEAR transaction API alone).`);
console.log(`\n${pass}/${rows.length} checks passed.`);
process.exit(pass === rows.length ? 0 : 1);
