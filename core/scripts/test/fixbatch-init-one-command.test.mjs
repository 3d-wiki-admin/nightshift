import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const INIT = path.join(ROOT, 'core', 'scripts', 'nightshift-init.mjs');

function tmpProject() {
  return path.join(tmpdir(), `ns-fixbatch-init1cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function tmpRegistry() {
  return path.join(tmpdir(), `ns-fixbatch-reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

// TZ fix-batch P1.1: the CLI output should offer exactly one command to
// copy-paste, combining the cd and the claude invocation.

test('nightshift init prints a single copy-paste command that runs the intake slash command', async () => {
  const project = tmpProject();
  const registryRoot = tmpRegistry();
  try {
    const res = spawnSync('node', [INIT, project], {
      encoding: 'utf8',
      env: { ...process.env, NIGHTSHIFT_REGISTRY_ROOT: registryRoot, NIGHTSHIFT_AUTO_CHECKPOINT: '0' }
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /copy-paste one command/);
    // Exactly one line matching the combined-cd-claude pattern.
    const lines = res.stdout.split('\n');
    const matches = lines.filter(l => / && claude "\//.test(l));
    assert.equal(matches.length, 1, `expected exactly one "cd ... && claude ..." line, got ${matches.length}:\n${res.stdout}`);
    assert.match(matches[0], /\/nightshift intake --project/);
    assert.match(matches[0], new RegExp(`cd ${project.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`));
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(registryRoot, { recursive: true, force: true });
  }
});

test('nightshift init --json still emits next_command for programmatic callers', async () => {
  const project = tmpProject();
  const registryRoot = tmpRegistry();
  try {
    const res = spawnSync('node', [INIT, project, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, NIGHTSHIFT_REGISTRY_ROOT: registryRoot, NIGHTSHIFT_AUTO_CHECKPOINT: '0' }
    });
    assert.equal(res.status, 0, res.stderr);
    const obj = JSON.parse(res.stdout);
    assert.match(obj.next_command, /^\/nightshift intake --project /);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(registryRoot, { recursive: true, force: true });
  }
});
