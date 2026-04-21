import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const MORNING_DIGEST = path.join(ROOT, 'core', 'scripts', 'morning-digest.mjs');

function tmp(name = 'ns-h14-digest') {
  return path.join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function makeEvent(action, overrides = {}) {
  return {
    event_id: overrides.event_id || `ev_${Math.random().toString(36).slice(2, 18).toUpperCase()}`,
    ts: overrides.ts || new Date().toISOString(),
    session_id: overrides.session_id || 'sess_01HXYZ000000000000000001',
    agent: overrides.agent || 'orchestrator',
    action,
    ...overrides
  };
}

async function bootstrapProject(events) {
  const project = tmp('ns-h14-digest-project');
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  await fs.writeFile(
    path.join(project, 'tasks', 'events.ndjson'),
    events.map(event => JSON.stringify(event)).join('\n') + '\n',
    'utf8'
  );
  return project;
}

function runDigest(project, homeDir) {
  return spawnSync('node', [MORNING_DIGEST, project], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      NIGHTSHIFT_DIGEST_VOICE: '0'
    }
  });
}

async function readDigest(homeDir) {
  const digestPath = path.join(homeDir, '.nightshift', 'digest', `${new Date().toISOString().slice(0, 10)}.md`);
  return await fs.readFile(digestPath, 'utf8');
}

function sectionBody(markdown, heading) {
  const marker = `${heading}\n`;
  const start = markdown.indexOf(marker);
  if (start === -1) return null;
  const rest = markdown.slice(start + marker.length);
  const nextHeading = rest.search(/^## /m);
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
}

test('digest puts unresolved questions first and lists only the still-open item', async () => {
  const now = new Date().toISOString();
  const project = await bootstrapProject([
    makeEvent('session.start', {
      event_id: 'ev_01HXYZ000000000000000BAA',
      ts: now,
      payload: { project: 'digest-hotfix2' }
    }),
    makeEvent('question.asked', {
      event_id: 'ev_01HXYZ000000000000000BAB',
      ts: now,
      wave: 1,
      task_id: 'T1_ALPHA',
      payload: { question_id: 'Q-6001', question: 'Keep feature flag on?' }
    }),
    makeEvent('question.asked', {
      event_id: 'ev_01HXYZ000000000000000BAC',
      ts: now,
      wave: 1,
      task_id: 'T1_BETA',
      payload: { question_id: 'Q-6002', question: 'Approve the rollout?' }
    }),
    makeEvent('question.asked', {
      event_id: 'ev_01HXYZ000000000000000BAD',
      ts: now,
      wave: 1,
      task_id: 'T1_GAMMA',
      payload: { question_id: 'Q-6003', question: 'Use the backup plan?' }
    }),
    makeEvent('question.answered', {
      event_id: 'ev_01HXYZ000000000000000BAE',
      ts: now,
      payload: { question_id: 'Q-6002', answer: 'yes' }
    }),
    makeEvent('decision.recorded', {
      event_id: 'ev_01HXYZ000000000000000BAF',
      ts: now,
      payload: { question_id: 'Q-6003', decision: 'no' }
    }),
    makeEvent('task.accepted', {
      event_id: 'ev_01HXYZ000000000000000BAG',
      ts: now,
      wave: 1,
      task_id: 'T1_DONE',
      agent: 'wave-reviewer'
    })
  ]);
  const homeDir = tmp('ns-h14-home');
  await fs.mkdir(homeDir, { recursive: true });

  try {
    const res = runDigest(project, homeDir);
    assert.equal(res.status, 0, res.stderr);

    const digest = await readDigest(homeDir);
    const headings = digest.split('\n').filter(line => line.startsWith('## '));
    assert.equal(headings[0], '## ⚠ Waiting for your answer');

    const waitingBody = sectionBody(digest, '## ⚠ Waiting for your answer');
    assert.equal(waitingBody, '- Q-6001 (wave 1, task T1_ALPHA): Keep feature flag on?');
    assert.ok(digest.indexOf('## Accepted (1)') > digest.indexOf('## ⚠ Waiting for your answer'));
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('digest omits the waiting-for-your-answer section when all questions are resolved', async () => {
  const now = new Date().toISOString();
  const project = await bootstrapProject([
    makeEvent('session.start', {
      event_id: 'ev_01HXYZ000000000000000BBA',
      ts: now,
      payload: { project: 'digest-hotfix2' }
    }),
    makeEvent('question.asked', {
      event_id: 'ev_01HXYZ000000000000000BBB',
      ts: now,
      payload: { question_id: 'Q-7001', question: 'Deploy now?' }
    }),
    makeEvent('question.answered', {
      event_id: 'ev_01HXYZ000000000000000BBC',
      ts: now,
      payload: { question_id: 'Q-7001', answer: 'later' }
    })
  ]);
  const homeDir = tmp('ns-h14-home');
  await fs.mkdir(homeDir, { recursive: true });

  try {
    const res = runDigest(project, homeDir);
    assert.equal(res.status, 0, res.stderr);

    const digest = await readDigest(homeDir);
    assert.ok(!digest.includes('## ⚠ Waiting for your answer'));
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('digest renders fallback text for unresolved questions missing payload.question', async () => {
  const now = new Date().toISOString();
  const project = await bootstrapProject([
    makeEvent('session.start', {
      event_id: 'ev_01HXYZ000000000000000BCA',
      ts: now,
      payload: { project: 'digest-hotfix2' }
    }),
    makeEvent('question.asked', {
      event_id: 'ev_01HXYZ000000000000000BCB',
      ts: now,
      wave: 2,
      task_id: 'T2_FALLBACK',
      payload: { question_id: 'Q-8001' }
    })
  ]);
  const homeDir = tmp('ns-h14-home');
  await fs.mkdir(homeDir, { recursive: true });

  try {
    const res = runDigest(project, homeDir);
    assert.equal(res.status, 0, res.stderr);

    const digest = await readDigest(homeDir);
    assert.match(digest, /- Q-8001 \(wave 2, task T2_FALLBACK\): \(no question text\)/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});
