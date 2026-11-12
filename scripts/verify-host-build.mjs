// Read only the generated public artifact; no credential or environment files are opened.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
assert.equal(config.outputDirectory, 'packages/web/dist');
assert.deepEqual(config.routes, [{ handle: 'filesystem' }, { src: '/.*', dest: '/index.html' }]);
const dir = resolve(root, config.outputDirectory);
const files = (p) => readdirSync(p, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(resolve(p, e.name)) : [resolve(p, e.name)]);
const markers = ['qa-signer', 'SETER_QA_SIGNER_TESTNET_ONLY', '__SETER_QA_SIGNER__', 'QA signer'];
const entries = files(dir);
assert(entries.includes(resolve(dir, 'index.html')));
for (const file of entries) {
  const name = relative(dir, file);
  assert(!/(?:^|\/)(?:\.near-credentials|\.loom|secrets|\.env[^/]*)(?:\/|$)|\.(?:key|pem)$/.test(name), 'Private file found in the public output.');
  assert(!markers.some((m) => name.includes(m) || readFileSync(file).includes(Buffer.from(m))), 'QA signer found in the public output.');
}
console.log(`PASS: ${entries.length} public build files; filesystem-first SPA fallback; QA signer and private files excluded.`);
