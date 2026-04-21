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
import crypto from 'node:crypto';
import path from 'node:path';
import { EventStore, buildState, sessionId } from '../event-store/src/index.mjs';
import { openQuestions } from '../event-store/src/open-questions.mjs';
import { appendEvent } from './dispatch.mjs';
import { parseHandoff } from './wave-handoff.mjs';

const STALE_MIN = 15;
const FAIL_THRESHOLD = 3;
const STALE_CLAIM_MS = 2 * 60 * 60 * 1000;

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
  const sid = state.session_id || sessionId();
  const open = openQuestions(events);

  if (open.length) {
    const openQuestionIds = [...new Set(open.map(question => question.id))].sort();
    const joinedIds = openQuestionIds.join(', ');
    const notes = `orchestrator awaiting human approval on ${joinedIds} (${openQuestionIds.length} open). Recover: open the Claude session and answer.`;

    await appendEvent(logPath, {
      session_id: sid,
      agent: 'health-pinger',
      action: 'session.paused',
      notes,
      payload: { open_question_ids: openQuestionIds }
    });
    await appendEvent(logPath, {
      session_id: sid,
      agent: 'health-pinger',
      action: 'pinger.ping',
      payload: { source: 'launchd', project: projectDir, skipped: 'awaiting_human' }
    });

    await maybeNotifyAwaitingHuman(projectDir, openQuestionIds);
    return;
  }

  const resurrected = await detectResurrectFreshOpportunity(projectDir, events);
  if (resurrected) return;

  const now = Date.now();
  await appendEvent(logPath, {
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
      await pauseTask(projectDir, st, logPath, sid);
      continue;
    }
    const ok = await attemptUnstick(projectDir);
    await appendEvent(logPath, {
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
      // TZ P0.2: a failed `claude --continue` cannot silently re-ping forever.
      // Record session.paused on the very first failure so the operator sees
      // the stalled session immediately; the pause-task hand-off fires at the
      // 3-fail threshold to avoid creating paused.md churn on transient errors.
      await appendEvent(logPath, {
        session_id: sid,
        wave: st.wave,
        task_id: st.task_id,
        agent: 'health-pinger',
        action: 'session.paused',
        outcome: 'failure',
        notes: `claude --continue failed (attempt ${failCounts[key]}/${FAIL_THRESHOLD}). Recover with: cd ${projectDir} && claude --continue`
      });
      if (failCounts[key] >= FAIL_THRESHOLD) {
        await pauseTask(projectDir, st, logPath, sid);
      }
    }
  }

  await writeFailCounts(projectDir, failCounts);
}

