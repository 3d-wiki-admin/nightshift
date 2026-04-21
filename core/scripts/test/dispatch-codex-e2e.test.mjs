import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventStore } from '../../event-store/src/index.mjs';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const DISPATCH = path.join(ROOT, 'core', 'scripts', 'dispatch.mjs');

function tmp() {
  return path.join(tmpdir(), `ns-dispatch-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function writeExec(p, body) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body, { mode: 0o755 });
}

async function bootstrapProject({ taskId = 'E2E_001', wave = 1 } = {}) {
  const project = tmp();
  const taskDir = path.join(project, 'tasks', 'waves', String(wave), taskId);
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'contract.md'), `# ${taskId}\n`, 'utf8');
  await fs.writeFile(path.join(taskDir, 'prompt.md'), 'You are the implementer.\n', 'utf8');
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# test\n', 'utf8');
  await fs.writeFile(path.join(project, 'tasks', 'events.ndjson'), '', 'utf8');
  return { project, taskDir };
}

async function makeFakeCodex({ envDump }) {
  const dir = tmp();
  const bin = path.join(dir, 'codex');
  // Note: codex-cli 0.121 reads the prompt from stdin (positional arg path
  // was removed). The fake captures stdin too so tests can assert the prompt
  // actually travelled through.
  await writeExec(bin, [
    '#!/usr/bin/env bash',
    'set -u',
    'STDIN_CONTENT=""',
    'if [ ! -t 0 ]; then',
    '  STDIN_CONTENT="$(cat)"',
    'fi',
    `cat > "${envDump}" <<-EOF`,
    'NIGHTSHIFT_TASK_CONTRACT=$NIGHTSHIFT_TASK_CONTRACT',
    'NIGHTSHIFT_CONTEXT_PACK=$NIGHTSHIFT_CONTEXT_PACK',
    'NIGHTSHIFT_CONSTITUTION=$NIGHTSHIFT_CONSTITUTION',
    'NIGHTSHIFT_PROJECT_DIR=$NIGHTSHIFT_PROJECT_DIR',
    'ARGV=$*',
    'STDIN_BYTES=${#STDIN_CONTENT}',
    'EOF',
    'echo "{\\"event\\":\\"usage\\",\\"usage\\":{\\"input_tokens\\":7,\\"output_tokens\\":3}}"',
    'exit 0'
  ].join('\n'));
  return { dir, bin };
}

test('dispatch.mjs codex propagates NIGHTSHIFT_* env to the spawned codex process', async () => {
  const { project } = await bootstrapProject();
  const taskDir = path.join(project, 'tasks', 'waves', '1', 'E2E_001');
  const taskJson = path.join(project, 'task.json');
  await fs.writeFile(taskJson, JSON.stringify({
    task_id: 'E2E_001',
    wave: 1,
    project_dir: project,
    session_id: 'sess_01HXYZ000000000000000001',
    target_model: 'gpt-5.3-codex',
    reasoning_effort: 'high',
    reviewer_model: 'claude-opus-4-7',
    prompt_path: path.join(taskDir, 'prompt.md')
  }), 'utf8');

  const envDump = path.join(project, 'env-dump.txt');
  const { dir: fakeDir } = await makeFakeCodex({ envDump });

  const res = spawnSync('node', [DISPATCH, 'codex', taskJson, '--log', path.join(project, 'tasks', 'events.ndjson')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeDir}:${process.env.PATH}`,
      NIGHTSHIFT_AUTO_CHECKPOINT: '0'
    }
  });

  assert.equal(res.status, 0, `dispatch exited ${res.status}: ${res.stderr}`);

  const dump = await fs.readFile(envDump, 'utf8');
  // All four env vars must be non-empty and absolute:
  assert.match(dump, new RegExp(`NIGHTSHIFT_TASK_CONTRACT=${path.join(taskDir, 'contract.md')}`));
  assert.match(dump, new RegExp(`NIGHTSHIFT_CONTEXT_PACK=${path.join(taskDir, 'context-pack.md')}`));
  assert.match(dump, new RegExp(`NIGHTSHIFT_CONSTITUTION=${path.join(project, 'memory', 'constitution.md')}`));
  assert.match(dump, new RegExp(`NIGHTSHIFT_PROJECT_DIR=${project}`));
  // codex received model + effort + prompt in argv:
  assert.match(dump, /--model gpt-5\.3-codex/);
  // codex-cli 0.121 syntax: `-c model_reasoning_effort=<value>` instead of
  // `--reasoning-effort <value>`, and prompt goes via stdin (not `--prompt`).
  assert.match(dump, /-c model_reasoning_effort="high"/);
  assert.match(dump, /--skip-git-repo-check/);
  // Prompt reached codex via stdin (non-zero byte count).
  assert.match(dump, /STDIN_BYTES=[1-9]\d*/);

  // dispatch wrote task.routed + task.dispatched + task.implemented events:
  const events = await new EventStore(path.join(project, 'tasks', 'events.ndjson')).all();
  const kinds = events.map(e => e.action);
  assert.ok(kinds.includes('task.routed'));
  assert.ok(kinds.includes('task.dispatched'));
  assert.ok(kinds.includes('task.implemented'));
  const impl = events.find(e => e.action === 'task.implemented');
  assert.deepEqual(impl.tokens, { input: 7, output: 3, cached: 0 });

  await fs.rm(project, { recursive: true, force: true });
  await fs.rm(fakeDir, { recursive: true, force: true });
});

test('dispatch.mjs codex emits guard.violation and exits 4 when contract file is missing', async () => {
  const project = tmp();
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# c', 'utf8');
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  await fs.writeFile(path.join(project, 'tasks', 'events.ndjson'), '', 'utf8');

  const taskJson = path.join(project, 'task.json');
  await fs.writeFile(taskJson, JSON.stringify({
    task_id: 'MISSING_001',
    wave: 1,
    project_dir: project,
    session_id: 'sess_01HXYZ000000000000000001',
    target_model: 'gpt-5.3-codex',
    reviewer_model: 'claude-opus-4-7'
  }), 'utf8');

  // Even with codex on PATH, dispatch must refuse before spawning.
  const fakeBin = path.join(tmp(), 'codex');
  await writeExec(fakeBin, '#!/usr/bin/env bash\nexit 0\n');

  const res = spawnSync('node', [DISPATCH, 'codex', taskJson, '--log', path.join(project, 'tasks', 'events.ndjson')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.dirname(fakeBin)}:${process.env.PATH}`,
      NIGHTSHIFT_AUTO_CHECKPOINT: '0'
    }
  });
  assert.equal(res.status, 4, `expected exit 4 for unresolvable env; got ${res.status}: ${res.stderr}`);
  const events = await new EventStore(path.join(project, 'tasks', 'events.ndjson')).all();
  const v = events.find(e => e.action === 'guard.violation' && e.payload?.kind === 'codex_env_unresolvable');
  assert.ok(v, 'expected guard.violation{codex_env_unresolvable}');
  await fs.rm(project, { recursive: true, force: true });
  await fs.rm(path.dirname(fakeBin), { recursive: true, force: true });
});
