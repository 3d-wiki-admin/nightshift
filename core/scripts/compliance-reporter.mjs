#!/usr/bin/env node
// compliance-reporter.mjs — regenerate tasks/compliance.md from events.ndjson.
// Read-only on the log; idempotent; safe to re-run.
import { EventStore, buildState } from '../event-store/src/index.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Parse a review.md file and extract verdict, reviewer model, dimension
// findings, and constitution notes. Returns null if the file is missing
// or unparseable. Best-effort; prompts aren't strict schemas.
async function readReview(reviewPath) {
  let text;
  try { text = await fs.readFile(reviewPath, 'utf8'); } catch { return null; }

  const verdictMatch = text.match(/^Verdict:\s*([a-z_-]+)/mi);
  const reviewerMatch = text.match(/^Reviewer model:\s*(\S+)/mi);
  const implementerMatch = text.match(/^Implementer model:\s*(\S+)/mi);

  const dims = [];
  // Format: "- dim_name:  OK|NOTE|FAIL — evidence reference"
  const dimRe = /^[-*]\s+([a-z_]+):\s+(OK|NOTE|FAIL)(?:\s+[—-]\s+(.+))?$/gmi;
  let m;
  while ((m = dimRe.exec(text)) !== null) {
    dims.push({ name: m[1], verdict: m[2], evidence: (m[3] || '').trim() });
  }

  return {
    verdict: verdictMatch?.[1] || null,
    reviewer: reviewerMatch?.[1] || null,
    implementer: implementerMatch?.[1] || null,
    dimensions: dims
  };
}

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

function renderTask(wave, taskId, task, review) {
  const lines = [];
  lines.push(`## TASK ${taskId} — wave ${wave}`);
  lines.push(`  Status:   ${task.status}`);
  lines.push(`  Risk:     ${task.risk_class || 'n/a'}`);
  lines.push(`  Impl:     ${task.model || 'n/a'} (${task.effort || 'default'})`);
  if (review?.reviewer) {
    const differ = review.reviewer !== task.model ? 'differs from implementer ✓' : '⚠ SAME AS IMPLEMENTER';
    lines.push(`  Reviewer: ${review.reviewer}  (${differ})`);
  }
  lines.push(`  Retries:  ${task.retries}`);
  lines.push(`  Hard gates:`);
  for (const g of ['tests', 'types', 'lint', 'build', 'smoke', 'migrations', 'security']) {
    lines.push(gateLine(task, g));
  }
  if (task.quality_score != null) lines.push(`  Quality:  ${task.quality_score}`);
  const tokTotal = Object.values(task.tokens || {}).reduce((a, t) => a + (t.in||0) + (t.out||0), 0);
  const costTotal = Object.values(task.tokens || {}).reduce((a, t) => a + (t.cost||0), 0);
  lines.push(`  Tokens:   ${fmtBytes(tokTotal)}  |  Cost: $${costTotal.toFixed(4)}`);
  if (task.evidence_folder) lines.push(`  Evidence: ${task.evidence_folder}`);

  if (review?.dimensions?.length) {
    lines.push(`  Dimension review (${review.dimensions.length}):`);
    for (const d of review.dimensions) {
      const mark = d.verdict === 'OK' ? '✓' : d.verdict === 'NOTE' ? '·' : '✗';
      const ev = d.evidence ? ` — ${d.evidence}` : '';
      lines.push(`    ${mark} ${d.name.padEnd(20)} ${d.verdict}${ev}`);
    }
  }

  // Constitution checks are implicit in hard-gate outcomes + dimension reviews
  // (scope_drift, security, etc.). Surface a compact summary:
  const constChecks = [];
  if (task.risk_class) constChecks.push(`risk classified (${task.risk_class})`);
  if (review?.reviewer && task.model && review.reviewer !== task.model) constChecks.push('reviewer≠implementer ✓');
  const scopeDim = review?.dimensions?.find(d => d.name === 'scope_drift');
  if (scopeDim) constChecks.push(`allowed_files respected (scope_drift=${scopeDim.verdict})`);
  if (constChecks.length) lines.push(`  Constitution checks: ${constChecks.join(', ')}`);

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
      const reviewPath = path.join(projectDir, 'tasks', 'waves', String(wId), tid, 'review.md');
      const review = await readReview(reviewPath);
      lines.push(renderTask(wId, tid, wave.tasks[tid], review));
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