async function detectResurrectFreshOpportunity(projectDir, events) {
  if (process.env.NIGHTSHIFT_AUTONOMOUS !== '1') return null;

  const handoff = events.slice().reverse().find(event => event.action === 'wave.handoff');
  if (!handoff) {
    await maybeRepairOrphanHandoff(projectDir, events);
    return null;
  }

  const {
    source_wave,
    next_wave,
    source_session_id,
    handoff_token,
    handoff_path,
    next_manifest
  } = handoff.payload || {};

  if (
    source_wave == null ||
    next_wave == null ||
    !source_session_id ||
    !handoff_token ||
    !handoff_path ||
    !next_manifest
  ) {
    console.error('[pinger] wave.handoff missing required payload fields; ignoring.');
    return null;
  }

  const handoffAbs = path.resolve(projectDir, handoff_path);
  const nextManifestAbs = path.resolve(projectDir, next_manifest);
  if (!await pathExists(handoffAbs) || !await pathExists(nextManifestAbs)) {
    console.error(`[pinger] wave.handoff references missing files — not spawning; handoff_token=${handoff_token}`);
    return null;
  }

  let parsed;
  try {
    parsed = parseHandoff(await fs.readFile(handoffAbs, 'utf8'));
  } catch (err) {
    console.error(`[pinger] handoff file parse failed; not spawning: ${err.message}`);
    return null;
  }

  const expectedFields = {
    source_wave,
    next_wave,
    source_session_id,
    handoff_token
  };
  const mismatches = Object.entries(expectedFields)
    .filter(([key, value]) => parsed.machine_fields[key] !== value)
    .map(([key]) => key);
  if (mismatches.length > 0) {
    console.error(`[pinger] handoff file/event mismatch on: ${mismatches.join(', ')}; not spawning.`);
    return null;
  }
  if (parsed.next_wave_pointer.manifest !== next_manifest) {
    console.error('[pinger] handoff file next_manifest disagrees with event payload; not spawning.');
    return null;
  }

  const alreadyDispatched = events.some(event =>
    event.action === 'task.dispatched' && Number(event.wave) === Number(next_wave)
  );
  if (alreadyDispatched) return null;

  const claimKey = crypto.createHash('sha256')
    .update(`${source_wave}:${next_wave}:${next_manifest}`)
    .digest('hex')
    .slice(0, 16);
  const claimFile = path.join(projectDir, '.nightshift', `wave-claim-${claimKey}`);
  const logPath = path.join(projectDir, 'tasks', 'events.ndjson');

  try {
    const stat = await fs.stat(claimFile);
    const ageMs = Date.now() - stat.mtimeMs;
    const claim = JSON.parse(await fs.readFile(claimFile, 'utf8'));
    const claimPid = claim.pid;
    const claimSid = claim.new_session_id;

    let pidDead = claimPid == null;
    if (claimPid != null) {
      try {
        process.kill(claimPid, 0);
        pidDead = false;
      } catch (err) {
        if (err?.code === 'ESRCH') {
          pidDead = true;
        } else {
          return null;
        }
      }
    }

    const recentActivity = Boolean(claimSid) && events.some(event =>
      event.session_id === claimSid &&
      (Date.now() - new Date(event.ts).getTime()) < STALE_CLAIM_MS
    );

    if (pidDead && !recentActivity && ageMs > STALE_CLAIM_MS) {
      await fs.unlink(claimFile);
      await appendEvent(logPath, {
        session_id: sessionId(),
        agent: 'health-pinger',
        action: 'session.halted',
        outcome: 'failure',
        payload: {
          reason: 'stale_claim_recovered',
          claim_key: claimKey,
          stale_pid: claimPid,
          stale_session_id: claimSid,
          next_wave,
          age_ms: ageMs
        }
      });
    } else {
      return null;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const newSid = sessionId();
  try {
    await fs.mkdir(path.dirname(claimFile), { recursive: true });
    const fh = await fs.open(claimFile, 'wx');
    await fh.writeFile(JSON.stringify({
      claim_key: claimKey,
      handoff_token,
      triggering_handoff: handoff.event_id,
      source_wave,
      next_wave,
      new_session_id: newSid,
      pid: null,
      created_at: new Date().toISOString()
    }, null, 2));
    await fh.close();
  } catch (err) {
    if (err.code === 'EEXIST') return null;
    throw err;
  }

  await appendEvent(logPath, {
    session_id: newSid,
    agent: 'system',
    action: 'session.start',
    payload: {
      source: 'pinger-resurrect',
      triggering_handoff: handoff.event_id,
      handoff_token,
      next_wave
    },
    notes: `pinger spawning fresh claude -p for wave ${next_wave}`
  });

  const cli = process.env.NIGHTSHIFT_CLAUDE_CMD || 'claude';
  const child = spawn(cli, [
    '-p',
    '--dangerously-skip-permissions',
    `/nightshift:implement --wave=${next_wave}`
  ], {
    cwd: projectDir,
    env: { ...process.env, NIGHTSHIFT_SESSION_ID: newSid },
    stdio: 'ignore',
    detached: true
  });
  child.on('error', (err) => {
    console.error(`[pinger] claude -p spawn failed: ${err.message}`);
    appendEvent(logPath, {
      session_id: newSid,
      agent: 'system',
      action: 'session.halted',
      outcome: 'failure',
      payload: { reason: 'pinger_spawn_failed', error: err.message }
    }).catch(() => {});
    fs.unlink(claimFile).catch(() => {});
  });
  child.unref();

  try {
    const claim = JSON.parse(await fs.readFile(claimFile, 'utf8'));
    claim.pid = child.pid;
    await fs.writeFile(claimFile, JSON.stringify(claim, null, 2), 'utf8');
  } catch {}

  return { handoff_token, new_session_id: newSid, pid: child.pid };
}

async function attemptUnstick(projectDir) {
  // TZ P0.2: use the real `--continue` flag (the prior `-p /resume` started a
  // fresh headless print session instead of resuming — the unstuck "success"
  // was bogus). `--continue` reads cwd to pick the most-recent session; stdin
  // is /dev/null so the CLI exits cleanly instead of blocking on a TTY.
  const cli = process.env.NIGHTSHIFT_CLAUDE_CMD || 'claude';
  return await new Promise((resolve) => {
    const child = spawn(cli, ['--continue'], {
      cwd: projectDir,
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

async function pauseTask(projectDir, st, logPath, sessionId) {
  const pausedPath = path.join(projectDir, 'tasks', 'paused.md');
  let body = '';
  try { body = await fs.readFile(pausedPath, 'utf8'); } catch {}
  const recovery = `cd ${projectDir} && claude --continue`;
  const entry = `\n## ${new Date().toISOString()} — ${st.task_id} (wave ${st.wave})\n` +
                `Status: ${st.status}\nReason: 3 consecutive unstick attempts failed.\n` +
                `Recovery: \`${recovery}\`\n`;
  await fs.writeFile(pausedPath, body + entry, 'utf8');

  await appendEvent(logPath, {
    session_id: sessionId,
    wave: st.wave,
    task_id: st.task_id,
    agent: 'health-pinger',
    action: 'pinger.unstuck.failed',
    outcome: 'failure',
    notes: `3 consecutive unstick attempts failed; task moved to paused.md. Recovery: ${recovery}`
  });
}

async function maybeNotifyAwaitingHuman(projectDir, openQuestionIds) {
  if (process.platform !== 'darwin') return;

  const sentinelPath = path.join(projectDir, '.nightshift', 'last-notified-questions');
  const key = [...openQuestionIds].sort().join(',');
  let previous = '';

  try {
    previous = (await fs.readFile(sentinelPath, 'utf8')).trim();
  } catch {}

  if (previous !== key) {
    try {
      const child = spawn('say', ['nightshift is waiting for your answer'], {
        detached: true,
        stdio: 'ignore'
      });
      child.on('error', () => {});
      child.unref();
    } catch {}
  }

  try {
    await fs.mkdir(path.dirname(sentinelPath), { recursive: true });
    await fs.writeFile(sentinelPath, key, 'utf8');
  } catch {}
}

async function maybeRepairOrphanHandoff(projectDir, events) {
  const wavesDir = path.join(projectDir, 'tasks', 'waves');
  const waves = await fs.readdir(wavesDir).catch(() => []);
  const numericDesc = waves
    .filter(wave => /^\d+$/.test(wave))
    .map(wave => Number.parseInt(wave, 10))
    .sort((left, right) => right - left)
    .map(wave => String(wave));

  for (const wave of numericDesc) {
    const handoffPath = `tasks/waves/${wave}/handoff-to-next.md`;
    const handoffAbs = path.join(projectDir, handoffPath);
    if (!await pathExists(handoffAbs)) continue;

    const hasEvent = events.some(event =>
      event.action === 'wave.handoff' && event.payload?.handoff_path === handoffPath
    );
    if (hasEvent) continue;

    let parsed;
    try {
      parsed = parseHandoff(await fs.readFile(handoffAbs, 'utf8'));
    } catch {
      console.error(`[pinger] orphan handoff file ${handoffPath} is malformed; skipping repair.`);
      continue;
    }

    const machine = parsed.machine_fields;
    await appendEvent(path.join(projectDir, 'tasks', 'events.ndjson'), {
      session_id: sessionId(),
      agent: 'health-pinger',
      action: 'wave.handoff',
      outcome: 'success',
      wave: machine.source_wave,
      payload: {
        source_wave: machine.source_wave,
        next_wave: machine.next_wave,
        handoff_path: handoffPath,
        next_manifest: `tasks/waves/${machine.next_wave}/manifest.yaml`,
        handoff_token: machine.handoff_token,
        repaired: true,
        source_session_id: machine.source_session_id
      }
    });
    return;
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
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
