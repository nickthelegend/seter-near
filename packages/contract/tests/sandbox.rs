//! Signed transactions against a real local nearcore sandbox (near-workspaces). Build both
//! contracts first (`pnpm build:contract`).
//!
//! OutLayer does not exist in the sandbox, so `check()` really calls a missing
//! `outlayer.testnet` and its callback really receives a failed promise: that is how the
//! "failed request, relayer delivers the signed report" path is exercised without a stub.
//! The enclave's ed25519 key is the one thing replaced: the sandbox writes a locally generated
//! key into the contract's `k` storage slot with `patch_state`, a sandbox-only RPC that does
//! not exist on testnet or mainnet. On testnet the key comes from the attested `keys` run.
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use mienai::{commitment, TeeKeys, PRICE_SOURCE, REPORT_PREFIX};
use near_sdk::json_types::U64;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const MIENAI: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/target/near/mienai.wasm");
const TUSD: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../token/target/near/mienai_tusd.wasm");
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

struct World { worker: near_workspaces::Worker<near_workspaces::network::Sandbox>, mienai: Contract, token: Contract, owner: Account, key: SigningKey }

impl World {
    async fn now_ms(&self) -> anyhow::Result<u64> { Ok(self.worker.view_block().await?.timestamp() / 1_000_000) }
    fn sign(&self, key: &SigningKey, body: &str) -> String { let mut m = REPORT_PREFIX.to_vec(); m.extend_from_slice(body.as_bytes()); B64.encode(key.sign(&m).to_bytes()) }
    fn body(&self, request: u64, price_e6: u64, price_ts_ms: u64, fired: Value) -> String {
        json!({"checked":1,"contract":self.mienai.id(),"ctx":{"block":"1","outlayer_request":"sandbox","predecessor":self.mienai.id()},"fired":fired,"op":"check","price_e6":price_e6,"price_ts_ms":price_ts_ms,"request":request,"source":PRICE_SOURCE,"trade_id":1,"unreadable":0,"v":1}).to_string()
    }
    async fn check(&self, caller: &Account) -> anyhow::Result<u64> {
        let stats: Value = self.mienai.view("get_stats").await?.json()?;
        caller.call(self.mienai.id(), "check").deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(300)).transact().await?.into_result()?;
        let id = stats["requests_total"].as_u64().unwrap() + 1;
        let req: Value = self.mienai.view("get_request").args_json(json!({"id": id})).await?.json()?;
        assert_eq!(req["status"], "Failed", "the sandbox has no OutLayer, so the real callback sees a failed promise");
        Ok(id)
    }
    async fn fire(&self, relayer: &Account, body: &str, sig: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
        Ok(relayer.call(self.mienai.id(), "fire").args_json(json!({"body": body, "sig": sig})).gas(Gas::from_tgas(100)).transact().await?)
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
    Ok(World { worker, mienai, token, owner, key: SigningKey::from_bytes(&[42u8; 32]) })
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

    // The genuine report fires the stop and swaps 1 NEAR for tUSD on the pool.
    let out = w.fire(&mallory, &good, &sig).await?;
    assert!(out.is_success(), "{out:?}");
    assert_eq!(out.json::<Vec<u64>>()?, vec![1]);
    let order: Value = w.mienai.view("get_order").args_json(json!({"id": 1})).await?.json()?;
    assert_eq!(order["status"], "Fired");
    assert_eq!(order["fire"]["trigger_e6"], 3_500_000);
    assert_eq!(order["fire"]["price_e6"], 3_490_000);
    assert_eq!(order["fire"]["plaintext"], stop);
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
