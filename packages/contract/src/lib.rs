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
//!   6. (second source) before any order executes, OutLayer's price oracle (`price-oracle.testnet`,
//!      a separate TEE run that takes the median of many exchanges) must agree with the enclave's
//!      Coinbase price within `tolerance_bps`; otherwise the report is refused (ERR_SOURCES_DISAGREE).
//! A fired order is swapped against the contract's NEAR/tUSD constant-product test pool and its
//! trigger, price, source and block are kept public for audit.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableSet, LazyOption, LookupMap, Vector};
use near_sdk::{env, ext_contract, log, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseOrValue};
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
/// Static gas for the oracle call; it also receives all unused gas (its OutLayer run needs ~85 Tgas).
const GAS_ORACLE: Gas = Gas::from_tgas(50);
const GAS_SECOND_CALLBACK: Gas = Gas::from_tgas(40);
/// OutLayer's price oracle requires at least 0.01 NEAR when its cached price is stale.
pub const ORACLE_FEE: NearToken = NearToken::from_millinear(10);
/// A check with the second source on: 0.01 NEAR for the enclave run plus the 0.01 NEAR oracle reserve.
pub const CHECK_MIN_DEPOSIT: NearToken = NearToken::from_millinear(20);
/// What one zero-deposit keeper check takes from the keeper budget.
pub const KEEPER_CHECK_COST: NearToken = NearToken::from_millinear(20);
pub const DEFAULT_ORACLE: &str = "price-oracle.testnet";
pub const DEFAULT_ORACLE_ASSET: &str = "wrap.near";
pub const DEFAULT_TOLERANCE_BPS: u32 = 100;
const NEED_SECOND: &str = "NEED_SECOND_SOURCE";
// Raw storage slots added after the first deployment (the borsh state struct is unchanged).
const K_SECOND_CFG: &[u8] = b"cfg2";
const K_KEEPER_BUDGET: &[u8] = b"kb";
const K_LAST_SECOND: &[u8] = b"lc2";
const K_RESERVE: &[u8] = b"q";
const K_FIRE_SECOND: &[u8] = b"x";
// Order types added on 14 Nov (raw slots, so the deployed state struct is unchanged):
// public (unsealed) orders, market fills and one-cancels-the-other links between sealed orders.
const K_PUB_NEXT: &[u8] = b"Pn";
const K_PUB_OPEN: &[u8] = b"Po";
const K_PUB: &[u8] = b"Pu";
const K_PUB_OWNER: &[u8] = b"Pw";
const K_MKT_NEXT: &[u8] = b"Mn";
const K_MKT: &[u8] = b"Mk";
const K_MKT_OWNER: &[u8] = b"Mw";
const K_OCO: &[u8] = b"Lk";
const K_OCO_PAIRS: &[u8] = b"Lp";
pub const MAX_PUBLIC_OPEN: usize = 16;

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

/// A public order: the opposite of a sealed one. Its trigger is in the transaction arguments and in
/// contract state for anyone to read. It exists so the app can show the difference side by side; it
/// fires on the same enclave-signed, two-source-checked price as sealed orders.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PublicOrder {
    pub id: u64, pub owner: AccountId, pub kind: String, pub cond: String, pub trigger_e6: u64, pub side: String,
    pub amount: U128, pub created_ns: U64, pub status: OrderStatus, pub fire: Option<PublicFill>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PublicFill {
    pub request: u64, pub path: String, pub price_e6: u64, pub price_ts_ms: u64, pub block_height: U64, pub block_ts: U64,
    pub filled_in: U128, pub filled_out: U128, pub note: String, pub report_sha256: String,
}

/// A market order: filled at once against the test pool from the caller's vault balance.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MarketFill {
    pub id: u64, pub owner: AccountId, pub side: String, pub amount_in: U128, pub amount_out: U128, pub price_e6: u64,
    pub block_height: U64, pub block_ts: U64, pub note: String,
}

/// One leg of a one-cancels-the-other pair: a sealed order like `place_order` takes.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SealedLeg { pub ct: String, pub commit: String, pub view_ct: Option<String> }

/// "3.2800" -> 3_280_000 (USD to micro-USD); at most 6 decimals, greater than zero.
pub fn parse_usd_e6(s: &str) -> Option<u64> {
    let (int, frac) = s.split_once('.').unwrap_or((s, ""));
    if s.ends_with('.') || int.is_empty() || int.len() > 9 || frac.len() > 6 || !int.bytes().all(|b| b.is_ascii_digit()) || !frac.bytes().all(|b| b.is_ascii_digit()) { return None; }
    let v = int.parse::<u64>().ok()? * 1_000_000 + format!("{frac:0<6}").parse::<u64>().ok()?;
    (v > 0).then_some(v)
}

