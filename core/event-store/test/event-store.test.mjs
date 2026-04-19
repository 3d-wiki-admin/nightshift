import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventStore } from '../src/index.mjs';

function tmpPath() {
  return path.join(tmpdir(), `ns-events-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson`);
}

async function cleanup(p) {
  await fs.rm(p, { force: true }).catch(() => {});
}

test('append generates id and ts when missing', async () => {
  const p = tmpPath();
  const store = new EventStore(p);
  const ev = await store.append({
    session_id: 'sess_01HXYZ000000000000000ABC',
    agent: 'orchestrator',
    action: 'session.start'
  });
  assert.match(ev.event_id, /^ev_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(ev.ts);
  const all = await store.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].event_id, ev.event_id);
  await cleanup(p);
});

test('append rejects invalid event', async () => {
  const p = tmpPath();
  const store = new EventStore(p);
  await assert.rejects(
    () => store.append({ agent: 'orchestrator', action: 'bogus.action' }),
    /Invalid event/
  );
  await cleanup(p);
});

test('append rejects when session_id missing', async () => {
  const p = tmpPath();
  const store = new EventStore(p);
  await assert.rejects(
    () => store.append({ agent: 'orchestrator', action: 'session.start' }),
    /Invalid event/
  );
  await cleanup(p);
});

test('read iterates lines skipping blanks', async () => {
  const p = tmpPath();
  const store = new EventStore(p);
  await store.append({
    session_id: 'sess_01HXYZ000000000000000ABC',
    agent: 'system',
    action: 'session.start'
  });
  await fs.appendFile(p, '\n\n', 'utf8');
  await store.append({
    session_id: 'sess_01HXYZ000000000000000ABC',
    agent: 'system',
    action: 'session.end'
  });
  const all = await store.all();
  assert.equal(all.length, 2);
  assert.equal(all[0].action, 'session.start');
  assert.equal(all[1].action, 'session.end');
  await cleanup(p);
});

test('read on missing file returns empty', async () => {
  const p = tmpPath();
  const store = new EventStore(p);
  const all = await store.all();
  assert.deepEqual(all, []);
});

test('size returns 0 for missing file', async () => {
  const p = tmpPath();
  const store = new EventStore(p);
  assert.equal(await store.size(), 0);
});

test('size grows on append', async () => {
  const p = tmpPath();
  const store = new EventStore(p);
  await store.append({
    session_id: 'sess_01HXYZ000000000000000ABC',
    agent: 'system',
    action: 'session.start'
  });
  assert.ok((await store.size()) > 0);
  await cleanup(p);
});

test('corrupt line throws descriptive error', async () => {
  const p = tmpPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, '{"broken":\n', 'utf8');
  const store = new EventStore(p);
  await assert.rejects(() => store.all(), /Corrupt log line/);
  await cleanup(p);
});
