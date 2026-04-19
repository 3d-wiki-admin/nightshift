import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventStore } from '../../../core/event-store/src/index.mjs';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const HOOKS = path.join(ROOT, 'claude', 'hooks');

function tmpProject() {
  return path.join(tmpdir(), `ns-hooks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function setupActiveTask(project, taskId, allowedFiles) {
  await fs.mkdir(path.join(project, 'tasks', 'waves', '1', taskId), { recursive: true });
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.writeFile(
    path.join(project, 'memory', 'constitution.md'),
    '# Constitution — test\n## 1. Stack\nTypeScript strict.\n',
    'utf8'
  );
  const yaml = ['```yaml',
    `task_id: ${taskId}`,
    'wave: 1',
    'risk_class: safe',
    'allowed_files:',
    ...allowedFiles.map(f => `  - ${f}`),
    '```'
  ].join('\n');
  await fs.writeFile(
    path.join(project, 'tasks', 'waves', '1', taskId, 'contract.md'),
    `# ${taskId}\n\n${yaml}\n`,
    'utf8'
  );
  const ev = {
    event_id: 'ev_01HXYZ000000000000000AAA',
    ts: '2026-04-19T00:00:00.000Z',
    session_id: 'sess_01HXYZ000000000000000001',
    wave: 1,
    task_id: taskId,
    agent: 'task-decomposer',
    action: 'task.contracted'
  };
  await fs.writeFile(
    path.join(project, 'tasks', 'events.ndjson'),
    JSON.stringify(ev) + '\n',
    'utf8'
  );
}

function runHook(hook, eventPayload) {
  return spawnSync('bash', [path.join(HOOKS, hook)], {
    input: JSON.stringify(eventPayload),
    encoding: 'utf8',
    env: { ...process.env, NIGHTSHIFT_HOME: ROOT }
  });
}

test('write-guard allows writes to allowed_files', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx', 'lib/foo.ts']);
  const res = runHook('write-guard.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Write',
    tool_input: { file_path: path.join(project, 'lib/foo.ts') }
  });
  assert.equal(res.status, 0, `expected allow, stderr=${res.stderr}`);
  await fs.rm(project, { recursive: true, force: true });
});

test('write-guard blocks writes outside allowed_files', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx']);
  const res = runHook('write-guard.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Write',
    tool_input: { file_path: path.join(project, 'lib/secrets.ts') }
  });
  assert.equal(res.status, 2, 'expected block (exit 2)');
  assert.match(res.stdout, /decision.*block/);
  await fs.rm(project, { recursive: true, force: true });
});

test('write-guard blocks writes to ANOTHER task\'s review.md (narrowed scope)', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx']);
  await fs.mkdir(path.join(project, 'tasks', 'waves', '1', 'TASK_B'), { recursive: true });
  const res = runHook('write-guard.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Write',
    tool_input: { file_path: path.join(project, 'tasks/waves/1/TASK_B/review.md') }
  });
  assert.equal(res.status, 2, 'expected block (other task\'s review.md)');
  await fs.rm(project, { recursive: true, force: true });
});

test('write-guard allows writes to CURRENT task\'s review.md', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx']);
  const res = runHook('write-guard.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Write',
    tool_input: { file_path: path.join(project, 'tasks/waves/1/TASK_A/review.md') }
  });
  assert.equal(res.status, 0);
  await fs.rm(project, { recursive: true, force: true });
});

test('write-guard hard-blocks direct writes to events.ndjson + logs guard.violation', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx']);
  const beforeCount = (await new EventStore(path.join(project, 'tasks/events.ndjson')).all()).length;
  const res = runHook('write-guard.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Write',
    tool_input: { file_path: path.join(project, 'tasks/events.ndjson') }
  });
  assert.equal(res.status, 2);
  const events = await new EventStore(path.join(project, 'tasks/events.ndjson')).all();
  const violations = events.filter(e => e.action === 'guard.violation' && e.payload?.kind === 'hard_block');
  assert.ok(violations.length >= 1, `expected guard.violation event; got ${events.length - beforeCount} new events`);
  await fs.rm(project, { recursive: true, force: true });
});

