#!/usr/bin/env node
// project-status.mjs — ASCII dashboard for the active project.
import { EventStore, buildState } from '../event-store/src/index.mjs';
import path from 'node:path';

const c = {
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  bold:  '\x1b[1m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  red:   '\x1b[31m',
  cyan:  '\x1b[36m'
};

function badge(status) {
  const m = {
    accepted:  `${c.green}✓${c.reset}`,
    rejected:  `${c.red}✗${c.reset}`,
    revised:   `${c.yellow}↻${c.reset}`,
    in_progress: `${c.cyan}⋯${c.reset}`,
    reviewing: `${c.cyan}⊙${c.reset}`,
    planned:   `${c.dim}○${c.reset}`,
    halted:    `${c.red}■${c.reset}`,
    rolled_back: `${c.red}⤺${c.reset}`
  };
  return m[status] || status;
}

function taskBadge(status) {
  const m = {
    accepted:      `${c.green}✓${c.reset}`,
    rejected:      `${c.red}✗${c.reset}`,
    revised:       `${c.yellow}↻${c.reset}`,
    reviewing:     `${c.cyan}⊙${c.reset}`,
    implemented:   `${c.cyan}◎${c.reset}`,
    dispatched:    `${c.cyan}→${c.reset}`,
    blocked:       `${c.red}!${c.reset}`,
    contracted:    `${c.dim}○${c.reset}`,
    context_packed:`${c.dim}○${c.reset}`,
    routed:        `${c.dim}○${c.reset}`,
    promoted:      `${c.yellow}↑${c.reset}`
  };
  return m[status] || status;
}

function fmtTokens(n) {
  if (n > 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n > 1e3) return `${(n/1e3).toFixed(1)}k`;
  return String(n);
}

async function main() {
  const projectDir = process.argv[2] || process.cwd();
  const logPath = path.join(projectDir, 'tasks', 'events.ndjson');
  const store = new EventStore(logPath);
  const events = await store.all();
  const state = buildState(events);

  console.log(`${c.bold}${state.project.name || 'nightshift'}${c.reset}  ${c.dim}session=${state.session_id || '—'}${c.reset}`);
  console.log(`context_zone: ${zoneColor(state.context_zone)}   events=${state.totals.events}   tokens=${fmtTokens(state.totals.tokens)}   cost=$${state.totals.cost_usd_estimate}`);
  console.log('');

  const waves = Object.keys(state.waves).sort((a, b) => +a - +b);
  if (!waves.length) {
    console.log(c.dim + '(no waves yet)' + c.reset);
  }
  for (const wid of waves) {
    const w = state.waves[wid];
    console.log(`${badge(w.status)} wave ${wid} ${c.dim}(${w.status})${c.reset}  ${w.checkpoint_tag ? c.dim + 'tag=' + w.checkpoint_tag + c.reset : ''}`);
    const taskIds = Object.keys(w.tasks);
    for (const tid of taskIds) {
      const t = w.tasks[tid];
      const par = t.parallel_marker ? c.yellow + '[P]' + c.reset : '   ';
      const qs = t.quality_score != null ? `q=${t.quality_score}` : '';
      const retries = t.retries ? c.yellow + 'r=' + t.retries + c.reset : '';
      console.log(`  ${par} ${taskBadge(t.status)} ${tid.padEnd(24)} ${c.dim}${(t.risk_class||'').padEnd(18)}${c.reset} ${(t.model||'').padEnd(22)} ${qs} ${retries}`);
    }
  }

  if (state.open_questions.length) {
    console.log('');
    console.log(`${c.yellow}${c.bold}open questions:${c.reset}`);
    for (const q of state.open_questions) console.log(`  - ${q}`);
  }
  if (state.paused_tasks.length) {
    console.log('');
    console.log(`${c.red}${c.bold}paused tasks:${c.reset}`);
    for (const t of state.paused_tasks) console.log(`  - ${t}`);
  }
}

function zoneColor(z) {
  if (z === 'green') return c.green + z + c.reset;
  if (z === 'yellow') return c.yellow + z + c.reset;
  if (z === 'red') return c.red + z + c.reset;
  return z;
}

main().catch(err => { console.error(err.message); process.exit(1); });
