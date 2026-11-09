//! Mienai (見えない, "invisible"): stop-loss and take-profit orders nobody can hunt.
//!
//! A user deposits NEAR or tUSD and places an order as a ciphertext sealed to the enclave's
//! X25519 key, plus a commitment hash. The contract never sees a trigger. `check()` asks
//! OutLayer to run the pinned enclave WASM inside Intel TDX on the open ciphertexts; the
//! enclave reads NEAR/USD from Coinbase and reports only the orders whose trigger was crossed,
//! with their plaintext. The contract accepts a report only if
//!   1. it arrives as the promise result of its own `request_execution` (the `#[private]`
//!      `on_result` callback), or through `fire` from any relayer, and in both cases
//!   2. it is signed by the enclave's ed25519 key (learned from an attested `keys` run),
//!   3. it answers a request this contract issued and has not consumed (no replay),
//!   4. its price is fresh and from the pinned source,
//!   5. each revealed plaintext matches the order's commitment and its trigger really is crossed.
//! A fired order is swapped against the contract's NEAR/tUSD constant-product test pool and its
//! trigger, price, source and block are kept public for audit.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableSet, LazyOption, LookupMap, Vector};
use near_sdk::{env, ext_contract, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};
use sha2::{Digest, Sha256};

pub const PRICE_SOURCE: &str = "https://api.exchange.coinbase.com/products/NEAR-USD/ticker";
pub const REPORT_PREFIX: &[u8] = b"mienai:report:v1:";
const COMMIT_PREFIX: &[u8] = b"mienai:commit:v1:";
/// A report's price must be at most this old at the block that applies it.
pub const MAX_PRICE_AGE_NS: u64 = 180_000_000_000;
/// ... and at most this much older than the request it answers.
pub const PRICE_BEFORE_REQUEST_NS: u64 = 120_000_000_000;
const PRICE_FUTURE_SLACK_NS: u64 = 60_000_000_000;
/// A request a relayer may still answer through `fire` after its callback failed.
pub const REQUEST_TTL_NS: u64 = 900_000_000_000;
pub const MAX_OPEN: u32 = 16;
pub const ORDER_DEPOSIT: NearToken = NearToken::from_millinear(20);
pub const FEE_BPS: u128 = 30;
const MAX_CT_LEN: usize = 640;
const GAS_OUTLAYER: Gas = Gas::from_tgas(100);
const GAS_CALLBACK: Gas = Gas::from_tgas(80);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum OrderStatus { Open, Fired, Unfilled, Cancelled }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum RequestKind { Keys, Check, Bands }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum RequestStatus { Pending, Done, Failed, Rejected }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct FireRecord {
    pub request: u64,
    pub path: String,
    pub plaintext: String,
    pub cond: String,
    pub trigger_e6: u64,
    pub side: String,
    pub amount: U128,
    pub price_e6: u64,
    pub price_ts_ms: u64,
    pub trade_id: u64,
    pub source: String,
    pub block_height: U64,
    pub block_ts: U64,
    pub filled_in: U128,
    pub filled_out: U128,
    pub note: String,
    pub report_sha256: String,
    pub outlayer_request: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Order {
    pub id: u64,
    pub owner: AccountId,
    pub ct: String,
    pub commit: String,
    pub view_ct: Option<String>,
    pub created_ns: U64,
    pub status: OrderStatus,
    pub fire: Option<FireRecord>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Request {
    pub id: u64,
    pub kind: RequestKind,
    pub caller: AccountId,
    pub created_ns: U64,
    pub order_ids: Vec<u64>,
    pub status: RequestStatus,
    pub note: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TeeKeys {
    pub order_pub: String,
    pub attest_pub: String,
    pub request: u64,
    pub set_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Balance { pub near: U128, pub usd: U128 }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Pool { pub near: U128, pub usd: U128 }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct CheckSummary {
    pub request: u64,
    pub path: String,
    pub price_e6: u64,
    pub price_ts_ms: u64,
    pub trade_id: u64,
    pub checked: u32,
    pub unreadable: u32,
    pub fired: Vec<u64>,
    pub block_height: U64,
    pub block_ts: U64,
    pub outlayer_request: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct BandReport {
    pub request: u64,
    pub price_e6: u64,
    pub price_ts_ms: u64,
    pub k: u32,
    pub width_e6: u64,
    pub bands: String,
    pub suppressed: u32,
    pub total: u32,
    pub block_height: U64,
    pub outlayer_request: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Envelope { body: String, sig: String }

#[derive(Deserialize, Default)]
#[serde(crate = "near_sdk::serde")]
struct Ctx { #[serde(default)] outlayer_request: String }

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct FiredItem { id: u64, pt: String }

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct CheckBody {
    v: u8, op: String, contract: String, request: u64,
    price_e6: u64, price_ts_ms: u64, trade_id: u64, source: String,
    checked: u32, unreadable: u32, fired: Vec<FiredItem>, #[serde(default)] ctx: Ctx,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct KeysBody { v: u8, op: String, contract: String, request: u64, order_pub: String, attest_pub: String }

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct BandsBody {
    op: String, contract: String, request: u64, price_e6: u64, price_ts_ms: u64, source: String,
    k: u32, width_e6: u64, bands: Value, suppressed: u32, total: u32, #[serde(default)] ctx: Ctx,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct Plain { pub v: u8, pub cond: String, pub trigger_e6: u64, pub side: String, pub amount: String, pub salt: String }

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken { fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>); }

pub fn commitment(owner: &str, plaintext: &str) -> String {
    let mut h = Sha256::new();
    h.update(COMMIT_PREFIX);
    h.update(owner.as_bytes());
    h.update([0u8]);
    h.update(plaintext.as_bytes());
    hex::encode(h.finalize())
}

pub fn crossed(p: &Plain, price_e6: u64) -> bool {
    match p.cond.as_str() { "lte" => price_e6 <= p.trigger_e6, "gte" => price_e6 >= p.trigger_e6, _ => false }
}

fn is_hex64(s: &str) -> bool { s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }

fn amm_out(input: u128, reserve_in: u128, reserve_out: u128) -> u128 {
    if input == 0 || reserve_in == 0 || reserve_out == 0 { return 0; }
    let with_fee = input * (10_000 - FEE_BPS);
    // u128 is enough: reserves stay below 1e33 yocto in tests and on testnet.
    with_fee / 10_000 * reserve_out / (reserve_in + with_fee / 10_000)
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Mienai {
    owner: AccountId,
    token: AccountId,
    outlayer: AccountId,
    enclave_url: String,
    enclave_hash: String,
    tee: LazyOption<TeeKeys>,
    orders: LookupMap<u64, Order>,
    open: IterableSet<u64>,
    by_owner: LookupMap<AccountId, Vec<u64>>,
    fired: Vector<u64>,
    next_order: u64,
    requests: LookupMap<u64, Request>,
    next_request: u64,
    balances: LookupMap<AccountId, Balance>,
    pool: Pool,
    cancelled: u32,
    unfilled: u32,
    checks: u32,
    rejected: u32,
    last_check: Option<CheckSummary>,
    bands: Option<BandReport>,
}

#[near]
impl Mienai {
    #[init]
    pub fn new(owner_id: AccountId, token_id: AccountId, outlayer_id: AccountId, enclave_url: String, enclave_hash: String) -> Self {
        require!(is_hex64(&enclave_hash), "ERR_ENCLAVE_HASH");
        require!(enclave_url.starts_with("https://") && enclave_url.ends_with(&format!("{enclave_hash}.wasm")), "ERR_ENCLAVE_URL");
        Self {
            owner: owner_id, token: token_id, outlayer: outlayer_id, enclave_url, enclave_hash,
            tee: LazyOption::new(b"k".to_vec(), None),
            orders: LookupMap::new(b"o".to_vec()), open: IterableSet::new(b"s".to_vec()), by_owner: LookupMap::new(b"w".to_vec()),
            fired: Vector::new(b"f".to_vec()), next_order: 1,
            requests: LookupMap::new(b"r".to_vec()), next_request: 1,
            balances: LookupMap::new(b"b".to_vec()), pool: Pool::default(),
            cancelled: 0, unfilled: 0, checks: 0, rejected: 0, last_check: None, bands: None,
        }
    }

    // ---------- enclave requests ----------

    /// Asks the enclave for its order and report keys. The enclave hash is fixed at init, and
    /// the same build always derives the same keys, so a later call can only confirm them.
    #[payable]
    pub fn refresh_keys(&mut self) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
        self.request(RequestKind::Keys, vec![])
    }

    /// Anyone (a keeper) pays for one enclave run over the open orders.
    #[payable]
    pub fn check(&mut self) -> Promise {
        require!(self.tee.get().is_some(), "ERR_NO_ENCLAVE");
        let ids: Vec<u64> = self.open.iter().copied().collect();
        require!(!ids.is_empty(), "ERR_NOTHING_OPEN");
        self.request(RequestKind::Check, ids)
    }

    /// Asks the enclave for k-anonymous order counts per price band.
    #[payable]
    pub fn publish_bands(&mut self) -> Promise {
        require!(self.tee.get().is_some(), "ERR_NO_ENCLAVE");
        let ids: Vec<u64> = self.open.iter().copied().collect();
        self.request(RequestKind::Bands, ids)
    }

    fn request(&mut self, kind: RequestKind, order_ids: Vec<u64>) -> Promise {
        require!(env::attached_deposit() >= NearToken::from_millinear(5), "ERR_OUTLAYER_FEE");
        let id = self.next_request;
        self.next_request += 1;
        let operation = match kind { RequestKind::Keys => "keys", RequestKind::Check => "check", RequestKind::Bands => "bands" };
        let orders: Vec<Value> = order_ids.iter().map(|oid| {
            let o = self.orders.get(oid).unwrap();
            json!({ "id": o.id, "owner": o.owner, "ct": o.ct, "commit": o.commit })
        }).collect();
        let input = json!({ "operation": operation, "contract": env::current_account_id(), "request": id, "orders": orders }).to_string();
        self.requests.insert(id, Request { id, kind, caller: env::predecessor_account_id(), created_ns: U64(env::block_timestamp()), order_ids, status: RequestStatus::Pending, note: String::new() });
        let args = json!({
            "source": { "WasmUrl": { "url": self.enclave_url, "hash": self.enclave_hash, "build_target": "wasm32-wasip2" } },
            "input_data": input,
            "resource_limits": { "max_instructions": 20_000_000_000u64, "max_memory_mb": 128, "max_execution_seconds": 60 },
            "response_format": "Json",
            "payer_account_id": env::predecessor_account_id(),
        });
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"enclave_request","data":[{"request":id,"operation":operation,"orders":orders.len()}]}));
        Promise::new(self.outlayer.clone())
            .function_call("request_execution".to_string(), args.to_string().into_bytes(), env::attached_deposit(), GAS_OUTLAYER)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_result(id))
    }

    /// The only door for an OutLayer result: the promise result of this contract's own request.
    #[private]
    pub fn on_result(&mut self, request: u64) -> String {
        let mut req = self.requests.get(&request).cloned().expect("ERR_UNKNOWN_REQUEST");
        let raw = if env::promise_results_count() == 1 { env::promise_result_checked(0, 16_384).ok() } else { None };
        let parsed = raw.as_deref().and_then(|b| serde_json::from_slice::<Value>(b).ok());
        let envelope = parsed.clone().and_then(|v| serde_json::from_value::<Envelope>(v).ok());
        let Some(env_) = envelope else {
            let reason = parsed.as_ref().and_then(|v| v.get("error")).and_then(|e| e.as_str()).map(|e| format!("enclave error: {e}")).unwrap_or_else(|| "OutLayer execution failed or returned no report".to_string());
            req.status = RequestStatus::Failed;
            req.note = reason.chars().take(200).collect();
            log!("request {} failed: {}", request, req.note);
            self.requests.insert(request, req);
            return "failed".into();
        };
        let outcome = match req.kind {
            RequestKind::Keys => self.apply_keys(request, &env_.body, &env_.sig),
            RequestKind::Check => self.apply_check(Some(request), &env_.body, &env_.sig, "callback").map(|fired| format!("fired {}", fired.len())),
            RequestKind::Bands => self.apply_bands(request, &env_.body, &env_.sig),
        };
        match outcome {
            Ok(summary) => summary,
            Err(code) => {
                let mut req = self.requests.get(&request).cloned().unwrap();
                req.status = RequestStatus::Rejected;
                req.note = code.to_string();
                self.requests.insert(request, req);
                self.rejected += 1;
                log!("request {} rejected: {}", request, code);
                code.to_string()
            }
        }
    }

    /// The relayer door: anyone may deliver an enclave-signed check report for a request this
    /// contract issued (for example when the callback ran out of gas). Same checks as the callback.
    pub fn fire(&mut self, body: String, sig: String) -> Vec<u64> {
        match self.apply_check(None, &body, &sig, "relay") {
            Ok(fired) => fired,
            Err(code) => env::panic_str(code),
        }
    }

    fn verify_sig(&self, attest_pub_b64: &str, body: &str, sig_b64: &str) -> Result<(), &'static str> {
        let pk: [u8; 32] = B64.decode(attest_pub_b64).ok().and_then(|v| v.try_into().ok()).ok_or("ERR_ENCLAVE_KEY")?;
        let sig: [u8; 64] = B64.decode(sig_b64).ok().and_then(|v| v.try_into().ok()).ok_or("ERR_SIGNATURE")?;
        let mut message = REPORT_PREFIX.to_vec();
        message.extend_from_slice(body.as_bytes());
        if env::ed25519_verify(&sig, &message, &pk) { Ok(()) } else { Err("ERR_SIGNATURE") }
    }

    fn apply_keys(&mut self, request: u64, body: &str, sig: &str) -> Result<String, &'static str> {
        let k: KeysBody = serde_json::from_str(body).map_err(|_| "ERR_BODY")?;
        if k.v != 1 || k.op != "keys" || k.contract != env::current_account_id().as_str() || k.request != request { return Err("ERR_BODY"); }
        // Self-signed: proves the run holds the private half. The trust comes from the door
        // (the private callback on this contract's own pinned-hash request).
        self.verify_sig(&k.attest_pub, body, sig)?;
        if B64.decode(&k.order_pub).map(|v| v.len()) != Ok(32) { return Err("ERR_ENCLAVE_KEY"); }
        let keys = TeeKeys { order_pub: k.order_pub, attest_pub: k.attest_pub, request, set_at_ns: U64(env::block_timestamp()) };
        if let Some(current) = self.tee.get() {
            if current.order_pub != keys.order_pub || current.attest_pub != keys.attest_pub { return Err("ERR_ENCLAVE_KEY_CHANGED"); }
        } else {
            self.tee.set(Some(keys));
        }
        self.finish(request, RequestStatus::Done, "keys");
        Ok("keys".into())
    }

    fn apply_bands(&mut self, request: u64, body: &str, sig: &str) -> Result<String, &'static str> {
        let tee = self.tee.get().clone().ok_or("ERR_NO_ENCLAVE")?;
        self.verify_sig(&tee.attest_pub, body, sig)?;
        let b: BandsBody = serde_json::from_str(body).map_err(|_| "ERR_BODY")?;
        if b.op != "bands" || b.contract != env::current_account_id().as_str() || b.request != request { return Err("ERR_BODY"); }
        if b.source != PRICE_SOURCE { return Err("ERR_SOURCE"); }
        self.check_freshness(request, b.price_ts_ms)?;
        self.bands = Some(BandReport { request, price_e6: b.price_e6, price_ts_ms: b.price_ts_ms, k: b.k, width_e6: b.width_e6, bands: b.bands.to_string(), suppressed: b.suppressed, total: b.total, block_height: U64(env::block_height()), outlayer_request: b.ctx.outlayer_request });
        self.finish(request, RequestStatus::Done, "bands");
        Ok("bands".into())
    }

    fn check_freshness(&self, request: u64, price_ts_ms: u64) -> Result<(), &'static str> {
        let req = self.requests.get(&request).ok_or("ERR_UNKNOWN_REQUEST")?;
        let ts = price_ts_ms.checked_mul(1_000_000).ok_or("ERR_STALE_PRICE")?;
        let now = env::block_timestamp();
        if ts + MAX_PRICE_AGE_NS < now || ts + PRICE_BEFORE_REQUEST_NS < req.created_ns.0 { return Err("ERR_STALE_PRICE"); }
        if ts > now + PRICE_FUTURE_SLACK_NS { return Err("ERR_PRICE_IN_FUTURE"); }
        Ok(())
    }

    fn finish(&mut self, request: u64, status: RequestStatus, note: &str) {
        if let Some(mut r) = self.requests.get(&request).cloned() { r.status = status; r.note = note.to_string(); self.requests.insert(request, r); }
    }

    /// Validates the whole report first; only a fully valid report changes any order.
    fn apply_check(&mut self, expected_request: Option<u64>, body: &str, sig: &str, path: &str) -> Result<Vec<u64>, &'static str> {
        let tee = self.tee.get().clone().ok_or("ERR_NO_ENCLAVE")?;
        self.verify_sig(&tee.attest_pub, body, sig)?;
        let b: CheckBody = serde_json::from_str(body).map_err(|_| "ERR_BODY")?;
        if b.v != 1 || b.op != "check" || b.contract != env::current_account_id().as_str() { return Err("ERR_BODY"); }
        if b.source != PRICE_SOURCE { return Err("ERR_SOURCE"); }
        if let Some(id) = expected_request { if id != b.request { return Err("ERR_REQUEST_MISMATCH"); } }
        let req = self.requests.get(&b.request).cloned().ok_or("ERR_UNKNOWN_REQUEST")?;
        if req.kind != RequestKind::Check { return Err("ERR_REQUEST_KIND"); }
        let open_to_relay = req.status == RequestStatus::Failed || req.status == RequestStatus::Pending;
        let usable = match path { "callback" => req.status == RequestStatus::Pending, _ => open_to_relay && env::block_timestamp() <= req.created_ns.0 + REQUEST_TTL_NS };
        if !usable { return Err("ERR_REPLAY"); }
        self.check_freshness(b.request, b.price_ts_ms)?;

        let mut valid: Vec<(u64, Plain, String)> = Vec::new();
        for item in &b.fired {
            if !req.order_ids.contains(&item.id) { return Err("ERR_ORDER_NOT_IN_REQUEST"); }
            if valid.iter().any(|(id, _, _)| *id == item.id) { return Err("ERR_DUPLICATE_ORDER"); }
            let order = self.orders.get(&item.id).ok_or("ERR_UNKNOWN_ORDER")?;
            match order.status {
                OrderStatus::Open => {}
                OrderStatus::Cancelled => continue, // cancelled while the enclave ran: never executes
                _ => return Err("ERR_ALREADY_FIRED"),
            }
            if commitment(order.owner.as_str(), &item.pt) != order.commit { return Err("ERR_COMMITMENT"); }
            let plain: Plain = serde_json::from_str(&item.pt).map_err(|_| "ERR_PLAINTEXT")?;
            if !crossed(&plain, b.price_e6) { return Err("ERR_NOT_CROSSED"); }
            valid.push((item.id, plain, item.pt.clone()));
        }

        // Every check passed: consume the request, then execute.
        self.finish(b.request, RequestStatus::Done, &format!("{path}: fired {}", valid.len()));
        self.checks += 1;
        let report_sha256 = hex::encode(Sha256::digest(body.as_bytes()));
        let mut fired_ids = Vec::new();
        for (id, plain, pt) in valid {
            let mut order = self.orders.get(&id).cloned().unwrap();
            let (filled_in, filled_out, note) = self.execute(&order.owner, &plain);
            order.status = if filled_out > 0 { OrderStatus::Fired } else { self.unfilled += 1; OrderStatus::Unfilled };
            order.fire = Some(FireRecord {
                request: b.request, path: path.to_string(), plaintext: pt, cond: plain.cond.clone(), trigger_e6: plain.trigger_e6, side: plain.side.clone(),
                amount: U128(plain.amount.parse().unwrap_or(0)), price_e6: b.price_e6, price_ts_ms: b.price_ts_ms, trade_id: b.trade_id, source: b.source.clone(),
                block_height: U64(env::block_height()), block_ts: U64(env::block_timestamp()), filled_in: U128(filled_in), filled_out: U128(filled_out), note,
                report_sha256: report_sha256.clone(), outlayer_request: b.ctx.outlayer_request.clone(),
            });
            self.orders.insert(id, order);
            self.open.remove(&id);
            self.fired.push(id);
            fired_ids.push(id);
        }
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"check","data":[{"request":b.request,"path":path,"price_e6":b.price_e6,"fired":fired_ids}]}));
        self.last_check = Some(CheckSummary { request: b.request, path: path.to_string(), price_e6: b.price_e6, price_ts_ms: b.price_ts_ms, trade_id: b.trade_id, checked: b.checked, unreadable: b.unreadable, fired: fired_ids.clone(), block_height: U64(env::block_height()), block_ts: U64(env::block_timestamp()), outlayer_request: b.ctx.outlayer_request });
        Ok(fired_ids)
    }

    /// Swaps against the test pool from the owner's vault balance. Never panics: an order that
    /// cannot fill is recorded as Unfilled with the reason.
    fn execute(&mut self, owner: &AccountId, p: &Plain) -> (u128, u128, String) {
        let amount: u128 = match p.amount.parse() { Ok(a) if a > 0 => a, _ => return (0, 0, "invalid amount".into()) };
        let mut bal = self.balances.get(owner).cloned().unwrap_or_default();
        let (mut pn, mut pu) = (self.pool.near.0, self.pool.usd.0);
        let (out, note) = match p.side.as_str() {
            "sell" => {
                if bal.near.0 < amount { return (0, 0, "insufficient NEAR in vault".into()); }
                let out = amm_out(amount, pn, pu);
                if out == 0 { return (0, 0, "pool has no liquidity".into()); }
                bal.near.0 -= amount; bal.usd.0 += out; pn += amount; pu -= out;
                (out, "sold NEAR for tUSD on the test pool")
            }
            "buy" => {
                if bal.usd.0 < amount { return (0, 0, "insufficient tUSD in vault".into()); }
                let out = amm_out(amount, pu, pn);
                if out == 0 { return (0, 0, "pool has no liquidity".into()); }
                bal.usd.0 -= amount; bal.near.0 += out; pu += amount; pn -= out;
                (out, "bought NEAR with tUSD on the test pool")
            }
            _ => return (0, 0, "invalid side".into()),
        };
        self.pool = Pool { near: U128(pn), usd: U128(pu) };
        self.balances.insert(owner.clone(), bal);
        (amount, out, note.into())
    }

    // ---------- orders ----------

    /// Places a sealed order. `ct` is sealed to `get_config().tee.order_pub`; `commit` is
    /// sha256("mienai:commit:v1:" ‖ owner ‖ 0x00 ‖ plaintext); `view_ct` is an optional copy the
    /// owner sealed to a key that never leaves their device. 0.02 NEAR pays for the record's storage.
    #[payable]
    pub fn place_order(&mut self, ct: String, commit: String, view_ct: Option<String>) -> u64 {
        require!(self.tee.get().is_some(), "ERR_NO_ENCLAVE");
        require!(env::attached_deposit() >= ORDER_DEPOSIT, "ERR_ORDER_DEPOSIT");
        require!(ct.len() >= 100 && ct.len() <= MAX_CT_LEN && B64.decode(&ct).map(|b| b.first() == Some(&1)).unwrap_or(false), "ERR_CIPHERTEXT");
        require!(is_hex64(&commit), "ERR_COMMITMENT");
        if let Some(v) = &view_ct { require!(v.len() <= MAX_CT_LEN && B64.decode(v).is_ok(), "ERR_VIEW_CIPHERTEXT"); }
        require!(self.open.len() < MAX_OPEN, "ERR_BOOK_FULL");
        let owner = env::predecessor_account_id();
        let id = self.next_order;
        self.next_order += 1;
        self.orders.insert(id, Order { id, owner: owner.clone(), ct, commit, view_ct, created_ns: U64(env::block_timestamp()), status: OrderStatus::Open, fire: None });
        self.open.insert(id);
        let mut mine = self.by_owner.get(&owner).cloned().unwrap_or_default();
        mine.push(id);
        self.by_owner.insert(owner.clone(), mine);
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"order_placed","data":[{"id":id,"owner":owner}]}));
        id
    }

    pub fn cancel_order(&mut self, id: u64) {
        let mut order = self.orders.get(&id).cloned().expect("ERR_UNKNOWN_ORDER");
        require!(order.owner == env::predecessor_account_id(), "ERR_NOT_OWNER");
        require!(order.status == OrderStatus::Open, "ERR_NOT_OPEN");
        order.status = OrderStatus::Cancelled;
        self.orders.insert(id, order);
        self.open.remove(&id);
        self.cancelled += 1;
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"order_cancelled","data":[{"id":id}]}));
    }

    // ---------- balances and pool ----------

    #[payable]
    pub fn deposit_near(&mut self) -> Balance {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "ERR_ZERO");
        let account = env::predecessor_account_id();
        let mut bal = self.balances.get(&account).cloned().unwrap_or_default();
        bal.near.0 += amount;
        self.balances.insert(account, bal.clone());
        bal
    }

    pub fn withdraw_near(&mut self, amount: U128) -> Promise {
        let account = env::predecessor_account_id();
        let mut bal = self.balances.get(&account).cloned().unwrap_or_default();
        require!(amount.0 > 0 && bal.near.0 >= amount.0, "ERR_BALANCE");
        bal.near.0 -= amount.0;
        self.balances.insert(account.clone(), bal);
        Promise::new(account).transfer(NearToken::from_yoctonear(amount.0))
    }

    pub fn withdraw_usd(&mut self, amount: U128) -> Promise {
        let account = env::predecessor_account_id();
        let mut bal = self.balances.get(&account).cloned().unwrap_or_default();
        require!(amount.0 > 0 && bal.usd.0 >= amount.0, "ERR_BALANCE");
        bal.usd.0 -= amount.0;
        self.balances.insert(account.clone(), bal);
        ext_ft::ext(self.token.clone()).with_attached_deposit(NearToken::from_yoctonear(1)).with_static_gas(Gas::from_tgas(15)).ft_transfer(account.clone(), amount, Some("mienai withdraw".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_withdraw_usd(account, amount))
    }

    #[private]
    pub fn on_withdraw_usd(&mut self, account: AccountId, amount: U128) -> bool {
        if env::promise_result_checked(0, 64).is_ok() { return true; }
        let mut bal = self.balances.get(&account).cloned().unwrap_or_default();
        bal.usd.0 += amount.0;
        self.balances.insert(account, bal);
        false
    }

    /// NEP-141 receiver: tUSD deposits (msg "" or "deposit"), and the pool seed (msg "seed").
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "ERR_TOKEN");
        match msg.as_str() {
            "" | "deposit" => {
                let mut bal = self.balances.get(&sender_id).cloned().unwrap_or_default();
                bal.usd.0 += amount.0;
                self.balances.insert(sender_id, bal);
            }
            // The owner, or the tUSD issuer itself (the vault owner is the vault account, and a
            // NEP-141 transfer to oneself is not allowed).
            "seed" if sender_id == self.owner || sender_id == self.token => self.pool.usd.0 += amount.0,
            _ => return PromiseOrValue::Value(amount),
        }
        PromiseOrValue::Value(U128(0))
    }

    #[payable]
    pub fn seed_pool_near(&mut self) -> Pool {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
        self.pool.near.0 += env::attached_deposit().as_yoctonear();
        self.pool.clone()
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Value {
        json!({
            "owner": self.owner, "token": self.token, "outlayer": self.outlayer,
            "enclave_url": self.enclave_url, "enclave_hash": self.enclave_hash, "tee": self.tee.get(),
            "price_source": PRICE_SOURCE, "max_price_age_s": MAX_PRICE_AGE_NS / 1_000_000_000,
            "fee_bps": FEE_BPS as u64, "order_deposit": U128(ORDER_DEPOSIT.as_yoctonear()), "max_open": MAX_OPEN,
        })
    }

    /// What anyone, including a stop hunter, can learn: counts and ciphertexts, never a level.
    pub fn get_stats(&self) -> Value {
        json!({
            "orders_total": self.next_order - 1, "open": self.open.len(), "fired": self.fired.len(),
            "unfilled": self.unfilled, "cancelled": self.cancelled, "checks": self.checks, "rejected_reports": self.rejected,
            "requests_total": self.next_request - 1, "last_check": self.last_check, "pool": self.pool, "bands": self.bands,
        })
    }

    pub fn get_orders(&self, from_id: Option<u64>, limit: Option<u64>) -> Vec<Order> {
        let from = from_id.unwrap_or(1).max(1);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.next_order).take(limit as usize).filter_map(|id| self.orders.get(&id).cloned()).collect()
    }

    pub fn get_order(&self, id: u64) -> Option<Order> { self.orders.get(&id).cloned() }

    pub fn get_orders_of(&self, owner: AccountId) -> Vec<Order> {
        self.by_owner.get(&owner).map(|ids| ids.iter().filter_map(|id| self.orders.get(id).cloned()).collect()).unwrap_or_default()
    }

    pub fn get_open_ids(&self) -> Vec<u64> { self.open.iter().copied().collect() }

    pub fn get_fired(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Order> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.fired.len()).take(limit as usize).filter_map(|i| self.fired.get(i).and_then(|id| self.orders.get(id).cloned())).collect()
    }

    pub fn get_request(&self, id: u64) -> Option<Request> { self.requests.get(&id).cloned() }

    pub fn balance_of(&self, account_id: AccountId) -> Balance { self.balances.get(&account_id).cloned().unwrap_or_default() }

    pub fn get_pool(&self) -> Pool { self.pool.clone() }

    pub fn quote(&self, side: String, amount: U128) -> U128 {
        match side.as_str() {
            "sell" => U128(amm_out(amount.0, self.pool.near.0, self.pool.usd.0)),
            "buy" => U128(amm_out(amount.0, self.pool.usd.0, self.pool.near.0)),
            _ => env::panic_str("ERR_SIDE"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commitment_matches_the_enclave_and_sdk_format() {
        // Same vector as packages/sdk/test (sha256 of the prefixed owner ‖ 0x00 ‖ plaintext).
        let pt = r#"{"v":1,"cond":"lte","trigger_e6":3500000,"side":"sell","amount":"1","salt":"00112233445566778899aabbccddeeff"}"#;
        // printf 'mienai:commit:v1:alice.testnet\0%s' "$pt" | shasum -a 256
        assert_eq!(commitment("alice.testnet", pt), "0ddc05f14be95cea75b956d8e81da516232638132e0614b049c4a1b771d538f3");
    }
    #[test]
    fn crossing_rules() {
        let p = |cond: &str| Plain { v: 1, cond: cond.into(), trigger_e6: 3_500_000, side: "sell".into(), amount: "1".into(), salt: "0".repeat(32) };
        assert!(crossed(&p("lte"), 3_500_000) && crossed(&p("lte"), 3_400_000) && !crossed(&p("lte"), 3_500_001));
        assert!(crossed(&p("gte"), 3_500_000) && !crossed(&p("gte"), 3_499_999));
        assert!(!crossed(&p("eq"), 3_500_000));
    }
    #[test]
    fn pool_math_charges_the_fee_and_keeps_k() {
        let out = amm_out(1_000, 100_000, 100_000);
        assert_eq!(out, 987); // 0.3% fee, then x*y=k
        assert!((100_000 + 1_000) * (100_000 - out) >= 100_000u128 * 100_000);
        assert_eq!(amm_out(10, 0, 100), 0);
    }
}