test('write-guard allows always-writable paths (compliance.md, questions.md)', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx']);
  for (const p of ['tasks/compliance.md', 'tasks/questions.md', 'tasks/decisions.md', 'memory/learnings.md']) {
    const res = runHook('write-guard.sh', {
      cwd: project,
      session_id: 'sess_test',
      tool_name: 'Write',
      tool_input: { file_path: path.join(project, p) }
    });
    assert.equal(res.status, 0, `expected allow for ${p}; stderr=${res.stderr}`);
  }
  await fs.rm(project, { recursive: true, force: true });
});

test('bash-budget blocks Bash writes outside allowed_files', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx']);
  const res = runHook('bash-budget.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Bash',
    tool_input: { command: `echo hacked > ${project}/src/hack.ts` }
  });
  assert.equal(res.status, 2, `expected block; stderr=${res.stderr}`);
  await fs.rm(project, { recursive: true, force: true });
});

test('bash-budget allows Bash writes to allowed file', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['lib/foo.ts']);
  const res = runHook('bash-budget.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Bash',
    tool_input: { command: `echo x > ${project}/lib/foo.ts` }
  });
  assert.equal(res.status, 0);
  await fs.rm(project, { recursive: true, force: true });
});

test('bash-budget blocks Bash writes to events.ndjson (hard-block via Bash)', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx']);
  const res = runHook('bash-budget.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Bash',
    tool_input: { command: `echo garbage >> ${project}/tasks/events.ndjson` }
  });
  assert.equal(res.status, 2);
  await fs.rm(project, { recursive: true, force: true });
});

test('bash-budget still blocks destructive out-of-project commands', async () => {
  const project = tmpProject();
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  await fs.writeFile(path.join(project, 'tasks/events.ndjson'), '', 'utf8');
  const res = runHook('bash-budget.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Bash',
    tool_input: { command: 'sudo rm /etc/hosts' }
  });
  assert.equal(res.status, 2);
  await fs.rm(project, { recursive: true, force: true });
});

test('pre-task-preflight allows dispatch for a task in contracted state', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx']);
  const res = runHook('pre-task-preflight.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Task',
    tool_input: { subagent_type: 'context-packer' }
  });
  assert.equal(res.status, 0, `expected allow for context-packer on contracted task; stderr=${res.stderr}`);
  await fs.rm(project, { recursive: true, force: true });
});

test('pre-task-preflight allows reviewer dispatch after task.implemented', async () => {
  const project = tmpProject();
  await setupActiveTask(project, 'TASK_A', ['app/page.tsx']);
  // Append task.implemented so the task's latest non-terminal state is implemented.
  await fs.appendFile(
    path.join(project, 'tasks/events.ndjson'),
    JSON.stringify({
      event_id: 'ev_01HXYZ000000000000000AAB',
      ts: '2026-04-19T00:01:00.000Z',
      session_id: 'sess_01HXYZ000000000000000001',
      wave: 1,
      task_id: 'TASK_A',
      agent: 'implementer',
      model: 'gpt-5.4',
      action: 'task.implemented'
    }) + '\n',
    'utf8'
  );
  const res = runHook('pre-task-preflight.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Task',
    tool_input: { subagent_type: 'task-impl-reviewer' }
  });
  assert.equal(res.status, 0, `expected allow for task-impl-reviewer after implemented; stderr=${res.stderr}`);
  await fs.rm(project, { recursive: true, force: true });
});

test('pre-task-preflight blocks implementer dispatch when no active task exists', async () => {
  const project = tmpProject();
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.writeFile(path.join(project, 'memory/constitution.md'), '# test', 'utf8');
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  await fs.writeFile(path.join(project, 'tasks/events.ndjson'), '', 'utf8');
  const res = runHook('pre-task-preflight.sh', {
    cwd: project,
    session_id: 'sess_test',
    tool_name: 'Task',
    tool_input: { subagent_type: 'implementer' }
  });
  assert.equal(res.status, 2);
  await fs.rm(project, { recursive: true, force: true });
});
