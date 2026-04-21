import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventStore, validateEvent } from '../src/index.mjs';

function tmpPath() {
  return path.join(tmpdir(), `ns-schema-enum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson`);
}

async function cleanup(p) {
  await fs.rm(p, { force: true }).catch(() => {});
}

function buildEvent({ action, agent, eventId, ts }) {
  return {
    ts,
    event_id: eventId,
    session_id: 'sess_01HXYZ000000000000000ABC',
    agent,
    action
  };
}

test('plan.completed and analyze.completed validate against the event schema', () => {
  const cases = [
    buildEvent({
      action: 'plan.completed',
      agent: 'plan-writer',
      eventId: 'ev_01HXYZ000000000000000AAA',
      ts: '2026-04-21T01:00:00.000Z'
    }),
    buildEvent({
      action: 'analyze.completed',
      agent: 'analyzer',
      eventId: 'ev_01HXYZ000000000000000AAB',
      ts: '2026-04-21T01:00:01.000Z'
    })
  ];

  for (const event of cases) {
    const result = validateEvent(event);
    assert.equal(result.ok, true, result.errors.join('; '));
  }
});

test('plan.completed and analyze.completed round-trip through append() and read()', async () => {
  const logPath = tmpPath();
  const store = new EventStore(logPath);

  try {
    const events = [
      buildEvent({
        action: 'plan.completed',
        agent: 'plan-writer',
        eventId: 'ev_01HXYZ000000000000000AAC',
        ts: '2026-04-21T01:00:02.000Z'
      }),
      buildEvent({
        action: 'analyze.completed',
        agent: 'analyzer',
        eventId: 'ev_01HXYZ000000000000000AAD',
        ts: '2026-04-21T01:00:03.000Z'
      })
    ];

    for (const event of events) {
      await assert.doesNotReject(() => store.append(event));
    }

    const readBack = [];
    for await (const event of store.read()) readBack.push(event);

    assert.deepEqual(
      readBack.map(({ action, agent, session_id }) => ({ action, agent, session_id })),
      events.map(({ action, agent, session_id }) => ({ action, agent, session_id }))
    );
  } finally {
    await cleanup(logPath);
  }
});
