#!/usr/bin/env node
// morning-digest.mjs — called at 08:00 by launchd (or manually for testing).
// Writes ~/.nightshift/digest/<date>.md with a human-readable summary of the night.
// Optionally `say "Digest is ready"` on macOS.

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { EventStore, buildState, sessionId } from '../event-store/src/index.mjs';

function yyyymmdd(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function fmt(n) {
  if (n > 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n > 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

async function main() {
  const projectDir = process.argv[2] || process.env.NIGHTSHIFT_ACTIVE_PROJECT;
  if (!projectDir) {
    console.error('morning-digest: no project directory provided');
    process.exit(2);
  }

  const logPath = path.join(projectDir, 'tasks', 'events.ndjson');
  const store = new EventStore(logPath);
  const events = await store.all();
  const state = buildState(events);

  const since = Date.now() - 12 * 3600 * 1000;
  const overnight = events.filter(e => new Date(e.ts).getTime() >= since);

  const accepted = overnight.filter(e => e.action === 'task.accepted').map(e => e.task_id);
  const rejected = overnight.filter(e => e.action === 'task.rejected').map(e => e.task_id);
  const paused = overnight.filter(e => e.action === 'pinger.unstuck.failed').map(e => e.task_id);
  const previews = overnight
    .filter(e => e.action === 'infra.provisioned')
    .map(e => e.payload?.preview_url || e.payload?.ref)
    .filter(Boolean);
  const questionsAsked = overnight.filter(e => e.action === 'question.asked').map(e => e.payload?.question_id).filter(Boolean);

  const nightTokens = overnight.reduce((a, e) => a + ((e.tokens?.input || 0) + (e.tokens?.output || 0)), 0);
  const nightCost = overnight.reduce((a, e) => a + (e.cost_usd_estimate || 0), 0);

  const out = [
    `# nightshift digest — ${yyyymmdd()}`,
    '',
    `Project: ${state.project.name || path.basename(projectDir)}`,
    `Events in last 12h: ${overnight.length}`,
    `Overnight tokens: ${fmt(nightTokens)}   |   cost: $${nightCost.toFixed(4)}`,
    '',
    `## Accepted (${accepted.length})`,
    ...(accepted.length ? accepted.map(t => `- ${t}`) : ['_(none)_']),
    '',
    `## Rejected / revised (${rejected.length})`,
    ...(rejected.length ? rejected.map(t => `- ${t}`) : ['_(none)_']),
    '',
    `## Paused (${paused.length})`,
    ...(paused.length ? paused.map(t => `- ${t}  ← needs attention`) : ['_(none)_']),
    '',
    `## Preview URLs (${previews.length})`,
    ...(previews.length ? previews.map(u => `- ${u}`) : ['_(none)_']),
    '',
    `## Open questions (${state.open_questions.length})`,
    ...(state.open_questions.length ? state.open_questions.map(q => `- ${q}`) : ['_(none)_']),
    '',
    `## Cumulative`,
    `- Total events: ${state.totals.events}`,
    `- Total tokens: ${fmt(state.totals.tokens)}`,
    `- Estimated cost: $${state.totals.cost_usd_estimate}`,
    ''
  ].join('\n');

  const dir = path.join(os.homedir(), '.nightshift', 'digest');
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, `${yyyymmdd()}.md`);
  await fs.writeFile(outPath, out, 'utf8');
  console.error(`[morning-digest] wrote ${outPath}`);

  if (process.platform === 'darwin' && process.env.NIGHTSHIFT_DIGEST_VOICE !== '0') {
    spawn('say', ['Digest is ready']).unref();
  }

  const sid = state.session_id || sessionId();
  await store.append({
    session_id: sid,
    agent: 'morning-digest',
    action: 'pinger.ping',
    payload: { kind: 'digest', path: outPath }
  });
}

main().catch(err => {
  console.error('[morning-digest] fatal:', err.message);
  process.exit(1);
});
