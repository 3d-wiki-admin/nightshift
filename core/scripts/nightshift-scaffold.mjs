#!/usr/bin/env node
// nightshift-scaffold.mjs — post-approval scaffold for `nightshift scaffold <path>`.
//
// Preconditions:
//   - `<path>/.nightshift/intake-pending` exists (project was init'd).
//   - `<path>/.nightshift/intake.ndjson` contains at least one
//     kind=proposal line with approved=true.
//
// Actions:
//   1. Locate the templates dir (sibling of this script under core/templates/).
//   2. Pick template by proposal.template (default next-supabase-vercel).
//   3. Copy template files into the project, with substitutions for <project>.
//   4. Populate memory/constitution.md and tasks/spec.md from intake answers.
//   5. Emit decision.recorded event in tasks/events.ndjson (via dispatch).
//   6. Update registry stage=ready, fill template/stack/providers fields.
//   7. Return summary.

import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '../registry/index.mjs';
import { appendEvent } from './dispatch.mjs';
import { sessionId as genSessionId } from '../event-store/src/id.mjs';

export class ScaffoldError extends Error {
  constructor(msg, { code = 'SCAFFOLD_ERROR' } = {}) {
    super(msg);
    this.name = 'ScaffoldError';
    this.code = code;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function templatesRoot() {
  // core/scripts/nightshift-scaffold.mjs → ../../templates → core/templates/
  return path.resolve(__dirname, '..', 'templates');
}

export async function findApprovedProposal(project) {
  const logPath = path.join(project, '.nightshift', 'intake.ndjson');
  let text;
  try { text = await fs.readFile(logPath, 'utf8'); }
  catch { throw new ScaffoldError(`intake log not found at ${logPath}. Run 'nightshift init' + '/nightshift intake' first.`, { code: 'NO_INTAKE' }); }

  const lines = text.split('\n').filter(Boolean);
  let questions = [];
  let proposal = null;
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (e.kind === 'q') questions.push(e);
      if (e.kind === 'proposal') proposal = e;
    } catch { /* ignore malformed */ }
  }

  if (!proposal) throw new ScaffoldError('no proposal found in intake.ndjson — the interview did not finish.', { code: 'NO_PROPOSAL' });
  if (proposal.approved !== true) throw new ScaffoldError('latest proposal is not approved — run /nightshift intake through to approval first.', { code: 'NOT_APPROVED' });

  return { proposal, questions };
}

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// writeIfAbsent — never clobbers a pre-existing file. scaffold.mjs uses
// this for every stack-specific render target so hand-edits the user made
// between runs (or the idempotent re-scaffold case) are preserved.
async function writeIfAbsent(p, body) {
  if (await pathExists(p)) return false;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body, 'utf8');
  return true;
}

async function copyTree(srcDir, dstDir, { substitutions = {}, excludeRel = [] } = {}) {
  const copied = [];
  const skipped = [];
  const excludeSet = new Set(excludeRel);
  async function walk(src, dst) {
    await fs.mkdir(dst, { recursive: true });
    for (const name of await fs.readdir(src)) {
      const s = path.join(src, name);
      const d = path.join(dst, name);
      const rel = path.relative(dstDir, d);
      if (excludeSet.has(rel)) {
        skipped.push(rel);
        continue;
      }
      const stat = await fs.stat(s);
      if (stat.isDirectory()) {
        await walk(s, d);
      } else {
        if (await pathExists(d)) {
          skipped.push(path.relative(dstDir, d));
          continue;
        }
        let content;
        if (/\.(md|json|yaml|yml|ts|tsx|js|mjs|jsx|sh|template|env|txt|example)$/.test(name) || !path.extname(name)) {
          content = await fs.readFile(s, 'utf8');
          for (const [key, value] of Object.entries(substitutions)) {
            content = content.split(`<${key}>`).join(value);
          }
          await fs.writeFile(d, content, 'utf8');
        } else {
          content = await fs.readFile(s);
          await fs.writeFile(d, content);
        }
        copied.push(path.relative(dstDir, d));
      }
    }
  }
  if (await pathExists(srcDir)) await walk(srcDir, dstDir);
  return { copied, skipped };
}

// Build a `## 1. Stack` block from the approved proposal. Until this fix
// the constitution template hard-coded Next.js+Supabase+Vercel — which lied
// to /plan whenever intake picked a different stack (Python+FastAPI+Celery,
// Go, Rails, whatever). The block now reflects what the intake actually
// decided.
function renderStackBlock(proposal) {
  const stack = (proposal.stack || '').trim();
  const providers = Array.isArray(proposal.providers) ? proposal.providers : [];
  const template = proposal.template || '(unset)';
  const stackLines = stack
    ? stack.split(/[-,+ /]+/).filter(Boolean).map(s => `- ${s}`)
    : ['- _(stack unset — intake proposal did not pin a stack)_'];
  return [
    '## 1. Stack',
    `- Template: \`${template}\``,
    `- Stack identifier: \`${stack || '(unset)'}\``,
    ...(providers.length ? ['- Providers:', ...providers.map(p => `  - ${p}`)] : ['- Providers: _(none pinned at intake)_']),
    '- Components (from stack identifier — confirm each during /plan):',
    ...stackLines.map(l => `  ${l}`),
    '',
    '> This Stack section is generated from the intake proposal. If the plan reveals',
    '> a component was wrong, open an `approval-required` task to change it — do not',
    '> silently edit this block.',
    ''
  ].join('\n');
}

