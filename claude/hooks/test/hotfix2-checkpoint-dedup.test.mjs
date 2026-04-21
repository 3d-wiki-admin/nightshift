import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const HOOK = path.join(ROOT, 'claude', 'hooks', 'checkpoint.sh');

const SESS_X = 'sess_01HXYZ000000000000000001';
const SESS_Y = 'sess_01HXYZ000000000000000002';

function tmpProject() {
  return path.join(tmpdir(), `ns-checkpoint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function makeRepo(project) {
  await fs.mkdir(project, { recursive: true });
  spawnSync('git', ['-C', project, 'init', '-b', 'main'], { encoding: 'utf8' });
  spawnSync('git', ['-C', project, 'config', 'user.email', 'test@test.test'], { encoding: 'utf8' });
  spawnSync('git', ['-C', project, 'config', 'user.name', 'test'], { encoding: 'utf8' });
  await fs.writeFile(path.join(project, 'README.md'), 'hello\n', 'utf8');
  spawnSync('git', ['-C', project, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', project, 'commit', '-m', 'init'], { encoding: 'utf8' });
}

function eventLine(action, sessionId) {
  return JSON.stringify({ agent: 'system', action, session_id: sessionId });
}

async function writeEvents(project, lines) {
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  await fs.writeFile(
    path.join(project, 'tasks', 'events.ndjson'),
    lines.length ? `${lines.join('\n')}\n` : '',
    'utf8'
  );
}

function runCheckpoint(project, sessionId) {
  return spawnSync('bash', [HOOK], {
    input: JSON.stringify({ cwd: project, session_id: sessionId }),
    encoding: 'utf8',
    env: { ...process.env }
  });
}

async function readEventLines(project) {
  try {
    const raw = await fs.readFile(path.join(project, 'tasks', 'events.ndjson'), 'utf8');
    return raw.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function countSessionEnds(project) {
  const lines = await readEventLines(project);
  return lines
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(event => event?.action === 'session.end').length;
}

async function listSummaries(project) {
  try {
    const entries = await fs.readdir(path.join(project, 'tasks', 'history'));
    return entries.filter(name => /^session-.*\.summary\.md$/.test(name)).sort();
  } catch {
    return [];
  }
}

function listTags(project) {
  const res = spawnSync('git', ['-C', project, 'tag', '--list', 'nightshift/session-end-*'], {
    encoding: 'utf8'
  });
  return res.stdout.split('\n').map(line => line.trim()).filter(Boolean).sort();
}

async function waitForNextSecond() {
  await new Promise(resolve => setTimeout(resolve, 1100));
}

test('checkpoint F-A: empty or missing log passes through and writes tag, summary, and session.end', async () => {
  const project = tmpProject();
  await makeRepo(project);
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });

  const res = runCheckpoint(project, SESS_X);
  assert.equal(res.status, 0, `checkpoint exited ${res.status}: ${res.stderr}`);

  assert.equal(listTags(project).length, 1, 'expected one session-end tag');
  assert.equal((await listSummaries(project)).length, 1, 'expected one session summary');
  assert.equal(await countSessionEnds(project), 1, 'expected one session.end event');

  await fs.rm(project, { recursive: true, force: true });
});

test('checkpoint F-B: consecutive duplicate session.end is deduped before side effects', async () => {
  const project = tmpProject();
  await makeRepo(project);
  await writeEvents(project, [eventLine('session.end', SESS_X)]);

  const beforeLines = await readEventLines(project);
  const beforeTags = listTags(project);
  const beforeSummaries = await listSummaries(project);

  const res = runCheckpoint(project, SESS_X);
  assert.equal(res.status, 0, `checkpoint exited ${res.status}: ${res.stderr}`);

  assert.deepEqual(await readEventLines(project), beforeLines, 'expected no new event appended');
  assert.deepEqual(listTags(project), beforeTags, 'expected no new tag');
  assert.deepEqual(await listSummaries(project), beforeSummaries, 'expected no new summary');

  await fs.rm(project, { recursive: true, force: true });
});

test('checkpoint F-C: a different canonical session passes through even after prior session.end', async () => {
  const project = tmpProject();
  await makeRepo(project);
  await writeEvents(project, [eventLine('session.end', SESS_X)]);

  const beforeSessionEnds = await countSessionEnds(project);

  const res = runCheckpoint(project, SESS_Y);
  assert.equal(res.status, 0, `checkpoint exited ${res.status}: ${res.stderr}`);

  assert.equal(listTags(project).length, 1, 'expected one new tag');
  assert.equal((await listSummaries(project)).length, 1, 'expected one new summary');
  assert.equal(await countSessionEnds(project), beforeSessionEnds + 1, 'expected one new session.end event');

  await fs.rm(project, { recursive: true, force: true });
});

test('checkpoint F-D: pass-through after non-session.end last event, then dedup on immediate repeat', async () => {
  const project = tmpProject();
  await makeRepo(project);
  await writeEvents(project, [
    eventLine('session.start', SESS_X),
    eventLine('session.end', SESS_X),
    eventLine('decision.recorded', SESS_X)
  ]);

  const first = runCheckpoint(project, SESS_X);
  assert.equal(first.status, 0, `checkpoint exited ${first.status}: ${first.stderr}`);
  assert.equal(listTags(project).length, 1, 'expected first pass-through to tag');
  assert.equal((await listSummaries(project)).length, 1, 'expected first pass-through to write summary');
  assert.equal(await countSessionEnds(project), 2, 'expected first pass-through to append session.end');

  await waitForNextSecond();

  const beforeLines = await readEventLines(project);
  const beforeTags = listTags(project);
  const beforeSummaries = await listSummaries(project);

  const second = runCheckpoint(project, SESS_X);
  assert.equal(second.status, 0, `checkpoint exited ${second.status}: ${second.stderr}`);
  assert.deepEqual(await readEventLines(project), beforeLines, 'expected second run to dedup event append');
  assert.deepEqual(listTags(project), beforeTags, 'expected second run to dedup tag creation');
  assert.deepEqual(await listSummaries(project), beforeSummaries, 'expected second run to dedup summary creation');

  await fs.rm(project, { recursive: true, force: true });
});
