import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runOnce } from '../post-sync-docs.mjs';
import { appendEvent } from '../dispatch.mjs';

function tmpProject() {
  return path.join(tmpdir(), `ns-psd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function setup(project, { wave = 1, taskId = 'TASK_X', objective = 'Add name input', files = ['app/page.tsx'], diff = '' } = {}) {
  const taskDir = wave != null
    ? path.join(project, 'tasks', 'waves', String(wave), taskId)
    : path.join(project, 'tasks', 'micro', taskId);
  await fs.mkdir(path.join(taskDir, 'evidence'), { recursive: true });
  await fs.mkdir(path.join(project, 'tasks', 'contracts'), { recursive: true });
  const contractMd = [
    `# ${taskId}`,
    '```yaml',
    `task_id: ${taskId}`,
    wave != null ? `wave: ${wave}` : 'wave: null',
    'risk_class: safe',
    'goal:',
    `  objective: ${objective}`,
    '```'
  ].join('\n');
  await fs.writeFile(path.join(taskDir, 'contract.md'), contractMd, 'utf8');
  const resultMd = ['# Result', '', '## Files changed', ...files.map(f => `- ${f}`), ''].join('\n');
  await fs.writeFile(path.join(taskDir, 'result.md'), resultMd, 'utf8');
  if (diff) await fs.writeFile(path.join(taskDir, 'evidence', 'diff.patch'), diff, 'utf8');

  const logPath = path.join(project, 'tasks', 'events.ndjson');
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, '', 'utf8');
  process.env.NIGHTSHIFT_AUTO_CHECKPOINT = '0';
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    wave, task_id: taskId, agent: 'task-decomposer', action: 'task.contracted'
  });
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    wave, task_id: taskId, agent: 'orchestrator', action: 'task.accepted'
  });
  return { taskDir, logPath };
}

test('runOnce adds FEATURE_INDEX row for the last accepted task', async () => {
  const project = tmpProject();
  await setup(project, { taskId: 'TASK_X', objective: 'Add name input', files: ['app/page.tsx'] });
  const r = await runOnce(project);
  assert.equal(r.status, 'synced');
  assert.equal(r.feature_index_updated, true);

  const fi = await fs.readFile(path.join(project, 'tasks', 'contracts', 'FEATURE_INDEX.md'), 'utf8');
  assert.match(fi, /\| TASK_X \| Add name input \| app\/page\.tsx \|/);

  await fs.rm(project, { recursive: true, force: true });
});

test('runOnce is idempotent — repeated runs do not duplicate rows', async () => {
  const project = tmpProject();
  await setup(project, { taskId: 'TASK_X', objective: 'Add name input', files: ['app/page.tsx'] });
  await runOnce(project);
  const r2 = await runOnce(project);
  assert.equal(r2.feature_index_updated, false);
  const fi = await fs.readFile(path.join(project, 'tasks', 'contracts', 'FEATURE_INDEX.md'), 'utf8');
  const count = (fi.match(/\| TASK_X \|/g) || []).length;
  assert.equal(count, 1, `expected exactly 1 row, got ${count}`);
  await fs.rm(project, { recursive: true, force: true });
});

test('runOnce appends new exports from diff.patch to REUSE_FUNCTIONS.md', async () => {
  const project = tmpProject();
  const diff = [
    'diff --git a/lib/name-store.ts b/lib/name-store.ts',
    '--- /dev/null',
    '+++ b/lib/name-store.ts',
    '@@ -0,0 +1,5 @@',
    '+export function getName() { return localStorage.getItem("name") ?? ""; }',
    '+export const DEFAULT_NAME = "friend";',
    '+export async function setName(name) { localStorage.setItem("name", name); }',
    '+export class NameStore {}'
  ].join('\n');
  await setup(project, { taskId: 'TASK_X', files: ['lib/name-store.ts'], diff });
  const r = await runOnce(project);
  assert.equal(r.status, 'synced');
  assert.ok(r.reuse_functions_updated.includes('lib/name-store.ts:getName'));
  assert.ok(r.reuse_functions_updated.includes('lib/name-store.ts:setName'));
  assert.ok(r.reuse_functions_updated.includes('lib/name-store.ts:DEFAULT_NAME'));
  assert.ok(r.reuse_functions_updated.includes('lib/name-store.ts:NameStore'));

  const reuse = await fs.readFile(path.join(project, 'tasks', 'contracts', 'REUSE_FUNCTIONS.md'), 'utf8');
  assert.match(reuse, /`lib\/name-store\.ts`.*`getName`/);
  assert.match(reuse, /`lib\/name-store\.ts`.*`NameStore`/);
  await fs.rm(project, { recursive: true, force: true });
});

test('runOnce handles micro-lane tasks (wave=null under tasks/micro/)', async () => {
  const project = tmpProject();
  await setup(project, { wave: null, taskId: 'MICRO_X', objective: 'fix CTA text', files: ['app/page.tsx'] });
  const r = await runOnce(project);
  assert.equal(r.status, 'synced');
  assert.equal(r.wave, null);
  const fi = await fs.readFile(path.join(project, 'tasks', 'contracts', 'FEATURE_INDEX.md'), 'utf8');
  assert.match(fi, /\| MICRO_X \|.*fix CTA text/);
  await fs.rm(project, { recursive: true, force: true });
});

test('runOnce without any accepted task returns no_accepted_task', async () => {
  const project = tmpProject();
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  await fs.writeFile(path.join(project, 'tasks', 'events.ndjson'), '', 'utf8');
  const r = await runOnce(project);
  assert.equal(r.status, 'no_accepted_task');
  await fs.rm(project, { recursive: true, force: true });
});