// Build memory/constitution.md by applying the approved proposal to the
// template. Inserts stack, forbidden items, risk class, etc.
async function renderConstitution(project, proposal) {
  const templatePath = path.join(templatesRoot(), 'project-starter', 'memory', 'constitution.md');
  let text;
  try { text = await fs.readFile(templatePath, 'utf8'); }
  catch { return null; }

  text = text.replaceAll('<project>', path.basename(project));
  // Substitute the stack-block marker with a concrete stack section built
  // from the intake proposal. If the marker isn't found (older template)
  // we prepend the stack block above `## 2.` as a fallback.
  const stackBlock = renderStackBlock(proposal);
  const markerRe = /<!--\s*nightshift:stack-block[^>]*-->\s*/;
  if (markerRe.test(text)) {
    text = text.replace(markerRe, stackBlock);
  } else {
    text = text.replace(/^## 2\. /m, `${stackBlock}\n## 2. `);
  }
  // Append an intake snapshot so /plan can read it as first-class input.
  const snapshot = [
    '',
    '---',
    '',
    '## Intake snapshot (from /nightshift intake)',
    '',
    `- template: ${proposal.template}`,
    `- stack: ${proposal.stack}`,
    `- providers: ${(proposal.providers || []).join(', ') || '(none)'}`,
    `- initial_risk_class: ${proposal.initial_risk_class}`,
    `- success_criteria: ${proposal.success_criteria || '(unspecified)'}`,
    ...((proposal.out_of_scope || []).length
      ? ['- out_of_scope:', ...proposal.out_of_scope.map(s => `  - ${s}`)]
      : []),
    ...((proposal.questions || []).length
      ? ['- open_questions_at_intake:', ...proposal.questions.map(q => `  - ${q}`)]
      : []),
    ''
  ].join('\n');

  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  const outPath = path.join(project, 'memory', 'constitution.md');
  if (await pathExists(outPath)) {
    return { path: outPath, overwritten: false };
  }
  await fs.writeFile(outPath, text + snapshot, 'utf8');
  return { path: outPath, overwritten: true };
}

// =============================================================
// Stack-aware rendering (hotfix H8)
// =============================================================
//
// Before this block landed, almost every file in project-starter/ was
// hard-coded to the Next.js+Supabase+Vercel stack. When intake chose a
// different stack (Python/FastAPI/Celery, Go, Rails, polyglot monorepo),
// the scaffold copied those files 1-to-1 and the subagents that read them
// (plan-writer, task-decomposer, implementer) got silently wrong
// instructions — `.env.template` missing LLM keys, CI running only pnpm,
// API contracts saying "all routes under app/api/" for a Python API,
// package.json carrying Next deps the project doesn't use, etc.
//
// `stackFlags()` classifies the proposal once; each `render*()` function
// turns that classification into a concrete file body. Stack-agnostic
// files (learnings.md, research.md, FEATURE_INDEX.md) still copy through
// unchanged.

function stackFlags(proposal) {
  const stack = String(proposal?.stack || '').toLowerCase();
  const providers = Array.isArray(proposal?.providers)
    ? proposal.providers.map(p => String(p).toLowerCase())
    : [];
  const template = String(proposal?.template || '').toLowerCase();
  const has = (re) => re.test(stack);
  const prov = (needle) => providers.some(p => p.includes(needle));

  const hasNext = has(/next\.?js|\bnext\b/) || template.includes('next');
  const hasReact = hasNext || has(/\breact\b/);
  const hasPython = has(/python|fastapi|django|flask|celery|poetry/)
    || template.includes('python') || template.includes('api-worker');
  const hasFastApi = has(/fastapi/);
  const hasCelery = has(/celery/);
  const hasSupabase = has(/supabase/) || prov('supabase');
  const hasRailway = prov('railway');
  const hasVercel = prov('vercel');
  const hasRedis = has(/redis|upstash/) || prov('upstash') || prov('redis');
  const hasOpenAI = has(/openai/) || prov('openai');
  const hasAnthropic = has(/anthropic|claude/) || prov('anthropic');
  const hasOpenRouter = has(/openrouter/) || prov('openrouter');
  const hasGoogle = prov('google');
  const hasLLM = hasOpenAI || hasAnthropic || hasOpenRouter || has(/langchain|\bllm\b/);
  const hasPostgres = has(/postgres|\bpg\b/) || hasSupabase;
  const isMonorepo = hasNext && hasPython;
  const isTypescript = hasNext || has(/typescript|\btsx?\b/);

  return {
    hasNext, hasReact, hasPython, hasFastApi, hasCelery, hasSupabase,
    hasRailway, hasVercel, hasRedis, hasOpenAI, hasAnthropic, hasOpenRouter,
    hasGoogle, hasLLM, hasPostgres, isMonorepo, isTypescript,
    // resolved dir hints for monorepo vs flat
    webDir:    isMonorepo ? 'apps/web'    : '.',
    apiDir:    isMonorepo ? 'apps/api'    : '.',
    workerDir: isMonorepo ? 'apps/worker' : '.'
  };
}

function renderEnvTemplate(flags) {
  const blocks = [
    '# Resolved at runtime by core/scripts/run-with-secrets.sh via the active SecretBackend.',
    '# NEVER commit real values.',
    ''
  ];
  if (flags.hasSupabase) {
    blocks.push(
      '# --- Supabase ---',
      'NEXT_PUBLIC_SUPABASE_URL={{SECRET:NEXT_PUBLIC_SUPABASE_URL}}',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY={{SECRET:NEXT_PUBLIC_SUPABASE_ANON_KEY}}',
      'SUPABASE_SERVICE_ROLE_KEY={{SECRET:SUPABASE_SERVICE_ROLE_KEY}}',
      ''
    );
  }
  if (flags.hasLLM) {
    blocks.push('# --- LLM ---');
    if (flags.hasOpenAI)     blocks.push('OPENAI_API_KEY={{SECRET:OPENAI_API_KEY}}');
    if (flags.hasAnthropic)  blocks.push('ANTHROPIC_API_KEY={{SECRET:ANTHROPIC_API_KEY}}');
    if (flags.hasOpenRouter) blocks.push('OPENROUTER_API_KEY={{SECRET:OPENROUTER_API_KEY}}');
    blocks.push('');
  }
  if (flags.hasPostgres || flags.hasRedis || flags.hasCelery) {
    blocks.push('# --- Storage / Queue ---');
    if (flags.hasPostgres) blocks.push('DATABASE_URL={{SECRET:DATABASE_URL}}');
    if (flags.hasRedis) {
      blocks.push(
        'UPSTASH_REDIS_REST_URL={{SECRET:UPSTASH_REDIS_REST_URL}}',
        'UPSTASH_REDIS_REST_TOKEN={{SECRET:UPSTASH_REDIS_REST_TOKEN}}'
      );
    }
    if (flags.hasCelery) {
      blocks.push(
        'CELERY_BROKER_URL={{SECRET:CELERY_BROKER_URL}}',
        'CELERY_RESULT_BACKEND={{SECRET:CELERY_RESULT_BACKEND}}'
      );
    }
    blocks.push('');
  }
  if (flags.hasGoogle) {
    blocks.push('# --- Google APIs (service-account) ---',
      'GOOGLE_SERVICE_ACCOUNT_JSON={{SECRET:GOOGLE_SERVICE_ACCOUNT_JSON}}',
      '');
  }
  const deploy = [];
  if (flags.hasVercel)  deploy.push('VERCEL_TOKEN={{SECRET:VERCEL_TOKEN}}');
  if (flags.hasRailway) deploy.push('RAILWAY_TOKEN={{SECRET:RAILWAY_TOKEN}}');
  if (deploy.length) blocks.push('# --- Deploy ---', ...deploy, '');
  return blocks.join('\n');
}

function renderGitignore(flags) {
  const lines = [
    '# --- common ---',
    '.DS_Store',
    '.env',
    '.env.local',
    '.env.*.local',
    'dist/',
    'build/',
    ''
  ];
  if (flags.hasNext || flags.hasReact || flags.isTypescript) {
    lines.push(
      '# --- JS / Next ---',
      'node_modules/',
      '.next/',
      '*.tsbuildinfo',
      ''
    );
  }
  if (flags.hasPython) {
    lines.push(
      '# --- Python ---',
      '__pycache__/',
      '*.pyc',
      '*.pyo',
      '.venv/',
      '.mypy_cache/',
      '.pytest_cache/',
      '.ruff_cache/',
      '*.egg-info/',
      ''
    );
  }
  lines.push(
    '# --- nightshift local state (registry cache, intake markers, ping failcounts) ---',
    '.nightshift/',
    ''
  );
  return lines.join('\n');
}

function renderClaudeMd(flags, projectName) {
  const commands = [];
  if (flags.isMonorepo) {
    commands.push('Monorepo: `apps/api` (poetry), `apps/worker` (poetry), `apps/web` (pnpm).', '');
  }
  if (flags.hasPython) {
    commands.push('### Backend (Python)');
    const apiDir = flags.isMonorepo ? 'apps/api' : '.';
    const workerDir = flags.isMonorepo ? 'apps/worker' : '.';
    if (flags.hasFastApi) {
      commands.push(`- Dev (api):   \`cd ${apiDir} && poetry run uvicorn app.main:app --reload\``);
    }
    if (flags.hasCelery) {
      commands.push(`- Worker:      \`cd ${workerDir} && poetry run celery -A app.worker worker -l info\``);
    }
    commands.push(
      `- Test:        \`cd ${apiDir} && poetry run pytest\``,
      `- Typecheck:   \`cd ${apiDir} && poetry run mypy --strict .\``,
      `- Lint:        \`cd ${apiDir} && poetry run ruff check .\``,
      ''
    );
  }
  if (flags.hasNext) {
    const webDir = flags.isMonorepo ? 'apps/web' : '.';
    commands.push(
      '### Frontend (Next.js)',
      `- Dev:         \`${flags.isMonorepo ? `pnpm -C ${webDir} dev` : 'pnpm dev'}\``,
      `- Typecheck:   \`${flags.isMonorepo ? `pnpm -C ${webDir} typecheck` : 'pnpm typecheck'}\``,
      `- Lint:        \`${flags.isMonorepo ? `pnpm -C ${webDir} lint` : 'pnpm lint'}\``,
      `- Build:       \`${flags.isMonorepo ? `pnpm -C ${webDir} build` : 'pnpm build'}\``,
      `- Smoke:       \`${flags.isMonorepo ? `pnpm -C ${webDir} smoke` : 'pnpm smoke'}\``,
      ''
    );
  }
  if (!flags.hasPython && !flags.hasNext) {
    commands.push('_(stack-specific commands will be added by /plan once runtime files exist)_', '');
  }

  return [
    `# CLAUDE.md — ${projectName}`,
    '',
    'Scaffolded by the nightshift `project-bootstrap` skill. Edit freely; just don\'t remove load-bearing sections.',
    '',
    '## Read first',
    '- `memory/constitution.md` — non-negotiable rules. **Read before every action.**',
    '- `tasks/spec.md` — what we\'re building.',
    '- `tasks/plan.md` — how we\'re building it.',
    '',
    '## Source of truth',
    '- `tasks/events.ndjson` is the **only** canonical store. `tasks/state.json` and `tasks/compliance.md` are derived.',
    '- Never append to `events.ndjson` directly — go through the dispatch layer (`nightshift dispatch append`).',
    '',
    '## Commands',
    '',
    ...commands,
    '## Workflow for agents',
    '- Every task has a contract at `tasks/waves/<N>/<TASK-ID>/contract.md`.',
    '- Writes outside `contract.allowed_files` are rejected by the `write-guard` hook.',
    '- Before marking a task accepted: run hard gates, collect evidence in `evidence/`, produce `review.md` with per-dimension evidence paths.',
    '- **Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING.**',
    ''
  ].join('\n');
}

function renderCi(flags) {
  const jobs = [];
  if (flags.hasNext || flags.isTypescript) {
    const webDir = flags.isMonorepo ? 'apps/web' : '.';
    const runPrefix = flags.isMonorepo ? `pnpm -C ${webDir} ` : 'pnpm ';
    jobs.push(
      '  web:',
      '    name: web (Next.js / JS)',
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: 15',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: pnpm/action-setup@v4',
      '        with: { version: 10 }',
      '      - uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 22',
      '          cache: pnpm',
      '      - run: pnpm install --frozen-lockfile',
      `      - run: ${runPrefix}typecheck`,
      `      - run: ${runPrefix}lint`,
      `      - run: ${runPrefix}build`,
      `      - run: ${runPrefix}test -- --run`,
      ''
    );
  }
  if (flags.hasPython) {
    const apiDir = flags.isMonorepo ? 'apps/api' : '.';
    jobs.push(
      '  api:',
      '    name: api (Python)',
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: 15',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-python@v5',
      '        with:',
      '          python-version: "3.12"',
      '      - name: Install poetry',
      '        run: pipx install poetry==1.8.3',
      '      - name: Install deps',
      `        working-directory: ${apiDir}`,
      '        run: poetry install --no-interaction --no-ansi',
      '      - name: Type-check (mypy --strict)',
      `        working-directory: ${apiDir}`,
      '        run: poetry run mypy --strict .',
      '      - name: Lint (ruff)',
      `        working-directory: ${apiDir}`,
      '        run: poetry run ruff check .',
      '      - name: Unit tests (pytest)',
      `        working-directory: ${apiDir}`,
      '        run: poetry run pytest',
      ''
    );
    if (flags.hasCelery) {
      const workerDir = flags.isMonorepo ? 'apps/worker' : '.';
      jobs.push(
        '  worker:',
        '    name: worker (Celery)',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 15',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: actions/setup-python@v5',
        '        with:',
        '          python-version: "3.12"',
        '      - name: Install poetry',
        '        run: pipx install poetry==1.8.3',
        '      - name: Install deps',
        `        working-directory: ${workerDir}`,
        '        run: poetry install --no-interaction --no-ansi',
        '      - name: Type-check (mypy --strict)',
        `        working-directory: ${workerDir}`,
        '        run: poetry run mypy --strict .',
        '      - name: Lint (ruff)',
        `        working-directory: ${workerDir}`,
        '        run: poetry run ruff check .',
        '      - name: Unit tests (pytest)',
        `        working-directory: ${workerDir}`,
        '        run: poetry run pytest',
        ''
      );
    }
  }
  const smokeNeeds = [];
  if (flags.hasNext || flags.isTypescript) smokeNeeds.push('web');
  if (flags.hasPython) smokeNeeds.push('api');
  if (smokeNeeds.length) {
    jobs.push(
      '  smoke:',
      '    name: smoke (golden path, constitution §3)',
      `    needs: [${smokeNeeds.join(', ')}]`,
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: 15',
      '    steps:',
      '      - uses: actions/checkout@v4'
    );
    if (flags.hasNext || flags.isTypescript) {
      jobs.push(
        '      - uses: pnpm/action-setup@v4',
        '        with: { version: 10 }',
        '      - uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 22',
        '          cache: pnpm',
        '      - run: pnpm install --frozen-lockfile'
      );
    }
    if (flags.hasPython) {
      jobs.push(
        '      - uses: actions/setup-python@v5',
        '        with:',
        '          python-version: "3.12"',
        '      - name: Install poetry',
        '        run: pipx install poetry==1.8.3'
      );
    }
    jobs.push(
      '      - name: Smoke',
      '        run: bash scripts/smoke.sh',
      ''
    );
  }
  return [
    'name: CI',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    '',
    'jobs:',
    ...jobs
  ].join('\n');
}

function renderSmokeSh(flags) {
  const head = [
    '#!/usr/bin/env bash',
    '# smoke.sh — shortest golden-path verification.',
    '# Any failure → whole smoke fails. Edit this when a feature needs a smoke check.',
    'set -euo pipefail',
    '',
    'LOG_DIR="${TMPDIR:-/tmp}/nightshift-smoke"',
    'mkdir -p "$LOG_DIR"',
    ''
  ];
  const parts = [];
  const trapPids = [];
  if (flags.hasFastApi) {
    trapPids.push('api_pid');
    const apiDir = flags.isMonorepo ? 'apps/api' : '.';
    parts.push(
      'api_pid=""',
      'cleanup_api() { [[ -n "${api_pid}" ]] && kill "${api_pid}" 2>/dev/null || true; }',
      ''
    );
    parts.push(
      'echo "[smoke] starting FastAPI on :8001..."',
      `( cd ${apiDir} && poetry run uvicorn app.main:app --host 127.0.0.1 --port 8001 ) \\`,
      '  >"$LOG_DIR/api.log" 2>&1 &',
      'api_pid=$!',
      ''
    );
  }
  if (flags.hasNext) {
    trapPids.push('web_pid');
    const webDir = flags.isMonorepo ? 'apps/web' : '.';
    const buildCmd = flags.isMonorepo ? `pnpm -C ${webDir} build` : 'pnpm build';
    const startCmd = flags.isMonorepo ? `pnpm -C ${webDir} start -p 3001` : 'pnpm start -p 3001';
    parts.push(
      'web_pid=""',
      'cleanup_web() { [[ -n "${web_pid}" ]] && kill "${web_pid}" 2>/dev/null || true; }',
      '',
      'echo "[smoke] building Next.js..."',
      buildCmd,
      '',
      'echo "[smoke] starting Next.js on :3001..."',
      `( ${startCmd} ) >"$LOG_DIR/web.log" 2>&1 &`,
      'web_pid=$!',
      ''
    );
  }
  const cleanup = trapPids.length
    ? [`trap '${trapPids.map(p => `kill "$${p}" 2>/dev/null || true`).join('; ')}' EXIT`, '']
    : [];
  const waitFor = [
    'wait_for() {',
    '  local url="$1" name="$2" log="$3"',
    '  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do',
    '    if curl -sf "$url" >/dev/null 2>&1; then',
    '      echo "[smoke] $name responded ($url)"',
    '      return 0',
    '    fi',
    '    sleep 5',
    '  done',
    '  echo "[smoke] $name did not respond within 60s ($url)"',
    '  tail -40 "$log" || true',
    '  return 1',
    '}',
    ''
  ];
  const checks = [];
  if (flags.hasFastApi) checks.push('wait_for "http://127.0.0.1:8001/health" "FastAPI /health" "$LOG_DIR/api.log"');
  if (flags.hasNext)    checks.push('wait_for "http://127.0.0.1:3001/" "Next.js /" "$LOG_DIR/web.log"');
  if (!checks.length)   checks.push('echo "[smoke] no services configured for smoke in this stack; add when first /implement wave lands"');
  return [
    ...head,
    ...waitFor,
    ...cleanup,
    ...parts,
    ...checks,
    '',
    'echo "[smoke] OK"',
    'exit 0',
    ''
  ].join('\n');
}

function renderPackageJson(flags, projectName) {
  if (flags.isMonorepo) {
    return JSON.stringify({
      name: projectName,
      version: '0.0.0',
      private: true,
      packageManager: 'pnpm@10.0.0',
      engines: { node: '>=22' }
    }, null, 2) + '\n';
  }
  if (flags.hasNext) {
    return JSON.stringify({
      name: projectName,
      version: '0.0.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        lint: 'next lint',
        typecheck: 'tsc --noEmit',
        test: 'vitest run',
        smoke: 'bash scripts/smoke.sh'
      },
      dependencies: {
        ...(flags.hasSupabase ? {
          '@supabase/ssr': '^0.5.2',
          '@supabase/supabase-js': '^2.45.4'
        } : {}),
        next: '^15.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        zod: '^3.23.8'
      },
      devDependencies: {
        '@types/node': '^22.7.0',
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        eslint: '^9.0.0',
        'eslint-config-next': '^15.0.0',
        typescript: '^5.6.0',
        vitest: '^2.1.0',
        '@playwright/test': '^1.48.0'
      }
    }, null, 2) + '\n';
  }
  // Pure-Python or unclassified — no root package.json needed.
  return null;
}

