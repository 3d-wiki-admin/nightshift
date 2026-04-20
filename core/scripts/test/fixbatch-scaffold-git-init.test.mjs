import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scaffold } from '../nightshift-scaffold.mjs';

// TZ fix-batch P0.5: after scaffold, the project must already be a git
// repo with an initial commit so the `/preflight` "clean-or-at-least-
// committed" gate passes on the first wave.

function tmpProject() {
  return path.join(tmpdir(), `ns-fixbatch-gitinit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function seedIntake(project) {
  await fs.mkdir(path.join(project, '.nightshift'), { recursive: true });
  await fs.writeFile(path.join(project, '.nightshift', 'intake-pending'), '', 'utf8');
  const now = new Date().toISOString();
  const lines = [
    { ts: now, kind: 'q', n: 1, answer: 'demo' },
    { ts: now, kind: 'q', n: 2, answer: 'user' },
    { ts: now, kind: 'q', n: 3, answer: 'do a thing' },
    { ts: now, kind: 'q', n: 4, answer: 'nothing' },
    { ts: now, kind: 'q', n: 5, answer: 'none' },
    { ts: now, kind: 'q', n: 6, answer: 'works' },
    {
      ts: now, kind: 'proposal', approved: true,
      template: 'next-supabase-vercel', stack: 'nextjs-supabase-vercel',
      providers: [], initial_risk_class: 'safe',
      success_criteria: 'ok', questions: [], out_of_scope: []
    }
  ];
  await fs.writeFile(
    path.join(project, '.nightshift', 'intake.ndjson'),
    lines.map(l => JSON.stringify(l)).join('\n') + '\n',
    'utf8'
  );
}

function gitHasBin() {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

test('scaffold initializes a git repo with an initial commit', { skip: !gitHasBin() && 'git is not installed on this host' }, async () => {
  const project = tmpProject();
  const registryRoot = path.join(tmpdir(), `ns-fixbatch-reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await fs.mkdir(project, { recursive: true });
    await seedIntake(project);

    const result = await scaffold(project, { registryRoot, autoCheckpoint: false });
    assert.ok(result.git, 'scaffold result must include a git field');
    assert.equal(result.git.initialized, true);
    assert.equal(result.git.committed, true);
    assert.equal(result.git.branch, 'main');

    // `.git/` exists.
    const gitDir = await fs.stat(path.join(project, '.git')).catch(() => null);
    assert.ok(gitDir && gitDir.isDirectory(), 'expected .git/ directory');

    // Tree is clean after scaffold.
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8' });
    assert.equal(status.status, 0);
    assert.equal(status.stdout.trim(), '', `expected clean tree, got:\n${status.stdout}`);

    // At least one commit on main.
    const log = spawnSync('git', ['log', '--oneline', '-n', '1'], { cwd: project, encoding: 'utf8' });
    assert.equal(log.status, 0);
    assert.match(log.stdout, /nightshift scaffold/);

    // .gitignore excludes local state.
    const gi = await fs.readFile(path.join(project, '.gitignore'), 'utf8');
    assert.match(gi, /^\.nightshift\/$/m);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(registryRoot, { recursive: true, force: true });
  }
});

test('scaffold leaves an existing git repo alone', { skip: !gitHasBin() && 'git is not installed on this host' }, async () => {
  const project = tmpProject();
  const registryRoot = path.join(tmpdir(), `ns-fixbatch-reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await fs.mkdir(project, { recursive: true });
    spawnSync('git', ['init', '-b', 'main'], { cwd: project });
    spawnSync('git', ['config', 'user.email', 'test@local'], { cwd: project });
    spawnSync('git', ['config', 'user.name', 'test'], { cwd: project });
    await fs.writeFile(path.join(project, 'pre-existing.txt'), 'hello', 'utf8');
    spawnSync('git', ['add', '-A'], { cwd: project });
    spawnSync('git', ['commit', '-m', 'pre-existing commit'], { cwd: project });

    await seedIntake(project);
    const result = await scaffold(project, { registryRoot, autoCheckpoint: false });
    assert.equal(result.git.initialized, false);
    assert.equal(result.git.reason, 'repo_already_present');

    // The pre-existing commit must still be the first commit (not clobbered).
    const log = spawnSync('git', ['log', '--oneline'], { cwd: project, encoding: 'utf8' });
    assert.match(log.stdout, /pre-existing commit/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(registryRoot, { recursive: true, force: true });
  }
});