/// Effective price of a pool fill in micro-USD per NEAR (NEAR has 24 decimals, tUSD 6).
pub fn fill_price_e6(side: &str, amount_in: u128, amount_out: u128) -> u64 {
    let (usd, near) = if side == "sell" { (amount_out, amount_in) } else { (amount_in, amount_out) };
    if near == 0 { return 0; }
    (usd.saturating_mul(1_000_000_000_000_000_000_000_000) / near).min(u64::MAX as u128) as u64
}

/// Owner-set configuration of the second price source.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SecondSourceConfig { pub oracle: AccountId, pub asset: String, pub enabled: bool, pub tolerance_bps: u32 }

/// The oracle's answer, reduced to what the agreement check needs.
#[derive(Clone, Debug, PartialEq)]
pub struct SecondPrice { pub price_e6: u64, pub oracle_ts_ns: u64 }

/// Reads `price-oracle.testnet`'s `PriceData` JSON and returns the asset's price in micro-USD.
/// `None` when the oracle has no fresh median for the asset (its `price` is null).
pub fn parse_price_data(raw: &[u8], asset: &str) -> Option<SecondPrice> {
    let v: Value = serde_json::from_slice(raw).ok()?;
    let ts: u64 = v.get("timestamp")?.as_str()?.parse().ok()?;
    let entry = v.get("prices")?.as_array()?.iter().find(|p| p.get("asset_id").and_then(|a| a.as_str()) == Some(asset))?;
    let price = entry.get("price")?;
    let multiplier: u128 = price.get("multiplier")?.as_str()?.parse().ok()?;
    let decimals = price.get("decimals")?.as_u64()?;
    if decimals > 30 || multiplier == 0 { return None; }
    let e6 = if decimals >= 6 { multiplier / 10u128.pow((decimals - 6) as u32) } else { multiplier * 10u128.pow((6 - decimals) as u32) };
    if e6 == 0 || e6 > u64::MAX as u128 { return None; }
    Some(SecondPrice { price_e6: e6 as u64, oracle_ts_ns: ts })
}

/// Distance between the two prices in basis points of the oracle price (rounded up).
pub fn diff_bps(enclave_e6: u64, oracle_e6: u64) -> u64 {
    let d = (enclave_e6 as u128).abs_diff(oracle_e6 as u128) * 10_000;
    d.div_ceil(oracle_e6.max(1) as u128) as u64
}

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

pub fn crossed(p: &Plain, price_e6: u64) -> bool { crossed_at(&p.cond, p.trigger_e6, price_e6) }

pub fn crossed_at(cond: &str, trigger_e6: u64, price_e6: u64) -> bool {
    match cond { "lte" => price_e6 <= trigger_e6, "gte" => price_e6 >= trigger_e6, _ => false }
}

fn slot(prefix: &[u8], id: u64) -> Vec<u8> { [prefix, &id.to_le_bytes()].concat() }
fn owner_slot(prefix: &[u8], owner: &AccountId) -> Vec<u8> { [prefix, owner.as_bytes()].concat() }
fn read_json<T: near_sdk::serde::de::DeserializeOwned>(key: &[u8]) -> Option<T> { env::storage_read(key).and_then(|raw| serde_json::from_slice(&raw).ok()) }
fn write_json<T: Serialize>(key: &[u8], v: &T) { env::storage_write(key, serde_json::to_string(v).unwrap().as_bytes()); }
fn read_u64(key: &[u8]) -> u64 { env::storage_read(key).and_then(|raw| raw.try_into().ok()).map(u64::from_le_bytes).unwrap_or(0) }