function renderPnpmWorkspace(flags) {
  if (!flags.isMonorepo) return null;
  return [
    'packages:',
    '  - "apps/web"',
    '  - "packages/*"',
    ''
  ].join('\n');
}

function renderReadme(flags, projectName) {
  const lines = [
    `# ${projectName}`,
    '',
    'Scaffolded by [nightshift](https://github.com/3d-wiki-admin/nightshift).',
    '',
    '## Stack',
    ''
  ];
  if (flags.hasPython) lines.push('- Backend: Python / FastAPI' + (flags.hasCelery ? ' + Celery' : ''));
  if (flags.hasNext)   lines.push('- Frontend: Next.js 15 (TypeScript)');
  if (flags.hasSupabase) lines.push('- Data: Supabase (Postgres)');
  if (flags.hasRedis)    lines.push('- Queue: Upstash Redis');
  if (flags.hasVercel || flags.hasRailway) {
    const deploy = [];
    if (flags.hasVercel)  deploy.push('Vercel (frontend)');
    if (flags.hasRailway) deploy.push('Railway (api + worker)');
    lines.push(`- Deploy: ${deploy.join(', ')}`);
  }
  lines.push(
    '',
    '## Setup',
    '',
    '```bash'
  );
  if (flags.hasNext || flags.isMonorepo) lines.push('pnpm install');
  if (flags.hasPython && flags.isMonorepo) {
    lines.push('cd apps/api && poetry install && cd ../..');
    if (flags.hasCelery) lines.push('cd apps/worker && poetry install && cd ../..');
  } else if (flags.hasPython) {
    lines.push('poetry install');
  }
  lines.push('cp .env.template .env.local        # fill real values via SecretBackend', '```', '');
  lines.push(
    '## Agent-driven development',
    '',
    'This repo is built by AI agents under nightshift discipline:',
    '',
    '- `memory/constitution.md` — agents read this before every action.',
    '- `tasks/spec.md`, `tasks/plan.md` — product + design.',
    '- `tasks/events.ndjson` — canonical audit log (append-only).',
    '- `tasks/compliance.md` — audit generated from the log.',
    '',
    'See `CLAUDE.md` for workflow details.',
    ''
  );
  return lines.join('\n');
}

