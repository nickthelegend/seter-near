//! Mienai trigger enclave: a WASI P2 component run by OutLayer inside Intel TDX.
//!
//! Operations (input is JSON on stdin, built by the Mienai contract from its own state):
//! - `keys`: publish the X25519 order public key and the ed25519 report key.
//! - `check`: read NEAR/USD from Coinbase, open every sealed order, and report the ones whose
//!   trigger the price crossed, with their plaintext, for the contract to verify and execute.
//! - `bands`: publish order counts per $0.05 price band, only for bands with at least 5 orders.

mod core;

/// The manifest is embedded in a custom section, so the wasm hash covers the network
/// allowlist, the key declarations and the caller rule.
#[used]
#[cfg_attr(target_arch = "wasm32", link_section = "outlayer.manifest")]
#[cfg(not(feature = "direct-probe"))]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest.json").len()] = *include_bytes!("../manifest.json");
/// A probe build for checking the code on OutLayer before the contract exists: the same code,
/// a manifest admitting only a direct call. Never pinned by the contract.
#[used]
#[cfg_attr(target_arch = "wasm32", link_section = "outlayer.manifest")]
#[cfg(feature = "direct-probe")]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest-direct-probe.json").len()] = *include_bytes!("../manifest-direct-probe.json");

#[cfg(target_arch = "wasm32")]
mod signing_keys_host {
    wit_bindgen::generate!({ world: "signing-keys-host", path: "wit" });
}
#[cfg(target_arch = "wasm32")]
mod encryption_keys_host {
    wit_bindgen::generate!({ world: "encryption-keys-host", path: "wit-encryption" });
}

#[cfg(target_arch = "wasm32")]
struct OutLayer;

#[cfg(target_arch = "wasm32")]
impl core::Host for OutLayer {
    fn order_secret(&self) -> Result<[u8; 32], String> {
        let tag = encryption_keys_host::outlayer::encryption_keys::api::mac("orders", None, core::ORDER_KEY_LABEL)?;
        tag.try_into().map_err(|_| "mac returned a wrong length".to_string())
    }
    fn attest_public(&self) -> Result<[u8; 32], String> {
        let key = signing_keys_host::outlayer::signing_keys::api::public_key("attest", None)?;
        key.try_into().map_err(|_| "public key has a wrong length".to_string())
    }
    fn sign(&self, message: &[u8]) -> Result<Vec<u8>, String> {
        signing_keys_host::outlayer::signing_keys::api::sign("attest", None, message)
    }
    fn fetch_price(&self) -> Result<Vec<u8>, String> {
        let response = wasi_http_client::Client::new()
            .get(core::PRICE_SOURCE)
            .header("User-Agent", "mienai-enclave/0.1")
            .header("Accept", "application/json")
            .connect_timeout(std::time::Duration::from_secs(15))
            .send()
            .map_err(|e| format!("price source unreachable: {e}"))?;
        if response.status() != 200 { return Err(format!("price source HTTP {}", response.status())); }
        response.body().map_err(|e| format!("price source body: {e}"))
    }
    fn env(&self, key: &str) -> Option<String> { std::env::var(key).ok() }
}

#[cfg(target_arch = "wasm32")]
fn main() {
    use std::io::{Read, Write};
    let _ = &OUTLAYER_MANIFEST;
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let out = match core::run(&OutLayer, &input) {
        Ok(out) => out,
        Err(error) => serde_json::json!({ "error": error }).to_string(),
    };
    let mut stdout = std::io::stdout();
    let _ = stdout.write_all(out.as_bytes());
    let _ = stdout.flush();
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    let _ = &OUTLAYER_MANIFEST;
    eprintln!("mienai-enclave runs on OutLayer (wasm32-wasip2); natively it only runs its tests (cargo test)");
    std::process::exit(2);
}

