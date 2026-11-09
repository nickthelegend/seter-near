//! Platform-independent logic of the Mienai trigger enclave.
//!
//! The enclave never returns the plaintext of an order that has not fired. For every
//! operation it composes the report body itself, from fields it has parsed and checked,
//! and signs `REPORT_PREFIX || body` with its ed25519 key. The NEAR contract verifies
//! that signature with `env::ed25519_verify` against the key it learned from an earlier
//! attested `keys` run.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{aead::{Aead, KeyInit, Payload}, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub const REPORT_PREFIX: &[u8] = b"mienai:report:v1:";
pub const ORDER_AAD_PREFIX: &str = "mienai:order:v1:";
pub const COMMIT_PREFIX: &[u8] = b"mienai:commit:v1:";
pub const HKDF_INFO: &[u8] = b"mienai-order-v1";
/// The derivation label for the X25519 order key: `mac("orders", label)`.
pub const ORDER_KEY_LABEL: &[u8] = b"mienai/x25519-order-key/v1";
pub const PRICE_SOURCE: &str = "https://api.exchange.coinbase.com/products/NEAR-USD/ticker";
pub const MAX_ORDERS: usize = 16;
pub const MAX_FIRE: usize = 4;
pub const BAND_K: usize = 5;
/// $0.05 price bands for the anonymised aggregate.
pub const BAND_WIDTH_E6: u64 = 50_000;

/// What the enclave needs from its host. On OutLayer this is the keystore and WASI HTTP;
/// in native unit tests it is a local key and pinned real price responses.
pub trait Host {
    /// 32 bytes from `mac("orders", None, ORDER_KEY_LABEL)`: the X25519 order secret.
    fn order_secret(&self) -> Result<[u8; 32], String>;
    fn attest_public(&self) -> Result<[u8; 32], String>;
    fn sign(&self, message: &[u8]) -> Result<Vec<u8>, String>;
    /// The raw body of `GET PRICE_SOURCE`.
    fn fetch_price(&self) -> Result<Vec<u8>, String>;
    fn env(&self, key: &str) -> Option<String>;
}

#[derive(Deserialize)]
struct Input {
    operation: String,
    contract: String,
    request: u64,
    #[serde(default)]
    orders: Vec<OrderIn>,
}

#[derive(Deserialize)]
struct OrderIn {
    id: u64,
    owner: String,
    ct: String,
    commit: String,
}

/// The sealed order a user writes. Field order in the JSON is the client's; the commitment
/// covers the exact bytes.
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
pub struct Plain {
    pub v: u8,
    /// `lte` fires when price <= trigger (a stop-loss on a long), `gte` when price >= trigger.
    pub cond: String,
    pub trigger_e6: u64,
    /// `sell`: sell `amount` yoctoNEAR for tUSD. `buy`: spend `amount` tUSD (6 decimals) on NEAR.
    pub side: String,
    pub amount: String,
    pub salt: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Price {
    pub price_e6: u64,
    pub ts_ms: u64,
    pub trade_id: u64,
}

pub fn commitment(owner: &str, plaintext: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(COMMIT_PREFIX);
    h.update(owner.as_bytes());
    h.update([0u8]);
    h.update(plaintext);
    hex::encode(h.finalize())
}

pub fn order_public(secret: &[u8; 32]) -> [u8; 32] {
    PublicKey::from(&StaticSecret::from(*secret)).to_bytes()
}

fn aead_key(shared: &[u8; 32], eph: &[u8; 32], tee: &[u8; 32]) -> [u8; 32] {
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(eph);
    salt[32..].copy_from_slice(tee);
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), shared).expand(HKDF_INFO, &mut key).expect("32 bytes is a valid HKDF length");
    key
}

/// `0x01 || eph_pub(32) || nonce(24) || XChaCha20-Poly1305(ct || tag)`, base64.
pub fn seal(tee_public: &[u8; 32], owner: &str, plaintext: &[u8], eph_secret: [u8; 32], nonce: [u8; 24]) -> String {
    let eph = StaticSecret::from(eph_secret);
    let eph_pub = PublicKey::from(&eph).to_bytes();
    let shared = eph.diffie_hellman(&PublicKey::from(*tee_public)).to_bytes();
    let key = aead_key(&shared, &eph_pub, tee_public);
    let aad = format!("{ORDER_AAD_PREFIX}{owner}");
    let ct = XChaCha20Poly1305::new((&key).into()).encrypt(XNonce::from_slice(&nonce), Payload { msg: plaintext, aad: aad.as_bytes() }).expect("encryption cannot fail");
    let mut out = vec![1u8];
    out.extend_from_slice(&eph_pub);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    B64.encode(out)
}

