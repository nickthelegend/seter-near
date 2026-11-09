import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { x25519 } from '@noble/curves/ed25519';
import { orderPlaintext, sealToEnclave, openWithSecret, commitment, verifyReport, newViewKey, sealView, openView, toE6, fromE6, b64 } from '../src/crypto.mjs';

const deployments = new URL('../../../deployments/', import.meta.url);

test('seal to the enclave key and open with its secret; another owner cannot open it', () => {
  const secret = x25519.utils.randomPrivateKey();
  const pt = orderPlaintext({ cond: 'lte', triggerUsd: '3.5', side: 'sell', amount: '1000' });
  const ct = sealToEnclave(b64(x25519.getPublicKey(secret)), 'alice.testnet', pt);
  assert.equal(openWithSecret(secret, 'alice.testnet', ct), pt);
  assert.throws(() => openWithSecret(secret, 'mallory.testnet', ct));
  assert.notEqual(sealToEnclave(b64(x25519.getPublicKey(secret)), 'alice.testnet', pt), ct, 'fresh ephemeral key and nonce each time');
});

test('commitment vector matches the contract and enclave format', () => {
  const pt = '{"v":1,"cond":"lte","trigger_e6":3500000,"side":"sell","amount":"1","salt":"00112233445566778899aabbccddeeff"}';
  // sha256("mienai:commit:v1:alice.testnet\0" + pt), computed independently with shasum.
  assert.equal(commitment('alice.testnet', pt), '0ddc05f14be95cea75b956d8e81da516232638132e0614b049c4a1b771d538f3');
});

test('view copy opens only with the device key', () => {
  const k = newViewKey();
  const v = sealView(k, 'alice.testnet', 'hello');
  assert.equal(openView(k, 'alice.testnet', v), 'hello');
  assert.throws(() => openView(newViewKey(), 'alice.testnet', v));
});

test('prices are integers in micro-USD', () => {
  assert.equal(toE6('3.5949'), 3_594_900);
  assert.equal(toE6('3.12345678'), 3_123_456);
  assert.equal(fromE6(3_594_900), '3.5949');
  assert.throws(() => toE6('-1'));
  assert.throws(() => orderPlaintext({ cond: 'eq', triggerUsd: '1', side: 'sell', amount: '1' }));
});

test('a real report signed inside OutLayer TDX verifies, and an edited one does not', () => {
  const file = readdirSync(deployments).find((n) => n.startsWith('outlayer-direct-check-'));
  const keysFile = readdirSync(deployments).find((n) => n.startsWith('outlayer-direct-keys-'));
  const check = JSON.parse(JSON.parse(readFileSync(new URL(file, deployments), 'utf8')).output);
  const keys = JSON.parse(JSON.parse(JSON.parse(readFileSync(new URL(keysFile, deployments), 'utf8')).output).body);
  assert.equal(verifyReport(keys.attest_pub, check.body, check.sig), true);
  assert.equal(verifyReport(keys.attest_pub, check.body.replace('"price_e6":', '"price_e6":1'), check.sig), false);
  const body = JSON.parse(check.body);
  assert.equal(body.source, 'https://api.exchange.coinbase.com/products/NEAR-USD/ticker');
  assert.equal(body.fired.length, 1, 'only the crossed order was revealed');
});
