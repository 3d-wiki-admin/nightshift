import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appendEvent } from '../dispatch.mjs';

async function makeRepo() {
  const dir = path.join(tmpdir(), `ns-ac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(path.join(dir, 'tasks'), { recursive: true });
  spawnSync('git', ['-C', dir, 'init', '-b', 'main'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@test.test']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'test']);
  // Create an initial commit so tagging has something to point at.
  await fs.writeFile(path.join(dir, 'README.md'), 'hello\n', 'utf8');
  spawnSync('git', ['-C', dir, 'add', '-A']);
  spawnSync('git', ['-C', dir, 'commit', '-m', 'init'], { encoding: 'utf8' });
  return { dir, logPath: path.join(dir, 'tasks', 'events.ndjson') };
}

test('appendEvent auto-tags wave-<N>-start on wave.started', async () => {
  const { dir, logPath } = await makeRepo();
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    wave: 1,
    agent: 'orchestrator',
    action: 'wave.started'
  });
  const tags = spawnSync('git', ['-C', dir, 'tag', '--list', 'nightshift/wave-1-start-*'], { encoding: 'utf8' });
  assert.ok(tags.stdout.trim().length > 0, 'expected a nightshift/wave-1-start-* tag');
  await fs.rm(dir, { recursive: true, force: true });
});

test('appendEvent auto-tags wave-<N>-end on wave.accepted', async () => {
  const { dir, logPath } = await makeRepo();
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    wave: 2,
    agent: 'orchestrator',
    action: 'wave.accepted'
  });
  const tags = spawnSync('git', ['-C', dir, 'tag', '--list', 'nightshift/wave-2-end-*'], { encoding: 'utf8' });
  assert.ok(tags.stdout.trim().length > 0, 'expected a nightshift/wave-2-end-* tag');
  await fs.rm(dir, { recursive: true, force: true });
});

test('auto-checkpoint skipped when NIGHTSHIFT_AUTO_CHECKPOINT=0', async () => {
  const { dir, logPath } = await makeRepo();
  process.env.NIGHTSHIFT_AUTO_CHECKPOINT = '0';
  try {
    await appendEvent(logPath, {
      session_id: 'sess_01HXYZ000000000000000001',
      wave: 3,
      agent: 'orchestrator',
      action: 'wave.started'
    });
  } finally {
    delete process.env.NIGHTSHIFT_AUTO_CHECKPOINT;
  }
  const tags = spawnSync('git', ['-C', dir, 'tag', '--list', 'nightshift/wave-3-*'], { encoding: 'utf8' });
  assert.equal(tags.stdout.trim(), '', 'expected no wave-3 tags when flag is 0');
  await fs.rm(dir, { recursive: true, force: true });
});

test('auto-checkpoint is silent when not inside a git repo', async () => {
  const dir = path.join(tmpdir(), `ns-ac-nongit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(path.join(dir, 'tasks'), { recursive: true });
  const logPath = path.join(dir, 'tasks', 'events.ndjson');
  // No git init here — autoTagCheckpoint should silently skip.
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    wave: 4,
    agent: 'orchestrator',
    action: 'wave.started'
  });
  // The event should still land in the log without error.
  const raw = await fs.readFile(logPath, 'utf8');
  assert.match(raw, /"action":"wave.started"/);
  await fs.rm(dir, { recursive: true, force: true });
});
