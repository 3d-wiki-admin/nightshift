import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  runCodex,
  runCodexWithRetry,
  buildTaskEnv,
  CodexError,
  classifyError,
  extractTokens,
  codexAvailable
} from '../client.mjs';

function tmpDir() {
  return path.join(tmpdir(), `ns-codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function writeExec(filepath, body) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, body, { mode: 0o755 });
}

test('codexAvailable returns boolean', () => {
  assert.equal(typeof codexAvailable(), 'boolean');
});

test('classifyError maps known stderr patterns to taxonomy codes', () => {
  assert.equal(classifyError('HTTP 401 unauthorized'),   'AUTH_FAILED');
  assert.equal(classifyError('You are rate-limited'),    'RATE_LIMITED');
  assert.equal(classifyError('Unknown model gpt-9'),     'INVALID_MODEL');
  assert.equal(classifyError('context deadline exceeded'), 'TIMEOUT');
  assert.equal(classifyError('random error text'),        'NONZERO');
});

test('extractTokens pulls usage from the last JSON line that has it', () => {
  const stdout = [
    '{"event":"delta","text":"hello"}',
    '{"event":"delta","text":" world"}',
    '{"event":"usage","usage":{"input_tokens":1234,"output_tokens":56,"cache_read_tokens":200}}',
    ''
  ].join('\n');
  const t = extractTokens(stdout);
  assert.deepEqual(t, { input: 1234, output: 56, cached: 200 });
});

test('extractTokens returns null when no usage record present', () => {
  assert.equal(extractTokens('{"event":"delta"}\n'), null);
  assert.equal(extractTokens(''), null);
});

test('buildTaskEnv throws when contract is missing', async () => {
  const project = tmpDir();
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# const', 'utf8');
  await assert.rejects(
    () => buildTaskEnv({ task_id: 'T1', wave: 1, project_dir: project }),
    (err) => err instanceof CodexError && /contract not found/.test(err.message)
  );
  await fs.rm(project, { recursive: true, force: true });
});

test('buildTaskEnv throws when constitution is missing', async () => {
  const project = tmpDir();
  const taskDir = path.join(project, 'tasks', 'waves', '1', 'T1');
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'contract.md'), '# T1', 'utf8');
  await assert.rejects(
    () => buildTaskEnv({ task_id: 'T1', wave: 1, project_dir: project }),
    (err) => err instanceof CodexError && /constitution not found/.test(err.message)
  );
  await fs.rm(project, { recursive: true, force: true });
});

test('buildTaskEnv returns NIGHTSHIFT_* absolute paths for heavy-lane task', async () => {
  const project = tmpDir();
  const taskDir = path.join(project, 'tasks', 'waves', '1', 'T1');
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'contract.md'), '# T1', 'utf8');
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# const', 'utf8');

  const env = await buildTaskEnv({ task_id: 'T1', wave: 1, project_dir: project });
  assert.equal(env.NIGHTSHIFT_TASK_CONTRACT, path.join(taskDir, 'contract.md'));
  assert.equal(env.NIGHTSHIFT_CONSTITUTION, path.join(project, 'memory', 'constitution.md'));
  assert.equal(env.NIGHTSHIFT_PROJECT_DIR, project);
  assert.equal(env.NIGHTSHIFT_CONTEXT_PACK, path.join(taskDir, 'context-pack.md'));
  await fs.rm(project, { recursive: true, force: true });
});

test('buildTaskEnv handles micro-lane (wave=null) path', async () => {
  const project = tmpDir();
  const taskDir = path.join(project, 'tasks', 'micro', 'M1');
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'contract.md'), '# M1', 'utf8');
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# c', 'utf8');

  const env = await buildTaskEnv({ task_id: 'M1', wave: null, project_dir: project });
  assert.equal(env.NIGHTSHIFT_TASK_CONTRACT, path.join(taskDir, 'contract.md'));
  await fs.rm(project, { recursive: true, force: true });
});

test('runCodex passes NIGHTSHIFT_* env through to the subprocess', async () => {
  const project = tmpDir();
  const taskDir = path.join(project, 'tasks', 'waves', '1', 'T1');
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'contract.md'), '# T1', 'utf8');
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# c', 'utf8');

  const fakeBin = path.join(tmpDir(), 'fake-codex');
  await writeExec(fakeBin, [
    '#!/usr/bin/env bash',
    'set -u',
    'echo "{\\"nightshift_task_contract\\":\\"$NIGHTSHIFT_TASK_CONTRACT\\",\\"nightshift_context_pack\\":\\"$NIGHTSHIFT_CONTEXT_PACK\\",\\"nightshift_constitution\\":\\"$NIGHTSHIFT_CONSTITUTION\\",\\"nightshift_project_dir\\":\\"$NIGHTSHIFT_PROJECT_DIR\\"}"',
    'echo "{\\"event\\":\\"usage\\",\\"usage\\":{\\"input_tokens\\":10,\\"output_tokens\\":2}}"',
    'exit 0'
  ].join('\n'));

  const env = await buildTaskEnv({ task_id: 'T1', wave: 1, project_dir: project });
  const res = await runCodex({
    model: 'gpt-5.4',
    env,
    codexBin: fakeBin
  });

  // Find the first JSON line and check env was propagated.
  const firstLine = res.stdout.split(/\r?\n/).find(Boolean);
  const parsed = JSON.parse(firstLine);
  assert.equal(parsed.nightshift_task_contract, env.NIGHTSHIFT_TASK_CONTRACT);
  assert.equal(parsed.nightshift_constitution, env.NIGHTSHIFT_CONSTITUTION);
  assert.equal(parsed.nightshift_project_dir, env.NIGHTSHIFT_PROJECT_DIR);
  assert.deepEqual(res.tokens, { input: 10, output: 2, cached: 0 });
  await fs.rm(project, { recursive: true, force: true });
  await fs.rm(path.dirname(fakeBin), { recursive: true, force: true });
});

test('runCodex throws CodexError with AUTH_FAILED code on 401 stderr', async () => {
  const fakeBin = path.join(tmpDir(), 'fake-codex-401');
  await writeExec(fakeBin, [
    '#!/usr/bin/env bash',
    'echo "HTTP 401 unauthorized" >&2',
    'exit 1'
  ].join('\n'));
  try {
    await runCodex({ model: 'gpt-5.4', codexBin: fakeBin });
    assert.fail('expected CodexError');
  } catch (err) {
    assert.ok(err instanceof CodexError);
    assert.equal(err.code, 'AUTH_FAILED');
  }
  await fs.rm(path.dirname(fakeBin), { recursive: true, force: true });
});

test('runCodex throws TIMEOUT when child runs past timeoutMs', async () => {
  const fakeBin = path.join(tmpDir(), 'fake-codex-slow');
  await writeExec(fakeBin, [
    '#!/usr/bin/env bash',
    'sleep 10',
    'exit 0'
  ].join('\n'));
  const t0 = Date.now();
  try {
    await runCodex({ model: 'gpt-5.4', codexBin: fakeBin, timeoutMs: 300 });
    assert.fail('expected TIMEOUT');
  } catch (err) {
    assert.ok(err instanceof CodexError);
    assert.equal(err.code, 'TIMEOUT');
    assert.ok(Date.now() - t0 < 6000, 'timeout should not wait out full sleep');
  }
  await fs.rm(path.dirname(fakeBin), { recursive: true, force: true });
});

test('runCodexWithRetry retries on RATE_LIMITED then succeeds', async () => {
  const fakeBin = path.join(tmpDir(), 'fake-codex-retry');
  const counterFile = path.join(path.dirname(fakeBin), 'count');
  await writeExec(fakeBin, [
    '#!/usr/bin/env bash',
    'counter="' + counterFile + '"',
    '[ -f "$counter" ] || echo 0 > "$counter"',
    'n=$(cat "$counter"); n=$((n+1)); echo $n > "$counter"',
    'if [ "$n" -lt 2 ]; then',
    '  echo "rate-limit hit; please retry" >&2',
    '  exit 1',
    'fi',
    'echo "{\\"event\\":\\"usage\\",\\"usage\\":{\\"input_tokens\\":5,\\"output_tokens\\":1}}"',
    'exit 0'
  ].join('\n'));

  const res = await runCodexWithRetry(
    { model: 'gpt-5.4', codexBin: fakeBin },
    { retries: 2, backoffMs: 50 }
  );
  assert.equal(res.exitCode, 0);
  assert.equal(res.tokens.input, 5);
  await fs.rm(path.dirname(fakeBin), { recursive: true, force: true });
});

test('runCodexWithRetry does NOT retry on AUTH_FAILED (fails fast)', async () => {
  const fakeBin = path.join(tmpDir(), 'fake-codex-auth');
  const counterFile = path.join(path.dirname(fakeBin), 'auth-count');
  await writeExec(fakeBin, [
    '#!/usr/bin/env bash',
    'counter="' + counterFile + '"',
    '[ -f "$counter" ] || echo 0 > "$counter"',
    'n=$(cat "$counter"); n=$((n+1)); echo $n > "$counter"',
    'echo "401 unauthorized" >&2',
    'exit 1'
  ].join('\n'));

  try {
    await runCodexWithRetry(
      { model: 'gpt-5.4', codexBin: fakeBin },
      { retries: 5, backoffMs: 10 }
    );
    assert.fail('expected AUTH_FAILED');
  } catch (err) {
    assert.equal(err.code, 'AUTH_FAILED');
  }
  const n = parseInt(await fs.readFile(counterFile, 'utf8'), 10);
  assert.equal(n, 1, 'AUTH_FAILED should not retry');
  await fs.rm(path.dirname(fakeBin), { recursive: true, force: true });
});

test('runCodex without codexBin override checks PATH for codex', async () => {
  // When codexBin defaults to 'codex', we expect a clean ABSENT error if it's not on PATH.
  const origPath = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    await runCodex({ model: 'gpt-5.4' });
    assert.fail('expected ABSENT');
  } catch (err) {
    assert.equal(err.code, 'ABSENT');
  } finally {
    process.env.PATH = origPath;
  }
});
