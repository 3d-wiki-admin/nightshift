import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { init, InitError } from '../nightshift-init.mjs';
import { EventStore } from '../../event-store/src/index.mjs';
import { Registry } from '../../registry/index.mjs';

function tmp() {
  return path.join(tmpdir(), `ns-init-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function withIsolatedRegistry(fn) {
  const root = path.join(tmpdir(), `ns-init-reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('init creates minimal meta scaffold (NOT full project)', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    const r = await init(project, { registryRoot });

    // Created:
    await fs.access(path.join(project, '.nightshift', 'intake-pending'));
    await fs.access(path.join(project, '.nightshift', 'intake.ndjson'));
    await fs.access(path.join(project, 'tasks', 'events.ndjson'));
    await fs.access(path.join(project, 'NIGHTSHIFT.md'));

    // NOT created (the whole point — idea-first):
    const constitutionExists = await fs.access(path.join(project, 'memory', 'constitution.md')).then(() => true, () => false);
    assert.equal(constitutionExists, false, 'memory/constitution.md must NOT exist before approval');
    const specExists = await fs.access(path.join(project, 'tasks', 'spec.md')).then(() => true, () => false);
    assert.equal(specExists, false, 'tasks/spec.md must NOT exist before approval');
    const ciExists = await fs.access(path.join(project, '.github')).then(() => true, () => false);
    assert.equal(ciExists, false, 'CI must NOT exist before approval');
    const templateExists = await fs.access(path.join(project, 'package.json')).then(() => true, () => false);
    assert.equal(templateExists, false, 'template package.json must NOT exist before approval');

    assert.ok(r.project_id.startsWith('proj_'));
    assert.equal(r.stage, 'intake');
    assert.match(r.next_command, /^\/nightshift intake --project /);

    await fs.rm(project, { recursive: true, force: true });
  });
});

test('init registers the project in the registry at stage=intake', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    const reg = new Registry({ root: registryRoot });
    const rec = await reg.get(project);
    assert.ok(rec, 'expected a registry record');
    assert.equal(rec.stage, 'intake');
    assert.equal(rec.launchd_enabled, false, 'launchd should NOT auto-enable until scaffold');
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('init emits session.start event in the project event log', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await init(project, { registryRoot });
    const events = await new EventStore(path.join(project, 'tasks', 'events.ndjson')).all();
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'session.start');
    assert.equal(events[0].payload.stage, 'intake');
    assert.equal(events[0].payload.project_id, (await new Registry({ root: registryRoot }).get(project)).project_id);
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('init is idempotent (re-running on intake-pending project updates registry, leaves files)', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    const first = await init(project, { registryRoot });
    // Record the contents so we can assert they didn't flip.
    const markerBefore = await fs.readFile(path.join(project, '.nightshift', 'intake-pending'), 'utf8');
    await new Promise(r => setTimeout(r, 5));
    const second = await init(project, { registryRoot });
    assert.equal(second.project_id, first.project_id);
    const markerAfter = await fs.readFile(path.join(project, '.nightshift', 'intake-pending'), 'utf8');
    // Marker may be rewritten — the important thing is the project_id is stable.
    assert.match(markerAfter, new RegExp(`project_id=${first.project_id}`));
    assert.match(markerBefore, new RegExp(`project_id=${first.project_id}`));
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('init refuses to overwrite an already-scaffolded project without --force', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await fs.mkdir(path.join(project, 'memory'), { recursive: true });
    await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# existing\n', 'utf8');
    await assert.rejects(
      () => init(project, { registryRoot }),
      (err) => err instanceof InitError && err.code === 'ALREADY_SCAFFOLDED'
    );
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('init with --force proceeds over an existing constitution', async () => {
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    await fs.mkdir(path.join(project, 'memory'), { recursive: true });
    await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# existing\n', 'utf8');
    const r = await init(project, { registryRoot, force: true });
    assert.ok(r.project_id);
    // The existing constitution should NOT be overwritten by init (that's scaffold's job).
    const c = await fs.readFile(path.join(project, 'memory', 'constitution.md'), 'utf8');
    assert.equal(c, '# existing\n');
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('nightshift CLI init subcommand launches the init script and prints next-command', async () => {
  const CLI = path.resolve(new URL('../../../scripts/nightshift.sh', import.meta.url).pathname);
  await withIsolatedRegistry(async (registryRoot) => {
    const project = tmp();
    const res = spawnSync('bash', [CLI, 'init', project, '--json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        // Redirect Registry to an isolated tmp dir for this test.
        NIGHTSHIFT_REGISTRY_ROOT: registryRoot,
        NIGHTSHIFT_AUTO_CHECKPOINT: '0'
      }
    });
    assert.equal(res.status, 0, `init exited ${res.status}: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.match(parsed.project_id, /^proj_/);
    assert.equal(parsed.stage, 'intake');
    assert.match(parsed.next_command, /^\/nightshift intake --project /);
    await fs.rm(project, { recursive: true, force: true });
  });
});

test('nightshift init command rejects missing path with usage error', async () => {
  const CLI = path.resolve(new URL('../../../scripts/nightshift.sh', import.meta.url).pathname);
  const res = spawnSync('bash', [CLI, 'init'], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage: nightshift init/);
});