function renderProjectStructure(flags, projectName) {
  const lines = ['# Project structure', '',
    '<!-- Updated by post-task-sync when top-level folders change. Do not edit by hand. -->',
    '', '```', `${projectName}/`];
  if (flags.isMonorepo) {
    lines.push('├── apps/');
    if (flags.hasPython) {
      lines.push(
        '│   ├── api/                # FastAPI (Python 3.12, poetry)',
        '│   │   ├── app/',
        '│   │   ├── tests/',
        '│   │   └── pyproject.toml'
      );
      if (flags.hasCelery) {
        lines.push(
          '│   ├── worker/             # Celery worker (Python 3.12, poetry)',
          '│   │   ├── app/',
          '│   │   ├── tests/',
          '│   │   └── pyproject.toml'
        );
      }
    }
    if (flags.hasNext) {
      lines.push(
        '│   └── web/                # Next.js 15 App Router (TypeScript, pnpm)',
        '│       ├── app/',
        '│       ├── lib/',
        '│       ├── middleware.ts',
        '│       ├── next.config.mjs',
        '│       ├── tsconfig.json',
        '│       └── package.json'
      );
    }
    lines.push('├── packages/', '│   └── shared/             # shared TS types + Zod schemas');
  } else if (flags.hasNext) {
    lines.push(
      '├── app/                # Next.js 15 App Router',
      '├── lib/                # shared helpers',
      '├── public/             # static assets'
    );
  } else if (flags.hasPython) {
    lines.push(
      '├── app/                # FastAPI / Celery code',
      '├── tests/              # pytest',
      '├── pyproject.toml'
    );
  }
  if (flags.hasSupabase) {
    lines.push('├── supabase/               # migrations (SQL, managed by infra-provisioner)');
  }
  lines.push(
    '├── scripts/                # smoke.sh + project-local tooling',
    '├── memory/                 # agent-readable retrieval memory (v1.1)',
    '│   ├── constitution.md          # non-negotiables',
    '│   ├── learnings.md',
    '│   ├── decisions.ndjson         # append-only',
    '│   ├── incidents.ndjson         # append-only',
    '│   ├── services.json            # live infra state',
    '│   └── reuse-index.json         # machine-readable reuse catalog',
    '├── tasks/                  # canonical agent workspace',
    '│   ├── spec.md',
    '│   ├── plan.md',
    '│   ├── research.md',
    '│   ├── data-model.md',
    '│   ├── contracts/',
    '│   ├── waves/',
    '│   ├── events.ndjson       # canonical log (append-only)',
    '│   ├── state.json          # projection',
    '│   └── compliance.md       # audit',
    '├── .env.template',
    '├── CLAUDE.md',
    '└── NIGHTSHIFT.md',
    '```',
    ''
  );
  lines.push(
    '## Retrieval memory conventions (v1.1)',
    '',
    'All four `memory/*.{ndjson,json}` files are read as first-class inputs by `context-packer`, `plan-writer`, and `wave-orchestrator`. They MUST only be written through the `nightshift memory-record` CLI (never `Write`/`Edit`).',
    '',
    'Retrieve relevant slices for a task with:',
    '```bash',
    'nightshift memory-retrieve "$PROJECT" --query "<task keywords>" --markdown',
    '```',
    ''
  );
  return lines.join('\n');
}

