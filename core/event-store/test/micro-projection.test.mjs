import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildState } from '../src/projection.mjs';

const base = {
  ts: '2026-04-19T00:00:00.000Z',
  session_id: 'sess_01HXYZ000000000000000001',
  wave: null,
  task_id: 'MICRO_CTA_001'
};

test('micro-lane task events (wave=null) land in state.micro_tasks', () => {
  const s = buildState([
    { ...base, event_id: 'ev_01', agent: 'task-decomposer', action: 'task.contracted', payload: { risk_class: 'safe' } },
    { ...base, event_id: 'ev_02', agent: 'implementer', action: 'task.implemented', tokens: { input: 200, output: 50 } },
    { ...base, event_id: 'ev_03', agent: 'task-impl-reviewer', action: 'task.reviewed', payload: { quality_score: 0.95 } },
    { ...base, event_id: 'ev_04', agent: 'orchestrator', action: 'task.accepted' }
  ]);
  assert.ok(s.micro_tasks, 'expected state.micro_tasks');
  assert.ok(s.micro_tasks.MICRO_CTA_001, 'expected micro task MICRO_CTA_001');
  assert.equal(s.micro_tasks.MICRO_CTA_001.status, 'accepted');
  assert.equal(s.micro_tasks.MICRO_CTA_001.risk_class, 'safe');
  assert.equal(s.micro_tasks.MICRO_CTA_001.quality_score, 0.95);
  assert.deepEqual(Object.keys(s.waves), [], 'wave=null tasks must NOT appear in state.waves');
});

test('micro and heavy lanes coexist cleanly', () => {
  const heavyBase = { ts: '2026-04-19T00:00:00.000Z', session_id: 'sess_01HXYZ000000000000000001', wave: 2, task_id: 'HEAVY_001' };
  const microBase = { ts: '2026-04-19T00:00:01.000Z', session_id: 'sess_01HXYZ000000000000000001', wave: null, task_id: 'MICRO_001' };
  const s = buildState([
    { ...heavyBase, event_id: 'ev_01', agent: 'task-decomposer', action: 'task.contracted' },
    { ...heavyBase, event_id: 'ev_02', agent: 'orchestrator', action: 'task.accepted' },
    { ...microBase, event_id: 'ev_03', agent: 'task-decomposer', action: 'task.contracted' },
    { ...microBase, event_id: 'ev_04', agent: 'orchestrator', action: 'task.accepted' }
  ]);
  assert.equal(s.waves[2].tasks.HEAVY_001.status, 'accepted');
  assert.equal(s.micro_tasks.MICRO_001.status, 'accepted');
  assert.equal(Object.keys(s.waves).length, 1);
  assert.equal(Object.keys(s.micro_tasks).length, 1);
});

test('task.routed on micro task records model+effort', () => {
  const s = buildState([
    { ...base, event_id: 'ev_01', agent: 'task-decomposer', action: 'task.contracted' },
    { ...base, event_id: 'ev_02', agent: 'orchestrator', action: 'task.routed', payload: { model: 'gpt-5.3-codex-spark', effort: 'default' } }
  ]);
  assert.equal(s.micro_tasks.MICRO_CTA_001.model, 'gpt-5.3-codex-spark');
  assert.equal(s.micro_tasks.MICRO_CTA_001.effort, 'default');
});
