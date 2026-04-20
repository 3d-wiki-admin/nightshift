import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const CLI = path.join(ROOT, 'scripts', 'nightshift.sh');

function run(args, opts = {}) {
  return spawnSync('bash', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) }
  });
}

// TZ fix-batch P0.6: the raw install-launchd.sh path must no longer appear
// in prompts or docs; the blessed surface is `nightshift launchd ...`.

test('nightshift launchd with no op prints usage and exits 2', () => {
  const res = run(['launchd']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /nightshift launchd install --project/);
  assert.match(res.stderr, /nightshift launchd uninstall/);
  assert.match(res.stderr, /nightshift launchd status/);
});

test('nightshift launchd install without --project exits non-zero with a usage error', () => {
  const res = run(['launchd', 'install']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /--project/);
});

test('nightshift launchd unknown op is rejected', () => {
  const res = run(['launchd', 'doof']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown launchd op 'doof'/);
});

test('nightshift --help mentions the launchd subcommand', () => {
  const res = run(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /nightshift launchd install\|uninstall\|status/);
});

test('nightshift --help does not leak the raw install-launchd.sh script path', () => {
  // TZ P0.6 acceptance: user-facing docs (help, prompts) must reference
  // the CLI alias, not the internal implementation path. gpt-5.4 flagged
  // this on the first fix-batch review.
  const res = run(['--help']);
  assert.equal(res.status, 0);
  assert.ok(
    !/install-launchd\.sh/.test(res.stdout),
    `help output must not mention the raw script path. got:\n${res.stdout}`
  );
});

test('nightshift --help does not contain stale "Wave B will add" future-work comment', () => {
  // The v1.1 intake flow (init/new/doctor) is live; the header used to say
  // those subcommands were forthcoming, which misled readers.
  const res = run(['--help']);
  assert.equal(res.status, 0);
  assert.ok(
    !/Wave B will add/.test(res.stdout),
    `help output should not contain stale forward-looking comments. got:\n${res.stdout}`
  );
});

test('nightshift --help does not leak shell directives like "set -euo pipefail"', () => {
  // Guards against the old fixed `sed 1,40p` range running past the header
  // comment block.
  const res = run(['--help']);
  assert.equal(res.status, 0);
  assert.ok(
    !/^set -euo pipefail$/m.test(res.stdout),
    `help output leaked shell code. got:\n${res.stdout}`
  );
});
