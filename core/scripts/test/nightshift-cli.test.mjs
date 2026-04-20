import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const NS_BIN = path.join(ROOT, 'scripts', 'nightshift.sh');

function run(args, { env = {}, symlink = null } = {}) {
  const bin = symlink || NS_BIN;
  return spawnSync('bash', [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

test('nightshift --version prints a version number', () => {
  const res = run(['--version']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^nightshift\s+\S+/);
});

test('nightshift --help prints subcommand list', () => {
  const res = run(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /dispatch/);
  assert.match(res.stdout, /replay/);
  assert.match(res.stdout, /doctor/);
});

test('nightshift doctor runs and reports summary', () => {
  const res = run(['doctor']);
  // 0 = GO, 2 = WARN (both acceptable in dev env with warnings)
  assert.ok(res.status === 0 || res.status === 2, `doctor exited ${res.status}: ${res.stderr}`);
  assert.match(res.stdout, /doctor:/);
  assert.match(res.stdout, /node/);
});

test('nightshift router forwards to router.mjs', async () => {
  const tmpFile = path.join(tmpdir(), `router-${Date.now()}.json`);
  await fs.writeFile(tmpFile, JSON.stringify({
    risk_class: 'review-required',
    diff_budget_lines: 80,
    allowed_files: ['app/api/x/route.ts'],
    scope: { in_scope: ['Add new API endpoint'] }
  }), 'utf8');
  const res = run(['router', tmpFile]);
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.model, 'gpt-5.3-codex');
  await fs.rm(tmpFile, { force: true });
});

test('nightshift replay forwards to replay-events.mjs', () => {
  const fixture = path.join(ROOT, 'core', 'event-store', 'test', 'fixtures', 'sample.ndjson');
  const res = run(['replay', fixture, '--compact']);
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.waves['1'].status, 'accepted');
});

test('nightshift unknown subcommand exits 2 with a clear error', () => {
  const res = run(['bogus-subcommand']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown subcommand/);
});

test('nightshift init is scheduled (Wave B) — clear error, exit 2', () => {
  const res = run(['init', '/tmp/does-not-matter']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Wave B/i);
});

test('nightshift works when invoked through a symlink (as --link-bin installs it)', async () => {
  const symlink = path.join(tmpdir(), `nightshift-${Date.now()}`);
  await fs.symlink(NS_BIN, symlink);
  try {
    const res = spawnSync(symlink, ['--version'], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /nightshift/);
  } finally {
    await fs.rm(symlink, { force: true });
  }
});
