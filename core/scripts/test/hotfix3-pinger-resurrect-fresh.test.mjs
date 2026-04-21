import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { renderHandoff } from '../wave-handoff.mjs';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const HEALTH_PING = path.join(ROOT, 'core', 'scripts', 'health-ping.mjs');

function tmp(name = 'ns-h16') {
  return path.join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function writeExec(filePath, body) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, { mode: 0o755 });
}

function makeEvent(action, overrides = {}) {
  return {
    event_id: overrides.event_id || `ev_${Math.random().toString(36).slice(2, 18).toUpperCase()}`,
    ts: overrides.ts || '2026-04-21T00:00:00.000Z',
    session_id: overrides.session_id || 'sess_01HXYZ000000000000000001',
    agent: overrides.agent || 'orchestrator',
    action,
    ...overrides
  };
}

async function bootstrapProject(events = []) {
  const project = tmp('ns-h16-project');
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  if (events.length > 0) {
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      events.map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );
  }
  return project;
}

async function readEvents(project) {
  const logPath = path.join(project, 'tasks', 'events.ndjson');
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    return raw.trim() ? raw.trim().split('\n').map(line => JSON.parse(line)) : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function setupFakeClaude(options = {}) {
  const { sleepMs = 0, writeDispatchEvent = false } = options;
  const binDir = tmp('ns-h16-bin');
  const recordPath = path.join(binDir, 'claude-record.ndjson');
  const claudePath = path.join(binDir, 'claude-stub.mjs');
  await writeExec(claudePath, [
    '#!/usr/bin/env node',
    "import { appendFileSync } from 'node:fs';",
    "import path from 'node:path';",
    `const recordPath = ${JSON.stringify(recordPath)};`,
    'const payload = { argv: process.argv.slice(2), env: { NIGHTSHIFT_SESSION_ID: process.env.NIGHTSHIFT_SESSION_ID || null } };',
    "appendFileSync(recordPath, JSON.stringify(payload) + '\\n');",
    writeDispatchEvent
      ? [
          "const waveArg = process.argv.slice(2).find(arg => /--wave=\\d+/.test(arg));",
          'const wave = waveArg ? Number(waveArg.match(/--wave=(\\d+)/)[1]) : null;',
          "const logPath = path.join(process.cwd(), 'tasks', 'events.ndjson');",
          "appendFileSync(logPath, JSON.stringify({",
          "  event_id: `ev_${Date.now()}_FAKECLAUDE`,",
          "  ts: new Date().toISOString(),",
          "  session_id: process.env.NIGHTSHIFT_SESSION_ID || null,",
          "  agent: 'fake-claude',",
          "  action: 'task.dispatched',",
          '  wave,',
          "  task_id: 'TASK_FAKE_001'",
          "}) + '\\n');"
        ].join('\n')
      : '',
    sleepMs > 0 ? `setTimeout(() => process.exit(0), ${sleepMs});` : ''
  ].join('\n'));
  return { binDir, claudePath, recordPath };
}

function runHealthPing(project, env = {}) {
  return spawnSync('node', [HEALTH_PING, project], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTSHIFT_AUTO_CHECKPOINT: '0', ...env }
  });
}