pub fn open(secret: &[u8; 32], owner: &str, sealed_b64: &str) -> Result<Vec<u8>, &'static str> {
    let raw = B64.decode(sealed_b64).map_err(|_| "bad base64")?;
    if raw.len() < 1 + 32 + 24 + 16 || raw[0] != 1 { return Err("bad format"); }
    let eph_pub: [u8; 32] = raw[1..33].try_into().unwrap();
    let nonce = &raw[33..57];
    let sk = StaticSecret::from(*secret);
    let tee_pub = PublicKey::from(&sk).to_bytes();
    let shared = sk.diffie_hellman(&PublicKey::from(eph_pub));
    if !shared.was_contributory() { return Err("low-order point"); }
    let key = aead_key(&shared.to_bytes(), &eph_pub, &tee_pub);
    let aad = format!("{ORDER_AAD_PREFIX}{owner}");
    XChaCha20Poly1305::new((&key).into()).decrypt(XNonce::from_slice(nonce), Payload { msg: &raw[57..], aad: aad.as_bytes() }).map_err(|_| "decryption failed")
}

/// Parses a decimal USD string ("3.5949") into micro-USD, truncating past 6 decimals.
pub fn parse_e6(s: &str) -> Option<u64> {
    let (int, frac) = s.split_once('.').unwrap_or((s, ""));
    if int.is_empty() || !int.bytes().all(|b| b.is_ascii_digit()) || !frac.bytes().all(|b| b.is_ascii_digit()) { return None; }
    let mut f = frac.chars().take(6).collect::<String>();
    while f.len() < 6 { f.push('0'); }
    int.parse::<u64>().ok()?.checked_mul(1_000_000)?.checked_add(f.parse::<u64>().ok()?)
}

/// RFC 3339 UTC ("2026-11-09T16:48:05.810576735Z") to unix milliseconds.
pub fn parse_rfc3339_ms(s: &str) -> Option<u64> {
    let s = s.strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-');
    let (y, m, day): (i64, i64, i64) = (d.next()?.parse().ok()?, d.next()?.parse().ok()?, d.next()?.parse().ok()?);
    let (hms, frac) = time.split_once('.').unwrap_or((time, "0"));
    let mut t = hms.split(':');
    let (hh, mm, ss): (i64, i64, i64) = (t.next()?.parse().ok()?, t.next()?.parse().ok()?, t.next()?.parse().ok()?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) || hh > 23 || mm > 59 || ss > 60 { return None; }
    let ms: i64 = format!("{:0<3}", &frac[..frac.len().min(3)]).parse().ok()?;
    // Days from civil (Howard Hinnant).
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(((days * 86_400 + hh * 3600 + mm * 60 + ss) * 1000) + ms).ok()
}

pub fn parse_ticker(body: &[u8]) -> Result<Price, String> {
    let v: Value = serde_json::from_slice(body).map_err(|_| "price source returned invalid JSON".to_string())?;
    let price_e6 = v["price"].as_str().and_then(parse_e6).filter(|p| *p > 0).ok_or("price source has no price")?;
    let ts_ms = v["time"].as_str().and_then(parse_rfc3339_ms).ok_or("price source has no time")?;
    let trade_id = v["trade_id"].as_u64().ok_or("price source has no trade_id")?;
    Ok(Price { price_e6, ts_ms, trade_id })
}

pub fn crossed(plain: &Plain, price_e6: u64) -> bool {
    match plain.cond.as_str() {
        "lte" => price_e6 <= plain.trigger_e6,
        "gte" => price_e6 >= plain.trigger_e6,
        _ => false,
    }
}

fn valid_plain(p: &Plain) -> bool {
    p.v == 1 && (p.cond == "lte" || p.cond == "gte") && (p.side == "sell" || p.side == "buy") && p.trigger_e6 > 0
        && !p.amount.is_empty() && p.amount.len() <= 39 && p.amount.bytes().all(|b| b.is_ascii_digit()) && p.amount != "0"
        && p.salt.len() == 32 && p.salt.bytes().all(|b| b.is_ascii_hexdigit())
}

/// An order the enclave could open and whose plaintext matches its on-chain commitment.
struct Opened { id: u64, plaintext: String, plain: Plain }

