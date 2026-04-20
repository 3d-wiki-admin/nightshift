import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffold } from '../nightshift-scaffold.mjs';

// Hotfix H8: every stack-specific file in project-starter/ used to be
// hard-coded to Next.js+Supabase+Vercel. Scaffold now renders them from
// the intake proposal. These tests pin, per stack shape, that:
//   - Python-only stacks do NOT inherit Next-only files
//   - Monorepo stacks (Python backend + Next.js frontend) get monorepo
//     layout in every surface (CLAUDE.md commands, CI jobs, contracts)
//   - Next-only stacks still produce a working Next package.json

function tmpProject() {
  return path.join(tmpdir(), `ns-h8-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}
function tmpReg() {
  return path.join(tmpdir(), `ns-h8-reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function seedIntake(project, proposal) {
  await fs.mkdir(path.join(project, '.nightshift'), { recursive: true });
  await fs.writeFile(path.join(project, '.nightshift', 'intake-pending'), '', 'utf8');
  const now = new Date().toISOString();
  const lines = [];
  for (let i = 1; i <= 6; i++) lines.push({ ts: now, kind: 'q', n: i, answer: `a${i}` });
  lines.push({ ts: now, kind: 'proposal', approved: true, success_criteria: 'ok', questions: [], out_of_scope: [], ...proposal });
  await fs.writeFile(path.join(project, '.nightshift', 'intake.ndjson'),
    lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}

async function run(project, proposal) {
  const registryRoot = tmpReg();
  await fs.mkdir(project, { recursive: true });
  await seedIntake(project, proposal);
  await scaffold(project, { registryRoot, autoCheckpoint: false });
  return registryRoot;
}

test('Python+Next monorepo stack: CLAUDE.md carries poetry + pnpm commands', async () => {
  const project = tmpProject();
  const reg = await run(project, {
    template: 'api-worker',
    stack: 'python-fastapi-celery-redis-postgres-nextjs-tiptap',
    providers: ['railway', 'supabase', 'upstash-redis', 'openai', 'anthropic', 'openrouter', 'google-drive-api', 'vercel'],
    initial_risk_class: 'review-required'
  });
  try {
    const claude = await fs.readFile(path.join(project, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /poetry run pytest/);
    assert.match(claude, /poetry run mypy --strict/);
    assert.match(claude, /poetry run ruff check/);
    assert.match(claude, /cd apps\/api/);
    assert.match(claude, /pnpm -C apps\/web (dev|typecheck)/);
    assert.match(claude, /celery -A app\.worker worker/);
    assert.match(claude, /Monorepo: `apps\/api`/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(reg, { recursive: true, force: true });
  }
});

test('Python+Next monorepo stack: .env.template ships LLM + Celery + Google keys', async () => {
  const project = tmpProject();
  const reg = await run(project, {
    template: 'api-worker',
    stack: 'python-fastapi-celery-redis-postgres-nextjs',
    providers: ['railway', 'supabase', 'upstash-redis', 'openai', 'anthropic', 'openrouter', 'google-drive-api', 'vercel'],
    initial_risk_class: 'review-required'
  });
  try {
    const env = await fs.readFile(path.join(project, '.env.template'), 'utf8');
    assert.match(env, /OPENAI_API_KEY=\{\{SECRET:OPENAI_API_KEY\}\}/);
    assert.match(env, /ANTHROPIC_API_KEY=\{\{SECRET:ANTHROPIC_API_KEY\}\}/);
    assert.match(env, /OPENROUTER_API_KEY=\{\{SECRET:OPENROUTER_API_KEY\}\}/);
    assert.match(env, /DATABASE_URL=\{\{SECRET:DATABASE_URL\}\}/);
    assert.match(env, /UPSTASH_REDIS_REST_URL=/);
    assert.match(env, /CELERY_BROKER_URL=/);
    assert.match(env, /GOOGLE_SERVICE_ACCOUNT_JSON=/);
    assert.match(env, /RAILWAY_TOKEN=/);
    assert.match(env, /VERCEL_TOKEN=/);
    assert.match(env, /NEXT_PUBLIC_SUPABASE_URL=/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(reg, { recursive: true, force: true });
  }
});

test('Python+Next monorepo stack: CI has web + api + worker + smoke jobs', async () => {
  const project = tmpProject();
  const reg = await run(project, {
    template: 'api-worker',
    stack: 'python-fastapi-celery-redis-postgres-nextjs',
    providers: ['railway', 'supabase', 'vercel'],
    initial_risk_class: 'review-required'
  });
  try {
    const ci = await fs.readFile(path.join(project, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(ci, /name: web \(Next\.js/);
    assert.match(ci, /name: api \(Python\)/);
    assert.match(ci, /name: worker \(Celery\)/);
    assert.match(ci, /needs: \[web, api\]/);
    assert.match(ci, /poetry run mypy --strict/);
    assert.match(ci, /pnpm -C apps\/web build/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(reg, { recursive: true, force: true });
  }
});

test('Python+Next monorepo stack: smoke.sh covers both FastAPI and Next', async () => {
  const project = tmpProject();
  const reg = await run(project, {
    template: 'api-worker',
    stack: 'python-fastapi-nextjs',
    providers: ['railway', 'vercel'],
    initial_risk_class: 'review-required'
  });
  try {
    const smoke = await fs.readFile(path.join(project, 'scripts', 'smoke.sh'), 'utf8');
    assert.match(smoke, /uvicorn app\.main:app/);
    assert.match(smoke, /wait_for "http:\/\/127\.0\.0\.1:8001\/health"/);
    assert.match(smoke, /wait_for "http:\/\/127\.0\.0\.1:3001\/"/);
    assert.match(smoke, /pnpm -C apps\/web build/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(reg, { recursive: true, force: true });
  }
});

test('Python+Next monorepo stack: .gitignore carries both Node and Python patterns', async () => {
  const project = tmpProject();
  const reg = await run(project, {
    template: 'api-worker',
    stack: 'python-fastapi-nextjs',
    providers: ['railway'],
    initial_risk_class: 'safe'
  });
  try {
    const gi = await fs.readFile(path.join(project, '.gitignore'), 'utf8');
    assert.match(gi, /node_modules\//);
    assert.match(gi, /\.next\//);
    assert.match(gi, /__pycache__\//);
    assert.match(gi, /\.venv\//);
    assert.match(gi, /\.mypy_cache\//);
    assert.match(gi, /\.pytest_cache\//);
    assert.match(gi, /\.ruff_cache\//);
    assert.match(gi, /\.nightshift\//);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(reg, { recursive: true, force: true });
  }
});

test('Python+Next monorepo stack: package.json is a workspace root, not Next app', async () => {
  const project = tmpProject();
  const reg = await run(project, {
    template: 'api-worker',
    stack: 'python-fastapi-nextjs',
    providers: ['railway', 'vercel'],
    initial_risk_class: 'safe'
  });
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
    assert.equal(pkg.name, path.basename(project));
    assert.ok(!pkg.dependencies, 'monorepo root must NOT carry Next runtime deps');
    assert.ok(!pkg.scripts,       'monorepo root must NOT carry pnpm app scripts');
    assert.equal(pkg.packageManager, 'pnpm@10.0.0');

    const ws = await fs.readFile(path.join(project, 'pnpm-workspace.yaml'), 'utf8');
    assert.match(ws, /apps\/web/);
    assert.match(ws, /packages\/\*/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(reg, { recursive: true, force: true });
  }
});

test('Python-only stack does NOT ship Next.js files', async () => {
  const project = tmpProject();
  const reg = await run(project, {
    template: 'api-worker',
    stack: 'python-fastapi-celery',
    providers: ['railway'],
    initial_risk_class: 'safe'
  });
  try {
    for (const rel of ['app', 'lib', 'next.config.mjs', 'middleware.ts', 'tsconfig.json']) {
      const stat = await fs.stat(path.join(project, rel)).catch(() => null);
      assert.equal(stat, null, `pure-Python stack must not copy ${rel} from the Next.js fragment`);
    }
    const claude = await fs.readFile(path.join(project, 'CLAUDE.md'), 'utf8');
    assert.ok(!/pnpm dev/.test(claude), 'CLAUDE.md for pure-Python stack must not reference pnpm dev');
    const pkgExists = await fs.stat(path.join(project, 'package.json')).catch(() => null);
    assert.equal(pkgExists, null, 'pure-Python stack must not ship a root package.json');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(reg, { recursive: true, force: true });
  }
});

test('Python+Next monorepo stack: contract templates match monorepo layout', async () => {
  const project = tmpProject();
  const reg = await run(project, {
    template: 'api-worker',
    stack: 'python-fastapi-nextjs',
    providers: ['railway', 'vercel', 'supabase'],
    initial_risk_class: 'review-required'
  });
  try {
    const structure = await fs.readFile(path.join(project, 'tasks', 'contracts', 'PROJECT_STRUCTURE.md'), 'utf8');
    // Tree-formatted — we match on the line-level descriptors the renderer
    // emits (literal `apps/api` string doesn't exist because the tree
    // draws it on two lines: `├── apps/` then `│   ├── api/`).
    assert.match(structure, /FastAPI \(Python 3\.12, poetry\)/);
    assert.match(structure, /Next\.js 15 App Router \(TypeScript, pnpm\)/);
    assert.match(structure, /shared TS types \+ Zod schemas/);

    const api = await fs.readFile(path.join(project, 'tasks', 'contracts', 'API.md'), 'utf8');
    assert.match(api, /FastAPI \(`apps\/api`\)/);
    assert.match(api, /Pydantic v2/);
    assert.match(api, /Next\.js API \(`apps\/web\/app\/api\/`\)/);
    assert.match(api, /packages\/shared/);

    const taskT = await fs.readFile(path.join(project, 'tasks', 'contracts', 'TASK_TEMPLATE.md'), 'utf8');
    assert.match(taskT, /pnpm -C apps\/web/);
    assert.match(taskT, /cd apps\/<api\|worker>/);
    assert.match(taskT, /poetry run mypy --strict/);

    const review = await fs.readFile(path.join(project, 'tasks', 'contracts', 'REVIEW_DIMENSIONS.md'), 'utf8');
    assert.match(review, /pnpm audit/);
    assert.match(review, /poetry show --outdated/);
    assert.match(review, /both stacks/i);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(reg, { recursive: true, force: true });
  }
});

test('Next-only stack: Next dependencies still land in package.json', async () => {
  const project = tmpProject();
  const reg = await run(project, {
    template: 'next-supabase-vercel',
    stack: 'nextjs-supabase-vercel',
    providers: ['supabase', 'vercel'],
    initial_risk_class: 'safe'
  });
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
    assert.equal(pkg.name, path.basename(project));
    assert.match(pkg.dependencies?.next || '', /^\^15\./);
    assert.ok(pkg.dependencies?.['@supabase/ssr'], 'Next+Supabase stack expects @supabase/ssr dep');
    assert.ok(pkg.scripts?.dev, 'Next-only stack retains next dev script');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(reg, { recursive: true, force: true });
  }
});