#[cfg(test)]
mod tests {
    //! Native tests. The keystore is replaced by a local ed25519 key and a fixed MAC key
    //! (the enclave never sees its real keys either; it asks the host). Prices are real
    //! Coinbase responses captured on 2026-11-09 in `fixtures/`.
    use super::core::{self, Host, Plain};
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};
    use hmac::{Hmac, Mac};
    use serde_json::{json, Value};
    use sha2::Sha256;

    struct Local { sk: SigningKey, mac_key: [u8; 32], price: Vec<u8>, pred: Option<String> }
    impl Local {
        fn new(price: &[u8]) -> Self { Self { sk: SigningKey::from_bytes(&[7u8; 32]), mac_key: [9u8; 32], price: price.to_vec(), pred: Some(CONTRACT.into()) } }
    }
    impl Host for Local {
        fn order_secret(&self) -> Result<[u8; 32], String> {
            let mut m = Hmac::<Sha256>::new_from_slice(&self.mac_key).unwrap();
            m.update(core::ORDER_KEY_LABEL);
            Ok(m.finalize().into_bytes().into())
        }
        fn attest_public(&self) -> Result<[u8; 32], String> { Ok(self.sk.verifying_key().to_bytes()) }
        fn sign(&self, message: &[u8]) -> Result<Vec<u8>, String> { Ok(self.sk.sign(message).to_bytes().to_vec()) }
        fn fetch_price(&self) -> Result<Vec<u8>, String> { Ok(self.price.clone()) }
        fn env(&self, key: &str) -> Option<String> { if key == "NEAR_PREDECESSOR_ID" { self.pred.clone() } else { None } }
    }

    const CONTRACT: &str = "mienai-3013a230.testnet";
    const T1: &[u8] = include_bytes!("../fixtures/coinbase-ticker-1.json"); // 3.5892
    const T2: &[u8] = include_bytes!("../fixtures/coinbase-ticker-2.json"); // 3.5896

    fn plain(cond: &str, trigger_e6: u64) -> String {
        json!({"v":1,"cond":cond,"trigger_e6":trigger_e6,"side":"sell","amount":"100000000000000000000000","salt":"00112233445566778899aabbccddeeff"}).to_string()
    }
    fn order(host: &Local, id: u64, owner: &str, pt: &str) -> Value {
        let tee = core::order_public(&host.order_secret().unwrap());
        let ct = core::seal(&tee, owner, pt.as_bytes(), [id as u8 + 1; 32], [3u8; 24]);
        json!({"id": id, "owner": owner, "ct": ct, "commit": core::commitment(owner, pt.as_bytes())})
    }
    fn report(host: &Local, input: Value) -> Value {
        let out: Value = serde_json::from_str(&core::run(host, &input.to_string()).unwrap()).unwrap();
        let body = out["body"].as_str().unwrap();
        let sig = Signature::from_slice(&B64.decode(out["sig"].as_str().unwrap()).unwrap()).unwrap();
        let mut msg = core::REPORT_PREFIX.to_vec();
        msg.extend_from_slice(body.as_bytes());
        host.sk.verifying_key().verify(&msg, &sig).expect("report signature verifies");
        serde_json::from_str(body).unwrap()
    }

    #[test]
    fn encryption_round_trip_and_owner_binding() {
        let host = Local::new(T1);
        let secret = host.order_secret().unwrap();
        let pt = plain("lte", 3_500_000);
        let ct = core::seal(&core::order_public(&secret), "alice.testnet", pt.as_bytes(), [5u8; 32], [6u8; 24]);
        assert_eq!(core::open(&secret, "alice.testnet", &ct).unwrap(), pt.as_bytes());
        // The same ciphertext copied onto another owner's order does not open.
        assert_eq!(core::open(&secret, "mallory.testnet", &ct), Err("decryption failed"));
        // A different enclave key (another build or another contract) opens nothing.
        assert_eq!(core::open(&[1u8; 32], "alice.testnet", &ct), Err("decryption failed"));
        // One flipped bit is rejected.
        let mut raw = B64.decode(&ct).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 1;
        assert!(core::open(&secret, "alice.testnet", &B64.encode(raw)).is_err());
    }

    #[test]
    fn commitment_vector_matches_contract_and_sdk() {
        let pt = r#"{"v":1,"cond":"lte","trigger_e6":3500000,"side":"sell","amount":"1","salt":"00112233445566778899aabbccddeeff"}"#;
        assert_eq!(core::commitment("alice.testnet", pt.as_bytes()), "0ddc05f14be95cea75b956d8e81da516232638132e0614b049c4a1b771d538f3");
    }

    #[test]
    fn real_coinbase_ticker_parses() {
        let p = core::parse_ticker(T1).unwrap();
        assert_eq!(p.price_e6, 3_589_200);
        assert_eq!(p.trade_id, 36_355_783);
        assert_eq!(p.ts_ms, 1_794_242_885_810); // 2026-11-09T16:48:05.810Z
        assert_eq!(core::parse_e6("3.5"), Some(3_500_000));
        assert_eq!(core::parse_e6("3.12345678"), Some(3_123_456));
        assert_eq!(core::parse_e6("-1"), None);
    }

    #[test]
    fn keys_report_is_signed_and_names_the_contract() {
        let host = Local::new(T1);
        let body = report(&host, json!({"operation":"keys","contract":CONTRACT,"request":1}));
        assert_eq!(body["op"], "keys");
        assert_eq!(B64.decode(body["attest_pub"].as_str().unwrap()).unwrap(), host.sk.verifying_key().to_bytes());
        assert_eq!(B64.decode(body["order_pub"].as_str().unwrap()).unwrap(), core::order_public(&host.order_secret().unwrap()));
    }

    #[test]
    fn fires_only_orders_the_real_price_crossed_and_hides_the_rest() {
        let host = Local::new(T1); // 3.5892
        let stop_hit = plain("lte", 3_590_000);   // 3.5892 <= 3.59 -> fires
        let stop_far = plain("lte", 3_400_000);   // not crossed
        let tp_hit = plain("gte", 3_589_200);     // equal counts as crossed
        let tp_far = plain("gte", 3_700_000);
        let orders = vec![order(&host, 1, "a.testnet", &stop_hit), order(&host, 2, "b.testnet", &stop_far), order(&host, 3, "c.testnet", &tp_hit), order(&host, 4, "d.testnet", &tp_far)];
        let body = report(&host, json!({"operation":"check","contract":CONTRACT,"request":9,"orders":orders}));
        assert_eq!(body["price_e6"], 3_589_200);
        assert_eq!(body["source"], core::PRICE_SOURCE);
        assert_eq!(body["request"], 9);
        let fired: Vec<u64> = body["fired"].as_array().unwrap().iter().map(|f| f["id"].as_u64().unwrap()).collect();
        assert_eq!(fired, vec![1, 3]);
        assert_eq!(body["fired"][0]["pt"], stop_hit);
        // The plaintext of orders that did not fire appears nowhere in the output.
        let text = body.to_string();
        assert!(!text.contains("3400000") && !text.contains("3700000"));
        // The next real tick (3.5896) is above the 3.59 stop: it would no longer fire.
        let p2 = core::parse_ticker(T2).unwrap();
        assert!(!core::crossed(&serde_json::from_str::<Plain>(&stop_hit).unwrap(), p2.price_e6 + 5_000));
    }

    #[test]
    fn tampered_or_mismatched_orders_never_fire() {
        let host = Local::new(T1);
        let pt = plain("lte", 9_000_000);
        let mut wrong_commit = order(&host, 1, "a.testnet", &pt);
        wrong_commit["commit"] = json!(core::commitment("a.testnet", plain("lte", 8_000_000).as_bytes()));
        let mut moved = order(&host, 2, "a.testnet", &pt);
        moved["owner"] = json!("mallory.testnet");
        moved["commit"] = json!(core::commitment("mallory.testnet", pt.as_bytes()));
        let body = report(&host, json!({"operation":"check","contract":CONTRACT,"request":2,"orders":[wrong_commit, moved]}));
        assert_eq!(body["fired"], json!([]));
        assert_eq!(body["unreadable"], 2);
    }

    #[test]
    fn refuses_a_report_for_another_contract() {
        let host = Local::new(T1);
        let err = core::run(&host, &json!({"operation":"keys","contract":"evil.testnet","request":1}).to_string()).unwrap_err();
        assert!(err.contains("not the calling contract"));
    }

    #[test]
    fn bands_publish_only_k_anonymous_counts() {
        let host = Local::new(T1);
        let mut orders = Vec::new();
        for i in 0..5 { orders.push(order(&host, i, &format!("u{i}.testnet"), &plain("lte", 3_410_000 + i * 1000))); }
        orders.push(order(&host, 9, "lonely.testnet", &plain("gte", 3_900_000)));
        let body = report(&host, json!({"operation":"bands","contract":CONTRACT,"request":3,"orders":orders}));
        assert_eq!(body["bands"], json!([{"lo_e6":3_400_000u64,"hi_e6":3_450_000u64,"lte":5,"gte":0}]));
        assert_eq!(body["suppressed"], 1);
        assert!(!body.to_string().contains("3900000"));
    }

    #[test]
    fn manifest_is_embedded_and_strict() {
        let m: Value = serde_json::from_slice(&super::OUTLAYER_MANIFEST).unwrap();
        assert_eq!(m["capabilities"]["network"], json!(["api.exchange.coinbase.com"]));
        assert_eq!(m["encryption_keys"][0], json!({"path":"orders","bind":"wasm","caller":"predecessor"}));
        assert_eq!(m["callers"]["contract"]["only"], json!([CONTRACT]));
    }
}
