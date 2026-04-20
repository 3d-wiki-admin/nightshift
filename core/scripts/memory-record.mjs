#!/usr/bin/env node
// memory-record.mjs — CLI for agents to append memory entries safely.
//
// Usage:
//   nightshift memory-record <project> decision --subject "..." [--answer "..."] [--kind ...] [--source ...] [--wave N] [--task TASK] [--supersedes dec_...] [--notes "..."]
//   nightshift memory-record <project> incident --symptom "..." [--root-cause "..."] [--fix "..."] [--task T] [--wave N] [--evidence "..."] [--prevented-by dec_...]
//   nightshift memory-record <project> service --provider vercel --patch '{"project_id":"...","preview_url":"..."}'
//   nightshift memory-record <project> service-unset --provider vercel --field preview_url
//   nightshift memory-record <project> service-remove --provider vercel
//   nightshift memory-record <project> reuse --file "lib/x.ts" --symbol "foo" [--purpose "..."] [--tags "auth,ssr"] [--safe-to-extend true|false]
//   nightshift memory-record <project> reuse-remove --file "lib/x.ts" --symbol "foo"

import * as m from '../memory/index.mjs';

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function die(msg) { process.stderr.write(`memory-record: ${msg}\n`); process.exit(2); }

async function main() {
  const [project, subcommand, ...rest] = process.argv.slice(2);
  if (!project || !subcommand) {
    process.stderr.write(`Usage: memory-record <project> <subcommand> [flags]\nSubcommands: decision | incident | service | service-unset | service-remove | reuse | reuse-remove\n`);
    process.exit(2);
  }
  const f = parseFlags(rest);
  switch (subcommand) {
    case 'decision': {
      if (!f.subject) die('decision requires --subject');
      const row = await m.decisions.append(project, {
        subject: f.subject,
        answer: f.answer || null,
        kind: f.kind || 'architecture',
        source: f.source || null,
        wave: f.wave != null ? Number(f.wave) : null,
        task: f.task || null,
        supersedes: f.supersedes || null,
        notes: f.notes || null
      });
      process.stdout.write(JSON.stringify(row) + '\n');
      return;
    }
    case 'incident': {
      if (!f.symptom) die('incident requires --symptom');
      const row = await m.incidents.append(project, {
        symptom: f.symptom,
        root_cause: f['root-cause'] || null,
        fix: f.fix || null,
        task: f.task || null,
        wave: f.wave != null ? Number(f.wave) : null,
        evidence: f.evidence || null,
        prevented_by: f['prevented-by'] || null
      });
      process.stdout.write(JSON.stringify(row) + '\n');
      return;
    }
    case 'service': {
      if (!f.provider) die('service requires --provider');
      if (!f.patch) die('service requires --patch (JSON string)');
      const patch = JSON.parse(f.patch);
      const merged = await m.services.setProvider(project, f.provider, patch);
      process.stdout.write(JSON.stringify(merged) + '\n');
      return;
    }
    case 'service-unset': {
      if (!f.provider || !f.field) die('service-unset requires --provider and --field');
      await m.services.unsetProviderField(project, f.provider, f.field);
      process.stdout.write('ok\n');
      return;
    }
    case 'service-remove': {
      if (!f.provider) die('service-remove requires --provider');
      await m.services.removeProvider(project, f.provider);
      process.stdout.write('ok\n');
      return;
    }
    case 'reuse': {
      if (!f.file || !f.symbol) die('reuse requires --file and --symbol');
      const tags = f.tags ? String(f.tags).split(',').map(s => s.trim()).filter(Boolean) : undefined;
      const entry = await m.reuseIndex.upsert(project, {
        file: f.file,
        symbol: f.symbol,
        purpose: f.purpose ?? undefined,
        tags,
        safe_to_extend: f['safe-to-extend'] != null ? (f['safe-to-extend'] === 'true' || f['safe-to-extend'] === true) : undefined
      });
      process.stdout.write(JSON.stringify(entry) + '\n');
      return;
    }
    case 'reuse-remove': {
      if (!f.file || !f.symbol) die('reuse-remove requires --file and --symbol');
      await m.reuseIndex.remove(project, f.file, f.symbol);
      process.stdout.write('ok\n');
      return;
    }
    default:
      die(`unknown subcommand '${subcommand}'`);
  }
}

main().catch(err => { process.stderr.write(`memory-record: ${err.message}\n`); process.exit(1); });
