import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const CLI = path.join(ROOT, 'scripts', 'nightshift.sh');

function tmp() {
  return path.join(tmpdir(), `ns-mem-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}
function run(args) {
  return spawnSync('bash', [CLI, ...args], { encoding: 'utf8' });
}

test('memory-record decision writes to decisions.ndjson via CLI', async () => {
  const p = tmp();
  const res = run(['memory-record', p, 'decision', '--subject', 'use RSC for dashboard', '--answer', 'yes', '--kind', 'architecture']);
  assert.equal(res.status, 0, res.stderr);
  const row = JSON.parse(res.stdout);
  assert.equal(row.subject, 'use RSC for dashboard');
  assert.equal(row.kind, 'architecture');
  const log = await fs.readFile(path.join(p, 'memory', 'decisions.ndjson'), 'utf8');
  assert.match(log, /use RSC for dashboard/);
  await fs.rm(p, { recursive: true, force: true });
});

test('memory-record incident writes to incidents.ndjson', async () => {
  const p = tmp();
  const res = run(['memory-record', p, 'incident', '--symptom', 'Playwright timeout', '--root-cause', 'cold next dev', '--fix', 'switch to next start']);
  assert.equal(res.status, 0, res.stderr);
  const row = JSON.parse(res.stdout);
  assert.match(row.id, /^inc_/);
  assert.equal(row.fix, 'switch to next start');
  await fs.rm(p, { recursive: true, force: true });
});

test('memory-record service merges a provider patch', async () => {
  const p = tmp();
  const res1 = run(['memory-record', p, 'service', '--provider', 'vercel', '--patch', '{"project_id":"g1","prod_url":"https://g1.vercel.app"}']);
  assert.equal(res1.status, 0, res1.stderr);
  const res2 = run(['memory-record', p, 'service', '--provider', 'vercel', '--patch', '{"preview_url":"https://preview.vercel.app"}']);
  assert.equal(res2.status, 0, res2.stderr);
  const svc = JSON.parse(await fs.readFile(path.join(p, 'memory', 'services.json'), 'utf8'));
  assert.equal(svc.providers.vercel.project_id, 'g1');
  assert.equal(svc.providers.vercel.prod_url, 'https://g1.vercel.app');
  assert.equal(svc.providers.vercel.preview_url, 'https://preview.vercel.app');
  await fs.rm(p, { recursive: true, force: true });
});

test('memory-record reuse upserts a catalog entry with tags', async () => {
  const p = tmp();
  const res = run(['memory-record', p, 'reuse', '--file', 'lib/supabase/server.ts', '--symbol', 'supabaseServer', '--purpose', 'SSR client', '--tags', 'supabase,ssr']);
  assert.equal(res.status, 0, res.stderr);
  const entry = JSON.parse(res.stdout);
  assert.deepEqual(entry.tags, ['supabase', 'ssr']);
  await fs.rm(p, { recursive: true, force: true });
});

test('memory-retrieve returns JSON with all four surfaces', async () => {
  const p = tmp();
  run(['memory-record', p, 'decision', '--subject', 'use Zod everywhere']);
  run(['memory-record', p, 'incident', '--symptom', 'build OOM']);
  run(['memory-record', p, 'service', '--provider', 'vercel', '--patch', '{"project_id":"z"}']);
  run(['memory-record', p, 'reuse', '--file', 'lib/z.ts', '--symbol', 'z', '--purpose', 'util']);

  const res = run(['memory-retrieve', p]);
  assert.equal(res.status, 0, res.stderr);
  const slice = JSON.parse(res.stdout);
  assert.equal(slice.decisions.length, 1);
  assert.equal(slice.incidents.length, 1);
  assert.equal(slice.services.providers.vercel.project_id, 'z');
  assert.equal(slice.reuse_index.length, 1);
  await fs.rm(p, { recursive: true, force: true });
});

test('memory-retrieve --query filters decisions + incidents by keyword', async () => {
  const p = tmp();
  run(['memory-record', p, 'decision', '--subject', 'use Zod everywhere']);
  run(['memory-record', p, 'decision', '--subject', 'use Tailwind']);
  run(['memory-record', p, 'incident', '--symptom', 'zod parse error in prod']);

  const res = run(['memory-retrieve', p, '--query', 'zod']);
  assert.equal(res.status, 0, res.stderr);
  const slice = JSON.parse(res.stdout);
  assert.equal(slice.decisions.length, 1);
  assert.equal(slice.decisions[0].subject, 'use Zod everywhere');
  assert.equal(slice.incidents.length, 1);
  await fs.rm(p, { recursive: true, force: true });
});

test('memory-retrieve --markdown emits a compact markdown block', async () => {
  const p = tmp();
  run(['memory-record', p, 'decision', '--subject', 'use RSC']);
  run(['memory-record', p, 'service', '--provider', 'vercel', '--patch', '{"project_id":"g1"}']);
  const res = run(['memory-retrieve', p, '--markdown']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^## Memory retrieval/m);
  assert.match(res.stdout, /### decisions \(1\)/);
  assert.match(res.stdout, /### services/);
  assert.match(res.stdout, /vercel/);
  await fs.rm(p, { recursive: true, force: true });
});

test('memory-retrieve --include narrows to a subset', async () => {
  const p = tmp();
  run(['memory-record', p, 'decision', '--subject', 'x']);
  run(['memory-record', p, 'incident', '--symptom', 'y']);
  const res = run(['memory-retrieve', p, '--include', 'decisions']);
  const slice = JSON.parse(res.stdout);
  assert.equal(slice.decisions.length, 1);
  assert.equal(slice.incidents.length, 0);
  await fs.rm(p, { recursive: true, force: true });
});
