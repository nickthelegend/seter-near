// Restore the last active keeper run's public journal. A missing snapshot fails closed.
import { mkdir, writeFile, rm, readFile, copyFile, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const repo = process.env.GITHUB_REPOSITORY, run = process.env.GITHUB_RUN_ID;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+$/.test(run || '') || !process.env.GITHUB_TOKEN) throw new Error('GitHub Actions context required.');
if (process.env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('Keeper reruns are disabled; use a fresh dispatch after inspecting its journal.');
const today = new Date().toISOString().slice(0, 10);
const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2026-03-10' };
async function api(path) { const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`Journal restore API HTTP ${r.status}`); return r.json(); }
let previous;
for (let page = 1; page <= 10; page++) {
  const data = await api(`actions/workflows/keeper.yml/runs?per_page=100&page=${page}&branch=${encodeURIComponent(process.env.GITHUB_REF_NAME)}`);
  let reachedYesterday = false;
  for (const candidate of data.workflow_runs) {
    if (String(candidate.id) === run) continue;
    if (candidate.updated_at.slice(0, 10) < today) { reachedYesterday = true; break; }
    const jobs = await api(`actions/runs/${candidate.id}/jobs?per_page=100`);
    const keeper = jobs.jobs.find((j) => j.name === 'keeper');
    if (keeper && keeper.conclusion !== 'skipped') { previous = candidate; break; }
  }
  if (previous || reachedYesterday || data.workflow_runs.length < 100) break;
  if (page === 10) throw new Error('Too much keeper history; refusing an incomplete cap restore.');
}
if (previous) {
  const data = await api(`actions/runs/${previous.id}/artifacts?per_page=100`);
  const artifact = data.artifacts.find((a) => a.name === `seter-keeper-journal-${previous.id}-1` && !a.expired);
  if (!artifact) throw new Error(`Previous active keeper run ${previous.id} has no usable journal artifact. Restore its state before spending.`);
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Journal download HTTP ${response.status}`);
  const zip = resolve(process.env.RUNNER_TEMP, 'seter-keeper-public-journal.zip');
  await writeFile(zip, Buffer.from(await response.arrayBuffer()));
  const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
  if (names.some((n) => !/^[\w.-]+\.json$/.test(n))) throw new Error('Unexpected journal archive paths; refusing restore.');
  const dir = resolve('deployments/keeper'); await mkdir(dir, { recursive: true });
  const temporary = await mkdtemp(resolve(process.env.RUNNER_TEMP, 'seter-keeper-restore-'));
  try {
    execFileSync('unzip', ['-q', zip, '-d', temporary]);
    for (const name of names) {
      const source = resolve(temporary, name), target = resolve(dir, name);
      let existing; try { existing = await readFile(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (existing) {
        if (!existing.equals(await readFile(source))) throw new Error('Artifact differs from a committed journal; inspect it before spending.');
      } else await copyFile(source, target);
    }
  } finally { await rm(temporary, { recursive: true }); await rm(zip); }
  console.log(`Restored public keeper journal from run ${previous.id}.`);
} else console.log('No earlier active keeper run today; using the committed journal baseline.');
