import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildState, applyEvent, initialState } from '../src/projection.mjs';

test('empty log → initial state', () => {
  const s = buildState([]);
  assert.equal(s.version, 1);
  assert.equal(s.totals.events, 0);
  assert.deepEqual(s.waves, {});
  assert.equal(s.context_zone, 'green');
});

test('session.start populates session + project', () => {
  const s = buildState([
    {
      event_id: 'ev_A', ts: '2026-04-19T00:00:00.000Z',
      session_id: 'sess_X', agent: 'orchestrator',
      action: 'session.start', payload: { project: 'demo', constitution_version: 2 }
    }
  ]);
  assert.equal(s.session_id, 'sess_X');
  assert.equal(s.project.name, 'demo');
  assert.equal(s.project.constitution_version, 2);
});

test('full task lifecycle', () => {
  const base = { ts: '2026-04-19T00:00:00.000Z', session_id: 'sess_X', wave: 1, task_id: 'T1' };
  const events = [
    { ...base, event_id: 'ev_01', agent: 'task-decomposer', action: 'wave.planned' },
    { ...base, event_id: 'ev_02', agent: 'task-decomposer', action: 'task.contracted', payload: { risk_class: 'safe', evidence_folder: 'tasks/waves/1/T1/evidence/' } },
    { ...base, event_id: 'ev_03', agent: 'orchestrator', action: 'task.routed', payload: { model: 'gpt-5.3-codex', effort: 'high' } },
    { ...base, event_id: 'ev_04', agent: 'implementer', action: 'task.dispatched' },
    { ...base, event_id: 'ev_05', agent: 'implementer', action: 'task.implemented', tokens: { input: 1000, output: 200 }, cost_usd_estimate: 0.05 },
    { ...base, event_id: 'ev_06', agent: 'task-impl-reviewer', action: 'gate.passed', payload: { gate: 'tests' } },
    { ...base, event_id: 'ev_07', agent: 'task-impl-reviewer', action: 'task.reviewed', payload: { quality_score: 0.9 } },
    { ...base, event_id: 'ev_08', agent: 'orchestrator', action: 'task.accepted' }
  ];
  const s = buildState(events);
  assert.equal(s.waves[1].tasks.T1.status, 'accepted');
  assert.equal(s.waves[1].tasks.T1.risk_class, 'safe');
  assert.equal(s.waves[1].tasks.T1.evidence_folder, 'tasks/waves/1/T1/evidence/');
  assert.equal(s.waves[1].tasks.T1.model, 'gpt-5.3-codex');
  assert.equal(s.waves[1].tasks.T1.effort, 'high');
  assert.equal(s.waves[1].tasks.T1.gates.tests, 'pass');
  assert.equal(s.waves[1].tasks.T1.quality_score, 0.9);
  assert.equal(s.totals.events, 8);
  assert.equal(s.totals.tokens, 1200);
  assert.ok(s.totals.cost_usd_estimate >= 0.05);
  assert.deepEqual(s.waves[1].tasks.T1.tokens.implementer, { in: 1000, out: 200, cost: 0.05 });
});

test('retries increment on reject and revise', () => {
  const base = { ts: '2026-04-19T00:00:00.000Z', session_id: 'sess_X', wave: 1, task_id: 'T1' };
  const s = buildState([
    { ...base, event_id: 'ev_01', agent: 'task-decomposer', action: 'task.contracted' },
    { ...base, event_id: 'ev_02', agent: 'implementer', action: 'task.implemented' },
    { ...base, event_id: 'ev_03', agent: 'task-impl-reviewer', action: 'task.rejected' },
    { ...base, event_id: 'ev_04', agent: 'implementer', action: 'task.implemented' },
    { ...base, event_id: 'ev_05', agent: 'task-impl-reviewer', action: 'task.revised' }
  ]);
  assert.equal(s.waves[1].tasks.T1.retries, 2);
});

test('question.asked / answered manages open_questions list', () => {
  const base = { ts: '2026-04-19T00:00:00.000Z', session_id: 'sess_X', agent: 'orchestrator' };
  const s = buildState([
    { ...base, event_id: 'ev_a', action: 'question.asked', payload: { question_id: 'Q-1' } },
    { ...base, event_id: 'ev_b', action: 'question.asked', payload: { question_id: 'Q-2' } },
    { ...base, event_id: 'ev_c', action: 'question.answered', payload: { question_id: 'Q-1' } }
  ]);
  assert.deepEqual(s.open_questions, ['Q-2']);
});

test('context_zone.changed updates zone', () => {
  const s = buildState([
    { event_id: 'ev_a', ts: '2026-04-19T00:00:00.000Z', session_id: 'sess_X', agent: 'orchestrator', action: 'context_zone.changed', payload: { zone: 'yellow' } }
  ]);
  assert.equal(s.context_zone, 'yellow');
});

test('lease.acquired / expired roundtrip', () => {
  const base = { ts: '2026-04-19T00:00:00.000Z', session_id: 'sess_X', wave: 2, task_id: 'T2' };
  const s = buildState([
    { ...base, event_id: 'ev_01', agent: 'orchestrator', action: 'task.contracted' },
    { ...base, event_id: 'ev_02', agent: 'orchestrator', action: 'lease.acquired', payload: { worktree: '.nightshift/worktrees/w2-t2', until: '2026-04-19T00:15:00.000Z', locks: ['a.ts'] } },
    { ...base, event_id: 'ev_03', agent: 'orchestrator', action: 'lease.expired' }
  ]);
  assert.equal(s.waves[2].tasks.T2.lease, null);
});

test('pinger.unstuck.failed pauses task', () => {
  const base = { ts: '2026-04-19T00:00:00.000Z', session_id: 'sess_X', wave: 1, task_id: 'T-P' };
  const s = buildState([
    { ...base, event_id: 'ev_a', agent: 'health-pinger', action: 'pinger.unstuck.failed' }
  ]);
  assert.deepEqual(s.paused_tasks, ['T-P']);
});

test('applyEvent is pure-ish (no cross-instance bleed)', () => {
  const s1 = initialState();
  applyEvent(s1, { event_id: 'ev_1', ts: 't', session_id: 'sess_X', agent: 'system', action: 'session.start', payload: { project: 'A' } });
  const s2 = initialState();
  assert.equal(s2.project.name, '');
});

test('gate.failed records fail', () => {
  const base = { ts: 't', session_id: 'sess_X', wave: 1, task_id: 'T1' };
  const s = buildState([
    { ...base, event_id: 'ev_1', agent: 'task-impl-reviewer', action: 'gate.failed', payload: { gate: 'types' } }
  ]);
  assert.equal(s.waves[1].tasks.T1.gates.types, 'fail');
});
