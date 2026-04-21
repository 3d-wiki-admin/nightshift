import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ROOT = path.resolve(new URL('../../../..', import.meta.url).pathname);
export const STATUS = path.join(ROOT, 'core', 'scripts', 'project-status.mjs');

function isoHoursAgo(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

export function makeEvent(action, overrides = {}) {
  makeEvent._n = (makeEvent._n || 0) + 1;
  const id = String(makeEvent._n).padStart(26, '0');
  return {
    event_id: overrides.event_id || `ev_${id}`,
    ts: overrides.ts || isoHoursAgo(1),
    session_id: overrides.session_id || 'sess_01HXYZ000000000000000001',
    agent: overrides.agent || 'orchestrator',
    action,
    ...overrides
  };
}

export async function createProjectFixture({ events = [], pausedMarkdown = null, rawLog = null, name = 'ns-status-fixture' } = {}) {
  const project = path.join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  if (rawLog != null) {
    await fs.writeFile(path.join(project, 'tasks', 'events.ndjson'), rawLog, 'utf8');
  } else {
    const body = events.length ? `${events.map(event => JSON.stringify(event)).join('\n')}\n` : '';
    await fs.writeFile(path.join(project, 'tasks', 'events.ndjson'), body, 'utf8');
  }
  if (pausedMarkdown != null) {
    await fs.writeFile(path.join(project, 'tasks', 'paused.md'), pausedMarkdown, 'utf8');
  }
  return project;
}

export function runStatus(project, ...extraArgs) {
  return spawnSync('node', [STATUS, project, ...extraArgs], {
    encoding: 'utf8'
  });
}

export async function cleanupProject(project) {
  await fs.rm(project, { recursive: true, force: true });
}

export function midWaveFixtureEvents() {
  return [
    makeEvent('session.start', {
      ts: isoHoursAgo(30),
      payload: { project: 'status-fixture', stage: 'intake' }
    }),
    makeEvent('decision.recorded', {
      ts: isoHoursAgo(29.8),
      payload: { kind: 'intake_approval' }
    }),
    makeEvent('plan.completed', {
      ts: isoHoursAgo(29.6),
      agent: 'plan-writer',
      outcome: 'success'
    }),
    makeEvent('analyze.completed', {
      ts: isoHoursAgo(29.4),
      agent: 'analyzer',
      outcome: 'success'
    }),
    makeEvent('wave.planned', {
      ts: isoHoursAgo(29.2),
      wave: 0,
      agent: 'task-decomposer'
    }),
    makeEvent('task.contracted', {
      ts: isoHoursAgo(29.1),
      wave: 0,
      task_id: 'OLD_PREP',
      agent: 'task-decomposer',
      payload: { title: 'Prepare release', risk_class: 'safe' }
    }),
    makeEvent('task.dispatched', {
      ts: isoHoursAgo(29.05),
      wave: 0,
      task_id: 'OLD_PREP',
      agent: 'implementer',
      model: 'gpt-5.4'
    }),
    makeEvent('task.implemented', {
      ts: isoHoursAgo(29),
      wave: 0,
      task_id: 'OLD_PREP',
      agent: 'implementer',
      model: 'gpt-5.4',
      tokens: { input: 60_000, output: 5_000 }
    }),
    makeEvent('task.reviewed', {
      ts: isoHoursAgo(28.95),
      wave: 0,
      task_id: 'OLD_PREP',
      agent: 'task-impl-reviewer',
      model: 'claude-sonnet-4-6',
      tokens: { input: 4_000, output: 500 },
      payload: { quality_score: 0.91 }
    }),
    makeEvent('task.accepted', {
      ts: isoHoursAgo(28.9),
      wave: 0,
      task_id: 'OLD_PREP',
      agent: 'orchestrator'
    }),
    makeEvent('wave.accepted', {
      ts: isoHoursAgo(28.8),
      wave: 0
    }),
    makeEvent('wave.planned', {
      ts: isoHoursAgo(6.2),
      wave: 1,
      agent: 'task-decomposer'
    }),
    makeEvent('wave.started', {
      ts: isoHoursAgo(6.15),
      wave: 1
    }),
    makeEvent('task.contracted', {
      ts: isoHoursAgo(6.1),
      wave: 1,
      task_id: 'T1_ALPHA',
      agent: 'task-decomposer',
      payload: { title: 'API baseline', risk_class: 'safe' }
    }),
    makeEvent('task.dispatched', {
      ts: isoHoursAgo(6.05),
      wave: 1,
      task_id: 'T1_ALPHA',
      agent: 'implementer',
      model: 'gpt-5.4'
    }),
    makeEvent('task.implemented', {
      ts: isoHoursAgo(6),
      wave: 1,
      task_id: 'T1_ALPHA',
      agent: 'implementer',
      model: 'gpt-5.4',
      tokens: { input: 180_000, output: 54_567 }
    }),
    makeEvent('task.reviewed', {
      ts: isoHoursAgo(5.95),
      wave: 1,
      task_id: 'T1_ALPHA',
      agent: 'task-impl-reviewer',
      model: 'claude-sonnet-4-6',
      tokens: { input: 12_000, output: 1_000 },
      payload: { quality_score: 0.97 }
    }),
    makeEvent('gate.passed', {
      ts: isoHoursAgo(5.9),
      wave: 1,
      task_id: 'T1_ALPHA',
      agent: 'task-impl-reviewer',
      payload: { gate: 'unit' }
    }),
    makeEvent('task.accepted', {
      ts: isoHoursAgo(5.85),
      wave: 1,
      task_id: 'T1_ALPHA',
      agent: 'orchestrator'
    }),
    makeEvent('task.contracted', {
      ts: isoHoursAgo(5.8),
      wave: 1,
      task_id: 'T1_BETA',
      agent: 'task-decomposer',
      payload: { title: 'UI list', risk_class: 'review-required' }
    }),
    makeEvent('task.dispatched', {
      ts: isoHoursAgo(5.75),
      wave: 1,
      task_id: 'T1_BETA',
      agent: 'implementer',
      model: 'gpt-5.3-codex'
    }),
    makeEvent('task.implemented', {
      ts: isoHoursAgo(5.7),
      wave: 1,
      task_id: 'T1_BETA',
      agent: 'implementer',
      model: 'gpt-5.3-codex',
      tokens: { input: 45_000, output: 8_500 }
    }),
    makeEvent('task.reviewed', {
      ts: isoHoursAgo(5.65),
      wave: 1,
      task_id: 'T1_BETA',
      agent: 'task-impl-reviewer',
      model: 'claude-sonnet-4-6',
      tokens: { input: 3_000, output: 500 },
      payload: { quality_score: 0.92 }
    }),
    makeEvent('task.accepted', {
      ts: isoHoursAgo(5.6),
      wave: 1,
      task_id: 'T1_BETA',
      agent: 'orchestrator'
    }),
    makeEvent('task.contracted', {
      ts: isoHoursAgo(5.55),
      wave: 1,
      task_id: 'T1_GAMMA',
      agent: 'task-decomposer',
      payload: { title: 'Hook wiring', risk_class: 'safe' }
    }),
    makeEvent('task.dispatched', {
      ts: isoHoursAgo(5.5),
      wave: 1,
      task_id: 'T1_GAMMA',
      agent: 'implementer',
      model: 'gpt-5.4-mini'
    }),
    makeEvent('task.implemented', {
      ts: isoHoursAgo(5.45),
      wave: 1,
      task_id: 'T1_GAMMA',
      agent: 'implementer',
      model: 'gpt-5.4-mini',
      tokens: { input: 12_000, output: 2_000 }
    }),
    makeEvent('task.accepted', {
      ts: isoHoursAgo(5.4),
      wave: 1,
      task_id: 'T1_GAMMA',
      agent: 'orchestrator'
    }),
    makeEvent('task.contracted', {
      ts: isoHoursAgo(5.35),
      wave: 1,
      task_id: 'T1_DELTA',
      agent: 'task-decomposer',
      payload: { title: 'Long-running sync', risk_class: 'review-required' }
    }),
    makeEvent('task.dispatched', {
      ts: isoHoursAgo(5.3),
      wave: 1,
      task_id: 'T1_DELTA',
      agent: 'implementer',
      model: 'gpt-5.3-codex'
    }),
    makeEvent('task.contracted', {
      ts: isoHoursAgo(5.25),
      wave: 1,
      task_id: 'T1_EPSILON',
      agent: 'task-decomposer',
      payload: { title: 'Docs follow-up', risk_class: 'safe' }
    }),
    makeEvent('task.contracted', {
      ts: isoHoursAgo(5.2),
      wave: 1,
      task_id: 'T1_ZETA',
      agent: 'task-decomposer',
      payload: { title: 'Approval hold', risk_class: 'approval-required' }
    }),
    makeEvent('question.asked', {
      ts: isoHoursAgo(2),
      wave: 1,
      task_id: 'T1_DELTA',
      payload: { question_id: 'Q-1001', question: 'Need the API key rotation window?' }
    }),
    makeEvent('question.asked', {
      ts: isoHoursAgo(1.5),
      wave: 1,
      task_id: 'T1_ZETA',
      payload: { question_id: 'Q-1002', question: 'Approve the preview deploy?' }
    }),
    makeEvent('question.asked', {
      ts: isoHoursAgo(1.3),
      wave: 1,
      task_id: 'T1_BETA',
      payload: { question_id: 'Q-0999', question: 'This one gets resolved' }
    }),
    makeEvent('decision.recorded', {
      ts: isoHoursAgo(1.2),
      wave: 1,
      task_id: 'T1_BETA',
      payload: { question_id: 'Q-0999', decision: 'resolved' }
    }),
    makeEvent('guard.violation', {
      ts: isoHoursAgo(0.5),
      task_id: 'T1_DELTA',
      payload: { kind: 'stale_task' }
    }),
    makeEvent('gate.failed', {
      ts: isoHoursAgo(0.35),
      wave: 1,
      task_id: 'T1_DELTA',
      agent: 'task-impl-reviewer',
      payload: { gate: 'e2e' }
    })
  ];
}

export function pausedMarkdownFixture() {
  return [
    '# Paused tasks',
    '',
    '## T1_DELTA',
    'Waiting on the human answer before retrying the sync rollout.',
    'Recover: reopen Claude and answer Q-1001.',
    ''
  ].join('\n');
}

export function budgetPartialFixtureEvents() {
  return [
    makeEvent('session.start', {
      ts: isoHoursAgo(3),
      payload: { project: 'budget-partial', stage: 'intake' }
    }),
    makeEvent('task.contracted', {
      ts: isoHoursAgo(2.5),
      wave: 1,
      task_id: 'T1_COST',
      agent: 'task-decomposer',
      payload: { title: 'Token-heavy task', risk_class: 'safe' }
    }),
    makeEvent('task.dispatched', {
      ts: isoHoursAgo(2.4),
      wave: 1,
      task_id: 'T1_COST',
      agent: 'implementer'
    }),
    makeEvent('task.implemented', {
      ts: isoHoursAgo(2.3),
      wave: 1,
      task_id: 'T1_COST',
      agent: 'implementer',
      model: 'gpt-5.4',
      tokens: { input: 25_000, output: 5_000 }
    }),
    makeEvent('task.accepted', {
      ts: isoHoursAgo(2.2),
      wave: 1,
      task_id: 'T1_COST',
      agent: 'orchestrator'
    })
  ];
}
