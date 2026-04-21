import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  budgetPartialFixtureEvents,
  cleanupProject,
  createProjectFixture,
  midWaveFixtureEvents,
  pausedMarkdownFixture,
  runStatus
} from './helpers/status-fixtures.mjs';

test('F-A: mid-wave dashboard preserves the existing contract and adds the new sections', async () => {
  const project = await createProjectFixture({
    events: midWaveFixtureEvents(),
    pausedMarkdown: pausedMarkdownFixture(),
    name: 'ns-status-fa'
  });

  try {
    const res = runStatus(project);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /\x1b\[/, 'dashboard should not emit ANSI escapes when stdout is not a TTY');

    for (const header of [
      'PIPELINE',
      'WAVES',
      'GUARDS / GATES (last hour)',
      'TOP COST',
      'PER-AGENT SHARE (24h)',
      'BUDGET',
      'EVENTS',
      'OPEN QUESTIONS 2',
      'PAUSED TASKS 1'
    ]) {
      assert.match(res.stdout, new RegExp(header.replace(/[()[\]/]/g, '\\$&')));
    }

    assert.match(res.stdout, /Wave 1\s+◐ in-progress\s+\[[#-]+\]\s+50% \[3\/6\]/);
    assert.match(res.stdout, /Q-1001/);
    assert.match(res.stdout, /Q-1002/);
    assert.doesNotMatch(res.stdout, /Q-0999/);
    assert.match(res.stdout, /T1_DELTA - Waiting on the human answer before retrying the sync rollout\./);
    assert.match(res.stdout, /WARNING: T1_ALPHA cumulative tokens 247,567 \(>200k threshold\)/);
    assert.match(res.stdout, /gate\.failed: 1/);
    assert.match(res.stdout, /~\$[0-9]+\.[0-9]{2} \(24h\) \/ ~\$[0-9]+\.[0-9]{2} \(all-time\)/);
    assert.match(res.stdout, /T1_ALPHA/);
    assert.match(res.stdout, /implementer/);
    assert.match(res.stdout, /task-impl-reviewer/);
  } finally {
    await cleanupProject(project);
  }
});

test('F-B: empty events.ndjson prints no sessions recorded yet and exits 0', async () => {
  const project = await createProjectFixture({ events: [], name: 'ns-status-fb' });
  try {
    const res = runStatus(project);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /no sessions recorded yet/);
  } finally {
    await cleanupProject(project);
  }
});

test('F-C: --watch refuses when stdout is not a TTY', async () => {
  const project = await createProjectFixture({ events: [], name: 'ns-status-fc' });
  try {
    const res = runStatus(project, '--watch', '1');
    assert.equal(res.status, 2);
    assert.match(res.stderr, /--watch requires a TTY; use --json for piped consumption/);
  } finally {
    await cleanupProject(project);
  }
});

test('F-D: truncated last line is ignored instead of crashing', async () => {
  const events = midWaveFixtureEvents();
  const rawLog = `${events.map(event => JSON.stringify(event)).join('\n')}\n{"event_id":"ev_partial"`;
  const project = await createProjectFixture({
    rawLog,
    pausedMarkdown: pausedMarkdownFixture(),
    name: 'ns-status-fd'
  });

  try {
    const res = runStatus(project);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /PIPELINE/);
    assert.match(res.stdout, /OPEN QUESTIONS 2/);
  } finally {
    await cleanupProject(project);
  }
});

test('F-E: missing dispatched model marks budget_partial and uses under-counted text rendering', async () => {
  const project = await createProjectFixture({
    events: budgetPartialFixtureEvents(),
    name: 'ns-status-fe'
  });

  try {
    const jsonRes = runStatus(project, '--json');
    assert.equal(jsonRes.status, 0, jsonRes.stderr);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.budget.budget_partial, true);
    assert.ok(parsed.budget.missing_model_event_count > 0);
    assert.equal(typeof parsed.budget.estimate_usd_24h, 'number');
    assert.equal(typeof parsed.budget.estimate_usd_all_time, 'number');
    assert.ok(parsed.budget.estimate_usd_24h > 0);
    assert.ok(parsed.budget.estimate_usd_all_time > 0);

    const textRes = runStatus(project);
    assert.equal(textRes.status, 0, textRes.stderr);
    assert.match(
      textRes.stdout,
      /~\$≥[0-9]+\.[0-9]{2} \(24h, under-counted\) \/ ~\$≥[0-9]+\.[0-9]{2} \(all-time, under-counted\)/
    );
  } finally {
    await cleanupProject(project);
  }
});

test('F-F: slash-command parity uses --dashboard explicitly', async () => {
  const md = await fs.readFile(path.join(ROOT, 'claude', 'commands', 'status.md'), 'utf8');
  assert.match(md, /nightshift status "\$PROJECT" --dashboard/);
});
