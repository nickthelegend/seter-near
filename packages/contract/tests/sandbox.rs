//! Signed transactions against a real local nearcore sandbox (near-workspaces). Build both
//! contracts first (`pnpm build:contract`).
//!
//! OutLayer does not exist in the sandbox, so `check()` really calls a missing
//! `outlayer.testnet` and its callback really receives a failed promise: that is how the
//! "failed request, relayer delivers the signed report" path is exercised without a stub.
//! The enclave's ed25519 key is the one thing replaced: the sandbox writes a locally generated
//! key into the contract's `k` storage slot with `patch_state`, a sandbox-only RPC that does
//! not exist on testnet or mainnet. On testnet the key comes from the attested `keys` run.
//!
//! The second price source is the real OutLayer price oracle contract (`tests/fixtures`, built
//! from its public source), deployed in the sandbox. A sandbox account is registered as its price
//! reporter through the oracle's own council flow, so the prices it serves are set by the test;
//! with a fresh report `request_price_data` answers from its cache, exactly as on testnet.
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use mienai::{commitment, TeeKeys, PRICE_SOURCE, REPORT_PREFIX};
use near_sdk::json_types::U64;
use near_workspaces::types::{AccessKey, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const MIENAI: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/target/near/mienai.wasm");
const TUSD: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../token/target/near/mienai_tusd.wasm");
const ORACLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/price_oracle-0.7.0.wasm");
const HASH: &str = "791b4f6cab748be35d9f8c46c4df262bc8af13b4ade21a4b7e42c74e14a71386";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn rejected(result: near_workspaces::result::ExecutionFinalResult, code: &str) {
    assert!(result.is_failure(), "chain accepted an attack that should fail with {code}");
    assert!(format!("{result:?}").contains(code), "rejected with the wrong error (wanted {code}): {result:?}");
}

fn plaintext(cond: &str, trigger_e6: u64, side: &str, amount: u128, salt: &str) -> String {
    json!({"v":1,"cond":cond,"trigger_e6":trigger_e6,"side":side,"amount":amount.to_string(),"salt":salt}).to_string()
}

/// A well-formed sealed blob (format byte 0x01). The contract never opens ciphertexts; the
/// enclave tests cover real sealing and opening.
fn blob(seed: u8) -> String { let mut b = vec![1u8]; b.extend((0..140).map(|i| seed.wrapping_add(i))); B64.encode(b) }

struct World { worker: near_workspaces::Worker<near_workspaces::network::Sandbox>, mienai: Contract, token: Contract, owner: Account, key: SigningKey, oracle: Contract, reporter: Account }

impl World {
    async fn now_ms(&self) -> anyhow::Result<u64> { Ok(self.worker.view_block().await?.timestamp() / 1_000_000) }
    fn sign(&self, key: &SigningKey, body: &str) -> String { let mut m = REPORT_PREFIX.to_vec(); m.extend_from_slice(body.as_bytes()); B64.encode(key.sign(&m).to_bytes()) }
    fn body(&self, request: u64, price_e6: u64, price_ts_ms: u64, fired: Value) -> String {
        json!({"checked":1,"contract":self.mienai.id(),"ctx":{"block":"1","outlayer_request":"sandbox","predecessor":self.mienai.id()},"fired":fired,"op":"check","price_e6":price_e6,"price_ts_ms":price_ts_ms,"request":request,"source":PRICE_SOURCE,"trade_id":1,"unreadable":0,"v":1}).to_string()
    }
    async fn check(&self, caller: &Account) -> anyhow::Result<u64> {
        let stats: Value = self.mienai.view("get_stats").await?.json()?;
        caller.call(self.mienai.id(), "check").deposit(NearToken::from_millinear(20)).gas(Gas::from_tgas(300)).transact().await?.into_result()?;
        let id = stats["requests_total"].as_u64().unwrap() + 1;
        let req: Value = self.mienai.view("get_request").args_json(json!({"id": id})).await?.json()?;
        assert_eq!(req["status"], "Failed", "the sandbox has no OutLayer, so the real callback sees a failed promise");
        Ok(id)
    }
    async fn fire(&self, relayer: &Account, body: &str, sig: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
        Ok(relayer.call(self.mienai.id(), "fire").args_json(json!({"body": body, "sig": sig})).deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?)
    }
    /// The oracle reporter publishes a NEAR price (8 decimals, like price-oracle.testnet).
    async fn oracle_price(&self, price_e6: u64) -> anyhow::Result<()> {
        self.reporter.call(self.oracle.id(), "report_prices").args_json(json!({"prices": [{"asset_id": "wrap.near", "price": {"multiplier": (price_e6 as u128 * 100).to_string(), "decimals": 8}}]})).transact().await?.into_result()?;
        Ok(())
    }
}

async fn world() -> anyhow::Result<World> {
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.dev_create_account().await?;
    let token = worker.dev_deploy(&std::fs::read(TUSD)?).await?;
    token.call("new").args_json(json!({"owner_id": owner.id()})).transact().await?.into_result()?;
    let mienai = worker.dev_deploy(&std::fs::read(MIENAI)?).await?;
    let url = format!("https://test.fastfs.io/{}/outlayer.testnet/{HASH}.wasm", owner.id());
    mienai.call("new").args_json(json!({"owner_id": owner.id(), "token_id": token.id(), "outlayer_id": "outlayer.testnet", "enclave_url": url, "enclave_hash": HASH})).transact().await?.into_result()?;
    // The real price oracle: owner -> council of one -> add the reporter and two assets.
    let oracle = worker.dev_deploy(&std::fs::read(ORACLE)?).await?;
    let reporter = worker.dev_create_account().await?;
    oracle.call("new").args_json(json!({"recency_duration_sec": 300, "owner_id": owner.id(), "near_claim_amount": "0"})).transact().await?.into_result()?;
    owner.call(oracle.id(), "set_council").args_json(json!({"members": [owner.id()]})).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    owner.call(oracle.id(), "create_proposals").args_json(json!({"actions": [
        {"action": "add_oracle", "account_id": reporter.id()},
        {"action": "add_asset", "asset_id": "wrap.near", "push_signer_key": null},
        {"action": "add_asset", "asset_id": "aurora", "push_signer_key": null},
    ]})).deposit(NearToken::from_millinear(500)).gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    // Point Seter's second source at it (on testnet: price-oracle.testnet, the default).
    owner.call(mienai.id(), "set_second_source").args_json(json!({"oracle": oracle.id(), "asset": "wrap.near", "enabled": true, "tolerance_bps": 100})).transact().await?.into_result()?;
    Ok(World { worker, mienai, token, owner, key: SigningKey::from_bytes(&[42u8; 32]), oracle, reporter })
}

#[tokio::test]
async fn sealed_orders_fire_only_on_a_valid_enclave_report() -> anyhow::Result<()> {
    let w = world().await?;
    let alice = w.worker.dev_create_account().await?;
    let mallory = w.worker.dev_create_account().await?;

    // No enclave key yet: orders are refused, and refresh_keys really reaches for OutLayer and fails.
    rejected(alice.call(w.mienai.id(), "place_order").args_json(json!({"ct": blob(1), "commit": "0".repeat(64), "view_ct": null})).deposit(NearToken::from_millinear(20)).transact().await?, "ERR_NO_ENCLAVE");
    rejected(mallory.call(w.mienai.id(), "refresh_keys").deposit(NearToken::from_millinear(10)).transact().await?, "ERR_OWNER");
    w.owner.call(w.mienai.id(), "refresh_keys").deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?.into_result()?;
    let req1: Value = w.mienai.view("get_request").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(req1["status"], "Failed");
    // A non-OutLayer caller cannot deliver a result: the callback is private.
    rejected(mallory.call(w.mienai.id(), "on_result").args_json(json!({"request": 1})).gas(Gas::from_tgas(50)).transact().await?, "is private");

    // Sandbox-only: install the test enclave key (see module docs).
    let keys = TeeKeys { order_pub: B64.encode([9u8; 32]), attest_pub: B64.encode(w.key.verifying_key().to_bytes()), request: 1, set_at_ns: U64(0) };
    w.worker.patch_state(w.mienai.id(), b"k", &near_sdk::borsh::to_vec(&keys)?).await?;
    let cfg: Value = w.mienai.view("get_config").await?.json()?;
    assert_eq!(cfg["tee"]["attest_pub"], keys.attest_pub);

    // Liquidity: 10 NEAR and 36 tUSD (a 3.6 USD pool), seeded by the owner.
    w.owner.call(w.mienai.id(), "seed_pool_near").deposit(NearToken::from_near(10)).transact().await?.into_result()?;
    w.owner.call(w.token.id(), "mint").args_json(json!({"account_id": w.owner.id(), "amount": "1000000000"})).transact().await?.into_result()?;
    w.owner.call(w.token.id(), "mint").args_json(json!({"account_id": w.mienai.id(), "amount": "0"})).transact().await?.into_result()?;
    w.owner.call(w.token.id(), "ft_transfer_call").args_json(json!({"receiver_id": w.mienai.id(), "amount": "36000000", "msg": "seed"})).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    let pool: Value = w.mienai.view("get_pool").await?.json()?;
    assert_eq!(pool, json!({"near": (10 * NEAR).to_string(), "usd": "36000000"}));

    // Alice deposits 2 NEAR and seals a stop at 3.50 (sell 1 NEAR) and a take-profit at 3.80.
    alice.call(w.mienai.id(), "deposit_near").deposit(NearToken::from_near(2)).transact().await?.into_result()?;
    let stop = plaintext("lte", 3_500_000, "sell", NEAR, "11111111111111111111111111111111");
    let tp = plaintext("gte", 3_800_000, "sell", NEAR / 2, "22222222222222222222222222222222");
    for (seed, pt) in [(1u8, &stop), (2u8, &tp)] {
        alice.call(w.mienai.id(), "place_order").args_json(json!({"ct": blob(seed), "commit": commitment(alice.id().as_str(), pt), "view_ct": null})).deposit(NearToken::from_millinear(20)).transact().await?.into_result()?;
    }
    rejected(alice.call(w.mienai.id(), "place_order").args_json(json!({"ct": "bm90IHNlYWxlZA==", "commit": "0".repeat(64), "view_ct": null})).deposit(NearToken::from_millinear(20)).transact().await?, "ERR_CIPHERTEXT");
    rejected(alice.call(w.mienai.id(), "place_order").args_json(json!({"ct": blob(3), "commit": "0".repeat(64), "view_ct": null})).deposit(NearToken::from_millinear(1)).transact().await?, "ERR_ORDER_DEPOSIT");

    // What an attacker sees: ciphertexts, commitments and counts. No trigger anywhere.
    let public = w.mienai.view("get_orders").args_json(json!({})).await?.json::<Value>()?.to_string();
    assert!(!public.contains("3500000") && !public.contains("3800000") && !public.contains("lte"));
    let stats: Value = w.mienai.view("get_stats").await?.json()?;
    assert_eq!(stats["open"], 2);

    // A check request; the enclave reports price 3.49 -> the stop (order 1) fires.
    let r = w.check(&mallory).await?;
    let now = w.now_ms().await?;
    let good = w.body(r, 3_490_000, now, json!([{"id": 1, "pt": stop}]));

    // Attack: a report signed by any key other than the enclave's.
    rejected(w.fire(&mallory, &good, &w.sign(&SigningKey::from_bytes(&[7u8; 32]), &good)).await?, "ERR_SIGNATURE");
    // Attack: a valid signature over a body edited after signing (price changed).
    let sig = w.sign(&w.key, &good);
    rejected(w.fire(&mallory, &good.replace("3490000", "3400000"), &sig).await?, "ERR_SIGNATURE");
    // Attack: fire an order the enclave did not say crossed (price 3.60 is above the 3.50 stop).
    let not_crossed = w.body(r, 3_600_000, now, json!([{"id": 1, "pt": stop}]));
    rejected(w.fire(&mallory, &not_crossed, &w.sign(&w.key, &not_crossed)).await?, "ERR_NOT_CROSSED");
    // Attack: a stale price (5 minutes old).
    let stale = w.body(r, 3_490_000, now - 300_000, json!([{"id": 1, "pt": stop}]));
    rejected(w.fire(&mallory, &stale, &w.sign(&w.key, &stale)).await?, "ERR_STALE_PRICE");
    // Attack: the wrong order — a plaintext that is not what order 2 committed to.
    let wrong = w.body(r, 3_490_000, now, json!([{"id": 2, "pt": stop}]));
    rejected(w.fire(&mallory, &wrong, &w.sign(&w.key, &wrong)).await?, "ERR_COMMITMENT");
    // Attack: an order that was not part of this request.
    let foreign = w.body(r, 3_490_000, now, json!([{"id": 99, "pt": stop}]));
    rejected(w.fire(&mallory, &foreign, &w.sign(&w.key, &foreign)).await?, "ERR_ORDER_NOT_IN_REQUEST");
    // Attack: a report for another contract, or from another price source.
    let other = good.replace(&format!("\"contract\":\"{}\"", w.mienai.id()), "\"contract\":\"evil.testnet\"");
    rejected(w.fire(&mallory, &other, &w.sign(&w.key, &other)).await?, "ERR_BODY");
    let source = good.replace("api.exchange.coinbase.com", "evil.example");
    rejected(w.fire(&mallory, &source, &w.sign(&w.key, &source)).await?, "ERR_SOURCE");

    // Second source: the oracle reads 3.40 while the enclave says 3.49 (2.6% apart) -> refused,
    // and nothing executes. The relayer also has to pay the oracle fee.
    w.oracle_price(3_400_000).await?;
    rejected(mallory.call(w.mienai.id(), "fire").args_json(json!({"body": &good, "sig": &sig})).gas(Gas::from_tgas(300)).transact().await?, "ERR_ORACLE_FEE");
    rejected(w.fire(&mallory, &good, &sig).await?, "ERR_SOURCES_DISAGREE");
    let still: Value = w.mienai.view("get_order").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(still["status"], "Open", "a disagreement must leave the order armed");

    // The genuine report fires the stop once the oracle agrees (3.4995 vs 3.49 = 28 bps < 100).
    w.oracle_price(3_499_500).await?;
    let out = w.fire(&mallory, &good, &sig).await?;
    assert!(out.is_success(), "{out:?}");
    assert_eq!(out.json::<Vec<u64>>()?, vec![1]);
    let order: Value = w.mienai.view("get_order").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(order["status"], "Fired");
    assert_eq!(order["fire"]["trigger_e6"], 3_500_000);
    assert_eq!(order["fire"]["price_e6"], 3_490_000);
    assert_eq!(order["fire"]["plaintext"], stop);
    let second: Value = w.mienai.view("get_fire_second_source").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(second["oracle_price_e6"], 3_499_500);
    assert_eq!(second["enclave_price_e6"], 3_490_000);
    assert_eq!(second["diff_bps"], 28);
    assert_eq!(second["oracle"], w.oracle.id().as_str());
    let bal: Value = w.mienai.view("balance_of").args_json(json!({"account_id": alice.id()})).await?.json()?;
    assert_eq!(bal["near"], NEAR.to_string());
    let usd: u128 = bal["usd"].as_str().unwrap().parse()?;
    assert_eq!(usd, 3_263_799); // 1 NEAR into a 10 NEAR / 36 tUSD pool, 0.3% fee
    // The take-profit stays sealed and open.
    let tp_order: Value = w.mienai.view("get_order").args_json(json!({"id": 2})).await?.json()?;
    assert_eq!(tp_order["status"], "Open");
    assert!(tp_order["fire"].is_null());

    // Attack: replay the same signed report.
    rejected(w.fire(&mallory, &good, &sig).await?, "ERR_REPLAY");

    // No double fire: two requests both include order 2; the second report for it is refused.
    let a = w.check(&mallory).await?;
    let b = w.check(&mallory).await?;
    let now = w.now_ms().await?;
    let fire_a = w.body(a, 3_810_000, now, json!([{"id": 2, "pt": tp}]));
    w.oracle_price(3_800_000).await?;
    assert!(w.fire(&mallory, &fire_a, &w.sign(&w.key, &fire_a)).await?.is_success());
    let fire_b = w.body(b, 3_820_000, now, json!([{"id": 2, "pt": tp}]));
    rejected(w.fire(&mallory, &fire_b, &w.sign(&w.key, &fire_b)).await?, "ERR_ALREADY_FIRED");
    let dup_req = w.check(&mallory).await.err(); // nothing open any more
    assert!(dup_req.is_some(), "check with an empty book must fail (ERR_NOTHING_OPEN)");

    // Cancel: only the owner, only while open, and a cancelled order never executes.
    let pt3 = plaintext("lte", 3_700_000, "sell", NEAR / 4, "33333333333333333333333333333333");
    alice.call(w.mienai.id(), "place_order").args_json(json!({"ct": blob(4), "commit": commitment(alice.id().as_str(), &pt3), "view_ct": blob(5)})).deposit(NearToken::from_millinear(20)).transact().await?.into_result()?;
    let c = w.check(&mallory).await?;
    rejected(mallory.call(w.mienai.id(), "cancel_order").args_json(json!({"id": 3})).transact().await?, "ERR_NOT_OWNER");
    alice.call(w.mienai.id(), "cancel_order").args_json(json!({"id": 3})).transact().await?.into_result()?;
    rejected(alice.call(w.mienai.id(), "cancel_order").args_json(json!({"id": 3})).transact().await?, "ERR_NOT_OPEN");
    let now = w.now_ms().await?;
    let late = w.body(c, 3_600_000, now, json!([{"id": 3, "pt": pt3}]));
    let res = w.fire(&mallory, &late, &w.sign(&w.key, &late)).await?;
    assert!(res.is_success());
    assert_eq!(res.json::<Vec<u64>>()?, Vec::<u64>::new());
    let cancelled: Value = w.mienai.view("get_order").args_json(json!({"id": 3})).await?.json()?;
    assert_eq!(cancelled["status"], "Cancelled");

    // Withdraw: tUSD back to Alice's wallet (she registers on the token through the faucet).
    alice.call(w.token.id(), "faucet").deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    alice.call(w.mienai.id(), "withdraw_usd").args_json(json!({"amount": "1000000"})).gas(Gas::from_tgas(60)).transact().await?.into_result()?;
    let wallet: String = w.token.view("ft_balance_of").args_json(json!({"account_id": alice.id()})).await?.json()?;
    assert_eq!(wallet, "1001000000");
    rejected(alice.call(w.mienai.id(), "withdraw_near").args_json(json!({"amount": (100 * NEAR).to_string()})).transact().await?, "ERR_BALANCE");
    let stats: Value = w.mienai.view("get_stats").await?.json()?;
    assert_eq!(stats["fired"], 2);
    assert_eq!(stats["cancelled"], 1);
    Ok(())
}

#[tokio::test]
async fn only_the_token_can_credit_tusd_and_only_the_owner_seeds() -> anyhow::Result<()> {
    let w = world().await?;
    let mallory = w.worker.dev_create_account().await?;
    rejected(mallory.call(w.mienai.id(), "ft_on_transfer").args_json(json!({"sender_id": mallory.id(), "amount": "1000000000", "msg": ""})).transact().await?, "ERR_TOKEN");
    rejected(mallory.call(w.mienai.id(), "seed_pool_near").deposit(NearToken::from_near(1)).transact().await?, "ERR_OWNER");
    // A non-owner "seed" through the real token is refunded, not added to the pool.
    mallory.call(w.token.id(), "faucet").deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    w.owner.call(w.token.id(), "mint").args_json(json!({"account_id": w.mienai.id(), "amount": "0"})).transact().await?.into_result()?;
    mallory.call(w.token.id(), "ft_transfer_call").args_json(json!({"receiver_id": w.mienai.id(), "amount": "5000000", "msg": "seed"})).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    let pool: Value = w.mienai.view("get_pool").await?.json()?;
    assert_eq!(pool["usd"], "0");
    let wallet: String = w.token.view("ft_balance_of").args_json(json!({"account_id": mallory.id()})).await?.json()?;
    assert_eq!(wallet, "1000000000");
    rejected(mallory.call(w.token.id(), "faucet").deposit(NearToken::from_millinear(10)).transact().await?, "ERR_FAUCET_COOLDOWN");
    Ok(())
}

#[tokio::test]
async fn second_source_must_be_live_and_only_the_owner_configures_it() -> anyhow::Result<()> {
    let w = world().await?;
    let alice = w.worker.dev_create_account().await?;
    let mallory = w.worker.dev_create_account().await?;
    rejected(mallory.call(w.mienai.id(), "set_second_source").args_json(json!({"oracle": mallory.id(), "asset": "wrap.near", "enabled": false, "tolerance_bps": 100})).transact().await?, "ERR_OWNER");
    rejected(w.owner.call(w.mienai.id(), "set_second_source").args_json(json!({"oracle": w.oracle.id(), "asset": "wrap.near", "enabled": true, "tolerance_bps": 5000})).transact().await?, "ERR_TOLERANCE");
    let keys = TeeKeys { order_pub: B64.encode([9u8; 32]), attest_pub: B64.encode(w.key.verifying_key().to_bytes()), request: 1, set_at_ns: U64(0) };
    w.worker.patch_state(w.mienai.id(), b"k", &near_sdk::borsh::to_vec(&keys)?).await?;
    w.owner.call(w.mienai.id(), "seed_pool_near").deposit(NearToken::from_near(10)).transact().await?.into_result()?;
    alice.call(w.mienai.id(), "deposit_near").deposit(NearToken::from_near(1)).transact().await?.into_result()?;
    let stop = plaintext("lte", 3_500_000, "sell", NEAR / 10, "44444444444444444444444444444444");
    alice.call(w.mienai.id(), "place_order").args_json(json!({"ct": blob(1), "commit": commitment(alice.id().as_str(), &stop), "view_ct": null})).deposit(NearToken::from_millinear(20)).transact().await?.into_result()?;

    // The old 0.01 NEAR check is refused: 0.01 for the enclave plus 0.01 held for the oracle.
    rejected(mallory.call(w.mienai.id(), "check").deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?, "ERR_OUTLAYER_FEE");
    let r = w.check(&mallory).await?;
    let now = w.now_ms().await?;
    let body = w.body(r, 3_490_000, now, json!([{"id": 1, "pt": stop}]));
    let sig = w.sign(&w.key, &body);

    // An oracle with no fresh price for the asset: the oracle's own refresh path runs and fails
    // (no OutLayer in the sandbox), so the fire is refused. Fail closed, never single-source.
    w.owner.call(w.mienai.id(), "set_second_source").args_json(json!({"oracle": w.oracle.id(), "asset": "aurora", "enabled": true, "tolerance_bps": 100})).transact().await?.into_result()?;
    rejected(w.fire(&mallory, &body, &sig).await?, "ERR_SECOND_SOURCE_UNAVAILABLE");
    // A stale wrap.near report (none yet) is the same: no price, no fire.
    w.owner.call(w.mienai.id(), "set_second_source").args_json(json!({"oracle": w.oracle.id(), "asset": "wrap.near", "enabled": true, "tolerance_bps": 100})).transact().await?.into_result()?;
    rejected(w.fire(&mallory, &body, &sig).await?, "ERR_SECOND_SOURCE_UNAVAILABLE");
    // Exactly at the tolerance edge (3.5253 vs 3.49 = 101 bps) is still refused; 98 bps fires.
    w.oracle_price(3_525_300).await?;
    rejected(w.fire(&mallory, &body, &sig).await?, "ERR_SOURCES_DISAGREE");
    w.oracle_price(3_524_500).await?;
    let out = w.fire(&mallory, &body, &sig).await?;
    assert!(out.is_success(), "{out:?}");
    let order: Value = w.mienai.view("get_order").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(order["status"], "Unfilled", "executed against an empty tUSD side, so recorded Unfilled");
    assert_eq!(order["fire"]["price_e6"], 3_490_000);
    let info: Value = w.mienai.view("get_second_source").await?.json()?;
    assert_eq!(info["last_agreement"]["diff_bps"], 98);
    assert_eq!(info["config"]["tolerance_bps"], 100);
    Ok(())
}

#[tokio::test]
async fn the_scoped_keeper_key_can_only_run_budgeted_checks() -> anyhow::Result<()> {
    let w = world().await?;
    let alice = w.worker.dev_create_account().await?;
    let keys = TeeKeys { order_pub: B64.encode([9u8; 32]), attest_pub: B64.encode(w.key.verifying_key().to_bytes()), request: 1, set_at_ns: U64(0) };
    w.worker.patch_state(w.mienai.id(), b"k", &near_sdk::borsh::to_vec(&keys)?).await?;
    alice.call(w.mienai.id(), "deposit_near").deposit(NearToken::from_near(1)).transact().await?.into_result()?;
    let stop = plaintext("lte", 3_000_000, "sell", NEAR / 10, "55555555555555555555555555555555");
    alice.call(w.mienai.id(), "place_order").args_json(json!({"ct": blob(1), "commit": commitment(alice.id().as_str(), &stop), "view_ct": null})).deposit(NearToken::from_millinear(20)).transact().await?.into_result()?;

    // A function-call key on the vault account, limited to `check` on the vault, with a gas
    // allowance (2 NEAR here: sandbox gas costs 10x testnet's, where 0.25 NEAR is used).
    let sk = SecretKey::from_random(KeyType::ED25519);
    w.mienai.as_account().batch(w.mienai.id()).add_key(sk.public_key(), AccessKey::function_call_access(w.mienai.id(), &["check"], Some(NearToken::from_near(2)))).transact().await?.into_result()?;
    let keeper = Account::from_secret_key(w.mienai.id().clone(), sk, &w.worker);

    // Anyone else's zero-deposit check is refused; the vault's own is refused until funded.
    rejected(alice.call(w.mienai.id(), "check").gas(Gas::from_tgas(300)).transact().await?, "ERR_OUTLAYER_FEE");
    rejected(keeper.call(w.mienai.id(), "check").gas(Gas::from_tgas(300)).transact().await?, "ERR_KEEPER_BUDGET");
    rejected(alice.call(w.mienai.id(), "fund_keeper").transact().await?, "ERR_ZERO");
    alice.call(w.mienai.id(), "fund_keeper").deposit(NearToken::from_millinear(50)).transact().await?.into_result()?;

    // The keeper key runs a check: 0.02 NEAR leaves the budget; the sandbox has no OutLayer, the
    // request fails, and the unused 0.01 NEAR oracle reserve goes back into the budget.
    keeper.call(w.mienai.id(), "check").gas(Gas::from_tgas(300)).transact().await?.into_result()?;
    let info: Value = w.mienai.view("get_second_source").await?.json()?;
    assert_eq!(info["keeper_budget"], NearToken::from_millinear(40).as_yoctonear().to_string());
    let req: Value = w.mienai.view("get_request").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(req["caller"], w.mienai.id().as_str());
    assert_eq!(req["status"], "Failed");
    // User balances are untouched by keeper checks.
    let bal: Value = w.mienai.view("balance_of").args_json(json!({"account_id": alice.id()})).await?.json()?;
    assert_eq!(bal["near"], NEAR.to_string());

    // The key cannot do anything else: other methods and attached deposits are refused by the
    // protocol before the contract runs (invalid transaction, nothing included on chain).
    let other = keeper.call(w.mienai.id(), "withdraw_near").args_json(json!({"amount": "1"})).transact().await;
    assert!(format!("{other:?}").contains("MethodNameMismatch"), "{other:?}");
    let paid = keeper.call(w.mienai.id(), "check").deposit(NearToken::from_millinear(20)).gas(Gas::from_tgas(300)).transact().await;
    assert!(format!("{paid:?}").contains("DepositWithFunctionCall"), "{paid:?}");
    let other_receiver = keeper.call(w.token.id(), "faucet").transact().await;
    assert!(format!("{other_receiver:?}").contains("ReceiverMismatch"), "{other_receiver:?}");
    Ok(())
}

/// Liquidity for the order-type tests: 10 NEAR and 33 tUSD (a 3.30 USD pool), and the test enclave key.
async fn seeded(w: &World) -> anyhow::Result<()> {
    let keys = TeeKeys { order_pub: B64.encode([9u8; 32]), attest_pub: B64.encode(w.key.verifying_key().to_bytes()), request: 1, set_at_ns: U64(0) };
    w.worker.patch_state(w.mienai.id(), b"k", &near_sdk::borsh::to_vec(&keys)?).await?;
    w.owner.call(w.mienai.id(), "seed_pool_near").deposit(NearToken::from_near(10)).transact().await?.into_result()?;
    w.owner.call(w.token.id(), "mint").args_json(json!({"account_id": w.owner.id(), "amount": "1000000000"})).transact().await?.into_result()?;
    w.owner.call(w.token.id(), "mint").args_json(json!({"account_id": w.mienai.id(), "amount": "0"})).transact().await?.into_result()?;
    w.owner.call(w.token.id(), "ft_transfer_call").args_json(json!({"receiver_id": w.mienai.id(), "amount": "33000000", "msg": "seed"})).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn market_orders_fill_now_against_the_pool() -> anyhow::Result<()> {
    let w = world().await?;
    seeded(&w).await?;
    let alice = w.worker.dev_create_account().await?;
    alice.call(w.mienai.id(), "deposit_near").deposit(NearToken::from_near(1)).transact().await?.into_result()?;
    // Selling more than the vault holds, a bad side and a min_out above the quote are all refused.
    rejected(alice.call(w.mienai.id(), "market_order").args_json(json!({"side": "sell", "amount": (2 * NEAR).to_string(), "min_out": "0"})).transact().await?, "ERR_NOT_FILLED: insufficient NEAR in vault");
    rejected(alice.call(w.mienai.id(), "market_order").args_json(json!({"side": "short", "amount": "1", "min_out": "0"})).transact().await?, "ERR_SIDE");
    let quote: String = w.mienai.view("quote").args_json(json!({"side": "sell", "amount": (NEAR / 10).to_string()})).await?.json()?;
    let q: u128 = quote.parse()?;
    rejected(alice.call(w.mienai.id(), "market_order").args_json(json!({"side": "sell", "amount": (NEAR / 10).to_string(), "min_out": (q + 1).to_string()})).transact().await?, "ERR_SLIPPAGE");
    // A real fill at the quote: 0.1 NEAR into a 10 NEAR / 33 tUSD pool, 0.3% fee.
    let fill: Value = alice.call(w.mienai.id(), "market_order").args_json(json!({"side": "sell", "amount": (NEAR / 10).to_string(), "min_out": q.to_string()})).transact().await?.into_result()?.json()?;
    assert_eq!(fill["amount_out"], quote);
    assert_eq!(q, 325_762);
    assert_eq!(fill["price_e6"], 3_257_620);
    let bal: Value = w.mienai.view("balance_of").args_json(json!({"account_id": alice.id()})).await?.json()?;
    assert_eq!(bal["near"], (NEAR * 9 / 10).to_string());
    assert_eq!(bal["usd"], "325762");
    // And back: buy NEAR with the tUSD just received.
    let back: Value = alice.call(w.mienai.id(), "market_order").args_json(json!({"side": "buy", "amount": "325762", "min_out": "1"})).transact().await?.into_result()?.json()?;
    assert_eq!(back["side"], "buy");
    let fills: Vec<Value> = w.mienai.view("get_market_fills_of").args_json(json!({"owner": alice.id()})).await?.json()?;
    assert_eq!(fills.len(), 2);
    let bal: Value = w.mienai.view("balance_of").args_json(json!({"account_id": alice.id()})).await?.json()?;
    assert_eq!(bal["usd"], "0");
    assert!(bal["near"].as_str().unwrap().parse::<u128>()? < NEAR, "two fees were paid to the pool");
    Ok(())
}

#[tokio::test]
async fn public_orders_are_readable_and_fire_on_the_checked_price() -> anyhow::Result<()> {
    let w = world().await?;
    seeded(&w).await?;
    let alice = w.worker.dev_create_account().await?;
    let mallory = w.worker.dev_create_account().await?;
    alice.call(w.mienai.id(), "deposit_near").deposit(NearToken::from_near(1)).transact().await?.into_result()?;
    let place = |trigger: &str| json!({"kind": "stop", "cond": "lte", "trigger_usd": trigger, "side": "sell", "amount": (NEAR / 5).to_string()});
    rejected(alice.call(w.mienai.id(), "place_public_order").args_json(place("3.28")).deposit(NearToken::from_millinear(1)).transact().await?, "ERR_ORDER_DEPOSIT");
    rejected(alice.call(w.mienai.id(), "place_public_order").args_json(place("3,28")).deposit(NearToken::from_millinear(20)).transact().await?, "ERR_TRIGGER");
    rejected(alice.call(w.mienai.id(), "place_public_order").args_json(json!({"kind": "stop", "cond": "eq", "trigger_usd": "3.28", "side": "sell", "amount": "1"})).deposit(NearToken::from_millinear(20)).transact().await?, "ERR_COND");
    let id: u64 = alice.call(w.mienai.id(), "place_public_order").args_json(place("3.28")).deposit(NearToken::from_millinear(20)).transact().await?.into_result()?.json()?;
    assert_eq!(id, 1);
    // Unlike a sealed order, the trigger is in plain view for anyone.
    let book: Vec<Value> = w.mienai.view("get_public_orders").args_json(json!({})).await?.json()?;
    assert_eq!(book[0]["trigger_e6"], 3_280_000);
    assert_eq!(book[0]["cond"], "lte");
    rejected(mallory.call(w.mienai.id(), "cancel_public_order").args_json(json!({"id": 1})).transact().await?, "ERR_NOT_OWNER");

    // A check runs with only a public order open. At 3.30 nothing crosses; the request is consumed.
    let r = w.check(&mallory).await?;
    let now = w.now_ms().await?;
    let above = w.body(r, 3_300_000, now, json!([]));
    let out = w.fire(&mallory, &above, &w.sign(&w.key, &above)).await?;
    assert!(out.is_success(), "{out:?}");
    let o: Value = w.mienai.view("get_public_order").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(o["status"], "Open");

    // At 3.27 it crosses: the same two-source rule applies before it sells.
    let r = w.check(&mallory).await?;
    let now = w.now_ms().await?;
    let below = w.body(r, 3_270_000, now, json!([]));
    let sig = w.sign(&w.key, &below);
    w.oracle_price(3_400_000).await?;
    rejected(w.fire(&mallory, &below, &sig).await?, "ERR_SOURCES_DISAGREE");
    w.oracle_price(3_272_000).await?;
    let out = w.fire(&mallory, &below, &sig).await?;
    assert!(out.is_success(), "{out:?}");
    let o: Value = w.mienai.view("get_public_order").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(o["status"], "Fired");
    assert_eq!(o["fire"]["price_e6"], 3_270_000);
    assert_eq!(o["fire"]["filled_in"], (NEAR / 5).to_string());
    assert!(o["fire"]["filled_out"].as_str().unwrap().parse::<u128>()? > 600_000);
    assert!(w.mienai.view("get_public_open_ids").await?.json::<Vec<u64>>()?.is_empty());
    rejected(alice.call(w.mienai.id(), "cancel_public_order").args_json(json!({"id": 1})).transact().await?, "ERR_NOT_OPEN");
    Ok(())
}

#[tokio::test]
async fn oco_pairs_cancel_the_other_leg() -> anyhow::Result<()> {
    let w = world().await?;
    seeded(&w).await?;
    let alice = w.worker.dev_create_account().await?;
    let mallory = w.worker.dev_create_account().await?;
    alice.call(w.mienai.id(), "deposit_near").deposit(NearToken::from_near(1)).transact().await?.into_result()?;
    let stop = plaintext("lte", 3_200_000, "sell", NEAR / 10, "66666666666666666666666666666666");
    let tp = plaintext("gte", 3_400_000, "sell", NEAR / 10, "77777777777777777777777777777777");
    let leg = |seed: u8, pt: &str| json!({"ct": blob(seed), "commit": commitment(alice.id().as_str(), pt), "view_ct": null});
    rejected(alice.call(w.mienai.id(), "place_oco").args_json(json!({"a": leg(1, &stop), "b": leg(2, &tp)})).deposit(NearToken::from_millinear(20)).transact().await?, "ERR_ORDER_DEPOSIT");
    rejected(alice.call(w.mienai.id(), "place_oco").args_json(json!({"a": leg(1, &stop), "b": leg(2, &stop)})).deposit(NearToken::from_millinear(40)).transact().await?, "ERR_OCO_SAME_ORDER");
    let ids: Vec<u64> = alice.call(w.mienai.id(), "place_oco").args_json(json!({"a": leg(1, &stop), "b": leg(2, &tp)})).deposit(NearToken::from_millinear(40)).transact().await?.into_result()?.json()?;
    assert_eq!(ids, vec![1, 2]);
    assert_eq!(w.mienai.view("get_oco_pairs").await?.json::<Vec<[u64; 2]>>()?, vec![[1, 2]]);
    // Both legs stay sealed: no level in the public view.
    let public = w.mienai.view("get_orders").args_json(json!({})).await?.json::<Value>()?.to_string();
    assert!(!public.contains("3200000") && !public.contains("3400000"));

    // The take-profit crosses at 3.41: it sells, and the stop is cancelled in the same transaction.
    let r = w.check(&mallory).await?;
    let now = w.now_ms().await?;
    let body = w.body(r, 3_410_000, now, json!([{"id": 2, "pt": tp}]));
    w.oracle_price(3_405_000).await?;
    let out = w.fire(&mallory, &body, &w.sign(&w.key, &body)).await?;
    assert!(out.is_success(), "{out:?}");
    assert!(format!("{:?}", out.logs()).contains("oco_cancelled"));
    let a: Value = w.mienai.view("get_order").args_json(json!({"id": 1})).await?.json()?;
    let b: Value = w.mienai.view("get_order").args_json(json!({"id": 2})).await?.json()?;
    assert_eq!((a["status"].as_str(), b["status"].as_str()), (Some("Cancelled"), Some("Fired")));
    assert!(a["fire"].is_null(), "the cancelled leg's level is never revealed");

    // A report naming both legs of a pair executes only the first.
    let stop2 = plaintext("lte", 3_500_000, "sell", NEAR / 10, "88888888888888888888888888888888");
    let tp2 = plaintext("gte", 3_100_000, "sell", NEAR / 10, "99999999999999999999999999999999");
    alice.call(w.mienai.id(), "place_oco").args_json(json!({"a": leg(3, &stop2), "b": leg(4, &tp2)})).deposit(NearToken::from_millinear(40)).transact().await?.into_result()?;
    let r = w.check(&mallory).await?;
    let now = w.now_ms().await?;
    let both = w.body(r, 3_300_000, now, json!([{"id": 3, "pt": stop2}, {"id": 4, "pt": tp2}]));
    w.oracle_price(3_300_000).await?;
    let out = w.fire(&mallory, &both, &w.sign(&w.key, &both)).await?;
    assert_eq!(out.json::<Vec<u64>>()?, vec![3]);
    let d: Value = w.mienai.view("get_order").args_json(json!({"id": 4})).await?.json()?;
    assert_eq!(d["status"], "Cancelled");

    // Cancelling one leg cancels the pair.
    let s3 = plaintext("lte", 3_000_000, "sell", NEAR / 10, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let t3 = plaintext("gte", 3_600_000, "sell", NEAR / 10, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    let ids: Vec<u64> = alice.call(w.mienai.id(), "place_oco").args_json(json!({"a": leg(5, &s3), "b": leg(6, &t3)})).deposit(NearToken::from_millinear(40)).transact().await?.into_result()?.json()?;
    rejected(mallory.call(w.mienai.id(), "cancel_order").args_json(json!({"id": ids[0]})).transact().await?, "ERR_NOT_OWNER");
    alice.call(w.mienai.id(), "cancel_order").args_json(json!({"id": ids[0]})).transact().await?.into_result()?;
    let e: Value = w.mienai.view("get_order").args_json(json!({"id": ids[1]})).await?.json()?;
    assert_eq!(e["status"], "Cancelled");
    let stats: Value = w.mienai.view("get_stats").await?.json()?;
    assert_eq!((stats["open"].as_u64(), stats["fired"].as_u64(), stats["cancelled"].as_u64()), (Some(0), Some(2), Some(4)));
    Ok(())
}

#[tokio::test]
async fn order_types_upgrade_keeps_state() -> anyhow::Result<()> {
    // The code running on testnet before this upgrade, then an in-place deploy of the new build.
    let w = world().await?;
    let old = w.worker.dev_deploy(&std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/mienai-testnet-two-source.wasm"))?).await?;
    let url = format!("https://test.fastfs.io/{}/outlayer.testnet/{HASH}.wasm", w.owner.id());
    old.call("new").args_json(json!({"owner_id": w.owner.id(), "token_id": w.token.id(), "outlayer_id": "outlayer.testnet", "enclave_url": url, "enclave_hash": HASH})).transact().await?.into_result()?;
    let keys = TeeKeys { order_pub: B64.encode([9u8; 32]), attest_pub: B64.encode(w.key.verifying_key().to_bytes()), request: 1, set_at_ns: U64(0) };
    w.worker.patch_state(old.id(), b"k", &near_sdk::borsh::to_vec(&keys)?).await?;
    let alice = w.worker.dev_create_account().await?;
    alice.call(old.id(), "deposit_near").deposit(NearToken::from_near(1)).transact().await?.into_result()?;
    let pt = plaintext("lte", 3_000_000, "sell", NEAR / 10, "cccccccccccccccccccccccccccccccc");
    alice.call(old.id(), "place_order").args_json(json!({"ct": blob(1), "commit": commitment(alice.id().as_str(), &pt), "view_ct": blob(2)})).deposit(NearToken::from_millinear(20)).transact().await?.into_result()?;
    old.call("fund_keeper").deposit(NearToken::from_millinear(50)).transact().await?.into_result()?;
    let before: Value = old.view("get_stats").await?.json()?;
    let order_before: Value = old.view("get_order").args_json(json!({"id": 1})).await?.json()?;
    old.as_account().deploy(&std::fs::read(MIENAI)?).await?.into_result()?;
    let after: Value = old.view("get_stats").await?.json()?;
    assert_eq!(before, after);
    assert_eq!(order_before, old.view("get_order").args_json(json!({"id": 1})).await?.json::<Value>()?);
    let second: Value = old.view("get_second_source").await?.json()?;
    assert_eq!(second["keeper_budget"], NearToken::from_millinear(50).as_yoctonear().to_string());
    // New methods work on the upgraded state, and new sealed orders continue the numbering.
    assert!(old.view("get_public_orders").args_json(json!({})).await?.json::<Vec<Value>>()?.is_empty());
    let id: u64 = alice.call(old.id(), "place_order").args_json(json!({"ct": blob(3), "commit": "1".repeat(64), "view_ct": null})).deposit(NearToken::from_millinear(20)).transact().await?.into_result()?.json()?;
    assert_eq!(id, 2);
    alice.call(old.id(), "cancel_order").args_json(json!({"id": 1})).transact().await?.into_result()?;
    let o: Value = old.view("get_order").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(o["status"], "Cancelled");
    Ok(())
}
