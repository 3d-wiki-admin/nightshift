import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const HEALTH_PING = path.join(ROOT, 'core', 'scripts', 'health-ping.mjs');

function tmp(name = 'ns-h14') {
  return path.join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function writeExec(filePath, body) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, { mode: 0o755 });
}

function makeEvent(action, overrides = {}) {
  return {
    event_id: overrides.event_id || `ev_${Math.random().toString(36).slice(2, 18).toUpperCase()}`,
    ts: overrides.ts || '2026-04-20T00:00:00.000Z',
    session_id: overrides.session_id || 'sess_01HXYZ000000000000000001',
    agent: overrides.agent || 'orchestrator',
    action,
    ...overrides
  };
}

async function bootstrapProject(events = []) {
  const project = tmp('ns-h14-project');
  await fs.mkdir(project, { recursive: true });
  if (events.length) {
    await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      events.map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );
  }
  return project;
}

async function readEvents(project) {
  const logPath = path.join(project, 'tasks', 'events.ndjson');
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    return raw.trim() ? raw.trim().split('\n').map(line => JSON.parse(line)) : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function setupFakeClaude() {
  const binDir = tmp('ns-h14-bin');
  const recordPath = path.join(binDir, 'claude-record.txt');
  const claudePath = path.join(binDir, 'claude-stub');
  await writeExec(claudePath, [
    '#!/usr/bin/env bash',
    `echo "$*" >> "${recordPath}"`,
    'exit 0'
  ].join('\n'));
  return { binDir, claudePath, recordPath };
}

async function setupFakeSay(binDir) {
  const sayRecordPath = path.join(binDir, 'say-record.txt');
  const sayPath = path.join(binDir, 'say');
  await writeExec(sayPath, [
    '#!/usr/bin/env bash',
    `echo "$*" >> "${sayRecordPath}"`,
    'exit 0'
  ].join('\n'));
  return { sayPath, sayRecordPath };
}

function runHealthPing(project, env = {}) {
  return spawnSync('node', [HEALTH_PING, project], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTSHIFT_AUTO_CHECKPOINT: '0', ...env }
  });
}

async function readLineCount(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.trim() ? raw.trim().split('\n').length : 0;
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
}

function staleTs(minutes = 45) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function staleStalledFixture(extraEvents = []) {
  const ts = staleTs();
  return [
    makeEvent('session.start', {
      event_id: 'ev_01HXYZ000000000000000AAA',
      ts,
      payload: { project: 'hotfix2-pinger' }
    }),
    makeEvent('wave.planned', {
      event_id: 'ev_01HXYZ000000000000000AAB',
      ts,
      wave: 1,
      agent: 'task-decomposer'
    }),
    makeEvent('wave.started', {
      event_id: 'ev_01HXYZ000000000000000AAC',
      ts,
      wave: 1
    }),
    makeEvent('task.contracted', {
      event_id: 'ev_01HXYZ000000000000000AAD',
      ts,
      wave: 1,
      task_id: 'T1_FOO',
      agent: 'task-decomposer'
    }),
    makeEvent('task.dispatched', {
      event_id: 'ev_01HXYZ000000000000000AAE',
      ts,
      wave: 1,
      task_id: 'T1_FOO',
      agent: 'implementer'
    }),
    ...extraEvents
  ];
}

