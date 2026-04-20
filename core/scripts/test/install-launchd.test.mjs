import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const SCRIPT = path.join(ROOT, 'scripts', 'install-launchd.sh');

function run(args, { env = {} } = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

test('install-launchd without --project exits 2 and shows the usage line', () => {
  const res = run([]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--project/);
});

test('install-launchd refuses non-existent project dir', () => {
  const res = run(['--project', '/nonexistent-path-for-ns-test-xyz']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not found|not a directory/);
});

test('install-launchd refuses the nightshift repo itself without --allow-self-target', () => {
  const res = run(['--project', ROOT]);
  // On non-Darwin the script exits 0 early with "macOS only; skipping".
  if (res.status === 0 && /macOS only/.test(res.stdout)) return;
  assert.equal(res.status, 2);
  assert.match(res.stderr, /nightshift repo itself|refusing/i);
});

test('install-launchd refuses an unmanaged project (no tasks/ or memory/)', async () => {
  const p = path.join(tmpdir(), `ns-launchd-unmanaged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(p, { recursive: true });
  try {
    const res = run(['--project', p]);
    if (res.status === 0 && /macOS only/.test(res.stdout)) return;
    assert.equal(res.status, 2);
    assert.match(res.stderr, /does not look like a nightshift-managed project/);
  } finally {
    await fs.rm(p, { recursive: true, force: true });
  }
});
