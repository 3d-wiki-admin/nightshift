import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openQuestions } from '../src/open-questions.mjs';

function makeEvent(overrides = {}) {
  return {
    event_id: 'ev_default',
    ts: '2026-04-21T00:00:00.000Z',
    action: 'question.asked',
    payload: { question_id: 'Q-1', question: 'Need approval?' },
    wave: 1,
    task_id: 'T1-A',
    ...overrides
  };
}

test('empty input returns empty array', () => {
  assert.deepEqual(openQuestions([]), []);
});

test('one asked and never resolved returns one entry', () => {
  const result = openQuestions([makeEvent()]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    id: 'Q-1',
    ts: '2026-04-21T00:00:00.000Z',
    payload: { question_id: 'Q-1', question: 'Need approval?' },
    wave: 1,
    task_id: 'T1-A'
  });
});

test('question.answered resolves an open question', () => {
  const result = openQuestions([
    makeEvent(),
    makeEvent({
      event_id: 'ev_answered',
      ts: '2026-04-21T00:01:00.000Z',
      action: 'question.answered',
      payload: { question_id: 'Q-1' }
    })
  ]);

  assert.deepEqual(result, []);
});

test('decision.recorded with question_id resolves an open question', () => {
  const result = openQuestions([
    makeEvent(),
    makeEvent({
      event_id: 'ev_decision',
      ts: '2026-04-21T00:01:00.000Z',
      action: 'decision.recorded',
      payload: { question_id: 'Q-1', decision: 'approved' }
    })
  ]);

  assert.deepEqual(result, []);
});

test('one of two open questions can be resolved by decision.recorded', () => {
  const result = openQuestions([
    makeEvent({ event_id: 'ev_q1', payload: { question_id: 'Q-1', question: 'First?' } }),
    makeEvent({
      event_id: 'ev_q2',
      ts: '2026-04-21T00:00:01.000Z',
      payload: { question_id: 'Q-2', question: 'Second?' },
      task_id: 'T1-B'
    }),
    makeEvent({
      event_id: 'ev_decision',
      ts: '2026-04-21T00:00:02.000Z',
      action: 'decision.recorded',
      payload: { question_id: 'Q-1' }
    })
  ]);

  assert.deepEqual(result, [
    {
      id: 'Q-2',
      ts: '2026-04-21T00:00:01.000Z',
      payload: { question_id: 'Q-2', question: 'Second?' },
      wave: 1,
      task_id: 'T1-B'
    }
  ]);
});

test('missing payload.question_id is skipped and warns', () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    const result = openQuestions([
      makeEvent({
        event_id: 'ev_bad',
        payload: { question: 'Missing id' }
      })
    ]);

    assert.deepEqual(result, []);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1], 'ev_bad');
});

test('output is sorted by ts ascending even when input order is not', () => {
  const result = openQuestions([
    makeEvent({
      event_id: 'ev_late',
      ts: '2026-04-21T00:00:02.000Z',
      payload: { question_id: 'Q-2', question: 'Later?' }
    }),
    makeEvent({
      event_id: 'ev_early',
      ts: '2026-04-21T00:00:01.000Z',
      payload: { question_id: 'Q-1', question: 'Earlier?' }
    })
  ]);

  assert.deepEqual(result.map(question => question.id), ['Q-1', 'Q-2']);
});

test('wave and task_id propagate to the open question entry', () => {
  const [result] = openQuestions([
    makeEvent({
      event_id: 'ev_wave',
      wave: 2,
      task_id: 'T2-X',
      payload: { question_id: 'Q-2', question: 'Wave-specific?' }
    })
  ]);

  assert.equal(result.wave, 2);
  assert.equal(result.task_id, 'T2-X');
});
