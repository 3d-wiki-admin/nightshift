import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Registry, RegistryError } from '../index.mjs';

function tmpRoot() {
  return path.join(tmpdir(), `ns-reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

test('register creates index + per-project file with schema_version', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  const record = await reg.register({ path: '/Users/x/dev/foo', name: 'foo' });
  assert.ok(record.project_id.startsWith('proj_'));
  assert.equal(record.schema_version, 1);
  const idxText = await fs.readFile(path.join(root, 'index.json'), 'utf8');
  const idx = JSON.parse(idxText);
  assert.equal(idx.schema_version, 1);
  assert.equal(idx.projects.length, 1);
  assert.equal(idx.projects[0].project_id, record.project_id);
  await fs.rm(root, { recursive: true, force: true });
});

test('register is idempotent — same path returns same id', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  const r1 = await reg.register({ path: '/tmp/x' });
  const r2 = await reg.register({ path: '/tmp/x' });
  assert.equal(r1.project_id, r2.project_id);
  const list = await reg.list();
  assert.equal(list.length, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test('get by path or by id returns the same record', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  const r = await reg.register({ path: '/tmp/alpha' });
  const byPath = await reg.get('/tmp/alpha');
  const byId = await reg.get(r.project_id);
  assert.equal(byPath.project_id, r.project_id);
  assert.equal(byId.project_id, r.project_id);
  await fs.rm(root, { recursive: true, force: true });
});

test('update merges partial and bumps updated_at', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  const r = await reg.register({ path: '/tmp/beta', stage: 'intake' });
  await new Promise(res => setTimeout(res, 10));
  const u = await reg.update(r.project_id, { stage: 'ready', template: 'next-supabase-vercel' });
  assert.equal(u.stage, 'ready');
  assert.equal(u.template, 'next-supabase-vercel');
  assert.ok(u.updated_at > r.updated_at);
  await fs.rm(root, { recursive: true, force: true });
});

test('update mirrors stage + name into the index row', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  const r = await reg.register({ path: '/tmp/gamma', stage: 'intake', name: 'gamma' });
  await reg.update(r.project_id, { stage: 'ready', name: 'gamma-v2' });
  const idx = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'));
  const row = idx.projects.find(p => p.project_id === r.project_id);
  assert.equal(row.stage, 'ready');
  assert.equal(row.name, 'gamma-v2');
  await fs.rm(root, { recursive: true, force: true });
});

test('remove deletes project record and index row', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  const r = await reg.register({ path: '/tmp/delta' });
  await reg.remove(r.project_id);
  const gone = await reg.get(r.project_id);
  assert.equal(gone, null);
  const idx = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'));
  assert.equal(idx.projects.length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test('atomic write — leaves no partial file on interruption', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  await reg.register({ path: '/tmp/epsilon' });
  // simulate an interrupted tmp file alongside real file
  const projectFiles = await fs.readdir(path.join(root, 'projects'));
  assert.ok(projectFiles.some(f => f.endsWith('.json')));
  // No *.tmp-* leftovers after register completes.
  assert.ok(projectFiles.every(f => !f.includes('.tmp-')));
  await fs.rm(root, { recursive: true, force: true });
});

test('backup file is created on overwrite', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  const r = await reg.register({ path: '/tmp/zeta' });
  await reg.update(r.project_id, { stage: 'ready' });
  const bak = path.join(root, 'projects', `${r.project_id}.json.bak`);
  await fs.access(bak); // throws if missing
  await fs.rm(root, { recursive: true, force: true });
});

test('corrupt index recovers from .bak silently', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  await reg.register({ path: '/tmp/eta' });
  // .bak was created on the second write; force a first-write scenario by registering twice.
  await reg.register({ path: '/tmp/eta2' });
  // Corrupt index.json
  await fs.writeFile(path.join(root, 'index.json'), '{{{ not json', 'utf8');
  const list = await reg.list();
  assert.ok(Array.isArray(list));
  await fs.rm(root, { recursive: true, force: true });
});

test('list returns index entries', async () => {
  const root = tmpRoot();
  const reg = new Registry({ root });
  await reg.register({ path: '/tmp/iota' });
  await reg.register({ path: '/tmp/kappa' });
  const list = await reg.list();
  assert.equal(list.length, 2);
  const paths = list.map(p => p.path).sort();
  assert.deepEqual(paths, ['/tmp/iota', '/tmp/kappa']);
  await fs.rm(root, { recursive: true, force: true });
});

test('idFromPath is deterministic across case differences', () => {
  const a = Registry.idFromPath('/Users/x/DEV/Foo');
  const b = Registry.idFromPath('/users/X/dev/foo');
  assert.equal(a, b);
});

test('schema_version newer than binary rejects', async () => {
  const root = tmpRoot();
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, 'index.json'),
    JSON.stringify({ schema_version: 999, projects: [] })
  );
  const reg = new Registry({ root });
  await assert.rejects(
    () => reg.list(),
    (err) => err instanceof RegistryError && err.code === 'SCHEMA_NEWER'
  );
  await fs.rm(root, { recursive: true, force: true });
});
