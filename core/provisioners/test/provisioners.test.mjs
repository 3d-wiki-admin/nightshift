import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeProvisioner, listServices } from '../index.mjs';
import { EventStore } from '../../event-store/src/index.mjs';

function tmpLog() {
  return path.join(tmpdir(), `ns-prov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson`);
}

test('registry lists expected services', () => {
  const svcs = listServices().sort();
  assert.deepEqual(svcs, ['railway', 'redis', 'supabase', 'vercel']);
});

test('makeProvisioner returns correct class and preflight returns reasons', async () => {
  const logPath = tmpLog();
  const eventStore = new EventStore(logPath);
  const p = makeProvisioner('vercel', { eventStore });
  assert.equal(p.service, 'vercel');
  const pre = await p.preflight();
  assert.equal(typeof pre.ok, 'boolean');
  assert.ok(Array.isArray(pre.reasons));
  await fs.rm(logPath, { force: true });
});

test('docsUrl returns url and summary', async () => {
  const p = makeProvisioner('supabase', {});
  const d = await p.docsUrl();
  assert.match(d.url, /^https?:\/\//);
  assert.ok(d.summary.length > 10);
});

test('dry-run create emits infra.provisioned with dry_run:true', async () => {
  const logPath = tmpLog();
  const eventStore = new EventStore(logPath);
  const p = makeProvisioner('vercel', { execute: false, eventStore });

  const originalPreflight = p.preflight.bind(p);
  p.preflight = async () => ({ ok: true, reasons: [] });

  const result = await p.create({ project: 'test-project' });
  assert.equal(result.id, 'test-project');
  assert.match(result.ref, /^vercel:\/\/projects\/test-project$/);

  const all = await eventStore.all();
  const prov = all.find(e => e.action === 'infra.provisioned');
  assert.ok(prov, 'expected infra.provisioned event');
  assert.equal(prov.payload.dry_run, true);
  assert.equal(prov.payload.service, 'vercel');

  await fs.rm(logPath, { force: true });
});

test('unknown service throws', () => {
  assert.throws(() => makeProvisioner('bogus', {}), /Unknown provisioner service/);
});
