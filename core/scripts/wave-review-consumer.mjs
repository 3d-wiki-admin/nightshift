#!/usr/bin/env node
// wave-review-consumer.mjs — the code path that reads a wave-reviewer's
// wave-review.md and turns its verdict into actual events:
//   - verdict: accept  → emits wave.accepted (which auto-tags via appendEvent).
//   - verdict: revise  → for each task mentioned in the must-fix/delta/
//                        recommendation sections, emits task.revised with
//                        a pointer to the review file.
//
// Usage:
//   wave-review-consumer.mjs <project-dir> <wave>
//
// Stdout: JSON summary ({ status, verdict, ... }).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventStore, sessionId as genSessionId } from '../event-store/src/index.mjs';
import { appendEvent } from './dispatch.mjs';

// Words that look like task-ids but are really labels/glossary tokens.
// task_id pattern is /^[A-Z][A-Z0-9_-]*$/ minimum 3 chars; these would
// otherwise pass.
const NOT_TASK_IDS = new Set([
  'PASS','FAIL','NOTE','OK','CRITICAL','WARNING','TODO','FIXME','NULL','USD',
  'CLI','API','URL','MCP','CI','CD','YAML','JSON','RLS','PID','TS','JS',
  'HTTP','HTTPS','REST','DRY','TLS','SSH','UUID','LGTM','WIP','NA','NB',
  'ULID','MD','TSX','JSX','PR','PRS','RSS'
]);

function detectVerdict(text) {
  // Try headings first, then plain "Verdict: …" lines anywhere.
  const patterns = [
    /^##\s*Verdict:\s*([A-Za-z_-]+)/mi,
    /^#[^\n]*verdict:\s*([A-Za-z_-]+)/mi,
    /^Verdict:\s*([A-Za-z_-]+)/mi
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function detectReviewerModel(text) {
  const m = text.match(/^Reviewer:?\s*([\w.\-]+)/mi);
  return m ? m[1] : null;
}

export function extractSection(text, headingRe) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => headingRe.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

// Pull task IDs out of a text blob. Case-sensitive so we don't swallow English.
// Require at least 4 chars and one underscore/hyphen OR one digit to filter
// out common acronyms.
export function extractTaskIds(text) {
  if (!text) return [];
  const out = new Set();
  const tokenRe = /\b([A-Z][A-Z0-9_-]{2,})\b/g;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    const token = m[1];
    if (NOT_TASK_IDS.has(token)) continue;
    // Drop pure-letter short tokens like "AAA" (unless it has a digit or separator).
    if (token.length < 5 && !/[_\-0-9]/.test(token)) continue;
    out.add(token);
  }
  return [...out];
}

function resolveSessionFromEvents(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].session_id) return events[i].session_id;
  }
  return genSessionId();
}

export async function consume(projectDir, wave) {
  const waveN = Number(wave);
  const waveDir = path.join(projectDir, 'tasks', 'waves', String(waveN));
  const reviewPath = path.join(waveDir, 'wave-review.md');
  const logPath = path.join(projectDir, 'tasks', 'events.ndjson');

  let text;
  try { text = await fs.readFile(reviewPath, 'utf8'); }
  catch { return { status: 'not_found', reviewPath }; }

  const verdict = detectVerdict(text);
  const reviewerModel = detectReviewerModel(text);

  if (!verdict) {
    return { status: 'no_verdict', reviewPath, reviewerModel };
  }

  const store = new EventStore(logPath);
  const events = await store.all();
  const sid = resolveSessionFromEvents(events);

  if (verdict === 'accept') {
    // Idempotency: if wave.accepted already recorded for this wave, skip.
    const already = events.some(e => e.wave === waveN && e.action === 'wave.accepted');
    if (already) {
      return { status: 'already_accepted', verdict: 'accept', wave: waveN, reviewPath };
    }
    await appendEvent(logPath, {
      session_id: sid,
      wave: waveN,
      agent: 'wave-reviewer',
      model: reviewerModel,
      action: 'wave.accepted',
      outcome: 'success',
      evidence_paths: [path.relative(projectDir, reviewPath)],
      notes: 'consumed wave-review.md verdict=accept'
    });
    return { status: 'accepted', verdict: 'accept', wave: waveN, reviewerModel, reviewPath };
  }

  if (verdict === 'revise') {
    // Look in the sections where revisions are actionable.
    const sections = [
      extractSection(text, /^##?\s*(must.?fix)/i),
      extractSection(text, /^##?\s*(delta)/i),
      extractSection(text, /^##?\s*(recommend)/i),
      extractSection(text, /^##?\s*(revise)/i),
      extractSection(text, /^##?\s*(residual)/i),
      extractSection(text, /^##?\s*(findings?)/i)
    ].filter(Boolean).join('\n');

    const candidates = extractTaskIds(sections);
    const taskIdsInWave = new Set(
      events.filter(e => e.wave === waveN && e.task_id).map(e => e.task_id)
    );
    const revisions = candidates.filter(id => taskIdsInWave.has(id));

    if (revisions.length === 0) {
      // Wave-level revise without specific task attribution: emit a
      // wave.reviewed payload for traceability; orchestrator must widen scope.
      await appendEvent(logPath, {
        session_id: sid,
        wave: waveN,
        agent: 'wave-reviewer',
        model: reviewerModel,
        action: 'wave.reviewed',
        outcome: 'revised',
        evidence_paths: [path.relative(projectDir, reviewPath)],
        notes: 'verdict=revise but no per-task attribution found; orchestrator must widen scope'
      });
      return { status: 'revised_no_tasks', verdict: 'revise', wave: waveN, revisions: [], reviewPath };
    }

    for (const tid of revisions) {
      await appendEvent(logPath, {
        session_id: sid,
        wave: waveN,
        task_id: tid,
        agent: 'wave-reviewer',
        model: reviewerModel,
        action: 'task.revised',
        outcome: 'revised',
        evidence_paths: [path.relative(projectDir, reviewPath)],
        notes: 'wave-review verdict=revise — see evidence_paths[0] for delta'
      });
    }
    return { status: 'revised', verdict: 'revise', wave: waveN, revisions, reviewerModel, reviewPath };
  }

  return { status: 'unknown_verdict', verdict, reviewPath };
}

async function main() {
  const projectDir = process.argv[2];
  const wave = process.argv[3];
  if (!projectDir || !wave) {
    console.error(`
Usage: wave-review-consumer.mjs <project-dir> <wave>

Reads tasks/waves/<wave>/wave-review.md, parses its verdict, and emits the
matching downstream events (wave.accepted or task.revised). Designed to close
the loop between wave-reviewer's adversarial run and the orchestrator's next
action — without requiring the orchestrator to read the review file itself.
    `.trim());
    process.exit(2);
  }
  const result = await consume(projectDir, wave);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('[wave-review-consumer] fatal:', err.message); process.exit(1); });
}
