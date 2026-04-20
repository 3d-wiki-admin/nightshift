// memory/incidents.mjs — append-only log of project incidents.
//
// Shape per line:
//   { schema_version, id, ts, symptom, task, wave, root_cause, fix,
//     evidence, prevented_by }
//
// Used by the orchestrator + reviewers to avoid re-stepping on prior rakes.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const SCHEMA_VERSION = 1;

function newId() { return 'inc_' + randomBytes(6).toString('hex'); }

function logPath(project) {
  return path.join(project, 'memory', 'incidents.ndjson');
}

export async function append(project, entry) {
  if (!entry || !entry.symptom) throw new Error('incidents.append: symptom is required');
  const row = {
    schema_version: SCHEMA_VERSION,
    id: entry.id || newId(),
    ts: entry.ts || new Date().toISOString(),
    symptom: entry.symptom,
    task: entry.task || null,
    wave: entry.wave ?? null,
    root_cause: entry.root_cause || null,
    fix: entry.fix || null,
    evidence: entry.evidence || null,
    prevented_by: entry.prevented_by || null
  };
  const p = logPath(project);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(row) + '\n', 'utf8');
  return row;
}

export async function list(project, { limit = null, newest = true, symptomIncludes = null } = {}) {
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
      if (symptomIncludes && !e.symptom.toLowerCase().includes(symptomIncludes.toLowerCase())) continue;
      out.push(e);
    } catch { /* skip */ }
  }
  if (newest) out.reverse();
  if (limit != null) out = out.slice(0, limit);
  return out;
}
