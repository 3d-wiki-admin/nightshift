import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decisions, incidents, services, reuseIndex, readAll } from '../index.mjs';

function tmpProject() {
  return path.join(tmpdir(), `ns-mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

// ---------- decisions ----------

test('decisions.append adds a row with schema_version + id + ts', async () => {
  const p = tmpProject();
  const row = await decisions.append(p, { subject: 'use RSC for dashboard', answer: 'yes', kind: 'architecture' });
  assert.equal(row.schema_version, 1);
  assert.match(row.id, /^dec_/);
  assert.ok(row.ts);
  const text = await fs.readFile(path.join(p, 'memory', 'decisions.ndjson'), 'utf8');
  const parsed = JSON.parse(text.trim());
  assert.equal(parsed.subject, 'use RSC for dashboard');
  await fs.rm(p, { recursive: true, force: true });
});

test('decisions.list filters by kind and returns newest-first', async () => {
  const p = tmpProject();
  await decisions.append(p, { subject: 'stack: supabase', kind: 'stack' });
  await decisions.append(p, { subject: 'policy: zod everywhere', kind: 'policy' });
  await decisions.append(p, { subject: 'stack: vercel edge', kind: 'stack' });
  const stack = await decisions.list(p, { kind: 'stack' });
  assert.equal(stack.length, 2);
  assert.equal(stack[0].subject, 'stack: vercel edge');
  const all = await decisions.list(p, { newest: false });
  assert.equal(all[0].subject, 'stack: supabase');
  await fs.rm(p, { recursive: true, force: true });
});

test('decisions.latestBySubject returns the most recent match', async () => {
  const p = tmpProject();
  await decisions.append(p, { subject: 'auth approach', answer: 'magic links' });
  await decisions.append(p, { subject: 'auth approach', answer: 'clerk' });
  const latest = await decisions.latestBySubject(p, 'auth approach');
  assert.equal(latest.answer, 'clerk');
  await fs.rm(p, { recursive: true, force: true });
});

test('decisions.list empty log returns []', async () => {
  const p = tmpProject();
  const r = await decisions.list(p);
  assert.deepEqual(r, []);
});

// ---------- incidents ----------

test('incidents.append records symptom + root_cause + fix', async () => {
  const p = tmpProject();
  const r = await incidents.append(p, {
    symptom: 'Playwright timeout on homepage',
    root_cause: 'next dev warmup > 30s on cold cache',
    fix: 'switch smoke to next start on port 3001 (already built)',
    task: 'G1-004'
  });
  assert.equal(r.schema_version, 1);
  assert.match(r.id, /^inc_/);
  const list = await incidents.list(p, { symptomIncludes: 'playwright' });
  assert.equal(list.length, 1);
  await fs.rm(p, { recursive: true, force: true });
});

// ---------- services ----------

test('services.read returns a blank state when file is missing', async () => {
  const p = tmpProject();
  const s = await services.read(p);
  assert.equal(s.schema_version, 1);
  assert.deepEqual(s.providers, {});
});

test('services.setProvider merges patches atomically', async () => {
  const p = tmpProject();
  await services.setProvider(p, 'vercel', { project_id: 'grocery', prod_url: 'https://grocery.vercel.app' });
  await services.setProvider(p, 'vercel', { preview_url: 'https://grocery-preview.vercel.app' });
  const v = await services.getProvider(p, 'vercel');
  assert.equal(v.project_id, 'grocery');
  assert.equal(v.preview_url, 'https://grocery-preview.vercel.app');
  assert.equal(v.prod_url, 'https://grocery.vercel.app');
  // .bak exists after overwrite.
  await fs.access(path.join(p, 'memory', 'services.json.bak'));
  await fs.rm(p, { recursive: true, force: true });
});

test('services.setProvider updates updated_at', async () => {
  const p = tmpProject();
  await services.setProvider(p, 'vercel', { project_id: 'g1' });
  const s1 = await services.read(p);
  await new Promise(r => setTimeout(r, 5));
  await services.setProvider(p, 'vercel', { project_id: 'g2' });
  const s2 = await services.read(p);
  assert.ok(s2.updated_at > s1.updated_at);
  await fs.rm(p, { recursive: true, force: true });
});

test('services.unsetProviderField removes a specific field', async () => {
  const p = tmpProject();
  await services.setProvider(p, 'vercel', { project_id: 'g1', preview_url: 'x' });
  await services.unsetProviderField(p, 'vercel', 'preview_url');
  const v = await services.getProvider(p, 'vercel');
  assert.equal(v.project_id, 'g1');
  assert.equal(v.preview_url, undefined);
  await fs.rm(p, { recursive: true, force: true });
});

test('services.removeProvider drops the whole bucket', async () => {
  const p = tmpProject();
  await services.setProvider(p, 'vercel', { project_id: 'g1' });
  await services.setProvider(p, 'supabase', { project_ref: 'abc' });
  await services.removeProvider(p, 'vercel');
  const v = await services.getProvider(p, 'vercel');
  assert.equal(v, null);
  const s = await services.getProvider(p, 'supabase');
  assert.equal(s.project_ref, 'abc');
  await fs.rm(p, { recursive: true, force: true });
});

// ---------- reuse-index ----------

test('reuse-index.upsert adds + updates entries by (file, symbol)', async () => {
  const p = tmpProject();
  await reuseIndex.upsert(p, {
    file: 'lib/supabase/server.ts',
    symbol: 'supabaseServer',
    purpose: 'Server-side Supabase client (SSR cookies)',
    tags: ['supabase', 'ssr']
  });
  await reuseIndex.upsert(p, {
    file: 'lib/supabase/server.ts',
    symbol: 'supabaseServer',
    purpose: 'Server-side Supabase client (SSR + RSC)',
    tags: ['supabase', 'ssr', 'rsc']
  });
  const list = await reuseIndex.list(p, { tag: 'rsc' });
  assert.equal(list.length, 1);
  assert.equal(list[0].purpose, 'Server-side Supabase client (SSR + RSC)');
  await fs.rm(p, { recursive: true, force: true });
});

test('reuse-index.list filters by tag + purpose substring', async () => {
  const p = tmpProject();
  await reuseIndex.upsert(p, { file: 'a.ts', symbol: 'A', purpose: 'auth helper', tags: ['auth'] });
  await reuseIndex.upsert(p, { file: 'b.ts', symbol: 'B', purpose: 'db helper', tags: ['db'] });
  assert.equal((await reuseIndex.list(p, { tag: 'auth' })).length, 1);
  assert.equal((await reuseIndex.list(p, { purposeIncludes: 'helper' })).length, 2);
  await fs.rm(p, { recursive: true, force: true });
});

test('reuse-index.remove drops a specific entry', async () => {
  const p = tmpProject();
  await reuseIndex.upsert(p, { file: 'a.ts', symbol: 'A', purpose: 'x' });
  await reuseIndex.upsert(p, { file: 'a.ts', symbol: 'B', purpose: 'y' });
  await reuseIndex.remove(p, 'a.ts', 'A');
  const list = await reuseIndex.list(p);
  assert.equal(list.length, 1);
  assert.equal(list[0].symbol, 'B');
  await fs.rm(p, { recursive: true, force: true });
});

// ---------- readAll ----------

test('readAll aggregates all four memory surfaces with limits + query hint', async () => {
  const p = tmpProject();
  await decisions.append(p, { subject: 'use Zod for API', answer: 'yes' });
  await decisions.append(p, { subject: 'use Tailwind', answer: 'yes' });
  await incidents.append(p, { symptom: 'build OOM on Vercel' });
  await services.setProvider(p, 'vercel', { project_id: 'grocery' });
  await reuseIndex.upsert(p, { file: 'lib/x.ts', symbol: 'x', purpose: 'util', tags: [] });

  const all = await readAll(p);
  assert.equal(all.decisions.length, 2);
  assert.equal(all.incidents.length, 1);
  assert.equal(all.services.providers.vercel.project_id, 'grocery');
  assert.equal(all.reuse_index.length, 1);

  const filtered = await readAll(p, { query: 'zod' });
  assert.equal(filtered.decisions.length, 1);
  assert.equal(filtered.decisions[0].subject, 'use Zod for API');
  assert.equal(filtered.incidents.length, 0); // 'zod' doesn't match 'build OOM'
  await fs.rm(p, { recursive: true, force: true });
});
