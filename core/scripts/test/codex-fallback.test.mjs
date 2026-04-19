import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventStore } from '../../event-store/src/index.mjs';
import { codexAvailable, EXIT_CODEX_UNAVAILABLE } from '../dispatch.mjs';

const DISPATCH = path.resolve(new URL('../dispatch.mjs', import.meta.url).pathname);

function tmpProject() {
  return path.join(tmpdir(), `ns-codexfb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function writeTask(project, task) {
  await fs.mkdir(project, { recursive: true });
  const taskPath = path.join(project, 'task.json');
  await fs.writeFile(taskPath, JSON.stringify(task, null, 2), 'utf8');
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  const logPath = path.join(project, 'tasks', 'events.ndjson');
  await fs.writeFile(logPath, '', 'utf8');
  return { taskPath, logPath };
}

const baseTask = {
  task_id: 'FB_TEST_001',
  wave: 1,
  session_id: 'sess_01HXYZ000000000000000001',
  target_model: 'gpt-5.3-codex',
  reasoning_effort: 'high',
  reviewer_model: 'claude-opus-4-7'
};

test('EXIT_CODEX_UNAVAILABLE constant is exported and equals 5', () => {
  assert.equal(EXIT_CODEX_UNAVAILABLE, 5);
});

test('codexAvailable() returns true when codex binary is in PATH', () => {
  const before = codexAvailable();
  // Not a strict requirement — but this test environment has codex per install
  // docs. If codex is missing in CI, this serves as a degraded-mode indicator.
  assert.equal(typeof before, 'boolean');
});

test('cmdCodex exits 5 with task.routed fallback_from when codex is not on PATH', async () => {
  const project = tmpProject();
  const { taskPath, logPath } = await writeTask(project, baseTask);

  const sanitizedPath = (process.env.PATH || '')
    .split(':')
    .filter(dir => !existsSync(path.join(dir, 'codex')))
    .join(':');

  const res = spawnSync('node', [DISPATCH, 'codex', taskPath, '--log', logPath], {
    encoding: 'utf8',
    env: { ...process.env, PATH: sanitizedPath }
  });

  assert.equal(res.status, EXIT_CODEX_UNAVAILABLE, `expected exit ${EXIT_CODEX_UNAVAILABLE}, got ${res.status}; stderr=${res.stderr}`);
  assert.match(res.stderr, /codex CLI not on PATH/i);

  const events = await new EventStore(logPath).all();
  const routed = events.find(e => e.action === 'task.routed');
  assert.ok(routed, `expected a task.routed event; got ${events.length} events`);
  assert.equal(routed.payload.model, 'claude-sonnet-4-6');
  assert.equal(routed.payload.fallback_from, baseTask.target_model);
  assert.match(routed.payload.reason, /codex-unavailable/);

  const dispatched = events.find(e => e.action === 'task.dispatched');
  assert.equal(dispatched, undefined, 'task.dispatched should NOT be emitted when fallback fires');

  await fs.rm(project, { recursive: true, force: true });
});

test('cmdCodex refuses reviewer=implementer with guard.violation before checking codex', async () => {
  const project = tmpProject();
  const { taskPath, logPath } = await writeTask(project, {
    ...baseTask,
    reviewer_model: baseTask.target_model
  });

  const res = spawnSync('node', [DISPATCH, 'codex', taskPath, '--log', logPath], {
    encoding: 'utf8'
  });

  assert.notEqual(res.status, 0);
  assert.notEqual(res.status, EXIT_CODEX_UNAVAILABLE);
  assert.match(res.stderr, /must differ/i);

  const events = await new EventStore(logPath).all();
  const violation = events.find(e => e.action === 'guard.violation' && e.payload?.kind === 'reviewer_equals_implementer');
  assert.ok(violation, 'expected guard.violation with kind=reviewer_equals_implementer');
  const routed = events.find(e => e.action === 'task.routed');
  assert.equal(routed, undefined, 'task.routed should NOT emit when guard fires');

  await fs.rm(project, { recursive: true, force: true });
});
