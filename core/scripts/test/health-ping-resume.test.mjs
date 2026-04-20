import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const HEALTH_PING = path.join(ROOT, 'core', 'scripts', 'health-ping.mjs');

function tmp() {
  return path.join(tmpdir(), `ns-hp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function writeExec(p, body) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body, { mode: 0o755 });
}

async function bootstrapStalled({ staleMinutes = 30 } = {}) {
  const project = tmp();
  const taskDir = path.join(project, 'tasks', 'waves', '1', 'STALLED_001');
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'contract.md'), '# STALLED_001\n', 'utf8');
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# c\n', 'utf8');

  const staleTs = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const events = [
    { event_id: 'ev_01HXYZ000000000000000AAA', ts: staleTs, session_id: 'sess_01HXYZ000000000000000001', agent: 'orchestrator', action: 'session.start', payload: { project: 'hp-test' } },
    { event_id: 'ev_01HXYZ000000000000000AAB', ts: staleTs, session_id: 'sess_01HXYZ000000000000000001', wave: 1, agent: 'task-decomposer', action: 'wave.planned' },
    { event_id: 'ev_01HXYZ000000000000000AAC', ts: staleTs, session_id: 'sess_01HXYZ000000000000000001', wave: 1, agent: 'orchestrator', action: 'wave.started' },
    { event_id: 'ev_01HXYZ000000000000000AAD', ts: staleTs, session_id: 'sess_01HXYZ000000000000000001', wave: 1, task_id: 'STALLED_001', agent: 'task-decomposer', action: 'task.contracted' },
    { event_id: 'ev_01HXYZ000000000000000AAE', ts: staleTs, session_id: 'sess_01HXYZ000000000000000001', wave: 1, task_id: 'STALLED_001', agent: 'implementer', action: 'task.dispatched' }
  ];
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  await fs.writeFile(path.join(project, 'tasks', 'events.ndjson'), events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return project;
}

test('health-ping invokes claude with --continue and cwd=projectDir on stalled task', async () => {
  const project = await bootstrapStalled({ staleMinutes: 30 });
  const fakeDir = tmp();
  await fs.mkdir(fakeDir, { recursive: true });
  const fakeClaude = path.join(fakeDir, 'claude-stub');
  const record = path.join(fakeDir, 'record.txt');
  await writeExec(fakeClaude, [
    '#!/usr/bin/env bash',
    `echo "CWD=$(pwd)" >> "${record}"`,
    `echo "ARGV=$*" >> "${record}"`,
    'exit 0'
  ].join('\n'));

  const res = spawnSync('node', [HEALTH_PING, project], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NIGHTSHIFT_CLAUDE_CMD: fakeClaude,
      NIGHTSHIFT_AUTO_CHECKPOINT: '0'
    }
  });
  assert.equal(res.status, 0, `health-ping exited ${res.status}: ${res.stderr}`);

  const txt = await fs.readFile(record, 'utf8');
  // macOS /tmp is a symlink to /private/tmp; the fake claude's pwd resolves
  // through the symlink. Compare against the canonical project path.
  const realProject = await fs.realpath(project);
  assert.ok(
    txt.includes(`CWD=${project}`) || txt.includes(`CWD=${realProject}`),
    `expected claude cwd to be the project dir. got:\n${txt}`
  );
  assert.match(txt, /ARGV=--continue/, `expected claude args "--continue". got:\n${txt}`);

  // health-ping should have emitted pinger.unstuck (ok) because the fake
  // claude exited 0.
  const raw = await fs.readFile(path.join(project, 'tasks', 'events.ndjson'), 'utf8');
  const events = raw.trim().split('\n').map(JSON.parse);
  const unstuck = events.find(e => e.action === 'pinger.unstuck');
  assert.ok(unstuck, 'expected pinger.unstuck event');
  assert.equal(unstuck.outcome, 'success');

  await fs.rm(project, { recursive: true, force: true });
  await fs.rm(fakeDir, { recursive: true, force: true });
});

test('health-ping records unstick failure AND emits session.paused when claude exits non-zero', async () => {
  const project = await bootstrapStalled({ staleMinutes: 30 });
  const fakeDir = tmp();
  await fs.mkdir(fakeDir, { recursive: true });
  const fakeClaude = path.join(fakeDir, 'claude-stub');
  await writeExec(fakeClaude, '#!/usr/bin/env bash\nexit 7\n');

  const res = spawnSync('node', [HEALTH_PING, project], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTSHIFT_CLAUDE_CMD: fakeClaude, NIGHTSHIFT_AUTO_CHECKPOINT: '0' }
  });
  assert.equal(res.status, 0);
  const raw = await fs.readFile(path.join(project, 'tasks', 'events.ndjson'), 'utf8');
  const events = raw.trim().split('\n').map(JSON.parse);
  const unstuck = events.find(e => e.action === 'pinger.unstuck');
  assert.ok(unstuck);
  assert.equal(unstuck.outcome, 'failure');

  // TZ P0.2: failed auto-resume must record session.paused so the operator
  // sees the stall; the pinger cannot silently re-ping forever.
  const paused = events.find(e => e.action === 'session.paused');
  assert.ok(paused, 'expected session.paused event on failed --continue');
  assert.equal(paused.outcome, 'failure');
  assert.match(paused.notes || '', /claude --continue/);
  assert.match(paused.notes || '', /Recover with:/);

  await fs.rm(project, { recursive: true, force: true });
  await fs.rm(fakeDir, { recursive: true, force: true });
});
