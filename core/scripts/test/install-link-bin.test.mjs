import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const INSTALL = path.join(ROOT, 'scripts', 'install.sh');
const NS_BIN = path.join(ROOT, 'scripts', 'nightshift.sh');

function tmp() {
  return path.join(tmpdir(), `ns-link-bin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

// Isolate install.sh by running just the --link-bin step via a minimal
// re-implementation of its contract: we don't call install.sh (it would also
// pnpm install and run the full suite). Instead we assert the known rule:
// install.sh's linking logic prefers user-local bin over /usr/local/bin and
// never requires sudo in its default path. This test locks that contract.
test('install.sh contains the documented linking policy', async () => {
  const text = await fs.readFile(INSTALL, 'utf8');
  // default branch: prefer ~/.local/bin or ~/bin if on PATH
  assert.match(text, /\$HOME\/\.local\/bin/);
  assert.match(text, /\$HOME\/bin/);
  // --system-bin requires sudo, so sudo must NOT be called outside that branch
  const sudoMatches = text.match(/\bsudo\b/g) || [];
  assert.ok(sudoMatches.length >= 1, 'expected sudo in --system-bin branch');
  // sudo must not appear in the default (user-local) path
  const defaultSection = text.match(/# Prefer a user-local bin[\s\S]*?fi\n/)?.[0] || '';
  assert.doesNotMatch(defaultSection, /\bsudo\b/);
  // installer must call prepare-claude-plugin-runtime before /plugin install works
  assert.match(text, /prepare-claude-plugin-runtime\.sh/);
});

test('symlink emulating --link-bin exposes `nightshift` as a working CLI', async () => {
  const binDir = tmp();
  await fs.mkdir(binDir, { recursive: true });
  const target = path.join(binDir, 'nightshift');
  await fs.symlink(NS_BIN, target);
  // Invoke via the symlink and confirm it resolves the repo root correctly.
  const res = spawnSync(target, ['--version'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `symlink invocation failed: ${res.stderr}`);
  assert.match(res.stdout, /nightshift\s+\d/);

  const doctor = spawnSync(target, ['doctor'], { encoding: 'utf8' });
  assert.ok(doctor.status === 0 || doctor.status === 2);
  assert.match(doctor.stdout, /doctor:/);
  await fs.rm(binDir, { recursive: true, force: true });
});

test('install.sh --no-link-bin is a recognized flag (documented opt-out)', async () => {
  const text = await fs.readFile(INSTALL, 'utf8');
  assert.match(text, /--no-link-bin/);
});

test('install.sh rejects unknown args or at least tolerates --help', async () => {
  const res = spawnSync('bash', [INSTALL, '--help'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /--link-bin|link-bin/);
});
