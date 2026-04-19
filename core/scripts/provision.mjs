#!/usr/bin/env node
// provision.mjs — CLI for the infra-provisioner.
// Always runs in DRY-RUN by default. Pass --execute to actually create/rotate.
// Every action emits an infra.* event.
// --execute REQUIRES --for-task <TASK-ID> AND a matching decision.recorded event
// in the project's tasks/events.ndjson. This enforces spec §15 approval-required
// workflow at code level (not just in the agent prompt).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventStore } from '../event-store/src/index.mjs';
import { appendEvent } from './dispatch.mjs';
import { makeProvisioner, listServices } from '../provisioners/index.mjs';
import { makeBackend } from '../secrets/index.mjs';
import { resolveSessionId } from '../provisioners/interface.mjs';

function parseArgs(argv) {
  const a = argv.slice(2);
  const args = { service: null, op: null, execute: false, project: null, forTask: null, params: {} };
  const pullFlag = (name) => {
    const i = a.indexOf(`--${name}`);
    if (i < 0) return null;
    const val = a[i + 1];
    a.splice(i, 2);
    return val;
  };
  const forTask = pullFlag('for-task');
  if (forTask) args.forTask = forTask;
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

// Approval gate (§15). Returns { ok, reason, approvalEvent }.
export async function checkApproval(project, forTask) {
  if (!forTask) {
    return { ok: false, reason: '--execute requires --for-task <TASK-ID> (spec §15 approval gate)' };
  }
  const store = new EventStore(path.join(project, 'tasks', 'events.ndjson'));
  const events = await store.all();
  for (const e of events) {
    if (e.action !== 'decision.recorded') continue;
    if (e.payload?.task_id === forTask) {
      return { ok: true, reason: null, approvalEvent: e };
    }
  }
  return { ok: false, reason: `no decision.recorded event found with payload.task_id="${forTask}"` };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.op === 'list' || !args.op) {
    process.stdout.write(`Available services: ${listServices().join(', ')}\n`);
    process.stdout.write('Operations:\n');
    process.stdout.write('  provision.mjs <service> [--name <n>] [--<k> <v>]           (default: dry-run)\n');
    process.stdout.write('  provision.mjs <service> ... --execute --for-task <TASK>   (requires recorded approval)\n');
    process.stdout.write('  provision.mjs rotate <service> <resourceId> <key> [--execute --for-task <TASK>]\n');
    process.stdout.write('  provision.mjs docs <service>                              (print docs URL)\n');
    return;
  }

  if (args.execute) {
    const check = await checkApproval(args.project, args.forTask);
    if (!check.ok) {
      const logPath = path.join(args.project, 'tasks', 'events.ndjson');
      try {
        await appendEvent(logPath, {
          session_id: resolveSessionId(),
          task_id: args.forTask || null,
          agent: 'system',
          action: 'guard.violation',
          payload: { kind: 'provision_execute_without_approval', service: args.service, op: args.op, reason: check.reason }
        });
      } catch { /* log may not exist in fresh projects; still refuse */ }
      process.stderr.write(`[provision] refusing --execute: ${check.reason}\n`);
      process.exit(4);
    }
  }

  const logPath = path.join(args.project, 'tasks', 'events.ndjson');
  const secrets = makeBackend();
  const p = makeProvisioner(args.service, { execute: args.execute, logPath, secrets });

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
    process.stderr.write(args.execute ? '[provision] created (live)\n' : '[provision] DRY-RUN only — pass --execute (with --for-task) to create\n');
  } else if (args.op === 'rotate') {
    const result = await p.rotate(args.params.resourceId, args.params.key);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.stderr.write(args.execute ? '[provision] rotated (live)\n' : '[provision] DRY-RUN only — pass --execute (with --for-task) to rotate\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(`[provision] fatal: ${err.message}`);
    process.exit(1);
  });
}
