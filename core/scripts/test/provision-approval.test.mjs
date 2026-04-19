import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkApproval } from '../provision.mjs';
import { appendEvent } from '../dispatch.mjs';

function tmpProject() {
  return path.join(tmpdir(), `ns-prov-approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function setupProject(dir) {
  await fs.mkdir(path.join(dir, 'tasks'), { recursive: true });
  return path.join(dir, 'tasks', 'events.ndjson');
}

test('no --for-task rejects immediately', async () => {
  const project = tmpProject();
  await setupProject(project);
  const r = await checkApproval(project, null);
  assert.equal(r.ok, false);
  assert.match(r.reason, /--for-task/);
  await fs.rm(project, { recursive: true, force: true });
});

test('no matching decision.recorded rejects', async () => {
  const project = tmpProject();
  const logPath = await setupProject(project);
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    agent: 'orchestrator',
    action: 'session.start',
    payload: { project: 'demo' }
  });
  const r = await checkApproval(project, 'PROV_TEST_001');
  assert.equal(r.ok, false);
  assert.match(r.reason, /no decision.recorded/);
  await fs.rm(project, { recursive: true, force: true });
});

test('matching decision.recorded accepts', async () => {
  const project = tmpProject();
  const logPath = await setupProject(project);
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    agent: 'orchestrator',
    action: 'session.start',
    payload: { project: 'demo' }
  });
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    agent: 'orchestrator',
    action: 'decision.recorded',
    payload: { task_id: 'PROV_TEST_001', approval: true }
  });
  const r = await checkApproval(project, 'PROV_TEST_001');
  assert.equal(r.ok, true);
  assert.equal(r.approvalEvent.action, 'decision.recorded');
  await fs.rm(project, { recursive: true, force: true });
});

test('decision for a different task does not approve', async () => {
  const project = tmpProject();
  const logPath = await setupProject(project);
  await appendEvent(logPath, {
    session_id: 'sess_01HXYZ000000000000000001',
    agent: 'orchestrator',
    action: 'decision.recorded',
    payload: { task_id: 'OTHER_001', approval: true }
  });
  const r = await checkApproval(project, 'PROV_TEST_001');
  assert.equal(r.ok, false);
  await fs.rm(project, { recursive: true, force: true });
});