function renderApiContracts(flags) {
  const lines = ['# API contracts', '',
    '<!-- Fill from plan-writer. Each route: method, path, request/response schema, errors. -->', ''];
  if (flags.hasPython && flags.hasNext) {
    lines.push(
      '## Split',
      '',
      'Business logic lives in FastAPI (`apps/api`). Next.js API routes (`apps/web/app/api/`) are BFF-only: auth sessions, server actions, edge-side glue. Do **not** put pipeline / business logic in Next.js routes.',
      ''
    );
  }
  if (flags.hasPython) {
    const apiDir = flags.isMonorepo ? 'apps/api' : '.';
    lines.push(
      `## FastAPI (\`${apiDir}\`)`,
      '',
      '- Base path: `/api/v1/...`',
      '- Input validation: Pydantic v2 (request bodies + query params).',
      '- Output: Pydantic response models (explicit `response_model`).',
      '- Error responses: `{ detail: string, code: string }` with non-2xx status.',
      ...(flags.hasCelery ? ['- Long-running work: never inline — enqueue Celery task, return `{ run_id }`, poll `/api/v1/runs/{run_id}`.'] : []),
      ''
    );
  }
  if (flags.hasNext) {
    const webDir = flags.isMonorepo ? 'apps/web' : '.';
    lines.push(
      `## Next.js API (\`${webDir}/app/api/\`)`,
      '',
      flags.hasPython
        ? '- Scope: auth callbacks, session refresh, server actions proxying to FastAPI with auth context.'
        : '- Scope: all HTTP routes live here.',
      '- Input validation: Zod.',
      '- Output: Zod-typed JSON.',
      '- Error responses: `{ error: string, code: string }` with non-2xx status.',
      ...(flags.hasPython ? ['- Forbidden here: direct LLM calls, pipeline orchestration, business logic that belongs in FastAPI.'] : []),
      ''
    );
  }
  if (flags.hasPython && flags.hasNext) {
    lines.push(
      '## Shared types',
      '',
      'TS types + Zod schemas in `packages/shared/` MUST mirror FastAPI Pydantic models 1:1. When a Pydantic model changes, update its Zod twin in the same task.',
      ''
    );
  }
  lines.push('## Routes', '', '_(none yet)_', '');
  return lines.join('\n');
}

function renderTaskTemplate(flags) {
  const jsCmd = flags.hasNext
    ? (flags.isMonorepo
      ? ['    # - pnpm -C apps/web typecheck', '    # - pnpm -C apps/web lint', '    # - pnpm -C apps/web test -- --run']
      : ['    # - pnpm typecheck', '    # - pnpm lint', '    # - pnpm test -- --run'])
    : [];
  const pyCmd = flags.hasPython
    ? (flags.isMonorepo
      ? ['    # - cd apps/<api|worker> && poetry run mypy --strict .', '    # - cd apps/<api|worker> && poetry run ruff check .', '    # - cd apps/<api|worker> && poetry run pytest']
      : ['    # - poetry run mypy --strict .', '    # - poetry run ruff check .', '    # - poetry run pytest'])
    : [];
  const verifBlock = [
    'verification_plan:',
    '  commands:',
    '    # Pick commands matching the stack this task touches.',
    ...(jsCmd.length ? ['    #', '    # --- JS ---', ...jsCmd] : []),
    ...(pyCmd.length ? ['    #', '    # --- Python ---', ...pyCmd] : []),
    ...(!jsCmd.length && !pyCmd.length ? ['    # - (add commands once runtime files exist)'] : []),
    '  manual_checks:',
    '    - "User-visible behavior check"'
  ];

  const forbiddenExamples = [];
  if (flags.hasNext) forbiddenExamples.push('  - "**/*.test.ts"');
  if (flags.hasPython) forbiddenExamples.push('  - "**/test_*.py"');
  if (flags.hasSupabase) forbiddenExamples.push('  - "supabase/migrations/**"     # only via approval-required tasks');
  if (!forbiddenExamples.length) forbiddenExamples.push('  - (fill per task)');

  const gates = [];
  if (flags.hasNext) gates.push('tests', 'types', 'lint', 'build');
  else if (flags.hasPython) gates.push('tests', 'types', 'lint');
  else gates.push('tests');
  const gatesLine = `gates_required: [${gates.join(', ')}]`;

  return [
    '# TASK-XXX: <title>',
    '',
    '<!-- Frontmatter MUST validate against core/schemas/contract.schema.json. -->',
    '<!-- Copy this template; fill every field. Leave lists empty only when a field does not apply. -->',
    '',
    '```yaml',
    'task_id: WAVE-ID-NUM',
    'wave: 1',
    'risk_class: safe | review-required | approval-required',
    'parallel_marker: "[P]"             # omit if serial',
    'target_model: gpt-5.4              # per §6.1',
    'reasoning_effort: default          # default | high | xhigh',
    'diff_budget_lines: 150',
    'owner_agent: implementer',
    'reviewer_agent: task-impl-reviewer',
    'reviewer_model: claude-opus-4.7    # MUST differ from target_model',
    'created_at: 2026-MM-DDTHH:MM:SSZ',
    '',
    'lease:',
    '  worktree: .nightshift/worktrees/wave-1-task-1',
    '  write_lock:',
    '    - path/to/file',
    '  lease_until: 2026-MM-DDTHH:MM:SSZ',
    '',
    'goal:',
    '  objective: "Describe the outcome in one sentence."',
    '  business_value: "What user-visible win does this produce?"',
    '',
    'scope:',
    '  in_scope:',
    '    - "Concrete list"',
    '  out_of_scope:',
    '    - "Concrete list"',
    '  dependencies:',
    '    - PRIOR-TASK-ID',
    '',
    'source_of_truth:',
    '  - memory/constitution.md',
    '  - tasks/spec.md',
    '  - tasks/plan.md',
    '  - tasks/data-model.md',
    '  - tasks/contracts/API.md',
    '',
    'allowed_files:',
    '  - path/to/file',
    'forbidden_files:',
    ...forbiddenExamples,
    '',
    'acceptance_criteria:',
    '  functional:',
    '    - "Measurable outcome #1"',
    '  edge_cases:',
    '    - "What must not happen"',
    `  ${gatesLine}`,
    '',
    'halt_conditions:',
    '  - "3 consecutive implementation failures"',
    '  - "new top-level dependency required"',
    '  - "contract violation detected by write-guard"',
    '  - "constitution conflict"',
    '',
    ...verifBlock,
    '',
    'post_task_updates:',
    '  - tasks/contracts/FEATURE_INDEX.md',
    '  - tasks/contracts/REUSE_FUNCTIONS.md',
    '```',
    '',
    '## Body (free prose for context)',
    '',
    '- Link to relevant spec/plan sections.',
    '- Why now (ordering within the wave).',
    '- Known traps or prior art.',
    ''
  ].join('\n');
}