fn reserve_key(request: u64) -> Vec<u8> { [K_RESERVE, &request.to_le_bytes()].concat() }
fn fire_second_key(id: u64) -> Vec<u8> { [K_FIRE_SECOND, &id.to_le_bytes()].concat() }
fn enclave_price(body: &str) -> u64 { serde_json::from_str::<Value>(body).ok().and_then(|v| v.get("price_e6").and_then(|p| p.as_u64())).unwrap_or(0) }

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
        self.request(RequestKind::Keys, vec![], env::attached_deposit())
    }

    /// Anyone (a keeper) pays for one enclave run over the open orders.
    ///
    /// The contract account itself may also call `check` with no deposit: that is the scoped keeper
    /// key (a function-call key on this account limited to `check`; such keys cannot attach NEAR).
    /// Its run is paid from the keeper budget that `fund_keeper` fills, never from user balances.
    /// With the second source on, 0.01 NEAR of the deposit is held back for the oracle and
    /// returned (or put back in the keeper budget) when no order crossed.
    #[payable]
    pub fn check(&mut self) -> Promise {
        require!(self.tee.get().is_some(), "ERR_NO_ENCLAVE");
        let ids: Vec<u64> = self.open.iter().copied().collect();
        require!(!ids.is_empty() || !self.public_open().is_empty(), "ERR_NOTHING_OPEN");
        let mut deposit = env::attached_deposit();
        if deposit.is_zero() && env::predecessor_account_id() == env::current_account_id() {
            let budget = self.keeper_budget();
            require!(budget >= KEEPER_CHECK_COST.as_yoctonear(), "ERR_KEEPER_BUDGET");
            self.set_keeper_budget(budget - KEEPER_CHECK_COST.as_yoctonear());
            deposit = KEEPER_CHECK_COST;
            log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"keeper_check","data":[{"paid_from_budget":U128(KEEPER_CHECK_COST.as_yoctonear()),"budget_left":U128(budget - KEEPER_CHECK_COST.as_yoctonear())}]}));
        }
        self.request(RequestKind::Check, ids, deposit)
    }

    /// Asks the enclave for k-anonymous order counts per price band.
    #[payable]
    pub fn publish_bands(&mut self) -> Promise {
        require!(self.tee.get().is_some(), "ERR_NO_ENCLAVE");
        let ids: Vec<u64> = self.open.iter().copied().collect();
        self.request(RequestKind::Bands, ids, env::attached_deposit())
    }

    fn request(&mut self, kind: RequestKind, order_ids: Vec<u64>, deposit: NearToken) -> Promise {
        require!(deposit >= NearToken::from_millinear(5), "ERR_OUTLAYER_FEE");
        let mut outlayer_deposit = deposit;
        let id = self.next_request;
        if kind == RequestKind::Check && self.second_source().enabled {
            require!(deposit >= CHECK_MIN_DEPOSIT, "ERR_OUTLAYER_FEE: a check needs 0.02 NEAR (enclave run + oracle reserve)");
            outlayer_deposit = deposit.saturating_sub(ORACLE_FEE);
            env::storage_write(&reserve_key(id), &ORACLE_FEE.as_yoctonear().to_le_bytes());
        }
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
            .function_call("request_execution".to_string(), args.to_string().into_bytes(), outlayer_deposit, GAS_OUTLAYER)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_result(id))
    }

    /// The only door for an OutLayer result: the promise result of this contract's own request.
    #[private]
    pub fn on_result(&mut self, request: u64) -> PromiseOrValue<String> {
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
            self.release_reserve(request);
            return PromiseOrValue::Value("failed".into());
        };
        let outcome = match req.kind {
            RequestKind::Keys => self.apply_keys(request, &env_.body, &env_.sig),
            RequestKind::Check => match self.apply_check(Some(request), &env_.body, &env_.sig, "callback", None) {
                // A crossed order: ask the second source before anything executes.
                Err(NEED_SECOND) => {
                    let reserve = self.take_reserve(request);
                    let mut r = self.requests.get(&request).cloned().unwrap();
                    r.note = "awaiting second source".into();
                    self.requests.insert(request, r);
                    return PromiseOrValue::Promise(self.ask_second_source(reserve).then(
                        Self::ext(env::current_account_id()).with_static_gas(GAS_SECOND_CALLBACK).with_unused_gas_weight(0)
                            .on_second_source(request, env_.body, env_.sig)));
                }
                other => other.map(|fired| format!("fired {}", fired.len())),
            },
            RequestKind::Bands => self.apply_bands(request, &env_.body, &env_.sig),
        };
        self.release_reserve(request);
        PromiseOrValue::Value(self.settle_outcome(request, outcome))
    }

    fn settle_outcome(&mut self, request: u64, outcome: Result<String, &'static str>) -> String {
        match outcome {
            Ok(summary) => summary,
            Err(code) => self.reject(request, code.to_string()),
        }
    }

    fn reject(&mut self, request: u64, note: String) -> String {
        let mut req = self.requests.get(&request).cloned().unwrap();
        req.status = RequestStatus::Rejected;
        req.note = note.chars().take(200).collect();
        self.requests.insert(request, req);
        self.rejected += 1;
        log!("request {} rejected: {}", request, note);
        note
    }

    /// The second source's answer for a report the callback delivered. The whole report is
    /// validated again before anything executes; a refusal marks the request Rejected.
    #[private]
    pub fn on_second_source(&mut self, request: u64, body: String, sig: String) -> String {
        let cfg = self.second_source();
        let second = self.second_price(&cfg);
        match self.apply_check(Some(request), &body, &sig, "callback", Some(second.clone())) {
            Ok(fired) => format!("fired {}", fired.len()),
            Err(code) => {
                let note = match (&second, code) {
                    (Ok(s), "ERR_SOURCES_DISAGREE") => format!("ERR_SOURCES_DISAGREE: oracle {} vs enclave {} (tolerance {} bps)", s.price_e6, enclave_price(&body), cfg.tolerance_bps),
                    _ => code.to_string(),
                };
                self.reject(request, note)
            }
        }
    }

    /// The second source's answer for a report a relayer delivered through `fire`.
    #[private]
    pub fn on_relay_second_source(&mut self, body: String, sig: String) -> Vec<u64> {
        let second = self.second_price(&self.second_source());
        match self.apply_check(None, &body, &sig, "relay", Some(second)) {
            Ok(fired) => fired,
            Err(code) => env::panic_str(code),
        }
    }

    fn second_price(&self, cfg: &SecondSourceConfig) -> Result<SecondPrice, &'static str> {
        env::promise_result_checked(0, 8_192).ok().and_then(|raw| parse_price_data(&raw, &cfg.asset)).ok_or("ERR_SECOND_SOURCE_UNAVAILABLE")
    }

    fn ask_second_source(&self, deposit: NearToken) -> Promise {
        let cfg = self.second_source();
        Promise::new(cfg.oracle).function_call_weight(
            "request_price_data".to_string(), json!({ "asset_ids": [cfg.asset] }).to_string().into_bytes(), deposit, GAS_ORACLE, GasWeight(1))
    }

    /// The relayer door: anyone may deliver an enclave-signed check report for a request this
    /// contract issued (for example when the callback ran out of gas). Same checks as the callback.
    /// With the second source on and a crossed order in the report, the relayer attaches 0.01 NEAR
    /// for the oracle and the fire completes in `on_second_source`.
    #[payable]
    pub fn fire(&mut self, body: String, sig: String) -> PromiseOrValue<Vec<u64>> {
        match self.apply_check(None, &body, &sig, "relay", None) {
            Ok(fired) => PromiseOrValue::Value(fired),
            Err(NEED_SECOND) => {
                require!(env::attached_deposit() >= ORACLE_FEE, "ERR_ORACLE_FEE: attach 0.01 NEAR for the second source");
                PromiseOrValue::Promise(self.ask_second_source(env::attached_deposit()).then(
                    Self::ext(env::current_account_id()).with_static_gas(GAS_SECOND_CALLBACK).with_unused_gas_weight(0)
                        .on_relay_second_source(body, sig)))
            }
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

    // ---------- second source, keeper budget (raw storage slots) ----------

    fn second_source(&self) -> SecondSourceConfig {
        env::storage_read(K_SECOND_CFG).and_then(|raw| serde_json::from_slice(&raw).ok()).unwrap_or_else(|| SecondSourceConfig {
            oracle: DEFAULT_ORACLE.parse().unwrap(), asset: DEFAULT_ORACLE_ASSET.into(), enabled: true, tolerance_bps: DEFAULT_TOLERANCE_BPS,
        })
    }

    fn keeper_budget(&self) -> u128 {
        env::storage_read(K_KEEPER_BUDGET).and_then(|raw| raw.try_into().ok()).map(u128::from_le_bytes).unwrap_or(0)
    }

    fn set_keeper_budget(&mut self, v: u128) { env::storage_write(K_KEEPER_BUDGET, &v.to_le_bytes()); }

    /// Removes and returns a request's oracle reserve (zero if none was held).
    fn take_reserve(&mut self, request: u64) -> NearToken {
        let key = reserve_key(request);
        let v = env::storage_read(&key).and_then(|raw| raw.try_into().ok()).map(u128::from_le_bytes).unwrap_or(0);
        if v > 0 { env::storage_remove(&key); }
        NearToken::from_yoctonear(v)
    }

    /// The oracle was not needed: the reserve goes back to whoever paid for the check.
    fn release_reserve(&mut self, request: u64) {
        let reserve = self.take_reserve(request);
        if reserve.is_zero() { return; }
        let caller = self.requests.get(&request).map(|r| r.caller.clone()).unwrap();
        if caller == env::current_account_id() { let b = self.keeper_budget(); self.set_keeper_budget(b + reserve.as_yoctonear()); }
        else { Promise::new(caller).transfer(reserve).detach(); }
    }

    /// Validates the whole report first; only a fully valid report changes any order.
    fn apply_check(&mut self, expected_request: Option<u64>, body: &str, sig: &str, path: &str, second: Option<Result<SecondPrice, &'static str>>) -> Result<Vec<u64>, &'static str> {
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

        // Public orders need no enclave: their triggers are in state, checked against the same signed price.
        let public_hits: Vec<PublicOrder> = self.public_open().into_iter().filter_map(|id| self.public_get(id))
            .filter(|o| o.status == OrderStatus::Open && crossed_at(&o.cond, o.trigger_e6, b.price_e6)).collect();

        // Second source: no order executes unless OutLayer's oracle agrees with the enclave's price.
        let cfg = self.second_source();
        let mut agreed: Option<(SecondPrice, u64)> = None;
        if (!valid.is_empty() || !public_hits.is_empty()) && cfg.enabled {
            let s = match second { None => return Err(NEED_SECOND), Some(r) => r? };
            let d = diff_bps(b.price_e6, s.price_e6);
            if d > cfg.tolerance_bps as u64 { return Err("ERR_SOURCES_DISAGREE"); }
            agreed = Some((s, d));
        }

        // Every check passed: consume the request, then execute.
        self.finish(b.request, RequestStatus::Done, &format!("{path}: fired {}", valid.len() + public_hits.len()));
        self.checks += 1;
        let report_sha256 = hex::encode(Sha256::digest(body.as_bytes()));
        let mut fired_ids = Vec::new();
        for (id, plain, pt) in valid {
            let mut order = self.orders.get(&id).cloned().unwrap();
            // Its one-cancels-the-other partner fired earlier in this same report.
            if order.status != OrderStatus::Open { continue; }
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
            self.cancel_partner(id, "partner fired");
        }
        let mut public_fired = Vec::new();
        for mut o in public_hits {
            let plain = Plain { v: 1, cond: o.cond.clone(), trigger_e6: o.trigger_e6, side: o.side.clone(), amount: o.amount.0.to_string(), salt: String::new() };
            let (filled_in, filled_out, note) = self.execute(&o.owner, &plain);
            o.status = if filled_out > 0 { OrderStatus::Fired } else { OrderStatus::Unfilled };
            o.fire = Some(PublicFill { request: b.request, path: path.to_string(), price_e6: b.price_e6, price_ts_ms: b.price_ts_ms, block_height: U64(env::block_height()), block_ts: U64(env::block_timestamp()), filled_in: U128(filled_in), filled_out: U128(filled_out), note, report_sha256: report_sha256.clone() });
            write_json(&slot(K_PUB, o.id), &o);
            self.public_set_open(o.id, false);
            public_fired.push(o.id);
        }
        let second_json = agreed.as_ref().map(|(s, d)| json!({
            "oracle": cfg.oracle, "asset": cfg.asset, "oracle_price_e6": s.price_e6, "oracle_ts_ns": U64(s.oracle_ts_ns),
            "enclave_price_e6": b.price_e6, "diff_bps": d, "tolerance_bps": cfg.tolerance_bps, "request": b.request, "block_height": U64(env::block_height()),
        }));
        if let Some(j) = &second_json {
            let raw = j.to_string();
            env::storage_write(K_LAST_SECOND, raw.as_bytes());
            for id in &fired_ids { env::storage_write(&fire_second_key(*id), raw.as_bytes()); }
        }
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"check","data":[{"request":b.request,"path":path,"price_e6":b.price_e6,"fired":fired_ids,"public_fired":public_fired,"second_source":second_json}]}));
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
        require!(env::attached_deposit() >= ORDER_DEPOSIT, "ERR_ORDER_DEPOSIT");
        self.place_sealed(ct, commit, view_ct)
    }

    /// Places two sealed orders as one-cancels-the-other: when either fires, the other is cancelled
    /// in the same transaction, and cancelling either cancels both. Typically a stop below the
    /// market and a take-profit above it. Both levels stay sealed; only the link between the two
    /// order numbers is public. 0.04 NEAR pays for both records.
    #[payable]
    pub fn place_oco(&mut self, a: SealedLeg, b: SealedLeg) -> Vec<u64> {
        require!(env::attached_deposit() >= ORDER_DEPOSIT.saturating_mul(2), "ERR_ORDER_DEPOSIT: an OCO pair needs 0.04 NEAR");
        require!(a.commit != b.commit, "ERR_OCO_SAME_ORDER");
        let x = self.place_sealed(a.ct, a.commit, a.view_ct);
        let y = self.place_sealed(b.ct, b.commit, b.view_ct);
        env::storage_write(&slot(K_OCO, x), &y.to_le_bytes());
        env::storage_write(&slot(K_OCO, y), &x.to_le_bytes());
        let mut pairs: Vec<[u64; 2]> = read_json(K_OCO_PAIRS).unwrap_or_default();
        pairs.push([x, y]);
        write_json(K_OCO_PAIRS, &pairs);
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"oco_placed","data":[{"ids":[x, y],"owner":env::predecessor_account_id()}]}));
        vec![x, y]
    }

    fn place_sealed(&mut self, ct: String, commit: String, view_ct: Option<String>) -> u64 {
        require!(self.tee.get().is_some(), "ERR_NO_ENCLAVE");
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
        self.cancel_partner(id, "partner cancelled");
    }

    /// Cancels the other leg of a one-cancels-the-other pair if it is still armed.
    fn cancel_partner(&mut self, id: u64, why: &str) {
        let Some(raw) = env::storage_read(&slot(K_OCO, id)) else { return };
        let partner = u64::from_le_bytes(raw.try_into().unwrap());
        let Some(mut p) = self.orders.get(&partner).cloned() else { return };
        if p.status != OrderStatus::Open { return; }
        p.status = OrderStatus::Cancelled;
        self.orders.insert(partner, p);
        self.open.remove(&partner);
        self.cancelled += 1;
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"oco_cancelled","data":[{"id":partner,"partner":id,"reason":why}]}));
    }

    // ---------- public orders and market orders (no seal) ----------

    /// A public (unsealed) order, for comparison with a sealed one: `trigger_usd` ("3.2800") is in
    /// the transaction arguments, so every explorer, bot and searcher can read it. `kind` is a label
    /// ("stop", "take_profit" or "limit"); `cond` is "lte" or "gte"; `side` "sell" (amount in yoctoNEAR)
    /// or "buy" (amount in micro-tUSD). It fires on the same signed, two-source-checked check price.
    #[payable]
    pub fn place_public_order(&mut self, kind: String, cond: String, trigger_usd: String, side: String, amount: U128) -> u64 {
        require!(env::attached_deposit() >= ORDER_DEPOSIT, "ERR_ORDER_DEPOSIT");
        require!(["stop", "take_profit", "limit"].contains(&kind.as_str()), "ERR_KIND");
        require!(cond == "lte" || cond == "gte", "ERR_COND");
        require!(side == "sell" || side == "buy", "ERR_SIDE");
        require!(amount.0 > 0, "ERR_AMOUNT");
        let trigger_e6 = parse_usd_e6(&trigger_usd).unwrap_or_else(|| env::panic_str("ERR_TRIGGER"));
        let open = self.public_open();
        require!(open.len() < MAX_PUBLIC_OPEN, "ERR_BOOK_FULL");
        let owner = env::predecessor_account_id();
        let id = read_u64(K_PUB_NEXT).max(1);
        env::storage_write(K_PUB_NEXT, &(id + 1).to_le_bytes());
        write_json(&slot(K_PUB, id), &PublicOrder { id, owner: owner.clone(), kind: kind.clone(), cond: cond.clone(), trigger_e6, side: side.clone(), amount, created_ns: U64(env::block_timestamp()), status: OrderStatus::Open, fire: None });
        self.public_set_open(id, true);
        let key = owner_slot(K_PUB_OWNER, &owner);
        let mut mine: Vec<u64> = read_json(&key).unwrap_or_default();
        mine.push(id);
        write_json(&key, &mine);
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"public_order_placed","data":[{"id":id,"owner":owner,"kind":kind,"cond":cond,"trigger_e6":trigger_e6,"side":side,"amount":amount}]}));
        id
    }

    pub fn cancel_public_order(&mut self, id: u64) {
        let mut o = self.public_get(id).unwrap_or_else(|| env::panic_str("ERR_UNKNOWN_ORDER"));
        require!(o.owner == env::predecessor_account_id(), "ERR_NOT_OWNER");
        require!(o.status == OrderStatus::Open, "ERR_NOT_OPEN");
        o.status = OrderStatus::Cancelled;
        write_json(&slot(K_PUB, id), &o);
        self.public_set_open(id, false);
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"public_order_cancelled","data":[{"id":id}]}));
    }

    /// A market order: swaps now against the vault's NEAR/tUSD test pool from the caller's vault
    /// balance. `side` "sell" spends `amount` yoctoNEAR, "buy" spends `amount` micro-tUSD. Refused
    /// (nothing changes) if it would receive less than `min_out`. There is no trigger to hide.
    pub fn market_order(&mut self, side: String, amount: U128, min_out: U128) -> MarketFill {
        require!(side == "sell" || side == "buy", "ERR_SIDE");
        let owner = env::predecessor_account_id();
        let plain = Plain { v: 1, cond: String::new(), trigger_e6: 0, side: side.clone(), amount: amount.0.to_string(), salt: String::new() };
        let quote = match side.as_str() { "sell" => amm_out(amount.0, self.pool.near.0, self.pool.usd.0), _ => amm_out(amount.0, self.pool.usd.0, self.pool.near.0) };
        require!(quote >= min_out.0, "ERR_SLIPPAGE: the pool would pay less than min_out");
        let (filled_in, filled_out, note) = self.execute(&owner, &plain);
        if filled_out == 0 { env::panic_str(&format!("ERR_NOT_FILLED: {note}")); }
        let id = read_u64(K_MKT_NEXT).max(1);
        env::storage_write(K_MKT_NEXT, &(id + 1).to_le_bytes());
        let fill = MarketFill { id, owner: owner.clone(), side, amount_in: U128(filled_in), amount_out: U128(filled_out), price_e6: fill_price_e6(&plain.side, filled_in, filled_out), block_height: U64(env::block_height()), block_ts: U64(env::block_timestamp()), note };
        write_json(&slot(K_MKT, id), &fill);
        let key = owner_slot(K_MKT_OWNER, &owner);
        let mut mine: Vec<u64> = read_json(&key).unwrap_or_default();
        mine.push(id);
        write_json(&key, &mine);
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"market_fill","data":[&fill]}));
        fill
    }

    fn public_open(&self) -> Vec<u64> { read_json(K_PUB_OPEN).unwrap_or_default() }
    fn public_get(&self, id: u64) -> Option<PublicOrder> { read_json(&slot(K_PUB, id)) }
    fn public_set_open(&mut self, id: u64, open: bool) {
        let mut ids = self.public_open();
        ids.retain(|x| *x != id);
        if open { ids.push(id); }
        write_json(K_PUB_OPEN, &ids);
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

    /// Owner switch for the second source. Off means fires need only the enclave report (the
    /// original single-source rule); every change is logged.
    pub fn set_second_source(&mut self, oracle: AccountId, asset: String, enabled: bool, tolerance_bps: u32) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
        require!((10..=500).contains(&tolerance_bps), "ERR_TOLERANCE: 10..=500 bps");
        require!(!asset.is_empty() && asset.len() <= 64, "ERR_ASSET");
        let cfg = SecondSourceConfig { oracle, asset, enabled, tolerance_bps };
        env::storage_write(K_SECOND_CFG, serde_json::to_string(&cfg).unwrap().as_bytes());
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"second_source_set","data":[cfg]}));
    }

    /// Anyone may add NEAR to the budget that pays for zero-deposit keeper checks.
    #[payable]
    pub fn fund_keeper(&mut self) -> U128 {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "ERR_ZERO");
        let b = self.keeper_budget() + amount;
        self.set_keeper_budget(b);
        log!("EVENT_JSON:{}", json!({"standard":"mienai","version":"1.0.0","event":"keeper_funded","data":[{"by":env::predecessor_account_id(),"amount":U128(amount),"budget":U128(b)}]}));
        U128(b)
    }

    // ---------- views ----------

    /// Second-source configuration, the last agreement it recorded, and the keeper budget.
    pub fn get_second_source(&self) -> Value {
        let last = env::storage_read(K_LAST_SECOND).and_then(|raw| serde_json::from_slice::<Value>(&raw).ok());
        json!({ "config": self.second_source(), "last_agreement": last, "keeper_budget": U128(self.keeper_budget()), "keeper_check_cost": U128(KEEPER_CHECK_COST.as_yoctonear()), "check_min_deposit": U128(CHECK_MIN_DEPOSIT.as_yoctonear()) })
    }

    /// The two prices that agreed when this order fired (orders fired before the upgrade have none).
    pub fn get_fire_second_source(&self, id: u64) -> Option<Value> {
        env::storage_read(&fire_second_key(id)).and_then(|raw| serde_json::from_slice(&raw).ok())
    }

    /// Public (unsealed) orders, triggers included: what a stop hunter reads.
    pub fn get_public_orders(&self, from_id: Option<u64>, limit: Option<u64>) -> Vec<PublicOrder> {
        let from = from_id.unwrap_or(1).max(1);
        let limit = limit.unwrap_or(50).min(100);
        (from..read_u64(K_PUB_NEXT).max(1)).take(limit as usize).filter_map(|id| self.public_get(id)).collect()
    }

    pub fn get_public_order(&self, id: u64) -> Option<PublicOrder> { self.public_get(id) }

    pub fn get_public_orders_of(&self, owner: AccountId) -> Vec<PublicOrder> {
        read_json::<Vec<u64>>(&owner_slot(K_PUB_OWNER, &owner)).unwrap_or_default().into_iter().filter_map(|id| self.public_get(id)).collect()
    }

    pub fn get_public_open_ids(&self) -> Vec<u64> { self.public_open() }

    pub fn get_market_fills(&self, from_id: Option<u64>, limit: Option<u64>) -> Vec<MarketFill> {
        let from = from_id.unwrap_or(1).max(1);
        let limit = limit.unwrap_or(50).min(100);
        (from..read_u64(K_MKT_NEXT).max(1)).take(limit as usize).filter_map(|id| read_json(&slot(K_MKT, id))).collect()
    }

    pub fn get_market_fills_of(&self, owner: AccountId) -> Vec<MarketFill> {
        read_json::<Vec<u64>>(&owner_slot(K_MKT_OWNER, &owner)).unwrap_or_default().into_iter().filter_map(|id| read_json(&slot(K_MKT, id))).collect()
    }

    /// Every one-cancels-the-other pair, as [first, second] order numbers.
    pub fn get_oco_pairs(&self) -> Vec<[u64; 2]> { read_json(K_OCO_PAIRS).unwrap_or_default() }

    pub fn get_config(&self) -> Value {
        json!({
            "owner": self.owner, "token": self.token, "outlayer": self.outlayer,
            "enclave_url": self.enclave_url, "enclave_hash": self.enclave_hash, "tee": self.tee.get(),
            "price_source": PRICE_SOURCE, "max_price_age_s": MAX_PRICE_AGE_NS / 1_000_000_000,
            "fee_bps": FEE_BPS as u64, "order_deposit": U128(ORDER_DEPOSIT.as_yoctonear()), "max_open": MAX_OPEN,
            "second_source": self.second_source(),
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
    fn oracle_price_data_parses_like_price_oracle_testnet() {
        // The exact return of the live probe tx 53Lsy4APti6hkneCNJBfLm9WMm7gn1zJsqCgRDFkJtne.
        let raw = br#"{"timestamp":"1794604600501208921","recency_duration_sec":300,"prices":[{"asset_id":"wrap.near","price":{"multiplier":"351140000","decimals":8}}]}"#;
        assert_eq!(parse_price_data(raw, "wrap.near"), Some(SecondPrice { price_e6: 3_511_400, oracle_ts_ns: 1_794_604_600_501_208_921 }));
        assert_eq!(parse_price_data(raw, "aurora"), None);
        let null = br#"{"timestamp":"1","recency_duration_sec":300,"prices":[{"asset_id":"wrap.near","price":null}]}"#;
        assert_eq!(parse_price_data(null, "wrap.near"), None);
        assert_eq!(parse_price_data(b"not json", "wrap.near"), None);
        let four = br#"{"timestamp":"1","prices":[{"asset_id":"wrap.near","price":{"multiplier":"35114","decimals":4}}]}"#;
        assert_eq!(parse_price_data(four, "wrap.near").unwrap().price_e6, 3_511_400);
    }
    #[test]
    fn agreement_is_measured_in_bps_of_the_oracle_price() {
        assert_eq!(diff_bps(3_507_200, 3_511_400), 12); // the probe: Coinbase 3.5072 vs oracle 3.5114
        assert_eq!(diff_bps(3_511_400, 3_511_400), 0);
        assert_eq!(diff_bps(3_545_000, 3_500_000), 129);
        assert_eq!(diff_bps(3_535_000, 3_500_000), 100);
    }
    #[test]
    fn usd_triggers_parse_to_micro_usd() {
        assert_eq!(parse_usd_e6("3.28"), Some(3_280_000));
        assert_eq!(parse_usd_e6("3.280000"), Some(3_280_000));
        assert_eq!(parse_usd_e6("3"), Some(3_000_000));
        assert_eq!(parse_usd_e6("0.000001"), Some(1));
        for bad in ["", ".5", "3.", "3.1234567", "-3", "3,28", "0", "0.0", "1e3", "3.2.1", "9999999999"] { assert_eq!(parse_usd_e6(bad), None, "{bad}"); }
    }
    #[test]
    fn fill_price_is_tusd_per_near() {
        // 0.2 NEAR sold for 0.6164 tUSD -> 3.082 USD per NEAR.
        assert_eq!(fill_price_e6("sell", 200_000_000_000_000_000_000_000, 616_403), 3_082_015);
        // 1 tUSD spent for 0.3 NEAR -> 3.333333.
        assert_eq!(fill_price_e6("buy", 1_000_000, 300_000_000_000_000_000_000_000), 3_333_333);
        assert_eq!(fill_price_e6("sell", 0, 5), 0);
    }
    #[test]
    fn pool_math_charges_the_fee_and_keeps_k() {
        let out = amm_out(1_000, 100_000, 100_000);
        assert_eq!(out, 987); // 0.3% fee, then x*y=k
        assert!((100_000 + 1_000) * (100_000 - out) >= 100_000u128 * 100_000);
        assert_eq!(amm_out(10, 0, 100), 0);
    }
}