test('F-A: unanswered question skips claude on repeated pings and records awaiting-human events', async () => {
  const ts = staleTs();
  const questionId = 'Q-1001';
  const project = await bootstrapProject([
    ...staleStalledFixture([
      makeEvent('question.asked', {
        event_id: 'ev_01HXYZ000000000000000AAF',
        ts,
        wave: 1,
        task_id: 'T1_FOO',
        agent: 'orchestrator',
        payload: { question_id: questionId, question: 'Ship the migration now?' }
      }),
      makeEvent('pinger.ping', {
        event_id: 'ev_01HXYZ000000000000000AAG',
        ts,
        agent: 'health-pinger',
        payload: { source: 'launchd', project: 'fixture' }
      }),
      makeEvent('task.implemented', {
        event_id: 'ev_01HXYZ000000000000000AAH',
        ts,
        wave: 1,
        task_id: 'T1_FOO',
        agent: 'implementer'
      })
    ])
  ]);
  const { binDir, claudePath, recordPath } = await setupFakeClaude();

  try {
    const env = { NIGHTSHIFT_CLAUDE_CMD: claudePath };
    const first = runHealthPing(project, env);
    const second = runHealthPing(project, env);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readLineCount(recordPath), 0, 'claude --continue should not be called while a question is open');

    const events = await readEvents(project);
    const paused = events.filter(event => event.action === 'session.paused');
    const skippedPings = events.filter(
      event => event.action === 'pinger.ping' && event.payload?.skipped === 'awaiting_human'
    );
    assert.equal(paused.length, 2, 'expected one session.paused per pinger tick');
    assert.equal(skippedPings.length, 2, 'expected one skipped pinger.ping per pinger tick');
    for (const event of paused) {
      assert.deepEqual(event.payload?.open_question_ids, [questionId]);
      assert.match(event.notes || '', /awaiting human approval on Q-1001 \(1 open\)/);
      assert.match(event.notes || '', /Recover: open the Claude session and answer\./);
    }
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-B: decision.recorded resolves the question so pinger resumes the normal stale-task path', async () => {
  const ts = staleTs();
  const questionId = 'Q-2001';
  const project = await bootstrapProject([
    ...staleStalledFixture([
      makeEvent('question.asked', {
        event_id: 'ev_01HXYZ000000000000000ABA',
        ts,
        wave: 1,
        task_id: 'T1_FOO',
        agent: 'orchestrator',
        payload: { question_id: questionId, question: 'Need approval?' }
      }),
      makeEvent('decision.recorded', {
        event_id: 'ev_01HXYZ000000000000000ABB',
        ts,
        wave: 1,
        task_id: 'T1_FOO',
        agent: 'orchestrator',
        payload: { question_id: questionId, decision: 'approved' }
      })
    ])
  ]);
  const { binDir, claudePath, recordPath } = await setupFakeClaude();

  try {
    const res = runHealthPing(project, { NIGHTSHIFT_CLAUDE_CMD: claudePath });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(await readLineCount(recordPath), 1, 'expected normal claude --continue attempt after resolution');

    const events = await readEvents(project);
    assert.ok(events.some(event => event.action === 'pinger.unstuck'), 'expected pinger to attempt unsticking');
    assert.ok(
      events.some(event => event.action === 'pinger.ping' && event.payload?.skipped !== 'awaiting_human'),
      'expected a normal pinger.ping event'
    );
    assert.ok(!events.some(event => event.action === 'session.paused' && event.payload?.open_question_ids), 'question should be treated as resolved');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-C: question.answered resolves the question so pinger resumes the normal stale-task path', async () => {
  const ts = staleTs();
  const questionId = 'Q-3001';
  const project = await bootstrapProject([
    ...staleStalledFixture([
      makeEvent('question.asked', {
        event_id: 'ev_01HXYZ000000000000000ACA',
        ts,
        wave: 1,
        task_id: 'T1_FOO',
        agent: 'orchestrator',
        payload: { question_id: questionId, question: 'Proceed to deploy?' }
      }),
      makeEvent('question.answered', {
        event_id: 'ev_01HXYZ000000000000000ACB',
        ts,
        wave: 1,
        task_id: 'T1_FOO',
        agent: 'orchestrator',
        payload: { question_id: questionId, answer: 'yes' }
      })
    ])
  ]);
  const { binDir, claudePath, recordPath } = await setupFakeClaude();

  try {
    const res = runHealthPing(project, { NIGHTSHIFT_CLAUDE_CMD: claudePath });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(await readLineCount(recordPath), 1, 'expected normal claude --continue attempt after answer');

    const events = await readEvents(project);
    assert.ok(events.some(event => event.action === 'pinger.unstuck'), 'expected pinger to attempt unsticking');
    assert.ok(!events.some(event => event.action === 'session.paused' && event.payload?.open_question_ids), 'question should be treated as resolved');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-D: stale task with no open questions preserves current claude --continue behavior', async () => {
  const project = await bootstrapProject(staleStalledFixture());
  const { binDir, claudePath, recordPath } = await setupFakeClaude();

  try {
    const res = runHealthPing(project, { NIGHTSHIFT_CLAUDE_CMD: claudePath });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(await readLineCount(recordPath), 1, 'expected claude --continue on a normal stale task');

    const events = await readEvents(project);
    assert.ok(events.some(event => event.action === 'pinger.unstuck'), 'expected unstuck attempt');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-E: empty log and missing .nightshift directory exit cleanly', async () => {
  const project = await bootstrapProject();

  try {
    const res = runHealthPing(project, { NIGHTSHIFT_CLAUDE_CMD: '/usr/bin/true' });
    assert.equal(res.status, 0, res.stderr);

    const events = await readEvents(project);
    assert.equal(events.length, 1, 'expected the initial pinger.ping to be appended');
    assert.equal(events[0].action, 'pinger.ping');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('F-F: sentinel de-duplicates say notifications for the same unanswered question', { skip: process.platform !== 'darwin' }, async () => {
  const ts = staleTs();
  const project = await bootstrapProject([
    makeEvent('session.start', {
      event_id: 'ev_01HXYZ000000000000000ADA',
      ts,
      payload: { project: 'hotfix2-pinger' }
    }),
    makeEvent('question.asked', {
      event_id: 'ev_01HXYZ000000000000000ADB',
      ts,
      wave: 1,
      task_id: 'T1_FOO',
      agent: 'orchestrator',
      payload: { question_id: 'Q-4001', question: 'Need input?' }
    })
  ]);
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const { sayRecordPath } = await setupFakeSay(binDir);

  try {
    const env = {
      NIGHTSHIFT_CLAUDE_CMD: claudePath,
      PATH: `${binDir}:${process.env.PATH || ''}`
    };
    assert.equal(runHealthPing(project, env).status, 0);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(runHealthPing(project, env).status, 0);
    await new Promise(resolve => setTimeout(resolve, 150));

    assert.equal(await readLineCount(recordPath), 0, 'claude --continue should never be called');
    assert.equal(await readLineCount(sayRecordPath), 1, 'say should fire only once for the same unanswered question');

    const sentinel = await fs.readFile(path.join(project, '.nightshift', 'last-notified-questions'), 'utf8');
    assert.equal(sentinel, 'Q-4001');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-G: say fires once per first observation of the unresolved-question set', { skip: process.platform !== 'darwin' }, async () => {
  const ts = staleTs();
  const project = await bootstrapProject([
    makeEvent('session.start', {
      event_id: 'ev_01HXYZ000000000000000AEA',
      ts,
      payload: { project: 'hotfix2-pinger' }
    }),
    makeEvent('question.asked', {
      event_id: 'ev_01HXYZ000000000000000AEB',
      ts,
      wave: 1,
      task_id: 'T1_BAR',
      agent: 'orchestrator',
      payload: { question_id: 'Q-5002', question: 'Second question?' }
    }),
    makeEvent('question.asked', {
      event_id: 'ev_01HXYZ000000000000000AEC',
      ts,
      wave: 1,
      task_id: 'T1_FOO',
      agent: 'orchestrator',
      payload: { question_id: 'Q-5001', question: 'First question?' }
    })
  ]);
  const { binDir, claudePath } = await setupFakeClaude();
  const { sayRecordPath } = await setupFakeSay(binDir);

  try {
    const env = {
      NIGHTSHIFT_CLAUDE_CMD: claudePath,
      PATH: `${binDir}:${process.env.PATH || ''}`
    };
    assert.equal(runHealthPing(project, env).status, 0);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(runHealthPing(project, env).status, 0);
    await new Promise(resolve => setTimeout(resolve, 150));

    const logPath = path.join(project, 'tasks', 'events.ndjson');
    await fs.appendFile(logPath, JSON.stringify(makeEvent('question.asked', {
      event_id: 'ev_01HXYZ000000000000000AED',
      ts,
      wave: 1,
      task_id: 'T1_BAZ',
      agent: 'orchestrator',
      payload: { question_id: 'Q-5003', question: 'Third question?' }
    })) + '\n', 'utf8');

    assert.equal(runHealthPing(project, env).status, 0);
    await new Promise(resolve => setTimeout(resolve, 150));

    assert.equal(await readLineCount(sayRecordPath), 2, 'say should fire once for Q-5001,Q-5002 and once for Q-5001,Q-5002,Q-5003');
    const sentinel = await fs.readFile(path.join(project, '.nightshift', 'last-notified-questions'), 'utf8');
    assert.equal(sentinel, 'Q-5001,Q-5002,Q-5003');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});