function renderReviewDimensions(flags) {
  const depEvidence = [];
  if (flags.hasNext) depEvidence.push('`pnpm audit` for JS');
  if (flags.hasPython) depEvidence.push('`poetry show --outdated` for Python');
  const depEvidenceStr = depEvidence.length
    ? depEvidence.join(' \\| ')
    : 'dep-manifest diff';
  const dualNote = (flags.hasNext && flags.hasPython)
    ? ' If the task touched both stacks, BOTH pieces of evidence are required.'
    : '';

  return [
    '# Review dimensions (per spec §14, §17)',
    '',
    'The task-impl-reviewer MUST produce a verdict (OK / NOTE / FAIL) with a concrete evidence path for every dimension below.',
    '',
    'A dimension without an evidence path → automatic FAIL on that dimension → reject the task.',
    '',
    '| # | Dimension | What to check | Typical evidence |',
    '|---|---|---|---|',
    '| 1 | `scope_drift` | Diff stayed inside `allowed_files`? | `evidence/diff.patch` byte range |',
    `| 2 | \`missed_deps\` | New imports? Manifest updated for the affected stack? Lockfile committed? | \`evidence/diff.patch\` + (${depEvidenceStr}).${dualNote} |`,
    '| 3 | `dup_abstractions` | Does the diff duplicate code listed in `REUSE_FUNCTIONS.md`? | `evidence/reuse-check.txt` |',
    '| 4 | `verification_gaps` | Every acceptance criterion has a test that exercises it? | `evidence/tests.txt` + contract diff |',
    '| 5 | `security` | Secret in code? PII in logs? auth bypass? RLS respected? | `evidence/secret-scan.txt` |',
    '| 6 | `data_contract` | Diff aligns with `contracts/API.md` and `data-model.md`? | line citation in review.md |',
    '| 7 | `deploy_risk` | Migration? env var? infra change? Approval recorded if required? | reviewer notes |',
    '',
    '## Verdict legend',
    '',
    '- `OK` — no concerns.',
    '- `NOTE` — minor observation, not blocking (log it, move on).',
    '- `FAIL` — blocks acceptance. Reviewer MUST recommend `revise` or `reject`.',
    '',
    '## Aggregate verdict rule',
    '',
    '`accept` ⇔ (all hard gates PASS or N/A-with-justification) ∧ (all 7 dimensions non-FAIL) ∧ (risk_class ≠ approval-required OR decision.recorded exists for task_id).',
    '',
    'Otherwise → `revise` (with delta request) or `reject` (abandon, reassign, or escalate).',
    ''
  ].join('\n');
}

function renderReuseFunctionsMd(flags) {
  const rows = [];
  if (flags.hasSupabase && flags.hasNext) {
    const webLibPrefix = flags.isMonorepo ? 'apps/web/lib' : 'lib';
    rows.push(
      `| \`${webLibPrefix}/supabase/server.ts\` | \`supabaseServer()\` | Server-side Supabase client (SSR cookies) |`,
      `| \`${webLibPrefix}/supabase/client.ts\` | \`supabaseBrowser()\` | Browser-side Supabase client (singleton) |`
    );
  }
  if (!rows.length) rows.push('| — | — | — |');
  return [
    '# Reuse catalog',
    '',
    '<!-- Appended by post-task-sync. Check BEFORE creating any helper > 10 LOC (see constitution §3). -->',
    '',
    '| File | Symbol | Purpose |',
    '|---|---|---|',
    ...rows,
    ''
  ].join('\n');
}

function renderReuseIndexEntries(flags) {
  if (!flags.hasSupabase || !flags.hasNext) return [];
  const libPrefix = flags.isMonorepo ? 'apps/web/lib' : 'lib';
  return [
    { file: `${libPrefix}/supabase/server.ts`, symbol: 'supabaseServer', purpose: 'Server-side Supabase client (SSR cookies)', tags: ['supabase', 'ssr'], safe_to_extend: true, examples: [] },
    { file: `${libPrefix}/supabase/client.ts`, symbol: 'supabaseBrowser', purpose: 'Browser-side Supabase client (singleton)', tags: ['supabase', 'browser'], safe_to_extend: true, examples: [] }
  ];
}

function renderPlanPlaceholder(flags, projectName) {
  const jsLibs = [];
  if (flags.hasNext)     jsLibs.push('zod');
  if (flags.hasSupabase) jsLibs.push('@supabase/ssr');
  const pyLibs = [];
  if (flags.hasFastApi) pyLibs.push('fastapi', 'pydantic');
  if (flags.hasCelery)  pyLibs.push('celery[redis]');
  if (flags.hasLLM)     pyLibs.push('langchain');

  const lines = [
    `# Plan — ${projectName}`,
    '',
    '<!-- Fill by the plan-writer skill after /plan. -->',
    '',
    '## Architecture',
    '_(one paragraph — component boundaries, data flow)_',
    '',
    '## Feature decomposition',
    '_(map must-not-miss features from spec → implementable units)_',
    '',
    '## Phases',
    '- P0 — skeleton and golden path',
    '- P1 — features',
    '- P2 — polish',
    '',
    '## Risks',
    '_(known hard problems)_',
    '',
    '## Dependencies (placeholder — plan-writer will expand)',
    '- Infra: see `memory/services.json` + constitution §1.'
  ];
  if (jsLibs.length) lines.push(`- JS libs: ${jsLibs.join(', ')}.`);
  if (pyLibs.length) lines.push(`- Python libs: ${pyLibs.join(', ')}.`);
  lines.push(
    '',
    '## Testing strategy'
  );
  if (flags.hasNext)   lines.push('- Unit (JS): vitest in the web app.');
  if (flags.hasPython) lines.push('- Unit (Python): pytest in the api/worker apps.');
  if (flags.hasNext || flags.hasPython) {
    lines.push('- E2E: `scripts/smoke.sh` exercises the golden path.');
  }
  lines.push('');
  return lines.join('\n');
}

