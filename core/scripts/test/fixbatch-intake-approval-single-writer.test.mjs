import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffold } from '../nightshift-scaffold.mjs';
import { EventStore } from '../../event-store/src/index.mjs';

// TZ fix-batch P0.4: exactly one decision.recorded with kind=intake_approval
// must be emitted per scaffold. The scaffold CLI is the single writer; the
// /nightshift confirm-scaffold prompt must NOT also append its own event.

function tmpProject() {
  return path.join(tmpdir(), `ns-fixbatch-approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function seedIntake(project, { approved = true } = {}) {
  await fs.mkdir(path.join(project, '.nightshift'), { recursive: true });
  await fs.writeFile(path.join(project, '.nightshift', 'intake-pending'), '', 'utf8');
  const now = new Date().toISOString();
  const lines = [
    { ts: now, kind: 'q', n: 1, answer: 'a kitchen-sink demo' },
    { ts: now, kind: 'q', n: 2, answer: 'the user' },
    { ts: now, kind: 'q', n: 3, answer: 'do a thing' },
    { ts: now, kind: 'q', n: 4, answer: 'nothing fancy' },
    { ts: now, kind: 'q', n: 5, answer: 'no hard constraints' },
    { ts: now, kind: 'q', n: 6, answer: 'it works by morning' },
    {
      ts: now,
      kind: 'proposal',
      approved,
      template: 'next-supabase-vercel',
      stack: 'nextjs-supabase-vercel',
      providers: ['supabase'],
      initial_risk_class: 'review-required',
      success_criteria: 'it works',
      questions: [],
      out_of_scope: []
    }
  ];
  await fs.writeFile(
    path.join(project, '.nightshift', 'intake.ndjson'),
    lines.map(l => JSON.stringify(l)).join('\n') + '\n',
    'utf8'
  );
}

test('scaffold emits exactly one decision.recorded with kind=intake_approval', async () => {
  const project = tmpProject();
  const registryRoot = path.join(tmpdir(), `ns-fixbatch-registry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await fs.mkdir(project, { recursive: true });
    await seedIntake(project);

    await scaffold(project, { registryRoot, autoCheckpoint: false });

    const logPath = path.join(project, 'tasks', 'events.ndjson');
    const events = await new EventStore(logPath).all();

    const approvals = events.filter(
      e => e.action === 'decision.recorded' && e.payload?.kind === 'intake_approval'
    );
    assert.equal(approvals.length, 1,
      `expected exactly one decision.recorded{kind:intake_approval}; got ${approvals.length}`);
    assert.equal(approvals[0].payload.approved, true);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(registryRoot, { recursive: true, force: true });
  }
});

test('/nightshift confirm-scaffold prompt does NOT instruct Claude to append the approval event', async () => {
  const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
  const cmd = await fs.readFile(path.join(ROOT, 'claude', 'commands', 'nightshift.md'), 'utf8');

  // Extract the confirm-scaffold section only — anything up to the next H2.
  const section = cmd.split(/^## /m).find(s => s.startsWith('`confirm-scaffold`')) || '';
  assert.ok(section, 'could not find confirm-scaffold section in commands/nightshift.md');

  // The prompt must explicitly forbid appending the approval event, not
  // just "avoid mentioning" it. Earlier versions told Claude to run
  // `nightshift dispatch append` for decision.recorded in addition to the
  // CLI; the scaffold CLI already writes that event, so the prompt-layer
  // emission was a duplicate.
  assert.match(section, /NEVER append the approval event yourself/);
  assert.ok(
    !/dispatch append.*decision\.recorded|decision\.recorded.*dispatch append/s.test(section),
    'confirm-scaffold prompt must not instruct dispatch-append of decision.recorded (scaffold CLI owns it).'
  );
});
