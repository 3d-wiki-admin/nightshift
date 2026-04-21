import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventStore, validateEvent } from '../src/index.mjs';

function tmpPath() {
  return path.join(tmpdir(), `ns-schema-wave-handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson`);
}

async function cleanup(p) {
  await fs.rm(p, { force: true }).catch(() => {});
}

function buildEvent({ eventId, ts }) {
  return {
    ts,
    event_id: eventId,
    session_id: 'sess_01HXYZ000000000000000ABC',
    wave: 3,
    agent: 'orchestrator',
    action: 'wave.handoff',
    outcome: 'success',
    payload: {
      source_wave: 3,
      next_wave: 4,
      source_session_id: 'sess_01HXYZ000000000000000ABC',
      handoff_token: '20260421T010203Z-deadbeef',
      handoff_path: 'tasks/waves/3/handoff-to-next.md',
      next_manifest: 'tasks/waves/4/manifest.yaml'
    }
  };
}

test('wave.handoff validates against the event schema', () => {
  const event = buildEvent({
    eventId: 'ev_01HXYZ000000000000000AAE',
    ts: '2026-04-21T01:00:04.000Z'
  });

  const result = validateEvent(event);
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('wave.handoff round-trips through append() and read()', async () => {
  const logPath = tmpPath();
  const store = new EventStore(logPath);

  try {
    const event = buildEvent({
      eventId: 'ev_01HXYZ000000000000000AAF',
      ts: '2026-04-21T01:00:05.000Z'
    });

    await assert.doesNotReject(() => store.append(event));

    const readBack = [];
    for await (const item of store.read()) readBack.push(item);

    assert.equal(readBack.length, 1);
    assert.equal(readBack[0].action, 'wave.handoff');
    assert.equal(readBack[0].payload.handoff_path, 'tasks/waves/3/handoff-to-next.md');
    assert.equal(readBack[0].payload.next_manifest, 'tasks/waves/4/manifest.yaml');
  } finally {
    await cleanup(logPath);
  }
});
