import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appendEvent } from '../../../core/scripts/dispatch.mjs';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const HOOK = path.join(ROOT, 'claude', 'hooks', 'post-edit-sync.sh');

function tmpProject() {
  return path.join(tmpdir(), `ns-pehw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function bootstrap(project, { wave = 1, taskId = 'TASK_X', lastAction = 'task.accepted', objective = 'Add X', files = ['app/page.tsx'] } = {}) {
  const taskDir = path.join(project, 'tasks', 'waves', String(wave), taskId);
  await fs.mkdir(path.join(taskDir, 'evidence'), { recursive: true });
  await fs.writeFile(
    path.join(taskDir, 'contract.md'),
    ['# ' + taskId, '```yaml', `task_id: ${taskId}`, `wave: ${wave}`, 'risk_class: safe', 'goal:', `  objective: ${objective}`, '```'].join('\n'),
    'utf8'
  );
  await fs.writeFile(
    path.join(taskDir, 'result.md'),
    ['# Result', '', '## Files changed', ...files.map(f => `- ${f}`), ''].join('\n'),
    'utf8'
  );

  const logPath = path.join(project, 'tasks', 'events.ndjson');
  await fs.writeFile(logPath, '', 'utf8');
  process.env.NIGHTSHIFT_AUTO_CHECKPOINT = '0';

  // Seed enough event history so the hook's last-action classifier sees the
  // specified terminal event.
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    agent: 'orchestrator',
    action: 'session.start',
    payload: { project: 'pehw' }
  });
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    wave, task_id: taskId, agent: 'task-decomposer', action: 'task.contracted'
  });
  if (lastAction === 'task.accepted') {
    await appendEvent(logPath, {
      session_id: 'sess_01HXYZ000000000000000001',
      wave, task_id: taskId, agent: 'implementer', action: 'task.implemented'
    });
    await appendEvent(logPath, {
      session_id: 'sess_01HXYZ000000000000000001',
      wave, task_id: taskId, agent: 'orchestrator', action: 'task.accepted'
    });
  } else if (lastAction === 'task.implemented') {
    await appendEvent(logPath, {
      session_id: 'sess_01HXYZ000000000000000001',
      wave, task_id: taskId, agent: 'implementer', action: 'task.implemented'
    });
  } else if (lastAction === 'task.routed') {
    await appendEvent(logPath, {
      session_id: 'sess_01HXYZ000000000000000001',
      wave, task_id: taskId, agent: 'orchestrator', action: 'task.routed',
      payload: { model: 'gpt-5.4', effort: 'default' }
    });
  }
  return { taskDir, logPath };
}

function runHook(project, filePath) {
  return spawnSync('bash', [HOOK], {
    input: JSON.stringify({
      cwd: project,
      session_id: 'sess_test',
      tool_name: 'Write',
      tool_input: { file_path: filePath }
    }),
    encoding: 'utf8',
    env: { ...process.env, NIGHTSHIFT_HOME: ROOT, NIGHTSHIFT_AUTO_CHECKPOINT: '0' }
  });
}

async function waitFor(cond, { timeoutMs = 5000, stepMs = 100 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise(r => setTimeout(r, stepMs));
  }
  return false;
}

test('post-edit-sync invokes post-sync-docs.mjs when last event is task.accepted', async () => {
  const project = tmpProject();
  await bootstrap(project, { lastAction: 'task.accepted' });

  const res = runHook(project, path.join(project, 'app/page.tsx'));
  assert.equal(res.status, 0, `hook exited ${res.status}: ${res.stderr}`);

  const featureIndex = path.join(project, 'tasks', 'contracts', 'FEATURE_INDEX.md');
  const appeared = await waitFor(async () => {
    try { const text = await fs.readFile(featureIndex, 'utf8'); return /\| TASK_X \|/.test(text); } catch { return false; }
  });
  assert.ok(appeared, 'FEATURE_INDEX should have been written by post-sync-docs via the hook');

  await fs.rm(project, { recursive: true, force: true });
});

test('post-edit-sync does NOT invoke post-sync-docs when last event is task.implemented (not terminal)', async () => {
  const project = tmpProject();
  await bootstrap(project, { lastAction: 'task.implemented' });

  const res = runHook(project, path.join(project, 'app/page.tsx'));
  assert.equal(res.status, 0, `hook exited ${res.status}: ${res.stderr}`);

  // Give the (potentially scheduled) background work ~800ms, then assert no
  // FEATURE_INDEX was created. The hook short-circuits for non-terminal
  // last_action so post-sync-docs should not have run.
  await new Promise(r => setTimeout(r, 800));
  const featureIndex = path.join(project, 'tasks', 'contracts', 'FEATURE_INDEX.md');
  let exists = true;
  try { await fs.access(featureIndex); } catch { exists = false; }
  assert.equal(exists, false, 'FEATURE_INDEX should NOT exist when hook last_action was task.implemented');

  await fs.rm(project, { recursive: true, force: true });
});

test('post-edit-sync does NOT invoke post-sync-docs when last event is task.routed', async () => {
  const project = tmpProject();
  await bootstrap(project, { lastAction: 'task.routed' });

  const res = runHook(project, path.join(project, 'app/page.tsx'));
  assert.equal(res.status, 0);

  await new Promise(r => setTimeout(r, 800));
  const featureIndex = path.join(project, 'tasks', 'contracts', 'FEATURE_INDEX.md');
  let exists = true;
  try { await fs.access(featureIndex); } catch { exists = false; }
  assert.equal(exists, false);

  await fs.rm(project, { recursive: true, force: true });
});
