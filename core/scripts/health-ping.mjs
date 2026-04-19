#!/usr/bin/env node
// health-ping.mjs — called every 30 min by launchd.
// 1. Read state.json (rebuild from log if stale).
// 2. If an in-progress wave has no events in the last 15 min, attempt to unstick.
// 3. If 3 consecutive unstucks fail on the same task, move it to paused.md.
//
// Every tick emits a pinger.ping event. Unstucks emit pinger.unstuck.
// Failures after 3 tries emit pinger.unstuck.failed.

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { EventStore, buildState, sessionId } from '../event-store/src/index.mjs';

const STALE_MIN = 15;
const FAIL_THRESHOLD = 3;

async function main() {
  const projectDir = process.argv[2] || process.env.NIGHTSHIFT_ACTIVE_PROJECT;
  if (!projectDir) {
    console.error('health-ping: no project directory provided');
    process.exit(2);
  }
  const logPath = path.join(projectDir, 'tasks', 'events.ndjson');
  const store = new EventStore(logPath);
  const events = await store.all();
  const state = buildState(events);

  const now = Date.now();
  const sid = state.session_id || sessionId();
  await store.append({
    session_id: sid,
    agent: 'health-pinger',
    action: 'pinger.ping',
    payload: { source: 'launchd', project: projectDir }
  });

  const inProgressWaves = Object.entries(state.waves || {}).filter(([, w]) => w.status === 'in_progress');
  if (!inProgressWaves.length) {
    console.error('[health-ping] no in-progress waves; nothing to do');
    return;
  }

  const lastTs = events.length ? new Date(events.at(-1).ts).getTime() : 0;
  const ageMin = (now - lastTs) / 60000;
  if (ageMin < STALE_MIN) {
    console.error(`[health-ping] last event ${ageMin.toFixed(1)} min ago — not stale, skipping`);
    return;
  }

  const failCounts = await readFailCounts(projectDir);
  let stalledTasks = [];
  for (const [wid, wave] of inProgressWaves) {
    for (const [tid, task] of Object.entries(wave.tasks || {})) {
      if (['dispatched', 'context_packed', 'blocked', 'reviewing'].includes(task.status)) {
        stalledTasks.push({ wave: +wid, task_id: tid, status: task.status });
      }
    }
  }
  if (!stalledTasks.length) {
    console.error('[health-ping] in-progress wave but no stalled tasks — skipping');
    return;
  }

  for (const st of stalledTasks) {
    const key = `${st.wave}:${st.task_id}`;
    const fails = failCounts[key] || 0;
    if (fails >= FAIL_THRESHOLD) {
      await pauseTask(projectDir, st, store, sid);
      continue;
    }
    const ok = await attemptUnstick(projectDir);
    await store.append({
      session_id: sid,
      wave: st.wave,
      task_id: st.task_id,
      agent: 'health-pinger',
      action: 'pinger.unstuck',
      outcome: ok ? 'success' : 'failure'
    });
    if (ok) {
      failCounts[key] = 0;
    } else {
      failCounts[key] = fails + 1;
      if (failCounts[key] >= FAIL_THRESHOLD) {
        await pauseTask(projectDir, st, store, sid);
      }
    }
  }

  await writeFailCounts(projectDir, failCounts);
}

async function attemptUnstick(projectDir) {
  const cli = process.env.NIGHTSHIFT_CLAUDE_CMD || 'claude';
  return await new Promise((resolve) => {
    const child = spawn(cli, ['--project', projectDir, '-p', '/resume'], {
      stdio: 'ignore',
      detached: false
    });
    const to = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(false);
    }, 5 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(to);
      resolve(code === 0);
    });
    child.on('error', () => {
      clearTimeout(to);
      resolve(false);
    });
  });
}

async function pauseTask(projectDir, st, store, sessionId) {
  const pausedPath = path.join(projectDir, 'tasks', 'paused.md');
  let body = '';
  try { body = await fs.readFile(pausedPath, 'utf8'); } catch {}
  const entry = `\n## ${new Date().toISOString()} — ${st.task_id} (wave ${st.wave})\n` +
                `Status: ${st.status}\nReason: 3 consecutive unstick attempts failed.\n`;
  await fs.writeFile(pausedPath, body + entry, 'utf8');

  await store.append({
    session_id: sessionId,
    wave: st.wave,
    task_id: st.task_id,
    agent: 'health-pinger',
    action: 'pinger.unstuck.failed',
    outcome: 'failure',
    notes: '3 consecutive unstick attempts failed; task moved to paused.md'
  });
}

async function readFailCounts(projectDir) {
  const p = path.join(projectDir, '.nightshift', 'ping-failcounts.json');
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return {}; }
}

async function writeFailCounts(projectDir, obj) {
  const p = path.join(projectDir, '.nightshift', 'ping-failcounts.json');
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2), 'utf8');
}

main().catch(err => {
  console.error('[health-ping] fatal:', err.message);
  process.exit(1);
});
