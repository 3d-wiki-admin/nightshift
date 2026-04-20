// core/codex/client.mjs — hardened wrapper around `codex exec`.
//
// Responsibilities:
//   - availability detection (CodexError code: ABSENT)
//   - env plumbing (NIGHTSHIFT_TASK_CONTRACT, NIGHTSHIFT_CONTEXT_PACK,
//     NIGHTSHIFT_CONSTITUTION, NIGHTSHIFT_PROJECT_DIR)
//   - spawn with timeout + soft/hard kill
//   - streaming stdout/stderr callbacks
//   - error taxonomy (AUTH_FAILED, RATE_LIMITED, INVALID_MODEL, TIMEOUT,
//     PARSE_ERROR, SPAWN_FAILED, NONZERO)
//   - token extraction from --json stream
//   - retry-with-backoff helper (optional; retry counts are spec §6.1 territory
//     and the orchestrator can opt in or stay at a single attempt)
//
// Design note: we keep subprocess CLI over the SDK on purpose. codex-cli
// ships with ChatGPT-subscription auth out of the box; switching to the SDK
// would require direct OpenAI API keys (different billing and UX). The
// hardening below exists so the subprocess path stops being fragile.

import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export class CodexError extends Error {
  constructor(msg, { code = 'NONZERO', stderr = '', exitCode = null } = {}) {
    super(msg);
    this.name = 'CodexError';
    this.code = code;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export const EXIT_CODEX_UNAVAILABLE = 5;

export function codexAvailable() {
  const res = spawnSync('bash', ['-lc', 'command -v codex'], { encoding: 'utf8' });
  return res.status === 0 && res.stdout.trim().length > 0;
}

// Error taxonomy. Checked in order; first match wins.
export const TAXONOMY = [
  { code: 'AUTH_FAILED',   re: /(401|unauthorized|not logged in|auth(entication)? fail|login required)/i },
  { code: 'RATE_LIMITED',  re: /(rate[-_ ]?limit|429|too many requests|quota exceeded)/i },
  { code: 'INVALID_MODEL', re: /(unknown model|model .*not (found|available)|invalid model)/i },
  { code: 'TIMEOUT',       re: /(timed? ?out|deadline exceeded)/i }
];

export function classifyError(stderr) {
  for (const { code, re } of TAXONOMY) if (re.test(stderr)) return code;
  return 'NONZERO';
}

// Extract token usage from `codex exec --json` output. Codex streams one
// JSON object per line; the final usage record lives on the last line that
// has a `usage` field.
export function extractTokens(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    try {
      const j = JSON.parse(l);
      if (j && j.usage) {
        return {
          input: j.usage.input_tokens || j.usage.prompt_tokens || 0,
          output: j.usage.output_tokens || j.usage.completion_tokens || 0,
          cached: j.usage.cache_read_tokens || j.usage.cached_input_tokens || 0
        };
      }
    } catch { /* tolerate non-JSON lines */ }
  }
  return null;
}

/**
 * Build the NIGHTSHIFT_* env block for a task. Throws CodexError if the
 * contract or constitution is missing (we never want to run Codex on an
 * ill-defined task just because the caller forgot a path).
 * context-pack is optional.
 */
export async function buildTaskEnv(task) {
  if (!task || !task.task_id) {
    throw new CodexError('buildTaskEnv: task.task_id is required', { code: 'SPAWN_FAILED' });
  }

  const projectDir = path.resolve(task.project_dir || process.cwd());
  const waveSeg = task.wave != null ? path.join('waves', String(task.wave)) : 'micro';
  const taskDir = task.contract_path
    ? path.dirname(path.resolve(task.contract_path))
    : path.join(projectDir, 'tasks', waveSeg, task.task_id);

  const contractPath = task.contract_path
    ? path.resolve(task.contract_path)
    : path.join(taskDir, 'contract.md');
  const contextPackPath = task.context_pack_path
    ? path.resolve(task.context_pack_path)
    : path.join(taskDir, 'context-pack.md');
  const constitutionPath = task.constitution_path
    ? path.resolve(task.constitution_path)
    : path.join(projectDir, 'memory', 'constitution.md');

  for (const [name, p] of [
    ['contract', contractPath],
    ['constitution', constitutionPath]
  ]) {
    try { await fs.access(p); }
    catch {
      throw new CodexError(`buildTaskEnv: ${name} not found at ${p}`, { code: 'SPAWN_FAILED' });
    }
  }

  return {
    NIGHTSHIFT_TASK_CONTRACT: contractPath,
    NIGHTSHIFT_CONTEXT_PACK: contextPackPath,
    NIGHTSHIFT_CONSTITUTION: constitutionPath,
    NIGHTSHIFT_PROJECT_DIR: projectDir
  };
}

/**
 * Spawn `codex exec --json --model <m> [--reasoning-effort <e>] [--prompt <p>]`
 * and return its result. Never throws on exit 0. On non-zero, throws
 * CodexError with a taxonomy code. On timeout, SIGTERM + SIGKILL after 5s.
 *
 * opts:
 *   model, effort, promptPath (optional), cwd (optional),
 *   env (object of extra env vars, merged over process.env),
 *   timeoutMs (default 15 min),
 *   onStdout, onStderr (stream callbacks)
 *   codexBin (override, default 'codex'; used by tests to point at a stub)
 */
export async function runCodex(opts = {}) {
  const {
    model,
    effort = 'default',
    promptPath,
    cwd,
    env = {},
    timeoutMs = 15 * 60 * 1000,
    onStdout,
    onStderr,
    codexBin = 'codex'
  } = opts;

  if (!model) throw new CodexError('runCodex: model is required', { code: 'SPAWN_FAILED' });

  if (codexBin === 'codex' && !codexAvailable()) {
    throw new CodexError('codex CLI not on PATH', { code: 'ABSENT' });
  }

  const args = [
    'exec',
    '--json',
    '--model', model,
    ...(effort && effort !== 'default' ? ['--reasoning-effort', effort] : []),
    ...(promptPath ? ['--prompt', promptPath] : [])
  ];

  const started = Date.now();
  return await new Promise((resolve, reject) => {
    let child;
    try {
      // detached:true puts child into its own process group so we can signal
      // the whole tree on timeout (otherwise grandchildren like `sleep` outlive
      // SIGTERM on the immediate bash).
      child = spawn(codexBin, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      });
    } catch (err) {
      reject(new CodexError(`spawn failed: ${err.message}`, { code: 'SPAWN_FAILED' }));
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { const s = d.toString(); stdout += s; if (onStdout) onStdout(s); });
    child.stderr.on('data', d => { const s = d.toString(); stderr += s; if (onStderr) onStderr(s); });

    const killTree = (signal) => {
      // Negative pid targets the process group. Fall back to direct child
      // kill if the group signal fails for any reason.
      try { process.kill(-child.pid, signal); }
      catch { try { child.kill(signal); } catch {} }
    };

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 2000);
    }, timeoutMs);

    child.on('error', err => {
      clearTimeout(timer);
      reject(new CodexError(`spawn error: ${err.message}`, { code: 'SPAWN_FAILED', stderr }));
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      if (killed) {
        reject(new CodexError('codex exec timed out', { code: 'TIMEOUT', stderr, exitCode }));
        return;
      }
      const tokens = extractTokens(stdout);
      if (exitCode === 0) {
        resolve({
          exitCode: 0,
          tokens: tokens || { input: 0, output: 0 },
          stdout, stderr, durationMs
        });
      } else {
        const code = classifyError(stderr || '');
        reject(new CodexError(
          `codex exec exited ${exitCode}${signal ? ` (signal ${signal})` : ''}: ${stderr.slice(0, 200)}`,
          { code, stderr, exitCode }
        ));
      }
    });
  });
}

/**
 * runCodexWithRetry — thin retry wrapper. Retries are ONLY for transient
 * classes (RATE_LIMITED, TIMEOUT). Auth / absent / invalid-model fail fast.
 */
export async function runCodexWithRetry(opts, { retries = 1, backoffMs = 2000 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await runCodex(opts);
    } catch (err) {
      if (!(err instanceof CodexError)) throw err;
      if (attempt >= retries) throw err;
      if (!['RATE_LIMITED', 'TIMEOUT'].includes(err.code)) throw err;
      attempt++;
      await new Promise(r => setTimeout(r, backoffMs * attempt));
    }
  }
}
