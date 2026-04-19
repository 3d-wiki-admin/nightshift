#!/usr/bin/env node
// provision.mjs — CLI for the infra-provisioner.
// Always runs in DRY-RUN by default. Pass --execute to actually create/rotate.
// Every action emits an infra.* event.
// The infra-provisioner skill prompt requires WebFetch of the adapter's docs URL
// before any --execute call; this script surfaces that URL for LLM to fetch.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventStore } from '../event-store/src/index.mjs';
import { makeProvisioner, listServices } from '../provisioners/index.mjs';
import { makeBackend } from '../secrets/index.mjs';

function parseArgs(argv) {
  const a = argv.slice(2);
  const args = { service: null, op: null, execute: false, project: null, params: {} };
  if (a[0] === 'rotate') {
    args.op = 'rotate';
    args.service = a[1];
    args.params.resourceId = a[2];
    args.params.key = a[3];
    args.execute = a.includes('--execute');
  } else if (a[0] === 'list') {
    args.op = 'list';
  } else if (a[0] === 'docs') {
    args.op = 'docs';
    args.service = a[1];
  } else {
    args.op = 'create';
    args.service = a[0];
    args.execute = a.includes('--execute');
    for (let i = 1; i < a.length; i++) {
      const tok = a[i];
      if (tok === '--execute') continue;
      if (tok.startsWith('--')) {
        const key = tok.slice(2);
        const next = a[i + 1];
        if (next && !next.startsWith('--')) { args.params[key] = next; i++; }
        else args.params[key] = true;
      }
    }
  }
  args.project = args.params.project || process.cwd();
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.op === 'list' || !args.op) {
    process.stdout.write(`Available services: ${listServices().join(', ')}\n`);
    process.stdout.write('Operations:\n');
    process.stdout.write('  provision.mjs <service> [--name <n>] [--<k> <v>]  (default: dry-run)\n');
    process.stdout.write('  provision.mjs <service> ... --execute            (actually create)\n');
    process.stdout.write('  provision.mjs rotate <service> <resourceId> <key> [--execute]\n');
    process.stdout.write('  provision.mjs docs <service>                     (print docs URL)\n');
    return;
  }

  const eventStore = new EventStore(path.join(args.project, 'tasks', 'events.ndjson'));
  const secrets = makeBackend();
  const p = makeProvisioner(args.service, { execute: args.execute, eventStore, secrets });

  if (args.op === 'docs') {
    const d = await p.docsUrl();
    process.stdout.write(JSON.stringify(d, null, 2) + '\n');
    return;
  }

  const pre = await p.preflight();
  if (!pre.ok) {
    process.stderr.write(`[provision] preflight failed for ${args.service}:\n`);
    for (const r of pre.reasons) process.stderr.write(`  - ${r}\n`);
    process.exit(3);
  }

  const docs = await p.docsUrl();
  process.stderr.write(`[provision] docs: ${docs.url}\n  ${docs.summary}\n`);

  if (args.op === 'create') {
    const result = await p.create(args.params);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.stderr.write(args.execute ? '[provision] created (live)\n' : '[provision] DRY-RUN only — pass --execute to create\n');
  } else if (args.op === 'rotate') {
    const result = await p.rotate(args.params.resourceId, args.params.key);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.stderr.write(args.execute ? '[provision] rotated (live)\n' : '[provision] DRY-RUN only — pass --execute to rotate\n');
  }
}

main().catch(err => {
  console.error(`[provision] fatal: ${err.message}`);
  process.exit(1);
});