fn open_all(host: &dyn Host, orders: &[OrderIn]) -> Result<(Vec<Opened>, usize), String> {
    let secret = host.order_secret()?;
    let mut opened = Vec::new();
    let mut unreadable = 0;
    for o in orders {
        let Ok(bytes) = open(&secret, &o.owner, &o.ct) else { unreadable += 1; continue };
        let Ok(text) = String::from_utf8(bytes) else { unreadable += 1; continue };
        // A ciphertext whose plaintext is not what the owner committed to never fires.
        if commitment(&o.owner, text.as_bytes()) != o.commit { unreadable += 1; continue; }
        match serde_json::from_str::<Plain>(&text) {
            Ok(plain) if valid_plain(&plain) => opened.push(Opened { id: o.id, plaintext: text, plain }),
            _ => unreadable += 1,
        }
    }
    Ok((opened, unreadable))
}

fn envelope(host: &dyn Host, body: Value) -> Result<String, String> {
    let body = body.to_string();
    let mut message = REPORT_PREFIX.to_vec();
    message.extend_from_slice(body.as_bytes());
    let sig = host.sign(&message)?;
    Ok(json!({ "body": body, "sig": B64.encode(sig) }).to_string())
}

fn context(host: &dyn Host) -> Value {
    json!({
        "predecessor": host.env("NEAR_PREDECESSOR_ID").unwrap_or_default(),
        "outlayer_request": host.env("NEAR_REQUEST_ID").or_else(|| host.env("OUTLAYER_REQUEST_ID")).unwrap_or_default(),
        "block": host.env("NEAR_BLOCK_HEIGHT").unwrap_or_default(),
    })
}

/// Runs one operation and returns the stdout the contract receives.
pub fn run(host: &dyn Host, raw_input: &str) -> Result<String, String> {
    let input: Input = serde_json::from_str(raw_input).map_err(|e| format!("invalid input: {e}"))?;
    // The order key belongs to the predecessor (the manifest says caller: predecessor), so
    // a run started by anyone else holds a different key and opens nothing. Refuse early
    // anyway, so the report can never name a contract that did not ask for it.
    if let Some(pred) = host.env("NEAR_PREDECESSOR_ID") {
        if !pred.is_empty() && pred != input.contract { return Err("input contract is not the calling contract".into()); }
    }
    if input.orders.len() > MAX_ORDERS { return Err("too many orders".into()); }
    let ctx = context(host);
    match input.operation.as_str() {
        "keys" => {
            let secret = host.order_secret()?;
            envelope(host, json!({
                "v": 1, "op": "keys", "contract": input.contract, "request": input.request,
                "order_pub": B64.encode(order_public(&secret)),
                "attest_pub": B64.encode(host.attest_public()?),
                "ctx": ctx,
            }))
        }
        "check" => {
            let price = parse_ticker(&host.fetch_price()?)?;
            let (opened, unreadable) = open_all(host, &input.orders)?;
            let fired: Vec<Value> = opened.iter().filter(|o| crossed(&o.plain, price.price_e6)).take(MAX_FIRE)
                .map(|o| json!({ "id": o.id, "pt": o.plaintext })).collect();
            envelope(host, json!({
                "v": 1, "op": "check", "contract": input.contract, "request": input.request,
                "price_e6": price.price_e6, "price_ts_ms": price.ts_ms, "trade_id": price.trade_id, "source": PRICE_SOURCE,
                "checked": input.orders.len(), "unreadable": unreadable, "fired": fired, "ctx": ctx,
            }))
        }
        "bands" => {
            let price = parse_ticker(&host.fetch_price()?)?;
            let (opened, unreadable) = open_all(host, &input.orders)?;
            let mut counts: std::collections::BTreeMap<u64, (usize, usize)> = Default::default();
            for o in &opened {
                let entry = counts.entry(o.plain.trigger_e6 / BAND_WIDTH_E6).or_default();
                if o.plain.cond == "lte" { entry.0 += 1 } else { entry.1 += 1 }
            }
            let mut suppressed = 0;
            let mut bands = Vec::new();
            for (band, (below, above)) in counts {
                if below + above >= BAND_K {
                    bands.push(json!({ "lo_e6": band * BAND_WIDTH_E6, "hi_e6": (band + 1) * BAND_WIDTH_E6, "lte": below, "gte": above }));
                } else {
                    suppressed += below + above;
                }
            }
            envelope(host, json!({
                "v": 1, "op": "bands", "contract": input.contract, "request": input.request,
                "price_e6": price.price_e6, "price_ts_ms": price.ts_ms, "source": PRICE_SOURCE, "k": BAND_K, "width_e6": BAND_WIDTH_E6,
                "bands": bands, "suppressed": suppressed, "unreadable": unreadable, "total": input.orders.len(), "ctx": ctx,
            }))
        }
        other => Err(format!("unknown operation {other}")),
    }
}
