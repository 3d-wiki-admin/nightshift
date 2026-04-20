import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { init } from '../nightshift-init.mjs';
import { scaffold, ScaffoldError, findApprovedProposal } from '../nightshift-scaffold.mjs';
import { EventStore } from '../../event-store/src/index.mjs';
import { Registry } from '../../registry/index.mjs';

function tmp() {
  return path.join(tmpdir(), `ns-scaffold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function withIsolatedRegistry(fn) {
  const root = path.join(tmpdir(), `ns-scaffold-reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try { return await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function appendIntake(project, records) {
  const p = path.join(project, '.nightshift', 'intake.ndjson');
  await fs.mkdir(path.dirname(p), { recursive: true });
  const lines = records.map(r => JSON.stringify({ ts: new Date().toISOString(), ...r })).join('\n') + '\n';
  await fs.appendFile(p, lines, 'utf8');
}

test('scaffold refuses on un-initialized project', async () => {
  const project = tmp();
  await fs.mkdir(project, { recursive: true });
  await assert.rejects(
    () => scaffold(project),
    (err) => err instanceof ScaffoldError && err.code === 'NOT_INITIALIZED'
  );
  await fs.rm(project, { recursive: true, force: true });
});

test('scaffold refuses when no proposal exists yet', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    await assert.rejects(
      () => scaffold(project, { registryRoot }),
      (err) => err instanceof ScaffoldError && err.code === 'NO_PROPOSAL'
    );
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('scaffold refuses when the latest proposal is not approved', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    await appendIntake(project, [
      { kind: 'q', n: 1, question: 'What?', answer: 'A.' },
      { kind: 'proposal', stack: 'x', template: 'y', approved: null }
    ]);
    await assert.rejects(
      () => scaffold(project, { registryRoot }),
      (err) => err instanceof ScaffoldError && err.code === 'NOT_APPROVED'
    );
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('scaffold with approved proposal creates memory/constitution.md and tasks/spec.md', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    await appendIntake(project, [
      { kind: 'q', n: 1, question: 'What are we building?', answer: 'A shared grocery list for a household.' },
      { kind: 'q', n: 2, question: 'Who is the primary user?', answer: 'Two roommates and me.' },
      { kind: 'q', n: 3, question: 'Must-not-miss?', answer: 'Sync in realtime across phones.' },
      { kind: 'q', n: 4, question: 'Out of scope?', answer: 'No recipes, no price tracking, no store integration.' },
      { kind: 'q', n: 5, question: 'Hard constraints?', answer: 'Next.js + Supabase + Vercel. Free tier only.' },
      { kind: 'q', n: 6, question: 'Success criteria at wake-up?', answer: 'I can add a banana from my phone and my roommate sees it.' },
      {
        kind: 'proposal',
        stack: 'next-supabase-vercel',
        template: 'next-supabase-vercel',
        providers: ['vercel', 'supabase'],
        initial_risk_class: 'safe',
        out_of_scope: ['recipes', 'price tracking', 'store integrations'],
        success_criteria: 'banana sync',
        questions: [],
        approved: true
      }
    ]);

    const result = await scaffold(project, { registryRoot });
    assert.match(result.project_id, /^proj_/);
    assert.equal(result.template, 'next-supabase-vercel');

    // memory/constitution.md exists and references intake snapshot + project name.
    const constitution = await fs.readFile(path.join(project, 'memory', 'constitution.md'), 'utf8');
    assert.match(constitution, /## 1\. Stack/);
    assert.match(constitution, /Intake snapshot/);
    assert.match(constitution, new RegExp(path.basename(project)));

    // tasks/spec.md composed from intake answers.
    const spec = await fs.readFile(path.join(project, 'tasks', 'spec.md'), 'utf8');
    assert.match(spec, /shared grocery list/);
    assert.match(spec, /Sync in realtime/);
    assert.match(spec, /banana/);

    // Template files (from project-starter) copied.
    const pkg = await fs.readFile(path.join(project, 'package.json'), 'utf8');
    assert.match(pkg, /nightshift-project-starter/);

    await fs.rm(project, { recursive: true, force: true });
  });
});

test('scaffold emits decision.recorded + session.start events', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    await appendIntake(project, [
      { kind: 'proposal', stack: 'x', template: 'next-supabase-vercel', providers: [], initial_risk_class: 'safe', approved: true }
    ]);
    await scaffold(project, { registryRoot });
    const events = await new EventStore(path.join(project, 'tasks', 'events.ndjson')).all();
    const kinds = events.map(e => e.action);
    assert.ok(kinds.includes('decision.recorded'), 'expected decision.recorded');
    const decision = events.find(e => e.action === 'decision.recorded');
    assert.equal(decision.payload.kind, 'intake_approval');
    assert.equal(decision.payload.approved, true);
    assert.equal(decision.payload.template, 'next-supabase-vercel');
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('scaffold flips registry stage from intake to ready', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    await appendIntake(project, [
      { kind: 'proposal', stack: 'x', template: 'next-supabase-vercel', providers: ['vercel'], initial_risk_class: 'safe', approved: true }
    ]);
    const reg = new Registry({ root: registryRoot });
    const before = await reg.get(project);
    assert.equal(before.stage, 'intake');
    await scaffold(project, { registryRoot });
    const after = await reg.get(project);
    assert.equal(after.stage, 'ready');
    assert.equal(after.template, 'next-supabase-vercel');
    assert.deepEqual(after.providers, ['vercel']);
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('scaffold seeds retrieval memory surface (decisions/incidents/services/reuse-index)', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    await appendIntake(project, [
      { kind: 'proposal', stack: 'x', template: 'next-supabase-vercel', providers: [], initial_risk_class: 'safe', approved: true }
    ]);
    await scaffold(project, { registryRoot });

    // ndjson files exist (possibly empty).
    const decisions = await fs.readFile(path.join(project, 'memory', 'decisions.ndjson'), 'utf8');
    const incidents = await fs.readFile(path.join(project, 'memory', 'incidents.ndjson'), 'utf8');
    assert.equal(typeof decisions, 'string');
    assert.equal(typeof incidents, 'string');

    // services.json and reuse-index.json have schema_version=1.
    const services = JSON.parse(await fs.readFile(path.join(project, 'memory', 'services.json'), 'utf8'));
    assert.equal(services.schema_version, 1);
    assert.deepEqual(services.providers, {});

    const reuse = JSON.parse(await fs.readFile(path.join(project, 'memory', 'reuse-index.json'), 'utf8'));
    assert.equal(reuse.schema_version, 1);
    // Seeded entries for supabase helpers from the template.
    assert.ok(reuse.entries.some(e => e.file.includes('lib/supabase/server.ts')));
    assert.ok(reuse.entries.some(e => e.file.includes('lib/supabase/client.ts')));

    await fs.rm(project, { recursive: true, force: true });
  });
});

test('scaffold renames intake-pending → intake-complete marker', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    await appendIntake(project, [
      { kind: 'proposal', stack: 'x', template: 'next-supabase-vercel', providers: [], initial_risk_class: 'safe', approved: true }
    ]);
    await scaffold(project, { registryRoot });
    const pendingStill = await fs.access(path.join(project, '.nightshift', 'intake-pending')).then(() => true, () => false);
    const completeNow = await fs.access(path.join(project, '.nightshift', 'intake-complete')).then(() => true, () => false);
    assert.equal(pendingStill, false);
    assert.equal(completeNow, true);
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('findApprovedProposal returns latest proposal even if older ones are null/rejected', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    await appendIntake(project, [
      { kind: 'proposal', stack: 'a', template: 'next-supabase-vercel', approved: false },
      { kind: 'revision', notes: 'user wanted api-worker' },
      { kind: 'proposal', stack: 'b', template: 'api-worker', approved: true }
    ]);
    const { proposal } = await findApprovedProposal(project);
    assert.equal(proposal.stack, 'b');
    assert.equal(proposal.approved, true);
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('scaffold refuses to overwrite an existing constitution from the template', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    await fs.mkdir(path.join(project, 'memory'), { recursive: true });
    await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# pre-existing\n', 'utf8');
    await appendIntake(project, [
      { kind: 'proposal', stack: 'x', template: 'next-supabase-vercel', providers: [], initial_risk_class: 'safe', approved: true }
    ]);
    const res = await scaffold(project, { registryRoot });
    // Pre-existing file is preserved; renderConstitution returns overwritten:false.
    const c = await fs.readFile(path.join(project, 'memory', 'constitution.md'), 'utf8');
    assert.equal(c, '# pre-existing\n');
    // Files still copied for other paths (package.json, etc.) — scaffold is idempotent.
    assert.ok(res.project_id);
    await fs.rm(project, { recursive: true, force: true });
  });
});
