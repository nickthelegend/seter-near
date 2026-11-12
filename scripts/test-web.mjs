// Read-only production regression: real public data, no wallet connection or transaction.
import { chromium } from 'playwright';
import { createServer } from 'node:net';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const shots = process.env.QA_SCREENSHOTS || '/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/mienai/r3';
const { withChromeLock } = await import(process.env.CHROME_LOCK_PATH || '/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs');
mkdirSync(shots, { recursive: true });
async function memory() { while (Number(execFileSync('memory_pressure', { encoding: 'utf8' }).match(/free percentage: (\d+)%/)?.[1] || 0) < 30) await new Promise((r) => setTimeout(r, 30000)); }
function disk() { const text = execFileSync('df', ['-k', '/System/Volumes/Data'], { encoding: 'utf8' }).trim().split('\n').at(-1).split(/\s+/); assert(Number(text[3]) >= 5 * 1024 * 1024, 'Less than 5 GB free; stop before building.'); }
let url = process.env.QA_BASE_URL, server;
if (url) { const u = new URL(url); assert(u.hostname === '127.0.0.1' && Number(u.port) >= 5300 && Number(u.port) <= 5999, 'Use a local QA port.'); }
const results = [];
try {
  if (!url) {
    await memory(); disk();
    const built = spawnSync('pnpm', ['build'], { cwd: root, encoding: 'utf8' });
    writeFileSync(resolve(shots, 'web-build.log'), built.stdout + built.stderr); assert.equal(built.status, 0, 'Production build failed.');
    let port;
    for (let candidate = 5300; candidate < 6000; candidate++) {
      const probe = createServer();
      if (await new Promise((r) => probe.once('error', () => r(false)).listen(candidate, '127.0.0.1', () => probe.close(() => r(true))))) { port = candidate; break; }
    }
    assert(port, 'No free QA port.');
    assert.equal(spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).status, 1);
    server = spawn(process.execPath, [resolve(root, 'packages/web/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: resolve(root, 'packages/web'), stdio: 'ignore' });
    url = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) { try { if ((await fetch(url)).ok) break; } catch {} assert(i < 100, 'Preview did not start.'); await new Promise((r) => setTimeout(r, 100)); }
  }
  await withChromeLock(async () => {
    await memory();
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      for (const width of [1440, 375]) {
        const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 812 } });
        const page = await context.newPage(), errors = [], failedRequests = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('requestfailed', (r) => failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
        await page.route('**/*', (r) => { let d; try { d = r.request().postDataJSON(); } catch {} assert(!['send_tx', 'broadcast_tx_commit', 'broadcast_tx_async'].includes(d?.method), 'Read-only regression must never broadcast.'); return r.continue(); });
        async function snap(id) {
          await page.waitForTimeout(200);
          const state = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, bad: /\b(?:NaN|undefined)\b|TypeError|ReferenceError/.test(document.body.innerText) }));
          assert(!state.overflow && !state.bad, `${id}: overflow or raw error at ${width}`);
          assert.equal(errors.length, 0, `${id}: page errors`);
          await page.screenshot({ path: resolve(shots, `test-${id}-${width}.png`) });
          results.push({ id, width, ...state, errors: [...errors], failedRequests: [...failedRequests] });
        }
        await page.goto(url + '/'); await page.locator('.trust').waitFor(); await snap('landing');
        await page.goto(url + '/app'); await page.locator('.chart canvas').first().waitFor();
        await page.waitForFunction(() => document.querySelector('.mb-cell:last-child')?.textContent?.includes('Coinbase') && document.querySelector('.chart')?.hasAttribute('data-marker-layout'));
        const cellsFit = await page.evaluate(() => {
          const b = document.querySelector('.mbar').getBoundingClientRect();
          return [...document.querySelectorAll('.mb-cell')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom; });
        }); assert(cellsFit, 'Every market field must fit inside the bar.'); await snap('terminal');
        for (const tf of ['15m', '1h', '6h', '1D']) {
          await page.getByRole('tab', { name: tf, exact: true }).click();
          await page.locator('.chart canvas').first().waitFor(); await page.waitForTimeout(350);
          const markers = JSON.parse(await page.locator('.chart').getAttribute('data-marker-layout'));
          for (const tone of ['fire', 'check']) { const list = markers.filter((m) => m.tone === tone).sort((a, b) => a.x - b.x); for (let i = 1; i < list.length; i++) assert(list[i - 1].x + list[i - 1].width / 2 < list[i].x - list[i].width / 2, 'Marker labels overlap.'); }
          await snap('chart-' + tf);
        }
        for (const tab of ['Market', 'Limit', 'Sealed stop', 'Sealed take-profit']) { await page.getByRole('tab', { name: tab, exact: true }).click(); await page.locator('.otabs').scrollIntoViewIfNeeded(); await snap(tab.replaceAll(' ', '-')); }
        for (const tab of ['Open orders', 'Order history', 'Enclave log', 'Attestations']) { await page.getByRole('tab', { name: new RegExp('^' + tab) }).click(); await page.locator('.bottom').scrollIntoViewIfNeeded(); await snap(tab.replaceAll(' ', '-')); }
        for (const id of [1, 3, 999999]) { await page.goto(url + '/order/' + id); await page.locator('.osum-grid, .state-empty').first().waitFor(); await snap('order-' + id); }
        await page.goto(url + '/unknown-route'); await page.getByText('Page not found', { exact: true }).waitFor(); await snap('not-found');
        await context.close();
      }
    } finally { await browser.close(); }
  });
  writeFileSync(resolve(shots, 'web-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`PASS ${results.length} read-only web checks at 1440/375; no transactions sent.`);
} finally { if (server) { server.kill('SIGTERM'); await new Promise((r) => server.once('exit', r)); } }
