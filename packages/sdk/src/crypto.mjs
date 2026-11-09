// Client-side sealing of Mienai orders to the enclave's X25519 key. Mirrors packages/enclave/src/core.rs.
//   blob = 0x01 ‖ eph_pub(32) ‖ nonce(24) ‖ XChaCha20-Poly1305(plaintext) ; key = HKDF-SHA256(shared, salt = eph ‖ tee, "mienai-order-v1")
//   aad  = "mienai:order:v1:" + owner        commit = sha256("mienai:commit:v1:" ‖ owner ‖ 0x00 ‖ plaintext)
// The view copy is sealed to a 32-byte key that stays on the user's device (XChaCha20-Poly1305, aad "mienai:view:v1:" + owner).
import { x25519, ed25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes, bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils';

const enc = (s) => utf8ToBytes(s);
const dec = (b) => new TextDecoder().decode(b);
export const b64 = (bytes) => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const REPORT_PREFIX = 'mienai:report:v1:';

/** Builds the exact plaintext bytes a user commits to. `triggerUsd` is a decimal string like "3.5800". */
export function orderPlaintext({ cond, triggerUsd, side, amount, salt = bytesToHex(randomBytes(16)) }) {
  if (cond !== 'lte' && cond !== 'gte') throw new Error('cond must be lte (stop) or gte (take-profit)');
  if (side !== 'sell' && side !== 'buy') throw new Error('side must be sell or buy');
  const trigger_e6 = toE6(triggerUsd);
  if (trigger_e6 <= 0) throw new Error('trigger must be positive');
  if (!/^[1-9]\d{0,38}$/.test(String(amount))) throw new Error('amount must be a positive integer in base units');
  return JSON.stringify({ v: 1, cond, trigger_e6, side, amount: String(amount), salt });
}

export function toE6(decimal) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(decimal).trim());
  if (!m) throw new Error(`not a decimal price: ${decimal}`);
  return Number(m[1]) * 1_000_000 + Number((m[2] || '').slice(0, 6).padEnd(6, '0'));
}
export const fromE6 = (e6) => (Number(e6) / 1e6).toFixed(4);

export function commitment(owner, plaintext) {
  return bytesToHex(sha256(concatBytes(enc('mienai:commit:v1:'), enc(owner), new Uint8Array([0]), enc(plaintext))));
}

/** Seals `plaintext` to the enclave key (base64 from the contract's `get_config().tee.order_pub`). */
export function sealToEnclave(teeOrderPubB64, owner, plaintext) {
  const tee = unb64(teeOrderPubB64);
  if (tee.length !== 32) throw new Error('enclave order key must be 32 bytes');
  const eph = x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, tee);
  const key = hkdf(sha256, shared, concatBytes(ephPub, tee), enc('mienai-order-v1'), 32);
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce, enc(`mienai:order:v1:${owner}`)).encrypt(enc(plaintext));
  return b64(concatBytes(new Uint8Array([1]), ephPub, nonce, ct));
}

/** Test helper: open with the enclave secret. Only native tests hold one; the real secret never leaves the TEE. */
export function openWithSecret(secret, owner, sealedB64) {
  const raw = unb64(sealedB64);
  if (raw[0] !== 1) throw new Error('bad format');
  const ephPub = raw.slice(1, 33), nonce = raw.slice(33, 57);
  const tee = x25519.getPublicKey(secret);
  const key = hkdf(sha256, x25519.getSharedSecret(secret, ephPub), concatBytes(ephPub, tee), enc('mienai-order-v1'), 32);
  return dec(xchacha20poly1305(key, nonce, enc(`mienai:order:v1:${owner}`)).decrypt(raw.slice(57)));
}

export const newViewKey = () => bytesToHex(randomBytes(32));
export function sealView(viewKeyHex, owner, plaintext) {
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(hexToBytes(viewKeyHex), nonce, enc(`mienai:view:v1:${owner}`)).encrypt(enc(plaintext));
  return b64(concatBytes(nonce, ct));
}
export function openView(viewKeyHex, owner, sealedB64) {
  const raw = unb64(sealedB64);
  return dec(xchacha20poly1305(hexToBytes(viewKeyHex), raw.slice(0, 24), enc(`mienai:view:v1:${owner}`)).decrypt(raw.slice(24)));
}

/** Verifies an enclave report envelope `{body, sig}` against the enclave's ed25519 key (base64). */
export function verifyReport(attestPubB64, body, sigB64) {
  return ed25519.verify(unb64(sigB64), enc(REPORT_PREFIX + body), unb64(attestPubB64));
}

export { bytesToHex, hexToBytes };
