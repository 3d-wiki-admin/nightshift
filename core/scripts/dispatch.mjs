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
import { spawnSync } from 'node:child_process';
import { EventStore } from '../event-store/src/index.mjs';
import {
  runCodex,
  buildTaskEnv,
  CodexError,
  codexAvailable as clientCodexAvailable,
  EXIT_CODEX_UNAVAILABLE as CLIENT_EXIT_CODEX_UNAVAILABLE
} from '../codex/client.mjs';

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
  const written = await store.append(filled);

  // Auto-checkpoint at wave boundaries so /rollback has a clean anchor even
  // if the orchestrator prompt forgot to tag. Silent no-op outside git repos
  // or when NIGHTSHIFT_AUTO_CHECKPOINT=0.
  if (process.env.NIGHTSHIFT_AUTO_CHECKPOINT !== '0') {
    if (written.action === 'wave.started' && written.wave != null) {
      await autoTagCheckpoint(logPath, `wave-${written.wave}-start`);
    } else if (written.action === 'wave.accepted' && written.wave != null) {
      await autoTagCheckpoint(logPath, `wave-${written.wave}-end`);
    }
  }

  return written;
}

async function autoTagCheckpoint(logPath, label) {
  // logPath is <project>/tasks/events.ndjson; project root is two levels up.
  const projectDir = path.resolve(path.dirname(logPath), '..');
  const isRepo = spawnSync('git', ['-C', projectDir, 'rev-parse', '--git-dir'], { encoding: 'utf8' });
  if (isRepo.status !== 0) return;
  const script = new URL('./checkpoint-manager.sh', import.meta.url).pathname;
  const res = spawnSync('bash', [script, 'tag', label], {
    cwd: projectDir,
    encoding: 'utf8',
    env: process.env
  });
  if (res.status !== 0) {
    // Tag creation can fail on "already exists" — that's OK, idempotent re-run.
    // Only log unexpected errors.
    if (!/already exists/i.test(res.stderr || '')) {
      console.error(`[dispatch] auto-checkpoint '${label}' failed: ${res.stderr.trim().slice(0, 200)}`);
    }
  }
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

// Detect `codex` CLI availability on PATH. Re-exported from the hardened
// client so existing tests (and the dispatch CLI) keep a single import.
export const codexAvailable = clientCodexAvailable;

// Exit code used when dispatch cannot reach Codex and the caller must fall
// back (spec §23 degraded mode). Orchestrator treats this as "route to Claude
// implementer", not as a generic failure.
export const EXIT_CODEX_UNAVAILABLE = CLIENT_EXIT_CODEX_UNAVAILABLE;

async function cmdCodex(args) {
  const taskPath = args.taskFile;
  if (!taskPath) throw new Error('codex requires <task.json>');
  const task = JSON.parse(await fs.readFile(taskPath, 'utf8'));
  const logPath = args.log || path.join(process.cwd(), 'tasks/events.ndjson');

  const model = task.target_model;
  const effort = task.reasoning_effort || 'default';

  // Reviewer ≠ implementer gate first.
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

  // §23 degraded mode: if Codex CLI isn't on PATH, record fallback + exit 5.
  if (!codexAvailable()) {
    await appendEvent(logPath, {
      session_id: task.session_id,
      wave: task.wave,
      task_id: task.task_id,
      agent: 'orchestrator',
      action: 'task.routed',
      payload: {
        model: 'claude-sonnet-4-6',
        effort,
        reason: `codex-unavailable (fallback per §23); original target was ${model}`,
        fallback_from: model
      }
    });
    console.error('[dispatch] codex CLI not on PATH — fallback: route to Claude implementer (exit 5)');
    process.exit(EXIT_CODEX_UNAVAILABLE);
  }

  // Build NIGHTSHIFT_* env block BEFORE spawn so implementer skills see
  // their declared inputs. buildTaskEnv throws CodexError on missing
  // contract/constitution; surface the reason and exit non-zero.
  let taskEnv;
  try {
    taskEnv = await buildTaskEnv({
      task_id: task.task_id,
      wave: task.wave,
      project_dir: task.project_dir || (args.log ? path.dirname(path.dirname(path.resolve(args.log))) : process.cwd()),
      contract_path: task.contract_path,
      context_pack_path: task.context_pack_path,
      constitution_path: task.constitution_path
    });
  } catch (err) {
    if (err instanceof CodexError) {
      await appendEvent(logPath, {
        session_id: task.session_id,
        wave: task.wave,
        task_id: task.task_id,
        agent: 'system',
        action: 'guard.violation',
        payload: { kind: 'codex_env_unresolvable', reason: err.message }
      });
      console.error(`[dispatch] ${err.message}`);
      process.exit(4);
    }
    throw err;
  }

  await appendEvent(logPath, {
    session_id: task.session_id,
    wave: task.wave,
    task_id: task.task_id,
    agent: 'orchestrator',
    action: 'task.routed',
    payload: { model, effort, reason: task.route_reason || 'default route' }
  });

  await appendEvent(logPath, {
    session_id: task.session_id,
    wave: task.wave,
    task_id: task.task_id,
    agent: 'implementer',
    model,
    action: 'task.dispatched'
  });

  const promptPath = task.prompt_path || `${path.dirname(taskPath)}/prompt.md`;

  try {
    const { tokens, durationMs } = await runCodex({
      model,
      effort,
      promptPath,
      env: taskEnv,
      onStdout: d => process.stdout.write(d),
      onStderr: d => process.stderr.write(d),
      codexBin: args.codexBin || 'codex'
    });
    const cost = await estimateCost(model, tokens);
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
    process.exit(0);
  } catch (err) {
    if (err instanceof CodexError) {
      const tokens = { input: 0, output: 0 };
      const cost = await estimateCost(model, tokens);
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
        notes: `[${err.code}] ${err.stderr.slice(0, 400)}`
      });
      console.error(`[dispatch] codex failed: ${err.code} — ${err.message}`);
      process.exit(err.exitCode && err.exitCode > 0 ? err.exitCode : 1);
    }
    throw err;
  }
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
