#!/usr/bin/env node
// nightshift-init.mjs — minimal scaffold for `nightshift init <path>`.
//
// Contract (v1.1 ТЗ §5.2):
//   1. Run doctor preflight.
//   2. Register the project in ~/.nightshift/registry at stage=intake.
//   3. Create ONLY minimal meta scaffold:
//        .nightshift/intake-pending     — marker (key=value)
//        .nightshift/intake.ndjson      — empty, for intake-interview to write into
//        tasks/events.ndjson            — empty canonical log
//        NIGHTSHIFT.md                  — one-screen pointer at the intake flow
//   4. Return a small object { project_id, next_command } so the CLI can echo
//      the one command the user should paste into Claude.
//
// Explicitly does NOT scaffold memory/constitution.md, tasks/spec.md, template
// files, CI, or launchd here. Those happen only after approval
// (nightshift-scaffold.mjs, Wave B.3).

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { Registry } from '../registry/index.mjs';
import { appendEvent } from './dispatch.mjs';
import { sessionId as genSessionId } from '../event-store/src/id.mjs';

export class InitError extends Error {
  constructor(msg, { code = 'INIT_ERROR', hint = null } = {}) {
    super(msg);
    this.name = 'InitError';
    this.code = code;
    this.hint = hint;
  }
}

