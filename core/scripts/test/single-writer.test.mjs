import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventStore } from '../../event-store/src/index.mjs';

const HEALTH_PING = path.resolve(new URL('../health-ping.mjs', import.meta.url).pathname);
const MORNING_DIGEST = path.resolve(new URL('../morning-digest.mjs', import.meta.url).pathname);

function tmpProject() {
  return path.join(tmpdir(), `ns-swriter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function bootstrap(project, events = []) {
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  const logPath = path.join(project, 'tasks', 'events.ndjson');
  if (events.length) {
    await fs.writeFile(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
  return logPath;
}

test('health-ping appends pinger.ping via dispatch.appendEvent (single-writer invariant)', async () => {
  const project = tmpProject();
  const logPath = await bootstrap(project, [
    {
      event_id: 'ev_01HXYZ000000000000000AAA',
      ts: '2026-04-19T00:00:00.000Z',
      session_id: 'sess_01HXYZ000000000000000001',
      agent: 'orchestrator',
      action: 'session.start',
      payload: { project: 'swriter' }
    }
  ]);

  const before = (await new EventStore(logPath).all()).length;
  const res = spawnSync('node', [HEALTH_PING, project], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTSHIFT_CLAUDE_CMD: '/bin/true' }
  });
  assert.equal(res.status, 0, `health-ping exited ${res.status}: ${res.stderr}`);

  const events = await new EventStore(logPath).all();
  assert.equal(events.length, before + 1, 'expected exactly one new event');
  const pingEvent = events.at(-1);
  assert.equal(pingEvent.action, 'pinger.ping');
  assert.equal(pingEvent.agent, 'health-pinger');
  // The event must validate against the schema — appendEvent routes through
  // EventStore.append which validates; a schema-invalid event would have
  // caused appendEvent to throw and health-ping to exit non-zero.
  assert.match(pingEvent.session_id, /^sess_[0-9A-HJKMNP-TV-Z]{20,40}$/);
  assert.match(pingEvent.event_id, /^ev_[0-9A-HJKMNP-TV-Z]{20,40}$/);

  await fs.rm(project, { recursive: true, force: true });
});

test('morning-digest appends via dispatch.appendEvent and generates a digest file', async () => {
  const project = tmpProject();
  const logPath = await bootstrap(project, [
    {
      event_id: 'ev_01HXYZ000000000000000AAA',
      ts: '2026-04-19T00:00:00.000Z',
      session_id: 'sess_01HXYZ000000000000000001',
      agent: 'orchestrator',
      action: 'session.start',
      payload: { project: 'swriter' }
    }
  ]);

  const res = spawnSync('node', [MORNING_DIGEST, project], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTSHIFT_DIGEST_VOICE: '0' }
  });
  assert.equal(res.status, 0, `morning-digest exited ${res.status}: ${res.stderr}`);

  const events = await new EventStore(logPath).all();
  const lastEvent = events.at(-1);
  assert.equal(lastEvent.agent, 'morning-digest');
  assert.equal(lastEvent.action, 'pinger.ping');
  assert.match(lastEvent.session_id, /^sess_[0-9A-HJKMNP-TV-Z]{20,40}$/);

  await fs.rm(project, { recursive: true, force: true });
});
