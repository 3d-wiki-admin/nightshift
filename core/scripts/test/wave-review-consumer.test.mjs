import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { consume, extractTaskIds, extractSection } from '../wave-review-consumer.mjs';
import { appendEvent } from '../dispatch.mjs';
import { EventStore } from '../../event-store/src/index.mjs';

function tmpProject() {
  return path.join(tmpdir(), `ns-wrc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function setupWave(projectDir, wave, taskIds) {
  await fs.mkdir(path.join(projectDir, 'tasks', 'waves', String(wave)), { recursive: true });
  const logPath = path.join(projectDir, 'tasks', 'events.ndjson');
  await fs.writeFile(logPath, '', 'utf8');
  // Disable auto-checkpoint so fixtures don't need a git repo.
  process.env.NIGHTSHIFT_AUTO_CHECKPOINT = '0';
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    agent: 'orchestrator',
    action: 'session.start',
    payload: { project: 'wrc-test' }
  });
  for (const tid of taskIds) {
    await appendEvent(logPath, {
      session_id: 'sess_01HXYZ000000000000000001',
      wave, task_id: tid,
      agent: 'task-decomposer',
      action: 'task.contracted'
    });
  }
  return logPath;
}

test('extractTaskIds picks task ids, drops labels like PASS/FAIL', () => {
  const ids = extractTaskIds('Some text about TASK_001 and DEMO_42 — but PASS/FAIL should not count, nor should API or JSON.');
  assert.deepEqual(ids.sort(), ['DEMO_42', 'TASK_001']);
});

test('extractSection pulls only that heading chunk', () => {
  const md = [
    '# Title',
    '## Must-fix',
    '- TASK_A needs rework',
    '## Nice-to-have',
    '- other stuff'
  ].join('\n');
  const sec = extractSection(md, /^##\s+Must.?fix/i);
  assert.match(sec, /Must-fix/);
  assert.match(sec, /TASK_A/);
  assert.doesNotMatch(sec, /Nice-to-have/);
});

test('consume on missing review file returns not_found', async () => {
  const project = tmpProject();
  await fs.mkdir(path.join(project, 'tasks', 'waves', '1'), { recursive: true });
  await fs.writeFile(path.join(project, 'tasks', 'events.ndjson'), '', 'utf8');
  const r = await consume(project, 1);
  assert.equal(r.status, 'not_found');
  await fs.rm(project, { recursive: true, force: true });
});

test('verdict=accept emits wave.accepted event', async () => {
  const project = tmpProject();
  const logPath = await setupWave(project, 1, ['TASK_A', 'TASK_B']);
  const reviewPath = path.join(project, 'tasks', 'waves', '1', 'wave-review.md');
  await fs.writeFile(reviewPath, [
    '# Wave 1 review — verdict: accept',
    'Reviewer: gpt-5.4',
    '## Verdict: accept',
    'All clean.'
  ].join('\n'), 'utf8');

  const r = await consume(project, 1);
  assert.equal(r.status, 'accepted');
  assert.equal(r.verdict, 'accept');
  assert.equal(r.reviewerModel, 'gpt-5.4');

  const events = await new EventStore(logPath).all();
  const accepted = events.find(e => e.action === 'wave.accepted');
  assert.ok(accepted, 'expected wave.accepted event');
  assert.equal(accepted.model, 'gpt-5.4');
  assert.equal(accepted.wave, 1);
  await fs.rm(project, { recursive: true, force: true });
});

test('verdict=accept is idempotent (second consume is a no-op)', async () => {
  const project = tmpProject();
  const logPath = await setupWave(project, 1, ['TASK_A']);
  const reviewPath = path.join(project, 'tasks', 'waves', '1', 'wave-review.md');
  await fs.writeFile(reviewPath, '## Verdict: accept\nReviewer: gpt-5.4\n', 'utf8');
  await consume(project, 1);
  const r2 = await consume(project, 1);
  assert.equal(r2.status, 'already_accepted');
  const events = await new EventStore(logPath).all();
  const accepts = events.filter(e => e.action === 'wave.accepted');
  assert.equal(accepts.length, 1);
  await fs.rm(project, { recursive: true, force: true });
});

test('verdict=revise emits task.revised for each referenced task in-wave', async () => {
  const project = tmpProject();
  const logPath = await setupWave(project, 2, ['TASK_A', 'TASK_B', 'TASK_C']);
  const reviewPath = path.join(project, 'tasks', 'waves', '2', 'wave-review.md');
  await fs.writeFile(reviewPath, [
    '# Wave 2 review — verdict: revise',
    'Reviewer: gpt-5.4',
    '## Verdict: revise',
    '## Must-fix',
    '- TASK_A missed edge case for 0-length input.',
    '- TASK_C leaked a secret into evidence/diff.patch.',
    '## Should-fix',
    '- <low>'
  ].join('\n'), 'utf8');

  const r = await consume(project, 2);
  assert.equal(r.status, 'revised');
  assert.deepEqual(r.revisions.sort(), ['TASK_A', 'TASK_C']);

  const events = await new EventStore(logPath).all();
  const revised = events.filter(e => e.action === 'task.revised');
  assert.equal(revised.length, 2);
  const taskIds = revised.map(e => e.task_id).sort();
  assert.deepEqual(taskIds, ['TASK_A', 'TASK_C']);
  for (const e of revised) {
    assert.equal(e.wave, 2);
    assert.equal(e.model, 'gpt-5.4');
    assert.equal(e.outcome, 'revised');
    assert.ok(Array.isArray(e.evidence_paths) && e.evidence_paths.length, 'expected evidence_paths pointing at review file');
  }
  await fs.rm(project, { recursive: true, force: true });
});

test('verdict=revise with no attributable tasks emits wave.reviewed (no per-task events)', async () => {
  const project = tmpProject();
  const logPath = await setupWave(project, 3, ['TASK_A']);
  const reviewPath = path.join(project, 'tasks', 'waves', '3', 'wave-review.md');
  await fs.writeFile(reviewPath, [
    '# Wave 3 review',
    'Reviewer: gpt-5.4',
    '## Verdict: revise',
    '## Must-fix',
    '- something general — needs rework in scope FOOBAR (but FOOBAR is not a real task id in this wave)'
  ].join('\n'), 'utf8');

  const r = await consume(project, 3);
  assert.equal(r.status, 'revised_no_tasks');

  const events = await new EventStore(logPath).all();
  const revised = events.filter(e => e.action === 'task.revised');
  assert.equal(revised.length, 0);
  const reviewed = events.find(e => e.action === 'wave.reviewed' && e.outcome === 'revised');
  assert.ok(reviewed, 'expected a wave.reviewed event with outcome=revised');
  await fs.rm(project, { recursive: true, force: true });
});

test('unrecognized verdict returns no_verdict', async () => {
  const project = tmpProject();
  const logPath = await setupWave(project, 1, ['TASK_A']);
  const reviewPath = path.join(project, 'tasks', 'waves', '1', 'wave-review.md');
  await fs.writeFile(reviewPath, '# Wave 1\nReviewer: gpt-5.4\nthis has no verdict line at all\n', 'utf8');
  const r = await consume(project, 1);
  assert.equal(r.status, 'no_verdict');
  await fs.rm(project, { recursive: true, force: true });
});
