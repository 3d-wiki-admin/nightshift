#!/usr/bin/env node
// post-sync-docs.mjs — append FEATURE_INDEX.md + REUSE_FUNCTIONS.md entries
// after a task.accepted event so those indices stay in step even if the
// orchestrator didn't explicitly invoke the doc-syncer subagent.
//
// Idempotent: will not add a row that already exists.
//
// Usage:
//   post-sync-docs.mjs <project-dir>

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventStore } from '../event-store/src/index.mjs';

function parseYamlFrontmatter(md) {
  const m = md.match(/```yaml\s*\n([\s\S]*?)```/);
  if (!m) return {};
  const out = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trimEnd();
    // Flat top-level key: value
    const kv = line.match(/^([a-z_][a-z0-9_]*):\s*(.+)$/i);
    if (kv && !kv[2].trim().startsWith('|') && !kv[2].trim().startsWith('>') ) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  // Nested goal.objective — look for under `goal:` then `  objective:`.
  const goalBlock = md.match(/```yaml[\s\S]*?\ngoal:\s*\n([\s\S]*?)(?=\n\S|```)/);
  if (goalBlock) {
    const obj = goalBlock[1].match(/^\s+objective:\s*(.+)$/m);
    if (obj) out.objective = obj[1].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function parseFilesChanged(resultMd) {
  if (!resultMd) return [];
  const lines = resultMd.split(/\r?\n/);
  let inSection = false;
  const out = [];
  for (const l of lines) {
    if (/^##\s+Files changed/i.test(l)) { inSection = true; continue; }
    if (inSection) {
      if (/^##\s/.test(l)) break;
      const m = l.match(/^\s*-\s+([^\s(]+)/);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

function parseExportsFromDiff(diffText) {
  if (!diffText) return [];
  const out = [];
  const lines = diffText.split(/\r?\n/);
  let currentFile = null;
  for (const l of lines) {
    const fileMatch = l.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) { currentFile = fileMatch[1]; continue; }
    if (!currentFile || !l.startsWith('+')) continue;
    const body = l.slice(1);
    const fn = body.match(/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (fn) { out.push({ file: currentFile, symbol: fn[1], kind: 'function' }); continue; }
    const cls = body.match(/^\s*export\s+class\s+([A-Za-z_$][\w$]*)/);
    if (cls) { out.push({ file: currentFile, symbol: cls[1], kind: 'class' }); continue; }
    const cn = body.match(/^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=/);
    if (cn) { out.push({ file: currentFile, symbol: cn[1], kind: 'const' }); continue; }
  }
  return out;
}

async function readIfExists(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

async function appendRowIfNew(filePath, row, existingPattern) {
  const text = (await readIfExists(filePath)) ?? '';
  if (existingPattern && existingPattern.test(text)) return false;
  let updated = text;
  if (!text.endsWith('\n') && text.length > 0) updated += '\n';
  updated += row + '\n';
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, updated, 'utf8');
  return true;
}

export async function runOnce(projectDir) {
  const logPath = path.join(projectDir, 'tasks', 'events.ndjson');
  const store = new EventStore(logPath);
  const events = await store.all();
  const lastAccepted = [...events].reverse().find(e => e.action === 'task.accepted');
  if (!lastAccepted) return { status: 'no_accepted_task' };

  const taskId = lastAccepted.task_id;
  const wave = lastAccepted.wave;
  if (!taskId) return { status: 'no_task_id' };

  const taskDir = wave != null
    ? path.join(projectDir, 'tasks', 'waves', String(wave), taskId)
    : path.join(projectDir, 'tasks', 'micro', taskId);

  const contractMd = await readIfExists(path.join(taskDir, 'contract.md'));
  const resultMd   = await readIfExists(path.join(taskDir, 'result.md'));
  const diffPatch  = await readIfExists(path.join(taskDir, 'evidence', 'diff.patch'));

  const contract = parseYamlFrontmatter(contractMd || '');
  const goal = contract.objective || '(unspecified)';
  const files = parseFilesChanged(resultMd || '');
  const entryPoint = files[0] || '(unknown)';

  const featureIndex = path.join(projectDir, 'tasks', 'contracts', 'FEATURE_INDEX.md');
  const reuseFunctions = path.join(projectDir, 'tasks', 'contracts', 'REUSE_FUNCTIONS.md');

  const featureRow = `| ${taskId} | ${goal} | ${entryPoint} |`;
  const featureAdded = await appendRowIfNew(
    featureIndex,
    featureRow,
    new RegExp(`\\|\\s*${taskId}\\s*\\|`)
  );

  const exports = parseExportsFromDiff(diffPatch || '');
  const reuseAdded = [];
  for (const ex of exports) {
    const row = `| \`${ex.file}\` | \`${ex.symbol}\` | added by ${taskId} (${ex.kind}) |`;
    const added = await appendRowIfNew(
      reuseFunctions,
      row,
      new RegExp(`\`${escapeRegex(ex.file)}\`\\s*\\|\\s*\`${escapeRegex(ex.symbol)}\``)
    );
    if (added) reuseAdded.push(`${ex.file}:${ex.symbol}`);
  }

  return {
    status: 'synced',
    task_id: taskId,
    wave,
    feature_index_updated: featureAdded,
    reuse_functions_updated: reuseAdded
  };
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function main() {
  const projectDir = process.argv[2] || process.cwd();
  const result = await runOnce(projectDir);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('[post-sync-docs] fatal:', err.message); process.exit(1); });
}
