import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendEvent, assertReviewerNotImplementer, estimateCost } from '../dispatch.mjs';
import { EventStore } from '../../event-store/src/index.mjs';

function tmpLog() {
  return path.join(tmpdir(), `ns-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson`);
}

test('assertReviewerNotImplementer passes when models differ', () => {
  const [ok, reason] = assertReviewerNotImplementer('gpt-5.3-codex', 'claude-opus-4-7');
  assert.equal(ok, true);
  assert.equal(reason, null);
});

test('assertReviewerNotImplementer rejects identical models', () => {
  const [ok, reason] = assertReviewerNotImplementer('gpt-5.3-codex', 'gpt-5.3-codex');
  assert.equal(ok, false);
  assert.match(reason, /reviewer model.*must differ/);
});

test('assertReviewerNotImplementer is tolerant of missing models', () => {
  assert.deepEqual(assertReviewerNotImplementer(null, 'x'), [true, null]);
  assert.deepEqual(assertReviewerNotImplementer('x', null), [true, null]);
});

test('appendEvent fills cost when model+tokens present', async () => {
  const p = tmpLog();
  const written = await appendEvent(p, {
    session_id: 'sess_01HXYZ000000000000000001',
    agent: 'implementer',
    model: 'gpt-5.4',
    action: 'task.implemented',
    tokens: { input: 10000, output: 2000 }
  });
  assert.ok(written.cost_usd_estimate > 0);
  await fs.rm(p, { force: true });
});

test('appendEvent routes through EventStore validation (bad event rejected)', async () => {
  const p = tmpLog();
  await assert.rejects(
    () => appendEvent(p, { agent: 'orchestrator', action: 'bogus.action' }),
    /Invalid event/
  );
});

test('estimateCost uses defaults for unknown models', async () => {
  const cost = await estimateCost('unknown-model', { input: 1_000_000, output: 0 });
  assert.ok(cost > 0);
});
