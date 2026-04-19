#!/usr/bin/env node
// infra-audit.mjs — filter events.ndjson → infra-audit.ndjson (subset view).
// Keeps only infra.provisioned | infra.rotated | infra.deleted_requested events
// plus question.asked / decision.recorded for approval-required tasks.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventStore } from '../event-store/src/index.mjs';

const KEEP = new Set([
  'infra.provisioned',
  'infra.rotated',
  'infra.deleted_requested',
  'question.asked',
  'decision.recorded'
]);

async function main() {
  const projectDir = process.argv[2] || process.cwd();
  const log = path.join(projectDir, 'tasks', 'events.ndjson');
  const out = path.join(projectDir, 'tasks', 'infra-audit.ndjson');

  const store = new EventStore(log);
  const events = await store.all();
  const subset = events.filter(e => KEEP.has(e.action));

  await fs.writeFile(out, subset.map(e => JSON.stringify(e)).join('\n') + (subset.length ? '\n' : ''), 'utf8');
  process.stderr.write(`[infra-audit] wrote ${subset.length}/${events.length} events to ${out}\n`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
