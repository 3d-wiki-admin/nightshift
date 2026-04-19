#!/usr/bin/env node
// dispatch.mjs — the ONLY writer to events.ndjson.
// Wraps agent invocations (Claude Task tool via bridge file, or `codex exec --json`)
// with: preflight, event append (contracted/dispatched/implemented/reviewed), token accounting,
// evidence path tagging, and timeout handling.
//
// Usage:
//   node dispatch.mjs <subcommand> [flags]
//
// Subcommands:
//   append                 Append one event from stdin (JSON). Fills event_id/ts if missing.
//   replay                 Shortcut to replay-events.mjs --write.
//   codex <task.json>      Dispatch a task to `codex exec` and record lifecycle events.
//   quote <model>          Estimate USD cost from {input,output,cached} via costs.json.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventStore } from '../event-store/src/index.mjs';

const COSTS_PATH = new URL('../schemas/costs.json', import.meta.url);

async function loadCosts() {
  return JSON.parse(await fs.readFile(COSTS_PATH, 'utf8'));
}

// Single public write entry for events.ndjson. All non-test callers must use this
// instead of EventStore.append directly, so cost estimation and future invariants
// (reviewer-gate, model policy, etc.) apply uniformly. The low-level EventStore.append
// is considered the internal validator; reserve direct use for the event-store's own
// tests.
export async function appendEvent(logPath, event) {
  if (!logPath) throw new Error('appendEvent: logPath required');
  const filled = { ...event };
  if (filled.model && filled.tokens && filled.cost_usd_estimate == null) {
    filled.cost_usd_estimate = await estimateCost(filled.model, filled.tokens);
  }
  const store = new EventStore(logPath);
  return await store.append(filled);
}

// Reviewer model MUST differ from implementer target_model at dispatch time (spec §6.2).
// Returns a tuple [ok, reason]. Callers MUST emit guard.violation on failure.
export function assertReviewerNotImplementer(targetModel, reviewerModel) {
  if (!targetModel || !reviewerModel) return [true, null];
  if (targetModel === reviewerModel) {
    return [false, `reviewer model (${reviewerModel}) must differ from implementer target (${targetModel})`];
  }
  return [true, null];
}

export async function estimateCost(model, tokens) {
  const costs = await loadCosts();
  const m = costs.models[model] || costs.defaults;
  const input = tokens.input || 0;
  const output = tokens.output || 0;
  const cached = tokens.cached || 0;
  const cacheRate = m.cache_read_per_mtok ?? m.input_per_mtok * 0.1;
  const total =
    (input / 1e6) * (m.input_per_mtok || 0) +
    (output / 1e6) * (m.output_per_mtok || 0) +
    (cached / 1e6) * cacheRate;
  return +total.toFixed(4);
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function cmdAppend(args) {
  const logPath = args.log || path.join(process.cwd(), 'tasks/events.ndjson');
  const text = await readStdin();
  const event = JSON.parse(text);
  const written = await appendEvent(logPath, event);
  process.stdout.write(JSON.stringify(written) + '\n');
}

async function cmdQuote(args) {
  const text = await readStdin();
  const tokens = JSON.parse(text);
  const cost = await estimateCost(args.model, tokens);
  process.stdout.write(JSON.stringify({ model: args.model, tokens, cost_usd_estimate: cost }) + '\n');
}

async function cmdCodex(args) {
  const taskPath = args.taskFile;
  if (!taskPath) throw new Error('codex requires <task.json>');
  const task = JSON.parse(await fs.readFile(taskPath, 'utf8'));
  const logPath = args.log || path.join(process.cwd(), 'tasks/events.ndjson');

  const model = task.target_model;
  const effort = task.reasoning_effort || 'default';

  const [ok, reason] = assertReviewerNotImplementer(model, task.reviewer_model);
  if (!ok) {
    await appendEvent(logPath, {
      session_id: task.session_id,
      wave: task.wave,
      task_id: task.task_id,
      agent: 'system',
      action: 'guard.violation',
      payload: { kind: 'reviewer_equals_implementer', target_model: model, reviewer_model: task.reviewer_model, reason }
    });
    throw new Error(`[dispatch] refusing to dispatch: ${reason}`);
  }

  await appendEvent(logPath, {
    session_id: task.session_id,
    wave: task.wave,
    task_id: task.task_id,
    agent: 'orchestrator',
    action: 'task.routed',
    payload: { model, effort, reason: task.route_reason || 'default route' }
  });

  const started = Date.now();
  await appendEvent(logPath, {
    session_id: task.session_id,
    wave: task.wave,
    task_id: task.task_id,
    agent: 'implementer',
    model,
    action: 'task.dispatched'
  });

  const codexArgs = [
    'exec',
    '--json',
    '--model', model,
    ...(effort !== 'default' ? ['--reasoning-effort', effort] : []),
    '--prompt', task.prompt_path || `${path.dirname(taskPath)}/prompt.md`
  ];

  const child = spawn('codex', codexArgs, { stdio: ['inherit', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); process.stdout.write(d); });
  child.stderr.on('data', d => { stderr += d.toString(); process.stderr.write(d); });

  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  const durationMs = Date.now() - started;

  const tokens = extractTokens(stdout) || { input: 0, output: 0 };
  const cost = await estimateCost(model, tokens);

  if (exitCode === 0) {
    await appendEvent(logPath, {
      session_id: task.session_id,
      wave: task.wave,
      task_id: task.task_id,
      agent: 'implementer',
      model,
      action: 'task.implemented',
      outcome: 'success',
      tokens,
      cost_usd_estimate: cost,
      duration_ms: durationMs,
      evidence_paths: [`tasks/waves/${task.wave}/${task.task_id}/result.md`]
    });
  } else {
    await appendEvent(logPath, {
      session_id: task.session_id,
      wave: task.wave,
      task_id: task.task_id,
      agent: 'implementer',
      model,
      action: 'task.blocked',
      outcome: 'failure',
      tokens,
      cost_usd_estimate: cost,
      duration_ms: durationMs,
      notes: stderr.slice(0, 500)
    });
  }
  process.exit(exitCode);
}

function extractTokens(stdout) {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.usage) {
        return {
          input: j.usage.input_tokens || j.usage.prompt_tokens || 0,
          output: j.usage.output_tokens || j.usage.completion_tokens || 0,
          cached: j.usage.cache_read_tokens || 0
        };
      }
    } catch { /* skip */ }
  }
  return null;
}

function parseArgs(argv) {
  const [,, sub, ...rest] = argv;
  const args = { _: sub, taskFile: null, log: null, model: null };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--log') args.log = rest[++i];
    else if (a === '--model') args.model = rest[++i];
    else if (!args.taskFile && !a.startsWith('--')) args.taskFile = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  switch (args._) {
    case 'append': await cmdAppend(args); break;
    case 'quote':  await cmdQuote(args); break;
    case 'codex':  await cmdCodex(args); break;
    default:
      console.error(`
Usage:
  dispatch.mjs append < event.json       # append one event (from stdin)
  dispatch.mjs quote --model <id> < tokens.json
  dispatch.mjs codex <task.json>         # dispatch to codex exec and record lifecycle
      `.trim());
      process.exit(args._ ? 2 : 0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('[dispatch] fatal:', err.message); process.exit(1); });
}
