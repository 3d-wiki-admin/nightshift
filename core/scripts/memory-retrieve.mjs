#!/usr/bin/env node
// memory-retrieve.mjs — CLI for context-packer / plan-writer / orchestrator
// to pull structured slices of the project's retrieval memory.
//
// Usage:
//   nightshift memory-retrieve <project> [--query "..."] [--decisions-limit N]
//                              [--incidents-limit N] [--reuse-tag TAG]
//                              [--include decisions,incidents,services,reuse] [--markdown]
//
// Without --markdown, prints a single JSON object.
// With --markdown, prints a compact markdown block suitable for inlining
// into a context-pack.

import { readAll } from '../memory/index.mjs';

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

function toMarkdown(slice, { query }) {
  const lines = [];
  lines.push('## Memory retrieval');
  if (query) lines.push(`_query:_ \`${query}\``);
  lines.push('');

  lines.push(`### decisions (${slice.decisions.length})`);
  if (!slice.decisions.length) lines.push('_(none matching)_');
  for (const d of slice.decisions) {
    const date = d.ts.slice(0, 10);
    lines.push(`- **${d.subject}** — ${d.answer || '_(no answer)_'}  \`[${d.kind}]\` _${date}_${d.task ? ` · task ${d.task}` : ''}`);
  }
  lines.push('');

  lines.push(`### incidents (${slice.incidents.length})`);
  if (!slice.incidents.length) lines.push('_(none matching)_');
  for (const i of slice.incidents) {
    const date = i.ts.slice(0, 10);
    lines.push(`- **${i.symptom}**${i.root_cause ? ` — ${i.root_cause}` : ''}  ${i.fix ? `_(fix: ${i.fix})_` : ''} _${date}_`);
  }
  lines.push('');

  lines.push('### services');
  const providers = Object.entries(slice.services.providers || {});
  if (!providers.length) lines.push('_(none registered yet)_');
  for (const [name, p] of providers) {
    const fields = Object.entries(p).filter(([k]) => !k.toLowerCase().includes('secret')).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    lines.push(`- **${name}** — ${fields.join(', ')}`);
  }
  lines.push('');

  lines.push(`### reuse candidates (${slice.reuse_index.length})`);
  if (!slice.reuse_index.length) lines.push('_(none matching)_');
  for (const r of slice.reuse_index) {
    const tags = r.tags?.length ? ` \`[${r.tags.join(', ')}]\`` : '';
    lines.push(`- \`${r.file}:${r.symbol}\` — ${r.purpose || '_(no purpose)_'}${tags}`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const [project, ...rest] = process.argv.slice(2);
  if (!project) {
    process.stderr.write('Usage: memory-retrieve <project> [--query "..."] [--markdown] [--include ...]\n');
    process.exit(2);
  }
  const f = parseFlags(rest);
  const include = (f.include ? String(f.include) : 'decisions,incidents,services,reuse').split(',').map(s => s.trim());

  const slice = await readAll(project, {
    query: f.query || null,
    decisionsLimit: f['decisions-limit'] != null ? Number(f['decisions-limit']) : 20,
    incidentsLimit: f['incidents-limit'] != null ? Number(f['incidents-limit']) : 10,
    reuseTag: f['reuse-tag'] || null
  });

  const filtered = {
    decisions: include.includes('decisions') ? slice.decisions : [],
    incidents: include.includes('incidents') ? slice.incidents : [],
    services: include.includes('services') ? slice.services : { providers: {} },
    reuse_index: include.includes('reuse') ? slice.reuse_index : []
  };

  if (f.markdown) {
    process.stdout.write(toMarkdown(filtered, { query: f.query || null }));
  } else {
    process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
  }
}

main().catch(err => { process.stderr.write(`memory-retrieve: ${err.message}\n`); process.exit(1); });
