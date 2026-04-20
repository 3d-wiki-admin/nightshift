// memory/reuse-index.mjs — machine-readable reuse catalog.
//
// Shape:
//   {
//     schema_version: 1,
//     updated_at,
//     entries: [
//       { file, symbol, purpose, tags, safe_to_extend, examples }
//     ]
//   }
//
// Keyed by (file, symbol). Upserts replace the entry; list() filters by
// tag / purpose substring.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

function filePath(project) {
  return path.join(project, 'memory', 'reuse-index.json');
}

async function atomicWrite(p, content) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${Date.now()}`;
  await fs.writeFile(tmp, content);
  try { await fs.copyFile(p, `${p}.bak`); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  await fs.rename(tmp, p);
}

function blank() {
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    entries: []
  };
}

function assertSchema(parsed, label) {
  if (parsed == null) throw new Error(`${label}: null payload`);
  const v = Number(parsed.schema_version);
  if (Number.isInteger(v) && v > SCHEMA_VERSION) {
    throw new Error(`${label}: schema_version ${v} is newer than this binary (${SCHEMA_VERSION})`);
  }
  return parsed;
}

export async function read(project) {
  const p = filePath(project);
  let parsed;
  try {
    const text = await fs.readFile(p, 'utf8');
    parsed = JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return blank();
    try {
      const backup = await fs.readFile(`${p}.bak`, 'utf8');
      parsed = JSON.parse(backup);
    } catch {
      throw new Error(`reuse-index.json is corrupt and no .bak available: ${p}`);
    }
  }
  return assertSchema(parsed, `reuse-index.json (${p})`);
}

// Upsert by (file, symbol). Missing patch fields are preserved from the
// existing entry; pass null explicitly to clear.
export async function upsert(project, entry) {
  if (!entry || !entry.file || !entry.symbol) throw new Error('reuse-index.upsert: file+symbol required');
  const state = await read(project);
  const idx = state.entries.findIndex(e => e.file === entry.file && e.symbol === entry.symbol);
  const merged = {
    file: entry.file,
    symbol: entry.symbol,
    purpose: entry.purpose ?? (idx >= 0 ? state.entries[idx].purpose : null),
    tags: entry.tags ?? (idx >= 0 ? state.entries[idx].tags : []),
    safe_to_extend: entry.safe_to_extend ?? (idx >= 0 ? state.entries[idx].safe_to_extend : null),
    examples: entry.examples ?? (idx >= 0 ? state.entries[idx].examples : [])
  };
  if (idx >= 0) state.entries[idx] = merged;
  else state.entries.push(merged);
  state.updated_at = new Date().toISOString();
  await atomicWrite(filePath(project), JSON.stringify(state, null, 2) + '\n');
  return merged;
}

export async function list(project, { tag = null, purposeIncludes = null, fileIncludes = null } = {}) {
  const state = await read(project);
  return state.entries.filter(e => {
    if (tag && !(e.tags || []).includes(tag)) return false;
    if (purposeIncludes && !(e.purpose || '').toLowerCase().includes(purposeIncludes.toLowerCase())) return false;
    if (fileIncludes && !e.file.toLowerCase().includes(fileIncludes.toLowerCase())) return false;
    return true;
  });
}

export async function remove(project, file, symbol) {
  const state = await read(project);
  state.entries = state.entries.filter(e => !(e.file === file && e.symbol === symbol));
  state.updated_at = new Date().toISOString();
  await atomicWrite(filePath(project), JSON.stringify(state, null, 2) + '\n');
}
