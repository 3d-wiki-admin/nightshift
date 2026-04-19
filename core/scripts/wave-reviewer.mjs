#!/usr/bin/env node
// wave-reviewer.mjs — background adversarial wave review (GPT-5.4, ≤60 min).
// Shells out to `codex exec` with the wave-review skill prompt. Writes
// tasks/waves/<N>/wave-review.md and emits wave.reviewed.
//
// Usage:
//   wave-reviewer.mjs <project-dir> <wave>
//   wave-reviewer.mjs poll <project-dir> <wave>       # report status

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { EventStore, sessionId as genSessionId } from '../event-store/src/index.mjs';
import { appendEvent } from './dispatch.mjs';

const WAVE_REVIEW_TIMEOUT_MS = 60 * 60 * 1000;
const REVIEW_MODEL = 'gpt-5.4';

function waveDir(project, wave) {
  return path.join(project, 'tasks', 'waves', String(wave));
}

async function pollStatus(project, wave) {
  const dir = waveDir(project, wave);
  const pidFile = path.join(dir, '.review.pid');
  const outFile = path.join(dir, 'wave-review.md');
  try {
    const pid = parseInt(await fs.readFile(pidFile, 'utf8'), 10);
    const alive = isProcessAlive(pid);
    const done = await fileExists(outFile);
    process.stdout.write(JSON.stringify({ pid, alive, done, wave, project }, null, 2) + '\n');
  } catch {
    process.stdout.write(JSON.stringify({ alive: false, done: await fileExists(outFile), wave, project }, null, 2) + '\n');
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function fileExists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function buildPrompt(project, wave) {
  const manifest = await fs.readFile(path.join(waveDir(project, wave), 'manifest.yaml'), 'utf8').catch(() => '');
  const constitution = await fs.readFile(path.join(project, 'memory', 'constitution.md'), 'utf8').catch(() => '');
  const plan = await fs.readFile(path.join(project, 'tasks', 'plan.md'), 'utf8').catch(() => '');
  return [
    '# You are the wave-reviewer.',
    '',
    'Follow core/skills/wave-review/SKILL.md verbatim.',
    '',
    '> Never mark a wave complete unless cross-task checks pass. Never fabricate evidence. NO LYING OR CHEATING.',
    '',
    `Wave: ${wave}`,
    `Project: ${project}`,
    '',
    '## constitution.md',
    constitution,
    '',
    '## plan.md',
    plan,
    '',
    '## manifest.yaml',
    manifest,
    '',
    'For each task in the manifest read: contract.md, result.md, review.md, evidence/diff.patch.',
    '',
    'Run (capture output into wave-review.md evidence blocks):',
    '- pnpm typecheck',
    '- pnpm build',
    '- bash scripts/smoke.sh',
    '',
    'Output MUST be a single file: tasks/waves/' + wave + '/wave-review.md',
    'Verdict: accept or revise. Include cross-task findings, architecture adherence, constitution adherence, aggregate gates, and a recommendation.'
  ].join('\n');
}

async function launch(project, wave) {
  const dir = waveDir(project, wave);
  await fs.mkdir(dir, { recursive: true });

  const prompt = await buildPrompt(project, wave);
  const promptPath = path.join(dir, '.review-prompt.md');
  await fs.writeFile(promptPath, prompt, 'utf8');

  const outFile = path.join(dir, 'wave-review.md');
  const logFile = path.join(dir, '.review.log');
  const pidFile = path.join(dir, '.review.pid');

  const args = [
    'exec',
    '--json',
    '--model', REVIEW_MODEL,
    '--prompt', promptPath,
    '--cwd', project,
    '--output', outFile
  ];

  const child = spawn('codex', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NIGHTSHIFT_WAVE_REVIEW: '1' },
    detached: true
  });
  await fs.writeFile(pidFile, String(child.pid), 'utf8');
  const stream = (await fs.open(logFile, 'a')).createWriteStream();
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  child.unref();

  const logPath = path.join(project, 'tasks', 'events.ndjson');
  const envSid = process.env.NIGHTSHIFT_SESSION_ID;
  const sid = envSid && /^sess_[0-9A-HJKMNP-TV-Z]{20,40}$/.test(envSid) ? envSid : genSessionId();
  await appendEvent(logPath, {
    session_id: sid,
    wave: Number(wave),
    agent: 'wave-reviewer',
    model: REVIEW_MODEL,
    action: 'wave.reviewed',
    outcome: 'success',
    payload: { started: true, pid: child.pid, timeout_ms: WAVE_REVIEW_TIMEOUT_MS }
  });

  process.stdout.write(JSON.stringify({ started: true, pid: child.pid, pidFile, outFile, logFile }, null, 2) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'poll') {
    await pollStatus(args[1], args[2]);
    return;
  }
  const project = args[0];
  const wave = args[1];
  if (!project || !wave) {
    console.error('Usage: wave-reviewer.mjs <project> <wave> | wave-reviewer.mjs poll <project> <wave>');
    process.exit(2);
  }
  await launch(project, wave);
}

main().catch(err => {
  console.error('[wave-reviewer] fatal:', err.message);
  process.exit(1);
});