function renderDataModel(flags, projectName) {
  const lines = [
    `# Data model — ${projectName}`,
    '',
    '<!-- Fill by plan-writer. Match the chosen backend (SQL for Supabase, etc.). -->',
    '',
    '## Entities',
    '',
    '_(none yet)_',
    '',
    '## Relationships',
    '',
    '_(none yet)_',
    ''
  ];
  if (flags.hasSupabase) {
    lines.push(
      '## Row-Level Security',
      '',
      'All tables MUST have RLS enabled (constitution §2). Default policy: deny.',
      ''
    );
  }
  return lines.join('\n');
}

// Build tasks/spec.md from the 6 intake Q/A pairs.
async function renderSpec(project, proposal, questions) {
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  const outPath = path.join(project, 'tasks', 'spec.md');
  if (await pathExists(outPath)) return { path: outPath, overwritten: false };

  const byN = {};
  for (const q of questions) byN[q.n] = q;

  const section = (n, heading, fallback = '_(no answer recorded)_') => [
    `## ${heading}`,
    '',
    byN[n]?.answer || fallback,
    ''
  ].join('\n');

  const md = [
    `# Spec — ${path.basename(project)}`,
    '',
    '_Generated from `/nightshift intake` on ' + new Date().toISOString() + '._',
    '',
    section(1, '1. Problem'),
    section(2, '2. Primary user'),
    section(3, '3. Must-not-miss features'),
    section(5, '4. Hard constraints'),
    section(4, '5. Out of scope'),
    section(6, '6. Success criteria at wake-up'),
    '## 7. Open questions at intake',
    '',
    ...(((proposal.questions || []).length)
      ? proposal.questions.map(q => `- ${q}`)
      : ['_(none — answer the remaining ones before `/plan`.)_']),
    ''
  ].join('\n');

  await fs.writeFile(outPath, md, 'utf8');
  return { path: outPath, overwritten: true };
}

export async function scaffold(project, {
  registryRoot,
  autoCheckpoint = false,
  templateOverride
} = {}) {
  if (!project) throw new ScaffoldError('project path is required', { code: 'MISSING_PATH' });
  const abs = path.resolve(project);

  const intakeMarker = path.join(abs, '.nightshift', 'intake-pending');
  if (!await pathExists(intakeMarker)) {
    throw new ScaffoldError(`no intake marker at ${intakeMarker}. Run 'nightshift init' first.`, { code: 'NOT_INITIALIZED' });
  }

  const { proposal, questions } = await findApprovedProposal(abs);

  // Choose template. Currently only 'next-supabase-vercel' ships; other names
  // resolve to the same dir by design (ТЗ §1 fast-path hint). Stack-specific
  // content is rendered dynamically from the proposal (hotfix H8).
  const template = templateOverride || proposal.template || 'next-supabase-vercel';
  const templateDir = path.join(templatesRoot(), 'project-starter');
  if (!await pathExists(templateDir)) {
    throw new ScaffoldError(`template dir not found: ${templateDir}`, { code: 'NO_TEMPLATE_DIR' });
  }

  const flags = stackFlags(proposal);

  // Stack-agnostic files copy through; stack-specific files are rendered
  // from the proposal below. Next-only files (app/, lib/, next.config.mjs,
  // middleware.ts, tsconfig.json) skip entirely if the stack has no Next.
  const dynamicRel = [
    '.env.template',
    '.gitignore',
    'CLAUDE.md',
    'README.md',
    'package.json',
    path.join('.github', 'workflows', 'ci.yml'),
    path.join('scripts', 'smoke.sh'),
    path.join('tasks', 'contracts', 'PROJECT_STRUCTURE.md'),
    path.join('tasks', 'contracts', 'API.md'),
    path.join('tasks', 'contracts', 'TASK_TEMPLATE.md'),
    path.join('tasks', 'contracts', 'REVIEW_DIMENSIONS.md'),
    path.join('tasks', 'contracts', 'REUSE_FUNCTIONS.md'),
    path.join('tasks', 'plan.md'),
    path.join('tasks', 'data-model.md'),
    // already rendered separately:
    path.join('memory', 'constitution.md'),
    path.join('tasks', 'spec.md')
  ];
  const nextOnlyRel = flags.hasNext ? [] : [
    'app', 'lib', 'next.config.mjs', 'middleware.ts', 'tsconfig.json'
  ];

  // Copy template (selective — skip files we render from the proposal).
  const { copied, skipped } = await copyTree(templateDir, abs, {
    substitutions: { project: path.basename(abs) },
    excludeRel: [...dynamicRel, ...nextOnlyRel]
  });

  // Render constitution + spec from intake answers.
  const con = await renderConstitution(abs, proposal);
  const spec = await renderSpec(abs, proposal, questions);

  // Render all stack-specific surface files from the proposal. Pure helpers
  // returning strings → one writeFile each; never overwrite pre-existing
  // files the user may have hand-edited.
  const projectName = path.basename(abs);
  await writeIfAbsent(path.join(abs, '.env.template'), renderEnvTemplate(flags));
  await writeIfAbsent(path.join(abs, '.gitignore'),    renderGitignore(flags));
  await writeIfAbsent(path.join(abs, 'CLAUDE.md'),     renderClaudeMd(flags, projectName));
  await writeIfAbsent(path.join(abs, 'README.md'),     renderReadme(flags, projectName));
  await fs.mkdir(path.join(abs, '.github', 'workflows'), { recursive: true });
  await writeIfAbsent(path.join(abs, '.github', 'workflows', 'ci.yml'), renderCi(flags));
  await fs.mkdir(path.join(abs, 'scripts'), { recursive: true });
  await writeIfAbsent(path.join(abs, 'scripts', 'smoke.sh'), renderSmokeSh(flags));
  try { await fs.chmod(path.join(abs, 'scripts', 'smoke.sh'), 0o755); } catch {}
  const pkg = renderPackageJson(flags, projectName);
  if (pkg) await writeIfAbsent(path.join(abs, 'package.json'), pkg);
  const ws = renderPnpmWorkspace(flags);
  if (ws) await writeIfAbsent(path.join(abs, 'pnpm-workspace.yaml'), ws);
  await fs.mkdir(path.join(abs, 'tasks', 'contracts'), { recursive: true });
  await writeIfAbsent(path.join(abs, 'tasks', 'contracts', 'PROJECT_STRUCTURE.md'), renderProjectStructure(flags, projectName));
  await writeIfAbsent(path.join(abs, 'tasks', 'contracts', 'API.md'),               renderApiContracts(flags));
  await writeIfAbsent(path.join(abs, 'tasks', 'contracts', 'TASK_TEMPLATE.md'),     renderTaskTemplate(flags));
  await writeIfAbsent(path.join(abs, 'tasks', 'contracts', 'REVIEW_DIMENSIONS.md'), renderReviewDimensions(flags));
  await writeIfAbsent(path.join(abs, 'tasks', 'contracts', 'REUSE_FUNCTIONS.md'),   renderReuseFunctionsMd(flags));
  await writeIfAbsent(path.join(abs, 'tasks', 'plan.md'),       renderPlanPlaceholder(flags, projectName));
  await writeIfAbsent(path.join(abs, 'tasks', 'data-model.md'), renderDataModel(flags, projectName));

  // Wave C — seed the retrieval-memory surface. ndjson files start empty;
  // JSON stores get a schema_version=1 header so readers never see "missing".
  await fs.mkdir(path.join(abs, 'memory'), { recursive: true });
  for (const f of ['decisions.ndjson', 'incidents.ndjson']) {
    const p = path.join(abs, 'memory', f);
    if (!await pathExists(p)) await fs.writeFile(p, '', 'utf8');
  }
  const servicesPath = path.join(abs, 'memory', 'services.json');
  if (!await pathExists(servicesPath)) {
    await fs.writeFile(servicesPath, JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      providers: {}
    }, null, 2) + '\n', 'utf8');
  }
  const reuseIndexPath = path.join(abs, 'memory', 'reuse-index.json');
  if (!await pathExists(reuseIndexPath)) {
    await fs.writeFile(reuseIndexPath, JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      entries: renderReuseIndexEntries(flags)
    }, null, 2) + '\n', 'utf8');
  }

  // Emit decision.recorded for the approval (single entry, atomic).
  const logPath = path.join(abs, 'tasks', 'events.ndjson');
  const reg = new Registry(registryRoot ? { root: registryRoot } : {});
  const record = await reg.get(abs);
  const projectId = record?.project_id;
  const sid = genSessionId();

  const envBackup = process.env.NIGHTSHIFT_AUTO_CHECKPOINT;
  if (!autoCheckpoint) process.env.NIGHTSHIFT_AUTO_CHECKPOINT = '0';
  try {
    await appendEvent(logPath, {
      session_id: sid,
      agent: 'orchestrator',
      action: 'decision.recorded',
      payload: {
        kind: 'intake_approval',
        project_id: projectId,
        approved: true,
        template: proposal.template,
        stack: proposal.stack,
        providers: proposal.providers || [],
        initial_risk_class: proposal.initial_risk_class
      },
      notes: 'intake-interview verdict=approved → /nightshift confirm-scaffold'
    });
    await appendEvent(logPath, {
      session_id: sid,
      agent: 'orchestrator',
      action: 'session.start',
      payload: { project: path.basename(abs), stage: 'scaffolded' }
    });
  } finally {
    if (!autoCheckpoint) {
      if (envBackup == null) delete process.env.NIGHTSHIFT_AUTO_CHECKPOINT;
      else process.env.NIGHTSHIFT_AUTO_CHECKPOINT = envBackup;
    }
  }

  // Update registry: stage=ready, fill in what intake decided.
  if (record) {
    await reg.update(record.project_id, {
      stage: 'ready',
      template,
      stack: proposal.stack,
      providers: proposal.providers || []
    });
  }

  // Clear the intake-pending marker (convert it to intake-complete).
  await fs.rename(intakeMarker, path.join(abs, '.nightshift', 'intake-complete')).catch(() => {});

  // TZ fix-batch P0.5: seed a git repo + initial commit so the `/preflight`
  // guard ("is git tree clean or at least committed?") passes on the first
  // wave. Skipped if a repo already exists in the project dir.
  const gitInit = await maybeInitGit(abs);

  return {
    project_id: projectId,
    project_path: abs,
    template,
    files_copied: copied.length,
    files_skipped: skipped.length,
    constitution: con?.path,
    spec: spec?.path,
    git: gitInit
  };
}

