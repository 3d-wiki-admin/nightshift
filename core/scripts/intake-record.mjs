#!/usr/bin/env node
// intake-record.mjs — helper for the intake-interview subagent to append
// safely to <project>/.nightshift/intake.ndjson. Centralizes the record
// shape + ISO timestamp + schema_version so the agent prompt doesn't have
// to reconstruct it every turn.
//
// Usage:
//   nightshift intake-record <project> q   --n 1 --question "..." --answer "..."
//   nightshift intake-record <project> proposal --json '<proposal json>'
//   nightshift intake-record <project> approve-last
//   nightshift intake-record <project> revision --notes "..."
//   nightshift intake-record <project> abort [--reason "..."]
//
// Always appends one line. `approve-last` rewrites the last `kind=proposal`
// line to set approved=true in-place (temp+rename for atomicity).

import { promises as fs } from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = 1;

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

async function readProjectId(project) {
  try {
    const text = await fs.readFile(path.join(project, '.nightshift', 'intake-pending'), 'utf8');
    const m = text.match(/^project_id=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

async function atomicWrite(filePath, text) {
  const tmp = `${filePath}.tmp-${Date.now()}`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, filePath);
}

async function appendLine(logPath, obj) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const line = JSON.stringify(obj) + '\n';
  await fs.appendFile(logPath, line, 'utf8');
}

async function main() {
  const [project, subcommand, ...rest] = process.argv.slice(2);
  if (!project || !subcommand) {
    process.stderr.write(`
Usage: intake-record <project> <subcommand> [flags]

Subcommands:
  q           --n <int> --question "..." --answer "..."
  proposal    --json '<proposal json>'
  approve-last
  revision    --notes "..."
  abort       [--reason "..."]
    `.trim() + '\n');
    process.exit(2);
  }
  const logPath = path.join(project, '.nightshift', 'intake.ndjson');
  const projectId = await readProjectId(project);
  const ts = new Date().toISOString();
  const flags = parseFlags(rest);

  switch (subcommand) {
    case 'q': {
      const n = Number(flags.n);
      if (!Number.isInteger(n) || n < 1) throw new Error('q requires --n <positive int>');
      if (!flags.question) throw new Error('q requires --question');
      if (!flags.answer) throw new Error('q requires --answer');
      await appendLine(logPath, { schema_version: SCHEMA_VERSION, kind: 'q', ts, project_id: projectId, n, question: flags.question, answer: flags.answer });
      process.stdout.write('ok\n');
      return;
    }
    case 'proposal': {
      if (!flags.json) throw new Error('proposal requires --json "<proposal object>"');
      const parsed = JSON.parse(flags.json);
      await appendLine(logPath, {
        schema_version: SCHEMA_VERSION,
        kind: 'proposal',
        ts,
        project_id: projectId,
        approved: null,
        ...parsed
      });
      process.stdout.write('ok\n');
      return;
    }
    case 'approve-last': {
      const raw = await fs.readFile(logPath, 'utf8').catch(() => '');
      const lines = raw.split('\n');
      let updated = false;
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].trim();
        if (!l) continue;
        try {
          const e = JSON.parse(l);
          if (e.kind === 'proposal') {
            e.approved = true;
            e.approved_at = ts;
            lines[i] = JSON.stringify(e);
            updated = true;
            break;
          }
        } catch { /* ignore */ }
      }
      if (!updated) throw new Error('approve-last: no prior kind=proposal line found — run "proposal" first');
      await atomicWrite(logPath, lines.join('\n'));
      process.stdout.write('ok\n');
      return;
    }
    case 'revision': {
      await appendLine(logPath, {
        schema_version: SCHEMA_VERSION,
        kind: 'revision',
        ts,
        project_id: projectId,
        notes: flags.notes || null
      });
      process.stdout.write('ok\n');
      return;
    }
    case 'abort': {
      await appendLine(logPath, {
        schema_version: SCHEMA_VERSION,
        kind: 'abort',
        ts,
        project_id: projectId,
        reason: flags.reason || null
      });
      process.stdout.write('ok\n');
      return;
    }
    default:
      throw new Error(`unknown subcommand '${subcommand}'`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('[intake-record]', err.message); process.exit(1); });
}
