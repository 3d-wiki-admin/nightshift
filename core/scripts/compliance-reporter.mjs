#!/usr/bin/env node
// compliance-reporter.mjs — regenerate tasks/compliance.md from events.ndjson.
// Read-only on the log; idempotent; safe to re-run.
import { EventStore, buildState } from '../event-store/src/index.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function fmtBytes(n) {
  if (!n) return '0';
  if (n > 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n > 1e3) return `${(n/1e3).toFixed(1)}k`;
  return String(n);
}

function gateLine(task, gate) {
  const v = task.gates?.[gate];
  if (v === 'pass') return `    ${gate.padEnd(8)} PASS`;
  if (v === 'fail') return `    ${gate.padEnd(8)} FAIL`;
  return `    ${gate.padEnd(8)} N/A`;
}

function renderTask(wave, taskId, task) {
  const lines = [];
  lines.push(`## TASK ${taskId} — wave ${wave}`);
  lines.push(`  Status:  ${task.status}`);
  lines.push(`  Risk:    ${task.risk_class || 'n/a'}`);
  lines.push(`  Model:   ${task.model || 'n/a'} (${task.effort || 'default'})`);
  lines.push(`  Retries: ${task.retries}`);
  lines.push(`  Hard gates:`);
  for (const g of ['tests', 'types', 'lint', 'build', 'smoke', 'migrations', 'security']) {
    lines.push(gateLine(task, g));
  }
  if (task.quality_score != null) lines.push(`  Quality: ${task.quality_score}`);
  const tokTotal = Object.values(task.tokens || {}).reduce((a, t) => a + (t.in||0) + (t.out||0), 0);
  const costTotal = Object.values(task.tokens || {}).reduce((a, t) => a + (t.cost||0), 0);
  lines.push(`  Tokens:  ${fmtBytes(tokTotal)}  |  Cost: $${costTotal.toFixed(4)}`);
  if (task.evidence_folder) lines.push(`  Evidence: ${task.evidence_folder}`);
  lines.push('');
  return lines.join('\n');
}

export async function generate(projectDir) {
  const logPath = path.join(projectDir, 'tasks', 'events.ndjson');
  const store = new EventStore(logPath);
  const events = await store.all();
  const state = buildState(events);

  const lines = [
    '# Compliance report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Project: ${state.project.name || '(unnamed)'}`,
    `Session: ${state.session_id || '(no active session)'}`,
    `Events processed: ${state.totals.events}`,
    `Total tokens: ${fmtBytes(state.totals.tokens)}  |  Estimated cost: $${state.totals.cost_usd_estimate}`,
    ''
  ];

  const waveIds = Object.keys(state.waves).sort((a, b) => +a - +b);
  for (const wId of waveIds) {
    const wave = state.waves[wId];
    lines.push(`# Wave ${wId} — status: ${wave.status}`);
    if (wave.checkpoint_tag) lines.push(`Checkpoint: ${wave.checkpoint_tag}`);
    lines.push('');
    const taskIds = Object.keys(wave.tasks);
    for (const tid of taskIds) {
      lines.push(renderTask(wId, tid, wave.tasks[tid]));
    }
  }

  if (state.open_questions.length) {
    lines.push('# Open questions');
    for (const q of state.open_questions) lines.push(`- ${q}`);
    lines.push('');
  }
  if (state.paused_tasks.length) {
    lines.push('# Paused tasks');
    for (const t of state.paused_tasks) lines.push(`- ${t}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const projectDir = process.argv[2] || process.cwd();
  const md = await generate(projectDir);
  const outPath = path.join(projectDir, 'tasks', 'compliance.md');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, md, 'utf8');
  console.error(`[compliance] wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('[compliance] fatal:', err.message); process.exit(1); });
}
