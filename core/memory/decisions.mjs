// memory/decisions.mjs — append-only log of architectural decisions.
//
// Shape per line (JSON):
//   { schema_version, id, ts, kind, subject, answer, source, wave, task,
//     supersedes, notes }
//
// kind examples:
//   architecture  — "use RSC for dashboard", "supabase RLS not row-level-secret"
//   stack         — "switch to Neon Postgres"
//   policy        — "every API route has Zod schemas"
//   approval      — approve-required task approval payloads
//
// Reads return newest-first by default so retrieval lands on the latest
// decision first.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const SCHEMA_VERSION = 1;

function newId() {
  return 'dec_' + randomBytes(6).toString('hex');
}

function logPath(project) {
  return path.join(project, 'memory', 'decisions.ndjson');
}

export async function append(project, entry) {
  if (!entry || !entry.subject) throw new Error('decisions.append: subject is required');
  const row = {
    schema_version: SCHEMA_VERSION,
    id: entry.id || newId(),
    ts: entry.ts || new Date().toISOString(),
    kind: entry.kind || 'architecture',
    subject: entry.subject,
    answer: entry.answer || null,
    source: entry.source || null,
    wave: entry.wave ?? null,
    task: entry.task || null,
    supersedes: entry.supersedes || null,
    notes: entry.notes || null
  };
  const p = logPath(project);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(row) + '\n', 'utf8');
  return row;
}

export async function list(project, { limit = null, kind = null, newest = true, subjectIncludes = null } = {}) {
  const p = logPath(project);
  let text;
  try { text = await fs.readFile(p, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  let out = [];
  for (const l of text.split('\n')) {
    const line = l.trim();
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (kind && e.kind !== kind) continue;
      if (subjectIncludes && !e.subject.toLowerCase().includes(subjectIncludes.toLowerCase())) continue;
      out.push(e);
    } catch { /* skip corrupt */ }
  }
  if (newest) out.reverse();
  if (limit != null) out = out.slice(0, limit);
  return out;
}

export async function latestBySubject(project, subject) {
  const all = await list(project, { newest: true });
  return all.find(e => e.subject === subject) || null;
}