async function pathIsEmpty(p) {
  try {
    const entries = await fs.readdir(p);
    return entries.length === 0;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

export async function init(projectPath, {
  force = false,
  registryRoot,
  autoCheckpoint = false
} = {}) {
  if (!projectPath) {
    throw new InitError('project path is required', { code: 'MISSING_PATH' });
  }
  const abs = path.resolve(projectPath);

  // 1. Refuse to overwrite an already-scaffolded target unless --force.
  const existingConstitution = path.join(abs, 'memory', 'constitution.md');
  const alreadyHasConstitution = await fs.access(existingConstitution).then(() => true, () => false);
  if (alreadyHasConstitution && !force) {
    throw new InitError(
      `${abs} already has memory/constitution.md — looks fully scaffolded.`,
      {
        code: 'ALREADY_SCAFFOLDED',
        hint: 'Pass --force to re-register this path, or delete memory/constitution.md first.'
      }
    );
  }

  // 2. Create root + register in the registry at stage=intake.
  await fs.mkdir(abs, { recursive: true });
  const reg = new Registry(registryRoot ? { root: registryRoot } : {});
  const record = await reg.register({
    path: abs,
    name: path.basename(abs),
    stage: 'intake'
  });

  // 3. Minimal meta scaffold. We do not touch template files yet.
  await fs.mkdir(path.join(abs, '.nightshift'), { recursive: true });
  await fs.mkdir(path.join(abs, 'tasks'), { recursive: true });

  const markerPath = path.join(abs, '.nightshift', 'intake-pending');
  const marker = [
    `project_id=${record.project_id}`,
    `project_name=${record.name}`,
    `project_path=${abs}`,
    `registered_at=${record.created_at}`,
    `status=intake`
  ].join('\n') + '\n';
  await fs.writeFile(markerPath, marker, 'utf8');

  // The intake-interview subagent appends question/answer lines here.
  const intakeLog = path.join(abs, '.nightshift', 'intake.ndjson');
  await fs.writeFile(intakeLog, '', 'utf8');

  const logPath = path.join(abs, 'tasks', 'events.ndjson');
  await fs.writeFile(logPath, '', 'utf8');

  // NIGHTSHIFT.md — short pointer at the flow, not a replacement for docs.
  const nextCommand = `/nightshift intake --project ${abs}`;
  const nightshiftMd = [
    `# ${record.name} — nightshift managed`,
    '',
    'Status: **intake pending**. No code scaffolded yet — that happens AFTER approval.',
    '',
    '## Next step',
    '',
    '1. Open Claude Code in this directory:',
    '   ```',
    '   cd ' + abs,
    '   claude',
    '   ```',
    '2. In the Claude session, paste:',
    '   ```',
    '   ' + nextCommand,
    '   ```',
    '3. Answer the 6 intake questions, review the proposed plan, confirm.',
    '4. Nightshift will scaffold the project, wire CI, and hand back control for `/plan`.',
    '',
    '## Files created so far',
    '- `.nightshift/intake-pending`   — marker (registry id, status)',
    '- `.nightshift/intake.ndjson`    — intake-interview will log Q/A here',
    '- `tasks/events.ndjson`          — canonical event log (empty)',
    '- `NIGHTSHIFT.md`                — this file',
    '',
    '## Registry record',
    `- project_id: \`${record.project_id}\``,
    `- stage: ${record.stage}`,
    `- registered_at: ${record.created_at}`,
    '',
    'If you cancel the intake, re-running `nightshift init` is idempotent:',
    'it updates the registry and leaves your project dir alone.',
    ''
  ].join('\n');
  await fs.writeFile(path.join(abs, 'NIGHTSHIFT.md'), nightshiftMd, 'utf8');

  // First event in the canonical log — session.start for the intake phase.
  // We set project name so /status shows it cleanly.
  const sid = genSessionId();
  const env = process.env.NIGHTSHIFT_AUTO_CHECKPOINT;
  if (!autoCheckpoint) process.env.NIGHTSHIFT_AUTO_CHECKPOINT = '0';
  try {
    await appendEvent(logPath, {
      session_id: sid,
      agent: 'orchestrator',
      action: 'session.start',
      payload: {
        project: record.name,
        project_id: record.project_id,
        stage: 'intake'
      },
      notes: 'nightshift init — intake stage'
    });
  } finally {
    if (!autoCheckpoint) {
      if (env == null) delete process.env.NIGHTSHIFT_AUTO_CHECKPOINT;
      else process.env.NIGHTSHIFT_AUTO_CHECKPOINT = env;
    }
  }

  return {
    project_id: record.project_id,
    project_path: abs,
    project_name: record.name,
    stage: record.stage,
    registered_at: record.created_at,
    next_command: nextCommand,
    files_created: [
      '.nightshift/intake-pending',
      '.nightshift/intake.ndjson',
      'tasks/events.ndjson',
      'NIGHTSHIFT.md'
    ]
  };
}

function formatSummary(result) {
  // TZ fix-batch P1.1: user gets ONE command to copy-paste. Shell does the
  // cd, then launches claude with the intake slash-command in one go. No
  // three-step "open claude, then paste, then…" dance.
  const oneCommand = `cd ${result.project_path} && claude "${result.next_command}"`;
  return [
    '',
    `  ✓ doctor prerequisites satisfied`,
    `  ✓ project registered     ${result.project_id}`,
    `  ✓ minimal meta scaffold  (4 files)`,
    `  — full scaffold will run AFTER intake approval`,
    '',
    `Project:  ${result.project_path}`,
    `Stage:    ${result.stage}`,
    '',
    `Next (copy-paste one command):`,
    `  ${oneCommand}`,
    ''
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '-h' || args[0] === '--help' || !args[0]) {
    process.stderr.write(`
Usage: nightshift-init.mjs <project-path> [--force] [--json] [--claude-now]

Registers <project-path> in the global nightshift registry (stage=intake) and
writes a minimal meta scaffold. Does NOT create memory/constitution.md or
template files — those only appear after the intake interview is approved.

Flags:
  --force        re-register a path whose memory/constitution.md already exists
  --json         machine-readable output
  --claude-now   after init, exec \`claude "/nightshift intake --project <path>"\`
                 in the project dir — user gets straight into the interview
    `.trim() + '\n');
    process.exit(args[0] ? 0 : 2);
  }
  const projectPath = args[0];
  const force = args.includes('--force');
  const json = args.includes('--json');
  const claudeNow = args.includes('--claude-now');
  try {
    const result = await init(projectPath, { force });
    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(formatSummary(result));
    }
    if (claudeNow) {
      // Replace this process with `claude <next_command>` in the project
      // dir — user doesn't have to copy anything. If claude is missing we
      // fall back to the printed summary (non-fatal).
      process.stdout.write(`\n[nightshift init] --claude-now: launching claude "${result.next_command}"...\n`);
      const child = spawn('claude', [result.next_command], {
        cwd: result.project_path,
        stdio: 'inherit'
      });
      child.on('error', err => {
        process.stderr.write(`[nightshift init] could not launch claude: ${err.message}. Paste the command above manually.\n`);
        process.exit(0);
      });
      child.on('exit', code => process.exit(code || 0));
      return;
    }
  } catch (err) {
    if (err instanceof InitError) {
      process.stderr.write(`nightshift init: ${err.message}\n`);
      if (err.hint) process.stderr.write(`  hint: ${err.hint}\n`);
      process.exit(err.code === 'ALREADY_SCAFFOLDED' ? 3 : 2);
    }
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('[nightshift init] fatal:', err.message); process.exit(1); });
}
