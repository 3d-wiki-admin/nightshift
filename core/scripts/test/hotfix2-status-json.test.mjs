import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupProject,
  createProjectFixture,
  midWaveFixtureEvents,
  pausedMarkdownFixture,
  runStatus
} from './helpers/status-fixtures.mjs';

test('F-A json: dashboard data is emitted as a single machine-readable object', async () => {
  const project = await createProjectFixture({
    events: midWaveFixtureEvents(),
    pausedMarkdown: pausedMarkdownFixture(),
    name: 'ns-status-json'
  });

  try {
    const res = runStatus(project, '--json');
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);

    for (const key of [
      'session_id',
      'uptime_seconds',
      'zone',
      'last_event_ts',
      'last_event_action',
      'pipeline',
      'waves',
      'open_questions',
      'paused_tasks',
      'guards_last_hour',
      'top_cost',
      'per_agent_share',
      'budget',
      'soft_warnings',
      'events_total'
    ]) {
      assert.ok(Object.hasOwn(parsed, key), `missing key: ${key}`);
    }

    assert.equal(typeof parsed.session_id, 'string');
    assert.equal(typeof parsed.uptime_seconds, 'number');
    assert.equal(typeof parsed.zone, 'string');
    assert.equal(typeof parsed.pipeline, 'object');
    assert.ok(Array.isArray(parsed.waves));
    assert.ok(Array.isArray(parsed.open_questions));
    assert.ok(Array.isArray(parsed.paused_tasks));
    assert.equal(typeof parsed.guards_last_hour['guard.violation'], 'number');
    assert.ok(Array.isArray(parsed.top_cost));
    assert.equal(typeof parsed.per_agent_share, 'object');
    assert.equal(typeof parsed.budget.estimate_usd_24h, 'number');
    assert.equal(typeof parsed.budget.estimate_usd_all_time, 'number');
    assert.equal(typeof parsed.budget.budget_partial, 'boolean');
    assert.ok(Array.isArray(parsed.soft_warnings));
    assert.equal(typeof parsed.events_total, 'number');

    assert.equal(parsed.pipeline.intake, 'done');
    assert.equal(parsed.pipeline.tasks, 'done');
    assert.equal(parsed.pipeline.accept, 'current');
    assert.equal(parsed.pipeline.deploy, 'pending');
    assert.equal(parsed.open_questions.length, 2);
    assert.equal(parsed.paused_tasks.length, 1);
    assert.equal(parsed.waves[1].accepted_tasks, 3);
    assert.equal(parsed.waves[1].total_tasks, 6);
    assert.ok(parsed.top_cost.some(row => row.task_id === 'T1_ALPHA'));
  } finally {
    await cleanupProject(project);
  }
});
