import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffold } from '../nightshift-scaffold.mjs';

// Hotfix H_STACK: the constitution template used to hard-code Next.js +
// Supabase + Vercel under `## 1. Stack`. When intake picked a different
// stack (Python/FastAPI/Celery, Go, Rails, etc.) the top of constitution
// silently lied to /plan, because plan-writer reads `## 1. Stack` first
// and only later reaches the intake snapshot appended at the bottom.
//
// Fix: template carries a <!-- nightshift:stack-block --> marker; the
// scaffold CLI replaces it with a concrete stack section built from the
// intake proposal (stack identifier + providers + template). This test
// pins that behavior.

function tmpProject() {
  return path.join(tmpdir(), `ns-hotfix-stack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function seedIntake(project, proposal) {
  await fs.mkdir(path.join(project, '.nightshift'), { recursive: true });
  await fs.writeFile(path.join(project, '.nightshift', 'intake-pending'), '', 'utf8');
  const now = new Date().toISOString();
  const lines = [];
  for (let i = 1; i <= 6; i++) {
    lines.push({ ts: now, kind: 'q', n: i, answer: `a${i}` });
  }
  lines.push({ ts: now, kind: 'proposal', approved: true, ...proposal });
  await fs.writeFile(
    path.join(project, '.nightshift', 'intake.ndjson'),
    lines.map(l => JSON.stringify(l)).join('\n') + '\n',
    'utf8'
  );
}

test('scaffold writes Stack block built from proposal — Python/FastAPI/Celery case', async () => {
  const project = tmpProject();
  const registryRoot = path.join(tmpdir(), `ns-hotfix-reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await fs.mkdir(project, { recursive: true });
    await seedIntake(project, {
      template: 'api-worker',
      stack: 'python-fastapi-celery-redis-postgres-nextjs-tiptap',
      providers: ['railway', 'supabase', 'upstash-redis', 'openai'],
      initial_risk_class: 'review-required',
      success_criteria: 'works',
      questions: [],
      out_of_scope: []
    });

    await scaffold(project, { registryRoot, autoCheckpoint: false });
    const md = await fs.readFile(path.join(project, 'memory', 'constitution.md'), 'utf8');

    // Stack section exists and reflects the proposal — NOT the old
    // hardcoded Next.js/Supabase/Vercel default.
    const stackSection = md.split('## 2.')[0];
    assert.match(stackSection, /## 1\. Stack/);
    assert.match(stackSection, /Template: `api-worker`/);
    assert.match(stackSection, /python/i);
    assert.match(stackSection, /fastapi/i);
    assert.match(stackSection, /celery/i);
    assert.match(stackSection, /railway/);
    assert.ok(
      !/Frontend: Next\.js 15 \(App Router\) \+ TypeScript/.test(stackSection),
      `Stack section leaked the old hardcoded Next.js line. got:\n${stackSection}`
    );

    // The stack-block marker comment must be consumed (no leftover raw marker).
    assert.ok(
      !/<!--\s*nightshift:stack-block/.test(md),
      'stack-block marker must be replaced, not copied verbatim'
    );
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(registryRoot, { recursive: true, force: true });
  }
});

test('scaffold writes Stack block built from proposal — Next.js/Supabase case still works', async () => {
  const project = tmpProject();
  const registryRoot = path.join(tmpdir(), `ns-hotfix-reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await fs.mkdir(project, { recursive: true });
    await seedIntake(project, {
      template: 'next-supabase-vercel',
      stack: 'nextjs-supabase-vercel',
      providers: ['supabase', 'vercel'],
      initial_risk_class: 'safe',
      success_criteria: 'ok',
      questions: [],
      out_of_scope: []
    });

    await scaffold(project, { registryRoot, autoCheckpoint: false });
    const md = await fs.readFile(path.join(project, 'memory', 'constitution.md'), 'utf8');
    const stackSection = md.split('## 2.')[0];
    assert.match(stackSection, /## 1\. Stack/);
    assert.match(stackSection, /nextjs/i);
    assert.match(stackSection, /supabase/i);
    assert.match(stackSection, /vercel/);
    assert.match(stackSection, /Template: `next-supabase-vercel`/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(registryRoot, { recursive: true, force: true });
  }
});