async function maybeInitGit(projectDir) {
  const existing = path.join(projectDir, '.git');
  if (await pathExists(existing)) return { initialized: false, reason: 'repo_already_present' };

  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.status !== 0) return { initialized: false, reason: 'git_not_on_path' };

  const runGit = (args, opts = {}) =>
    spawnSync('git', args, { cwd: projectDir, encoding: 'utf8', ...opts });

  const init = runGit(['init', '-b', 'main']);
  if (init.status !== 0) {
    // Older git (<2.28) doesn't know -b; fall back to default branch +
    // manual rename. We still emit a diagnostic so callers can see why
    // the branch ended up as `master`.
    const legacy = runGit(['init']);
    if (legacy.status !== 0) {
      return { initialized: false, reason: 'git_init_failed', stderr: (init.stderr || legacy.stderr || '').trim() };
    }
    runGit(['checkout', '-b', 'main']);
  }

  // .gitignore is written by scaffold() via renderGitignore() (stack-aware).
  // If we arrive here without one (very defensive — pure git-init without a
  // full scaffold), fall back to a minimal universal ignore so we never
  // leave a git repo missing one.
  const gi = path.join(projectDir, '.gitignore');
  if (!await pathExists(gi)) {
    const body = [
      '.DS_Store',
      '.env',
      '.env.local',
      '.env.*.local',
      '# nightshift local state',
      '.nightshift/',
      ''
    ].join('\n');
    await fs.writeFile(gi, body, 'utf8');
  }

  // Stage everything we just wrote. The commit message intentionally
  // doesn't reference the event log — that surface is internal state.
  const add = runGit(['add', '-A']);
  if (add.status !== 0) {
    return { initialized: true, committed: false, reason: 'git_add_failed', stderr: (add.stderr || '').trim() };
  }

  // Local committer config when the host has none configured; `git commit`
  // exits non-zero with a cryptic message otherwise. Scoped to this repo.
  runGit(['config', 'user.email', 'nightshift@local']);
  runGit(['config', 'user.name', 'nightshift scaffold']);

  const commit = runGit(['commit', '-m', 'chore: nightshift scaffold']);
  if (commit.status !== 0) {
    return { initialized: true, committed: false, reason: 'git_commit_failed', stderr: (commit.stderr || '').trim() };
  }

  return { initialized: true, committed: true, branch: 'main' };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args[0] || args[0] === '-h' || args[0] === '--help') {
    process.stderr.write(`
Usage: nightshift-scaffold.mjs <project-path> [--template <name>]

Expects the project to already have .nightshift/intake-pending and an
approved proposal in .nightshift/intake.ndjson. Writes the full project
scaffold and flips the registry record to stage=ready.
    `.trim() + '\n');
    process.exit(args[0] ? 0 : 2);
  }
  const project = args[0];
  const override = (() => {
    const i = args.indexOf('--template');
    return i >= 0 ? args[i + 1] : undefined;
  })();
  try {
    const result = await scaffold(project, { templateOverride: override });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    if (err instanceof ScaffoldError) {
      process.stderr.write(`nightshift scaffold: ${err.message}\n`);
      process.exit(err.code === 'NOT_APPROVED' || err.code === 'NO_PROPOSAL' ? 3 : 2);
    }
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('[nightshift scaffold] fatal:', err.message); process.exit(1); });
}
