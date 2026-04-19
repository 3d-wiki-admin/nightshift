import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPLAY = path.resolve(new URL('../replay-events.mjs', import.meta.url).pathname);

function tmpLog() {
  return path.join(tmpdir(), `ns-replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson`);
}

async function writeEvents(logPath, events) {
  await fs.writeFile(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

const validEvent = {
  event_id: 'ev_01HXYZ000000000000000AAA',
  ts: '2026-04-19T00:00:00.000Z',
  session_id: 'sess_01HXYZ000000000000000001',
  agent: 'orchestrator',
  action: 'session.start',
  payload: { project: 'test' }
};

test('replay strict refuses event with forbidden ULID char (I)', async () => {
  const logPath = tmpLog();
  const badEvent = { ...validEvent, event_id: 'ev_01HXYZ000000000000000AAI' };
  await writeEvents(logPath, [badEvent]);
  const res = spawnSync('node', [REPLAY, logPath, '--compact'], { encoding: 'utf8' });
  assert.notEqual(res.status, 0, 'expected replay to refuse — got exit 0');
  assert.match(res.stderr, /failed schema|invalid events/i);
  await fs.rm(logPath, { force: true });
});

test('replay strict refuses event with forbidden ULID char (L)', async () => {
  const logPath = tmpLog();
  const badEvent = { ...validEvent, event_id: 'ev_01HXYZ000000000000000AAL' };
  await writeEvents(logPath, [badEvent]);
  const res = spawnSync('node', [REPLAY, logPath, '--compact'], { encoding: 'utf8' });
  assert.notEqual(res.status, 0);
  await fs.rm(logPath, { force: true });
});

test('replay strict refuses event with forbidden ULID char (O)', async () => {
  const logPath = tmpLog();
  const badEvent = { ...validEvent, event_id: 'ev_01HXYZ000000000000000AAO' };
  await writeEvents(logPath, [badEvent]);
  const res = spawnSync('node', [REPLAY, logPath, '--compact'], { encoding: 'utf8' });
  assert.notEqual(res.status, 0);
  await fs.rm(logPath, { force: true });
});

test('replay --lax accepts event with invalid id (opt-out)', async () => {
  const logPath = tmpLog();
  const badEvent = { ...validEvent, event_id: 'ev_01HXYZ000000000000000AAI' };
  await writeEvents(logPath, [badEvent]);
  const res = spawnSync('node', [REPLAY, logPath, '--lax', '--compact'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `--lax should project; got exit ${res.status}, stderr: ${res.stderr}`);
  await fs.rm(logPath, { force: true });
});

test('replay strict accepts valid fixture', async () => {
  const fixturePath = path.resolve(new URL('../../event-store/test/fixtures/sample.ndjson', import.meta.url).pathname);
  const res = spawnSync('node', [REPLAY, fixturePath, '--compact'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected clean replay; stderr: ${res.stderr}`);
  assert.match(res.stdout, /"version":1/);
});
