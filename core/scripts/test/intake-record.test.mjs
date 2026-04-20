import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve(new URL('../intake-record.mjs', import.meta.url).pathname);

function tmpProject() {
  return path.join(tmpdir(), `ns-intake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function seedMarker(project) {
  await fs.mkdir(path.join(project, '.nightshift'), { recursive: true });
  await fs.writeFile(
    path.join(project, '.nightshift', 'intake-pending'),
    'project_id=proj_abc123\nproject_name=test\nstatus=intake\n',
    'utf8'
  );
}

function run(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

test('intake-record q appends Q/A line with project_id + schema_version', async () => {
  const project = tmpProject();
  await seedMarker(project);
  const res = run([project, 'q', '--n', '1', '--question', 'What?', '--answer', 'A grocery app.']);
  assert.equal(res.status, 0, res.stderr);
  const log = await fs.readFile(path.join(project, '.nightshift', 'intake.ndjson'), 'utf8');
  const parsed = JSON.parse(log.trim());
  assert.equal(parsed.kind, 'q');
  assert.equal(parsed.n, 1);
  assert.equal(parsed.question, 'What?');
  assert.equal(parsed.answer, 'A grocery app.');
  assert.equal(parsed.project_id, 'proj_abc123');
  assert.equal(parsed.schema_version, 1);
  await fs.rm(project, { recursive: true, force: true });
});

test('intake-record proposal line defaults approved=null', async () => {
  const project = tmpProject();
  await seedMarker(project);
  const proposal = JSON.stringify({
    stack: 'next-supabase-vercel',
    template: 'next-supabase-vercel',
    providers: ['vercel', 'supabase'],
    initial_risk_class: 'safe',
    out_of_scope: ['auth'],
    success_criteria: 'Home page renders.',
    questions: []
  });
  const res = run([project, 'proposal', '--json', proposal]);
  assert.equal(res.status, 0, res.stderr);
  const log = await fs.readFile(path.join(project, '.nightshift', 'intake.ndjson'), 'utf8');
  const parsed = JSON.parse(log.trim());
  assert.equal(parsed.kind, 'proposal');
  assert.equal(parsed.approved, null);
  assert.equal(parsed.stack, 'next-supabase-vercel');
  await fs.rm(project, { recursive: true, force: true });
});

test('intake-record approve-last flips the last proposal', async () => {
  const project = tmpProject();
  await seedMarker(project);
  run([project, 'proposal', '--json', JSON.stringify({ stack: 'x', template: 't1' })]);
  run([project, 'proposal', '--json', JSON.stringify({ stack: 'y', template: 't2' })]);
  const res = run([project, 'approve-last']);
  assert.equal(res.status, 0, res.stderr);
  const log = await fs.readFile(path.join(project, '.nightshift', 'intake.ndjson'), 'utf8');
  const lines = log.trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].approved, null, 'older proposal must NOT be flipped');
  assert.equal(lines[1].approved, true, 'newest proposal must be approved');
  assert.ok(lines[1].approved_at);
  await fs.rm(project, { recursive: true, force: true });
});

test('intake-record approve-last fails if no proposal exists', async () => {
  const project = tmpProject();
  await seedMarker(project);
  const res = run([project, 'approve-last']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /no prior kind=proposal/);
  await fs.rm(project, { recursive: true, force: true });
});

test('intake-record abort appends abort line with reason', async () => {
  const project = tmpProject();
  await seedMarker(project);
  const res = run([project, 'abort', '--reason', 'out of budget']);
  assert.equal(res.status, 0, res.stderr);
  const log = await fs.readFile(path.join(project, '.nightshift', 'intake.ndjson'), 'utf8');
  const parsed = JSON.parse(log.trim());
  assert.equal(parsed.kind, 'abort');
  assert.equal(parsed.reason, 'out of budget');
  await fs.rm(project, { recursive: true, force: true });
});

test('intake-record revision appends revision with notes', async () => {
  const project = tmpProject();
  await seedMarker(project);
  const res = run([project, 'revision', '--notes', 'change template to api-worker']);
  assert.equal(res.status, 0, res.stderr);
  const log = await fs.readFile(path.join(project, '.nightshift', 'intake.ndjson'), 'utf8');
  const parsed = JSON.parse(log.trim());
  assert.equal(parsed.kind, 'revision');
  assert.equal(parsed.notes, 'change template to api-worker');
  await fs.rm(project, { recursive: true, force: true });
});

test('nightshift CLI intake-record subcommand forwards correctly', async () => {
  const CLI = path.resolve(new URL('../../../scripts/nightshift.sh', import.meta.url).pathname);
  const project = tmpProject();
  await seedMarker(project);
  const res = spawnSync('bash', [CLI, 'intake-record', project, 'q', '--n', '1', '--question', 'Q', '--answer', 'A'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const log = await fs.readFile(path.join(project, '.nightshift', 'intake.ndjson'), 'utf8');
  assert.match(log, /"kind":"q"/);
  await fs.rm(project, { recursive: true, force: true });
});