function runHealthPingAsync(project, env = {}, delayMs = 0) {
  return new Promise((resolve, reject) => {
    const launch = () => {
      const child = spawn('node', [HEALTH_PING, project], {
        env: { ...process.env, NIGHTSHIFT_AUTO_CHECKPOINT: '0', ...env },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', status => resolve({ status, stdout, stderr }));
    };

    if (delayMs > 0) {
      setTimeout(launch, delayMs);
    } else {
      launch();
    }
  });
}

async function readRecords(recordPath) {
  try {
    const raw = await fs.readFile(recordPath, 'utf8');
    return raw.trim() ? raw.trim().split('\n').map(line => JSON.parse(line)) : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function waitForRecordCount(recordPath, expected, timeoutMs = 2000) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    const records = await readRecords(recordPath);
    if (records.length >= expected) return records;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return readRecords(recordPath);
}

async function waitFor(fn, timeoutMs = 2000, intervalMs = 25) {
  const start = Date.now();
  let lastError;
  while ((Date.now() - start) < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  if (lastError) throw lastError;
  return await fn();
}

async function assertNoSpawn(recordPath) {
  await new Promise(resolve => setTimeout(resolve, 150));
  const records = await readRecords(recordPath);
  assert.equal(records.length, 0, 'expected no fresh claude spawn');
}

function staleTs(minutes = 90) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function writeManifest(project, wave) {
  const manifestPath = path.join(project, 'tasks', 'waves', String(wave), 'manifest.yaml');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `wave: ${wave}\n`, 'utf8');
  return `tasks/waves/${wave}/manifest.yaml`;
}

async function writeHandoff(project, options = {}) {
  const sourceWave = options.sourceWave ?? 1;
  const nextWave = options.nextWave ?? (sourceWave + 1);
  const sourceSessionId = options.sourceSessionId ?? 'sess_01KPP9ABCDEFGHJKMNPQRSTVW';
  const handoffToken = options.handoffToken ?? `${sourceWave}-to-${nextWave}-token`;
  const nextManifest = options.nextManifest ?? `tasks/waves/${nextWave}/manifest.yaml`;
  const handoffRelPath = `tasks/waves/${sourceWave}/handoff-to-next.md`;
  const handoffAbsPath = path.join(project, handoffRelPath);
  await fs.mkdir(path.dirname(handoffAbsPath), { recursive: true });
  await fs.writeFile(handoffAbsPath, renderHandoff({
    source_wave: sourceWave,
    next_wave: nextWave,
    source_session_id: sourceSessionId,
    handoff_token: handoffToken,
    summary: options.summary || `Wave ${sourceWave} complete.`,
    pending: options.pending || ['TASK_NEXT_001'],
    next_manifest: options.fileNextManifest || nextManifest,
    first_task: options.firstTask || 'TASK_NEXT_001',
    reread_files: options.rereadFiles || [nextManifest, `${handoffRelPath} (this file)`],
    ephemeral_nuances: options.ephemeralNuances || ['none']
  }), 'utf8');
  return { handoffRelPath, handoffToken, sourceSessionId, nextManifest, sourceWave, nextWave };
}

function waveHandoffEvent(handoff, overrides = {}) {
  return makeEvent('wave.handoff', {
    event_id: overrides.event_id || 'ev_01HXYZ000000000000000H16',
    ts: overrides.ts || staleTs(),
    wave: handoff.sourceWave,
    agent: 'orchestrator',
    payload: {
      source_wave: handoff.sourceWave,
      next_wave: handoff.nextWave,
      source_session_id: handoff.sourceSessionId,
      handoff_token: handoff.handoffToken,
      handoff_path: handoff.handoffRelPath,
      next_manifest: handoff.nextManifest,
      ...overrides.payload
    }
  });
}

function acceptedWaveFixture({ ts = staleTs(), includeAccepted = true, extraEvents = [] } = {}) {
  const events = [
    makeEvent('session.start', {
      event_id: 'ev_01HXYZ000000000000000AAA',
      ts,
      payload: { project: 'hotfix3-pinger' }
    }),
    makeEvent('wave.planned', {
      event_id: 'ev_01HXYZ000000000000000AAB',
      ts,
      wave: 1,
      agent: 'task-decomposer'
    }),
    makeEvent('wave.started', {
      event_id: 'ev_01HXYZ000000000000000AAC',
      ts,
      wave: 1
    })
  ];
  if (includeAccepted) {
    events.push(makeEvent('wave.accepted', {
      event_id: 'ev_01HXYZ000000000000000AAD',
      ts,
      wave: 1
    }));
  }
  return [...events, ...extraEvents];
}

function claimPath(project, handoff) {
  const key = crypto.createHash('sha256')
    .update(`${handoff.sourceWave}:${handoff.nextWave}:${handoff.nextManifest}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(project, '.nightshift', `wave-claim-${key}`);
}

async function writeClaim(project, handoff, overrides = {}, ageMs = null) {
  const filePath = claimPath(project, handoff);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const claim = {
    claim_key: path.basename(filePath).replace('wave-claim-', ''),
    handoff_token: handoff.handoffToken,
    triggering_handoff: 'ev_01HXYZ000000000000000H16',
    source_wave: handoff.sourceWave,
    next_wave: handoff.nextWave,
    new_session_id: 'sess_01HXYZCLAIM000000000001',
    pid: null,
    created_at: new Date().toISOString(),
    ...overrides
  };
  await fs.writeFile(filePath, JSON.stringify(claim, null, 2), 'utf8');
  if (ageMs != null) {
    const staleAt = new Date(Date.now() - ageMs);
    await fs.utimes(filePath, staleAt, staleAt);
  }
  return filePath;
}

async function assertFreshSpawn(recordPath, expectedWave) {
  const records = await waitForRecordCount(recordPath, 1);
  assert.equal(records.length, 1, 'expected one fresh claude spawn');
  const [record] = records;
  assert.ok(record.argv.includes('-p'), 'expected -p');
  assert.ok(record.argv.includes('--dangerously-skip-permissions'), 'expected --dangerously-skip-permissions');
  assert.ok(record.argv.includes(`/nightshift:implement --wave=${expectedWave}`), 'expected wave command');
  assert.ok(!record.argv.includes('--continue'), 'fresh spawn must not use --continue');
  assert.ok(record.env.NIGHTSHIFT_SESSION_ID, 'expected NIGHTSHIFT_SESSION_ID');
  return record;
}

test('F-A: accepted-wave/no-in-progress path spawns fresh claude before the early return', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const handoffProject = await bootstrapProject();

  try {
    const handoff = await writeHandoff(handoffProject);
    await writeManifest(handoffProject, 2);
    const events = acceptedWaveFixture({
      extraEvents: [waveHandoffEvent(handoff)]
    });
    await fs.writeFile(
      path.join(handoffProject, 'tasks', 'events.ndjson'),
      events.map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const res = runHealthPing(handoffProject, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);

    const record = await assertFreshSpawn(recordPath, 2);
    const eventsAfter = await readEvents(handoffProject);
    const resurrectStart = eventsAfter.find(event =>
      event.action === 'session.start' && event.payload?.source === 'pinger-resurrect'
    );
    assert.ok(resurrectStart, 'expected pinger-resurrect session.start');
    assert.equal(resurrectStart.session_id, record.env.NIGHTSHIFT_SESSION_ID);
    assert.equal(resurrectStart.payload?.next_wave, 2);

    const claim = JSON.parse(await fs.readFile(claimPath(handoffProject, handoff), 'utf8'));
    assert.equal(claim.new_session_id, record.env.NIGHTSHIFT_SESSION_ID);
    assert.equal(claim.handoff_token, handoff.handoffToken);
  } finally {
    await fs.rm(handoffProject, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-B: unresolved question wins over handoff and preserves the H14 pause path', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject();

  try {
    const handoff = await writeHandoff(project);
    await writeManifest(project, 2);
    const questionId = 'Q-H16-1001';
    const events = acceptedWaveFixture({
      extraEvents: [
        waveHandoffEvent(handoff),
        makeEvent('question.asked', {
          event_id: 'ev_01HXYZ000000000000000ABQ',
          ts: staleTs(),
          wave: 1,
          task_id: 'TASK_APPROVAL_001',
          payload: { question_id: questionId, question: 'Ship wave 2?' }
        })
      ]
    });
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      events.map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recordPath);

    const eventsAfter = await readEvents(project);
    const paused = eventsAfter.find(event => event.action === 'session.paused');
    const ping = eventsAfter.find(
      event => event.action === 'pinger.ping' && event.payload?.skipped === 'awaiting_human'
    );
    assert.ok(paused, 'expected session.paused');
    assert.deepEqual(paused.payload?.open_question_ids, [questionId]);
    assert.ok(ping, 'expected awaiting-human ping');
    assert.ok(!eventsAfter.some(event => event.payload?.source === 'pinger-resurrect'), 'unexpected resurrect session');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-C: concurrent pinger runs race on one claim and only one fresh spawn wins', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude({ sleepMs: 500 });
  const project = await bootstrapProject();

  try {
    const handoff = await writeHandoff(project);
    await writeManifest(project, 2);
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      acceptedWaveFixture({ extraEvents: [waveHandoffEvent(handoff)] })
        .map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const [first, second] = await Promise.all([
      runHealthPingAsync(project, {
        NIGHTSHIFT_AUTONOMOUS: '1',
        NIGHTSHIFT_CLAUDE_CMD: claudePath
      }),
      runHealthPingAsync(project, {
        NIGHTSHIFT_AUTONOMOUS: '1',
        NIGHTSHIFT_CLAUDE_CMD: claudePath
      }, 10)
    ]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);

    const records = await waitForRecordCount(recordPath, 1);
    assert.equal(records.length, 1, 'expected exactly one fresh claude invocation');

    const claim = JSON.parse(await fs.readFile(claimPath(project, handoff), 'utf8'));
    assert.ok(claim.new_session_id, 'expected claim file to be created');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-D: missing handoff or manifest files do not spawn and log a warning', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject();

  try {
    const missingHandoff = {
      sourceWave: 1,
      nextWave: 2,
      sourceSessionId: 'sess_01KPP9ABCDEFGHJKMNPQRSTVW',
      handoffToken: 'missing-files-token',
      handoffRelPath: 'tasks/waves/1/handoff-to-next.md',
      nextManifest: 'tasks/waves/2/manifest.yaml'
    };
    const events = acceptedWaveFixture({
      extraEvents: [waveHandoffEvent(missingHandoff)]
    });
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      events.map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recordPath);
    assert.match(res.stderr, /wave\.handoff references missing files/);

    const eventsAfter = await readEvents(project);
    assert.ok(eventsAfter.some(event => event.action === 'pinger.ping'), 'expected normal pinger.ping');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-E: already-dispatched next wave does not respawn', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject();

  try {
    const handoff = await writeHandoff(project);
    await writeManifest(project, 2);
    const events = acceptedWaveFixture({
      extraEvents: [
        waveHandoffEvent(handoff),
        makeEvent('task.dispatched', {
          event_id: 'ev_01HXYZ000000000000000ABE',
          ts: staleTs(),
          wave: 2,
          task_id: 'TASK_W2_001',
          agent: 'implementer'
        })
      ]
    });
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      events.map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );
    await fs.mkdir(path.join(project, '.nightshift'), { recursive: true });
    await fs.writeFile(claimPath(project, handoff), JSON.stringify({
      claim_key: 'ignored',
      handoff_token: handoff.handoffToken,
      triggering_handoff: 'ev_01HXYZ000000000000000H16',
      source_wave: 1,
      next_wave: 2,
      new_session_id: 'sess_01HXYZCLAIM000000000001',
      pid: 999999,
      created_at: new Date().toISOString()
    }, null, 2), 'utf8');

    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recordPath);

    const eventsAfter = await readEvents(project);
    assert.ok(!eventsAfter.some(event => event.payload?.source === 'pinger-resurrect'), 'unexpected resurrect session');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-F: spawn failure removes the claim and emits session.halted without crashing the pinger', async () => {
  const project = await bootstrapProject();

  try {
    const handoff = await writeHandoff(project);
    await writeManifest(project, 2);
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      acceptedWaveFixture({ extraEvents: [waveHandoffEvent(handoff)] })
        .map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const missingClaude = path.join(project, 'does-not-exist', 'claude');
    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: missingClaude
    });
    assert.equal(res.status, 0, res.stderr);

    await waitFor(async () => {
      const events = await readEvents(project);
      return events.find(event =>
        event.action === 'session.halted' &&
        event.payload?.reason === 'pinger_spawn_failed'
      );
    });

    await waitFor(async () => {
      try {
        await fs.access(claimPath(project, handoff));
        return false;
      } catch (err) {
        if (err.code === 'ENOENT') return true;
        throw err;
      }
    });
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('F-G: malformed wave.handoff payload with empty next_manifest does not spawn and logs a warning', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject();

  try {
    const handoff = await writeHandoff(project);
    await writeManifest(project, 2);
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      acceptedWaveFixture({
        extraEvents: [waveHandoffEvent(handoff, { payload: { next_manifest: '' } })]
      }).map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recordPath);
    assert.match(res.stderr, /wave\.handoff missing required payload fields/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-H: no wave.handoff event falls through to the existing no-work path', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject(acceptedWaveFixture());

  try {
    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recordPath);
    assert.match(res.stderr, /no in-progress waves; nothing to do/);

    const eventsAfter = await readEvents(project);
    assert.ok(eventsAfter.some(event => event.action === 'pinger.ping'), 'expected normal pinger.ping');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-I: resurrect-fresh is gated behind NIGHTSHIFT_AUTONOMOUS=1', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const projectWithoutGate = await bootstrapProject();
  const projectWithGate = await bootstrapProject();

  try {
    const firstHandoff = await writeHandoff(projectWithoutGate);
    await writeManifest(projectWithoutGate, 2);
    await fs.writeFile(
      path.join(projectWithoutGate, 'tasks', 'events.ndjson'),
      acceptedWaveFixture({ extraEvents: [waveHandoffEvent(firstHandoff)] })
        .map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const noGate = runHealthPing(projectWithoutGate, {
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(noGate.status, 0, noGate.stderr);
    await assertNoSpawn(recordPath);

    const secondHandoff = await writeHandoff(projectWithGate, { handoffToken: 'autonomous-on' });
    await writeManifest(projectWithGate, 2);
    await fs.writeFile(
      path.join(projectWithGate, 'tasks', 'events.ndjson'),
      acceptedWaveFixture({ extraEvents: [waveHandoffEvent(secondHandoff)] })
        .map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const withGate = runHealthPing(projectWithGate, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(withGate.status, 0, withGate.stderr);
    await assertFreshSpawn(recordPath, 2);
  } finally {
    await fs.rm(projectWithoutGate, { recursive: true, force: true });
    await fs.rm(projectWithGate, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-J: claim key stays stable across handoff re-emits with different tokens', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject();

  try {
    const firstHandoff = await writeHandoff(project, { handoffToken: 'handoff-token-a' });
    await writeManifest(project, 2);
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      acceptedWaveFixture({ extraEvents: [waveHandoffEvent(firstHandoff)] })
        .map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const firstRun = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(firstRun.status, 0, firstRun.stderr);
    await assertFreshSpawn(recordPath, 2);

    const secondHandoff = await writeHandoff(project, { handoffToken: 'handoff-token-b' });
    const existingEvents = await readEvents(project);
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      [
        ...existingEvents,
        waveHandoffEvent(secondHandoff, { event_id: 'ev_01HXYZ000000000000000H17' })
      ].map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const secondRun = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(secondRun.status, 0, secondRun.stderr);

    const records = await readRecords(recordPath);
    assert.equal(records.length, 1, 'expected the existing claim to suppress a second spawn');
    assert.ok(await fs.readFile(claimPath(project, firstHandoff), 'utf8'), 'expected stable claim path');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-K: stale-claim recovery requires dead pid, old claim age, and no recent stale-session activity', async () => {
  const staleAgeMs = (2 * 60 * 60 * 1000) + 5_000;

  async function deadPid() {
    const child = spawn('node', ['-e', 'setTimeout(() => process.exit(0), 10)']);
    const pid = child.pid;
    await new Promise(resolve => child.on('close', resolve));
    return pid;
  }

  async function makeProject(label) {
    const fake = await setupFakeClaude();
    const project = await bootstrapProject();
    const handoff = await writeHandoff(project, { handoffToken: `${label}-token` });
    await writeManifest(project, 2);
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      acceptedWaveFixture({ extraEvents: [waveHandoffEvent(handoff)] })
        .map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );
    return { ...fake, project, handoff };
  }

  const positive = await makeProject('positive');
  try {
    const stalePid = await deadPid();
    await writeClaim(positive.project, positive.handoff, {
      new_session_id: 'sess_01HXYZSTALE000000000001',
      pid: stalePid
    }, staleAgeMs);

    const res = runHealthPing(positive.project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: positive.claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertFreshSpawn(positive.recordPath, 2);

    const halted = await waitFor(async () => {
      const events = await readEvents(positive.project);
      return events.find(event =>
        event.action === 'session.halted' &&
        event.payload?.reason === 'stale_claim_recovered'
      );
    });
    assert.equal(halted.payload?.stale_pid, stalePid);
    assert.equal(halted.payload?.stale_session_id, 'sess_01HXYZSTALE000000000001');
  } finally {
    await fs.rm(positive.project, { recursive: true, force: true });
    await fs.rm(positive.binDir, { recursive: true, force: true });
  }

  const alive = await makeProject('alive');
  const liveChild = spawn('node', ['-e', 'setTimeout(() => process.exit(0), 5000)'], { stdio: 'ignore' });
  try {
    await writeClaim(alive.project, alive.handoff, {
      new_session_id: 'sess_01HXYZLIVE0000000000001',
      pid: liveChild.pid
    }, staleAgeMs);
    const res = runHealthPing(alive.project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: alive.claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(alive.recordPath);
    assert.ok(await fs.readFile(claimPath(alive.project, alive.handoff), 'utf8'));
  } finally {
    try { liveChild.kill('SIGKILL'); } catch {}
    await fs.rm(alive.project, { recursive: true, force: true });
    await fs.rm(alive.binDir, { recursive: true, force: true });
  }

  const fresh = await makeProject('fresh');
  try {
    await writeClaim(fresh.project, fresh.handoff, {
      new_session_id: 'sess_01HXYZFRESH00000000001',
      pid: await deadPid()
    }, 60_000);
    const res = runHealthPing(fresh.project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: fresh.claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(fresh.recordPath);
    assert.ok(await fs.readFile(claimPath(fresh.project, fresh.handoff), 'utf8'));
  } finally {
    await fs.rm(fresh.project, { recursive: true, force: true });
    await fs.rm(fresh.binDir, { recursive: true, force: true });
  }

  const recent = await makeProject('recent');
  try {
    const recentEvents = [
      ...await readEvents(recent.project),
      makeEvent('task.accepted', {
        event_id: 'ev_01HXYZ000000000000000REC',
        ts: new Date().toISOString(),
        session_id: 'sess_01HXYZRECENT0000000001',
        wave: 2,
        task_id: 'TASK_RECENT_001'
      })
    ];
    await fs.writeFile(
      path.join(recent.project, 'tasks', 'events.ndjson'),
      recentEvents.map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );
    await writeClaim(recent.project, recent.handoff, {
      new_session_id: 'sess_01HXYZRECENT0000000001',
      pid: await deadPid()
    }, staleAgeMs);

    const res = runHealthPing(recent.project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: recent.claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recent.recordPath);
    assert.ok(await fs.readFile(claimPath(recent.project, recent.handoff), 'utf8'));
  } finally {
    await fs.rm(recent.project, { recursive: true, force: true });
    await fs.rm(recent.binDir, { recursive: true, force: true });
  }
});

test('F-L: orphan handoff file emits a repaired wave.handoff event', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject(acceptedWaveFixture());

  try {
    const handoff = await writeHandoff(project);
    await writeManifest(project, 2);

    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recordPath);

    const eventsAfter = await readEvents(project);
    const repaired = eventsAfter.find(event =>
      event.action === 'wave.handoff' && event.payload?.repaired === true
    );
    assert.ok(repaired, 'expected repaired wave.handoff');
    assert.equal(repaired.payload?.handoff_path, handoff.handoffRelPath);
    assert.equal(repaired.payload?.next_manifest, 'tasks/waves/2/manifest.yaml');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-M: NIGHTSHIFT_SESSION_ID propagates into the fresh claude environment', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude({ writeDispatchEvent: true });
  const project = await bootstrapProject();

  try {
    const handoff = await writeHandoff(project);
    await writeManifest(project, 2);
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      acceptedWaveFixture({ extraEvents: [waveHandoffEvent(handoff)] })
        .map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);

    const record = await assertFreshSpawn(recordPath, 2);
    const dispatched = await waitFor(async () => {
      const events = await readEvents(project);
      return events.find(event => event.agent === 'fake-claude' && event.action === 'task.dispatched');
    });
    const claim = JSON.parse(await fs.readFile(claimPath(project, handoff), 'utf8'));
    assert.equal(dispatched.session_id, claim.new_session_id);
    assert.equal(record.env.NIGHTSHIFT_SESSION_ID, claim.new_session_id);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-N: a fresh claim suppresses double-spawn even after the child exits before dispatching work', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude({ sleepMs: 1000 });
  const project = await bootstrapProject();

  try {
    const handoff = await writeHandoff(project);
    await writeManifest(project, 2);
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      acceptedWaveFixture({ extraEvents: [waveHandoffEvent(handoff)] })
        .map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const firstRun = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(firstRun.status, 0, firstRun.stderr);
    await assertFreshSpawn(recordPath, 2);

    await new Promise(resolve => setTimeout(resolve, 1200));

    const secondRun = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(secondRun.status, 0, secondRun.stderr);

    const records = await readRecords(recordPath);
    assert.equal(records.length, 1, 'expected the fresh claim to keep the retry idempotent');
    assert.ok(await fs.readFile(claimPath(project, handoff), 'utf8'));
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-Q: orphan repair sorts wave directories numerically descending', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject(acceptedWaveFixture());

  try {
    for (const wave of [2, 3, 10]) {
      await writeHandoff(project, {
        sourceWave: wave,
        nextWave: wave + 1,
        handoffToken: `token-${wave}`
      });
    }

    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recordPath);

    const eventsAfter = await readEvents(project);
    const repaired = eventsAfter.find(event =>
      event.action === 'wave.handoff' && event.payload?.repaired === true
    );
    assert.ok(repaired, 'expected repaired handoff event');
    assert.equal(repaired.payload?.handoff_path, 'tasks/waves/10/handoff-to-next.md');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('F-R: handoff file and event payload mismatches refuse to spawn', async () => {
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject();

  try {
    const handoff = await writeHandoff(project, { nextWave: 6, nextManifest: 'tasks/waves/6/manifest.yaml' });
    await writeManifest(project, 6);
    await writeManifest(project, 5);
    const events = acceptedWaveFixture({
      extraEvents: [
        waveHandoffEvent(handoff, {
          payload: {
            next_wave: 5,
            next_manifest: 'tasks/waves/5/manifest.yaml'
          }
        })
      ]
    });
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      events.map(event => JSON.stringify(event)).join('\n') + '\n',
      'utf8'
    );

    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recordPath);
    assert.match(res.stderr, /handoff file\/event mismatch on: next_wave/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});


test('F-K-negative: fresh claim (<2h old) is NOT recovered even if pid dead', async () => {
  // Even with a dead pid, if the claim is only minutes old, we
  // refuse to recover — pin the three-AND gate semantics.
  const { binDir, claudePath, recordPath } = await setupFakeClaude();
  const project = await bootstrapProject();
  try {
    const handoff = await writeHandoff(project);
    await writeManifest(project, 2);
    const events = acceptedWaveFixture({ extraEvents: [waveHandoffEvent(handoff)] });
    await fs.writeFile(
      path.join(project, 'tasks', 'events.ndjson'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n',
      'utf8'
    );

    // Fresh (current mtime) stale-pid claim.
    const claimFile = claimPath(project, handoff);
    await fs.mkdir(path.dirname(claimFile), { recursive: true });
    await fs.writeFile(claimFile, JSON.stringify({
      claim_key: path.basename(claimFile).replace(/^wave-claim-/, ''),
      handoff_token: handoff.handoffToken,
      triggering_handoff: 'ev_01HXYZ000000000000000H16',
      source_wave: 1, next_wave: 2,
      new_session_id: 'sess_01FRESH000000000000FRESH',
      pid: 999999,
      created_at: new Date().toISOString()
    }, null, 2));
    // mtime stays current (now).

    const res = runHealthPing(project, {
      NIGHTSHIFT_AUTONOMOUS: '1',
      NIGHTSHIFT_CLAUDE_CMD: claudePath
    });
    assert.equal(res.status, 0, res.stderr);
    await assertNoSpawn(recordPath);

    // Claim MUST still be present (no recovery).
    const claimExists = await fs.access(claimFile).then(() => true, () => false);
    assert.equal(claimExists, true, 'fresh claim must not be removed');

    const eventsAfter = await readEvents(project);
    const recovered = eventsAfter.find(e =>
      e.action === 'session.halted' && e.payload?.reason === 'stale_claim_recovered'
    );
    assert.equal(recovered, undefined, 'fresh claim must NOT emit stale_claim_recovered');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});
