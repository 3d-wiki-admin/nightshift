#!/usr/bin/env node
// project-status.mjs — compact or dashboard status surfaces for a project.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildState } from '../event-store/src/index.mjs';
import { openQuestions } from '../event-store/src/open-questions.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TOKEN_WARNING_THRESHOLD = 200_000;
const PIPELINE_STAGES = [
  {
    key: 'intake',
    label: 'intake',
    signal: event => event.action === 'session.start' && event.payload?.stage === 'intake',
    description: 'session.start{stage:intake}'
  },
  {
    key: 'scaffold',
    label: 'scaffold',
    signal: event => event.action === 'decision.recorded' && event.payload?.kind === 'intake_approval',
    description: 'decision.recorded{kind:intake_approval}'
  },
  {
    key: 'plan',
    label: 'plan',
    signal: event => event.action === 'plan.completed',
    description: 'plan.completed'
  },
  {
    key: 'analyze',
    label: 'analyze',
    signal: event => event.action === 'analyze.completed',
    description: 'analyze.completed'
  },
  {
    key: 'tasks',
    label: 'tasks',
    signal: event => event.action === 'task.contracted',
    description: 'task.contracted'
  },
  {
    key: 'implement',
    label: 'implement',
    signal: event => event.action === 'task.dispatched',
    description: 'task.dispatched'
  },
  {
    key: 'accept',
    label: 'accept',
    signal: event => event.action === 'wave.accepted',
    description: 'wave.accepted'
  },
  {
    key: 'deploy',
    label: 'deploy',
    signal: event => event.action === 'task.accepted' && /deploy|prod|ship|release/i.test(event.task_id || ''),
    description: 'task.accepted{task_id~/(deploy|prod|ship|release)/i}'
  }
];

function makeColors(enabled) {
  return {
    enabled,
    reset: enabled ? '\x1b[0m' : '',
    dim: enabled ? '\x1b[2m' : '',
    bold: enabled ? '\x1b[1m' : '',
    green: enabled ? '\x1b[32m' : '',
    yellow: enabled ? '\x1b[33m' : '',
    red: enabled ? '\x1b[31m' : '',
    cyan: enabled ? '\x1b[36m' : ''
  };
}

function fmtInt(n) {
  return new Intl.NumberFormat('en-US').format(Math.trunc(n || 0));
}

function fmtPct(percent) {
  return `${Number(percent).toFixed(percent % 1 === 0 ? 0 : 1)}%`;
}

function fmtMoney(n) {
  return Number(n || 0).toFixed(2);
}

function fmtTokensShort(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n || 0);
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatCompactLines(text) {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function zoneColor(zone, c) {
  if (zone === 'green') return `${c.green}${zone}${c.reset}`;
  if (zone === 'yellow') return `${c.yellow}${zone}${c.reset}`;
  if (zone === 'red') return `${c.red}${zone}${c.reset}`;
  return zone;
}

function section(title, lines) {
  const body = lines.length ? lines : ['  (none)'];
  return [title, ...body, ''];
}

function badge(status, c) {
  const map = {
    accepted: `${c.green}✓${c.reset}`,
    rejected: `${c.red}✗${c.reset}`,
    revised: `${c.yellow}↻${c.reset}`,
    in_progress: `${c.cyan}⋯${c.reset}`,
    reviewing: `${c.cyan}⊙${c.reset}`,
    planned: `${c.dim}○${c.reset}`,
    halted: `${c.red}■${c.reset}`,
    rolled_back: `${c.red}⤺${c.reset}`
  };
  return map[status] || status;
}

function taskBadge(status, c) {
  const map = {
    accepted: `${c.green}✓${c.reset}`,
    rejected: `${c.red}✗${c.reset}`,
    revised: `${c.yellow}↻${c.reset}`,
    reviewing: `${c.cyan}⊙${c.reset}`,
    implemented: `${c.cyan}◎${c.reset}`,
    dispatched: `${c.cyan}→${c.reset}`,
    blocked: `${c.red}!${c.reset}`,
    contracted: `${c.dim}○${c.reset}`,
    context_packed: `${c.dim}○${c.reset}`,
    routed: `${c.dim}○${c.reset}`,
    promoted: `${c.yellow}↑${c.reset}`
  };
  return map[status] || status;
}

function parseArgs(argv) {
  const args = {
    projectDir: null,
    mode: null,
    watch: false,
    watchSeconds: 10
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dashboard') {
      args.mode = 'dashboard';
      continue;
    }
    if (arg === '--compact') {
      args.mode = 'compact';
      continue;
    }
    if (arg === '--json') {
      args.mode = 'json';
      continue;
    }
    if (arg === '--watch') {
      args.watch = true;
      const maybeSeconds = argv[i + 1];
      if (maybeSeconds && !maybeSeconds.startsWith('--')) {
        const parsed = Number(maybeSeconds);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw usageError(`invalid --watch interval: ${maybeSeconds}`);
        }
        args.watchSeconds = parsed;
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('--')) {
      throw usageError(`unknown flag: ${arg}`);
    }
    if (!args.projectDir) {
      args.projectDir = arg;
      continue;
    }
    throw usageError(`unexpected argument: ${arg}`);
  }

  args.projectDir = args.projectDir || process.cwd();
  args.mode = args.mode || 'dashboard';

  if (args.watch && args.mode === 'json') {
    throw usageError('--watch cannot be combined with --json');
  }

  return args;
}

function usageError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function parseNdjsonComplete(text, logPath) {
  let completeText = text;
  let consumedBytes = Buffer.byteLength(text, 'utf8');

  if (text && !text.endsWith('\n')) {
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1) {
      return { events: [], consumedBytes: 0 };
    }
    completeText = text.slice(0, lastNewline + 1);
    consumedBytes = Buffer.byteLength(completeText, 'utf8');
  }

  const events = [];
  for (const line of completeText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      throw new Error(`Corrupt log line in ${logPath}: ${trimmed.slice(0, 80)}...`);
    }
  }

  return { events, consumedBytes };
}

async function readChunk(logPath, start, end) {
  const handle = await fs.open(logPath, 'r');
  try {
    const length = Math.max(0, end - start);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function initialCursor(logPath) {
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    const { events, consumedBytes } = parseNdjsonComplete(raw, logPath);
    return { events, offset: consumedBytes };
  } catch (err) {
    if (err.code === 'ENOENT') return { events: [], offset: 0 };
    throw err;
  }
}

async function advanceCursor(logPath, offset) {
  let stat;
  try {
    stat = await fs.stat(logPath);
  } catch (err) {
    if (err.code === 'ENOENT') return { events: [], offset: 0, reset: offset !== 0 };
    throw err;
  }

  if (stat.size < offset) {
    const snapshot = await initialCursor(logPath);
    return { ...snapshot, reset: true };
  }

  if (stat.size === offset) {
    return { events: [], offset, reset: false };
  }

  const chunk = await readChunk(logPath, offset, stat.size);
  const { events, consumedBytes } = parseNdjsonComplete(chunk, logPath);
  return {
    events,
    offset: offset + consumedBytes,
    reset: false
  };
}

async function loadCosts() {
  const raw = await fs.readFile(new URL('../schemas/costs.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

function estimateCost(costs, model, tokens = {}) {
  const table = costs.models?.[model] || costs.defaults || {};
  const input = tokens.input || 0;
  const output = tokens.output || 0;
  const cached = tokens.cached || 0;
  const cacheRate = table.cache_read_per_mtok ?? (table.input_per_mtok || 0) * 0.1;
  const total =
    (input / 1e6) * (table.input_per_mtok || 0) +
    (output / 1e6) * (table.output_per_mtok || 0) +
    (cached / 1e6) * cacheRate;
  return +total.toFixed(4);
}

async function parsePausedTasks(projectDir) {
  const pausedPath = path.join(projectDir, 'tasks', 'paused.md');
  let markdown;
  try {
    markdown = await fs.readFile(pausedPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const paused = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    paused.push({
      task_id: current.task_id,
      reason: current.lines.join(' ').replace(/\s+/g, ' ').trim() || '(no reason recorded)'
    });
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = { task_id: heading[1].trim(), lines: [] };
      continue;
    }
    if (!current) continue;
    if (rawLine.trim() === '') continue;
    current.lines.push(rawLine.trim());
  }
  flush();

  return paused;
}

function taskMeta(events) {
  const byTask = new Map();
  for (const event of events) {
    const taskId = event.task_id;
    if (!taskId) continue;
    const current = byTask.get(taskId) || { name: null, wave: event.wave ?? null };
    const candidate =
      event.payload?.title ||
      event.payload?.name ||
      event.payload?.summary ||
      event.payload?.task_name ||
      null;
    if (!current.name && candidate) current.name = candidate;
    if (current.wave == null && event.wave != null) current.wave = event.wave;
    byTask.set(taskId, current);
  }
  return byTask;
}

function derivePipeline(events) {
  const seen = PIPELINE_STAGES.map(stage => events.some(stage.signal));
  const lastDone = seen.lastIndexOf(true);
  const pipeline = {};

  PIPELINE_STAGES.forEach((stage, index) => {
    let status = 'pending';
    if (seen[index]) {
      status = index === lastDone && index < PIPELINE_STAGES.length - 1 ? 'current' : 'done';
    }
    pipeline[stage.key] = status;
  });

  return pipeline;
}

function buildWaveSummary(state, meta) {
  return Object.keys(state.waves)
    .map(Number)
    .sort((a, b) => a - b)
    .map(waveNumber => {
      const wave = state.waves[waveNumber];
      const taskIds = Object.keys(wave.tasks).sort();
      const tasks = taskIds.map(taskId => {
        const task = wave.tasks[taskId];
        const name = meta.get(taskId)?.name || null;
        return {
          task_id: taskId,
          name,
          status: task.status,
          model: task.model || null,
          risk_class: task.risk_class || null,
          last_event_ts: task.last_event_ts,
          retries: task.retries || 0,
          quality_score: typeof task.quality_score === 'number' ? task.quality_score : null
        };
      });
      const accepted = tasks.filter(task => task.status === 'accepted').length;
      const total = tasks.length;
      const progress = total ? Math.round((accepted / total) * 100) : 0;
      let status = wave.status;
      if (status === 'planned' && tasks.some(task => task.status !== 'contracted')) status = 'in_progress';
      if (total > 0 && accepted === total && status !== 'accepted') status = 'accepted';
      return {
        wave: waveNumber,
        status,
        checkpoint_tag: wave.checkpoint_tag || null,
        accepted_tasks: accepted,
        total_tasks: total,
        progress_percent: progress,
        tasks
      };
    });
}

function aggregateCosts(events, costs, nowMs) {
  const since24h = nowMs - DAY_MS;
  const recentAgentCost = new Map();
  const taskTotals = new Map();
  let inputAll = 0;
  let outputAll = 0;
  let cachedAll = 0;
  let input24h = 0;
  let output24h = 0;
  let cached24h = 0;
  let costAll = 0;
  let cost24h = 0;
  let budgetPartial = false;
  let missingModelEventCount = 0;

  for (const event of events) {
    const tsMs = Number.isNaN(Date.parse(event.ts)) ? 0 : Date.parse(event.ts);
    const in24h = tsMs >= since24h;
    const model = event.model || event.payload?.model || null;
    const tokens = event.tokens || null;
    const needsModel = event.action === 'task.dispatched' || event.action === 'task.implemented';
    const needsTokens = event.action === 'task.implemented';

    if ((needsModel && !model) || (needsTokens && !tokens)) {
      budgetPartial = true;
      missingModelEventCount += 1;
    }

    if (!tokens) continue;

    const input = tokens.input || 0;
    const output = tokens.output || 0;
    const cached = tokens.cached || 0;
    inputAll += input;
    outputAll += output;
    cachedAll += cached;
    if (in24h) {
      input24h += input;
      output24h += output;
      cached24h += cached;
    }

    if (!model) continue;

    const cost = estimateCost(costs, model, tokens);
    costAll += cost;
    if (in24h) cost24h += cost;

    if (in24h) {
      recentAgentCost.set(event.agent, (recentAgentCost.get(event.agent) || 0) + cost);
    }

    if (event.task_id) {
      const bucket = taskTotals.get(event.task_id) || {
        task_id: event.task_id,
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        tokens: 0,
        cost_usd: 0,
        by_agent: new Map()
      };
      bucket.input_tokens += input;
      bucket.output_tokens += output;
      bucket.cached_tokens += cached;
      bucket.tokens += input + output + cached;
      bucket.cost_usd += cost;
      bucket.by_agent.set(event.agent, (bucket.by_agent.get(event.agent) || 0) + cost);
      taskTotals.set(event.task_id, bucket);
    }
  }

  const totalAgentRecentCost = [...recentAgentCost.values()].reduce((sum, value) => sum + value, 0);
  const perAgentShare = {};
  for (const [agent, cost] of [...recentAgentCost.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    perAgentShare[agent] = totalAgentRecentCost > 0 ? +(cost / totalAgentRecentCost).toFixed(4) : 0;
  }

  const topCost = [...taskTotals.values()]
    .map(task => {
      const dominantAgent = [...task.by_agent.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
      return {
        task_id: task.task_id,
        tokens: task.tokens,
        input_tokens: task.input_tokens,
        output_tokens: task.output_tokens,
        cached_tokens: task.cached_tokens,
        cost_usd: +task.cost_usd.toFixed(4),
        agent: dominantAgent
      };
    })
    .sort((a, b) => b.cost_usd - a.cost_usd || b.tokens - a.tokens || a.task_id.localeCompare(b.task_id))
    .slice(0, 10);

  return {
    topCost,
    perAgentShare,
    budget: {
      input_tokens: inputAll,
      output_tokens: outputAll,
      cached_tokens: cachedAll,
      input_tokens_24h: input24h,
      output_tokens_24h: output24h,
      cached_tokens_24h: cached24h,
      estimate_usd_all_time: +costAll.toFixed(4),
      estimate_usd_24h: +cost24h.toFixed(4),
      budget_partial: budgetPartial,
      missing_model_event_count: missingModelEventCount
    }
  };
}

function guardCounts(events, nowMs) {
  const since = nowMs - HOUR_MS;
  const counts = {
    'guard.violation': 0,
    'gate.passed': 0,
    'gate.failed': 0
  };
  for (const event of events) {
    const tsMs = Number.isNaN(Date.parse(event.ts)) ? 0 : Date.parse(event.ts);
    if (tsMs < since) continue;
    if (event.action in counts) counts[event.action] += 1;
  }
  return counts;
}

function warningsFor(topCost, guards) {
  const warnings = [];
  for (const row of topCost) {
    if (row.tokens > TOKEN_WARNING_THRESHOLD) {
      warnings.push({
        kind: 'tokens_over_threshold',
        task_id: row.task_id,
        tokens: row.tokens,
        threshold: TOKEN_WARNING_THRESHOLD
      });
    }
  }
  if (guards['gate.failed'] > 0) {
    warnings.push({
      kind: 'gate_failed_recent',
      count: guards['gate.failed'],
      since_minutes: 60
    });
  }
  return warnings;
}

function summarize(events, projectDir, costs, now = new Date()) {
  const nowMs = now.getTime();
  const state = buildState(events);
  const meta = taskMeta(events);
  const pipeline = derivePipeline(events);
  const waves = buildWaveSummary(state, meta);
  const open = openQuestions(events).map(question => ({
    id: question.id,
    text: question.payload?.question || '(no question text)',
    wave: question.wave ?? null,
    task_id: question.task_id ?? null
  }));
  const guards = guardCounts(events, nowMs);
  const { topCost, perAgentShare, budget } = aggregateCosts(events, costs, nowMs);
  const paused = [];
  const lastEvent = events[events.length - 1] || null;
  const sessionStart = events.find(event => event.action === 'session.start') || events[0] || null;
  const warnings = warningsFor(topCost, guards);

  for (const entry of topCost) {
    entry.name = meta.get(entry.task_id)?.name || null;
  }

  return {
    session_id: state.session_id || null,
    project_name: state.project.name || path.basename(projectDir),
    uptime_seconds: sessionStart ? Math.max(0, Math.floor((nowMs - Date.parse(sessionStart.ts)) / 1000)) : 0,
    zone: state.context_zone || 'green',
    last_event_ts: lastEvent?.ts || null,
    last_event_action: lastEvent?.action || null,
    pipeline,
    waves,
    open_questions: open,
    paused_tasks: paused,
    guards_last_hour: guards,
    top_cost: topCost,
    per_agent_share: perAgentShare,
    budget,
    soft_warnings: warnings,
    events_total: events.length
  };
}

function waveStatusSymbol(status, c) {
  if (status === 'accepted') return `${c.green}✓${c.reset}`;
  if (status === 'in_progress' || status === 'reviewing') return `${c.cyan}◐${c.reset}`;
  return `${c.dim}◌${c.reset}`;
}

function pipelineSymbol(status, c) {
  if (status === 'done') return `${c.green}✓${c.reset}`;
  if (status === 'current') return `${c.cyan}◐${c.reset}`;
  return `${c.dim}◌${c.reset}`;
}

function progressBar(percent, width = 20) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
}

function renderDashboard(summary, c, now = new Date()) {
  const lines = [];
  const lastEventAge = summary.last_event_ts ? formatAge(now.getTime() - Date.parse(summary.last_event_ts)) : 'n/a';
  lines.push(`=== nightshift - ${summary.project_name} ===`);
  lines.push(
    `Session ${summary.session_id || '-'}  uptime ${formatAge(summary.uptime_seconds * 1000)}  ` +
    `zone ${zoneColor(summary.zone, c)}  last-event ${lastEventAge} ago`
  );
  lines.push('');

  lines.push(...section('PIPELINE', PIPELINE_STAGES.map(stage => {
    const status = summary.pipeline[stage.key];
    return `  ${pipelineSymbol(status, c)} ${stage.label.padEnd(10)} ${c.dim}(${stage.description})${c.reset}`;
  })));

  const waveLines = [];
  for (const wave of summary.waves) {
    waveLines.push(
      `  Wave ${wave.wave}  ${waveStatusSymbol(wave.status, c)} ${wave.status.replace('_', '-')}  ` +
      `[${progressBar(wave.progress_percent)}] ${wave.progress_percent}% [${wave.accepted_tasks}/${wave.total_tasks}]`
    );
    if (wave.checkpoint_tag) {
      waveLines.push(`    checkpoint: ${wave.checkpoint_tag}`);
    }
    for (const task of wave.tasks) {
      const quality = task.quality_score != null ? `  q=${task.quality_score}` : '';
      waveLines.push(
        `    ${task.task_id.padEnd(12)} ${(task.name || '-').padEnd(20)} ${task.status.padEnd(11)} ${(task.model || '?').padEnd(18)}${quality}`
      );
    }
  }
  if (!waveLines.length) waveLines.push('  (no waves yet)');
  const tokenWarnings = summary.soft_warnings.filter(warning => warning.kind === 'tokens_over_threshold');
  for (const warning of tokenWarnings) {
    waveLines.push(
      `  ${c.yellow}WARNING${c.reset} ${warning.task_id} cumulative tokens ${fmtInt(warning.tokens)} (>200k threshold)`
    );
  }
  lines.push(...section('WAVES', waveLines));

  const failedCount = summary.guards_last_hour['gate.failed'];
  const gateFailedText = failedCount > 0 ? `${c.red}${failedCount}${c.reset}` : String(failedCount);
  lines.push(...section('GUARDS / GATES (last hour)', [
    `  guard.violation: ${summary.guards_last_hour['guard.violation']}`,
    `  gate.passed: ${summary.guards_last_hour['gate.passed']}    gate.failed: ${gateFailedText}`
  ]));

  lines.push(...section('TOP COST', summary.top_cost.map(row => (
    `  ${row.task_id.padEnd(12)} ${(row.name || '-').padEnd(20)} ${fmtInt(row.tokens).padStart(8)} tok  ` +
    `$${fmtMoney(row.cost_usd).padStart(6)}  ${(row.agent || '-').padEnd(18)}`
  ))));

  lines.push(...section('PER-AGENT SHARE (24h)', Object.entries(summary.per_agent_share).map(([agent, share]) => (
    `  ${agent.padEnd(18)} ${fmtPct(share * 100)}`
  ))));

  const budgetLead = `  in ${fmtInt(summary.budget.input_tokens_24h)}   out ${fmtInt(summary.budget.output_tokens_24h)}   cached ${fmtInt(summary.budget.cached_tokens_24h)}`;
  const budgetEstimate = summary.budget.budget_partial
    ? `  ~$≥${fmtMoney(summary.budget.estimate_usd_24h)} (24h, under-counted) / ~$≥${fmtMoney(summary.budget.estimate_usd_all_time)} (all-time, under-counted)`
    : `  ~$${fmtMoney(summary.budget.estimate_usd_24h)} (24h) / ~$${fmtMoney(summary.budget.estimate_usd_all_time)} (all-time)`;
  lines.push(...section('BUDGET', [
    budgetLead,
    budgetEstimate,
    `  budget_partial: ${String(summary.budget.budget_partial)}    missing_model_event_count: ${summary.budget.missing_model_event_count}`
  ]));

  lines.push(...section('EVENTS', [
    `  total: ${summary.events_total}`,
    `  last: ${summary.last_event_action || '-'}${summary.last_event_ts ? ` (${lastEventAge} ago)` : ''}`
  ]));

  const gateRecent = summary.soft_warnings.find(warning => warning.kind === 'gate_failed_recent');
  if (gateRecent) {
    lines.push(`WARNING: gate.failed count ${gateRecent.count} in the last ${gateRecent.since_minutes}m`);
  }
  if (tokenWarnings.length) {
    for (const warning of tokenWarnings) {
      lines.push(`WARNING: ${warning.task_id} cumulative tokens ${fmtInt(warning.tokens)} (>200k threshold)`);
    }
  }
  if (gateRecent || tokenWarnings.length) {
    lines.push('');
  }

  lines.push(...section(`OPEN QUESTIONS ${summary.open_questions.length}`, summary.open_questions.map(question => {
    const suffix = [question.wave != null ? `wave ${question.wave}` : null, question.task_id ? `task ${question.task_id}` : null]
      .filter(Boolean)
      .join(', ');
    return `  ${question.id}  ${question.text}${suffix ? `  [${suffix}]` : ''}`;
  })));

  lines.push(...section(`PAUSED TASKS ${summary.paused_tasks.length}`, summary.paused_tasks.map(task => (
    `  ${task.task_id} - ${task.reason}`
  ))));

  return lines.join('\n').trimEnd() + '\n';
}

function renderCompact(summary, state, c) {
  const lines = [
    `${c.bold}${summary.project_name}${c.reset}  ${c.dim}session=${summary.session_id || '-'}${c.reset}`,
    `context_zone: ${zoneColor(summary.zone, c)}   events=${summary.events_total}   tokens=${fmtTokensShort(state.totals.tokens)}   cost=$${state.totals.cost_usd_estimate}`,
    ''
  ];

  if (!summary.waves.length) {
    lines.push(`${c.dim}(no waves yet)${c.reset}`);
  }

  for (const wave of summary.waves) {
    lines.push(`${badge(wave.status, c)} wave ${wave.wave} ${c.dim}(${wave.status})${c.reset}  ${wave.checkpoint_tag ? c.dim + 'tag=' + wave.checkpoint_tag + c.reset : ''}`.trimEnd());
    for (const task of wave.tasks) {
      lines.push(
        `      ${taskBadge(task.status, c)} ${task.task_id.padEnd(24)} ${c.dim}${(task.risk_class || '').padEnd(18)}${c.reset} ${(task.model || '').padEnd(22)}`
      );
    }
  }

  if (summary.open_questions.length) {
    lines.push('');
    lines.push(`${c.yellow}${c.bold}open questions:${c.reset}`);
    for (const question of summary.open_questions) {
      lines.push(`  - ${question.id}: ${question.text}`);
    }
  }
  if (summary.paused_tasks.length) {
    lines.push('');
    lines.push(`${c.red}${c.bold}paused tasks:${c.reset}`);
    for (const task of summary.paused_tasks) {
      lines.push(`  - ${task.task_id}: ${task.reason}`);
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

async function renderMode({ args, events, projectDir, costs, colors }) {
  if (events.length === 0) {
    if (args.mode === 'json') {
      return `${JSON.stringify({
        session_id: null,
        uptime_seconds: 0,
        zone: 'green',
        last_event_ts: null,
        last_event_action: null,
        pipeline: Object.fromEntries(PIPELINE_STAGES.map(stage => [stage.key, 'pending'])),
        waves: [],
        open_questions: [],
        paused_tasks: [],
        guards_last_hour: { 'guard.violation': 0, 'gate.passed': 0, 'gate.failed': 0 },
        top_cost: [],
        per_agent_share: {},
        budget: {
          input_tokens: 0,
          output_tokens: 0,
          cached_tokens: 0,
          estimate_usd_all_time: 0,
          estimate_usd_24h: 0,
          budget_partial: false,
          missing_model_event_count: 0
        },
        soft_warnings: [],
        events_total: 0,
        message: 'no sessions recorded yet'
      })}\n`;
    }
    return 'no sessions recorded yet\n';
  }

  const summary = summarize(events, projectDir, costs);
  summary.paused_tasks = await parsePausedTasks(projectDir);

  if (args.mode === 'json') {
    return `${JSON.stringify(summary)}\n`;
  }

  if (args.mode === 'compact') {
    const state = buildState(events);
    return renderCompact(summary, state, colors);
  }

  return renderDashboard(summary, colors);
}

async function renderOnce(args, events, projectDir, costs, colors) {
  return renderMode({ args, events, projectDir, costs, colors });
}

async function watch(args, logPath, costs) {
  if (!process.stdout.isTTY) {
    console.error('--watch requires a TTY; use --json for piped consumption');
    process.exit(2);
  }

  const colors = makeColors(true);
  let cursor = await initialCursor(logPath);
  let events = cursor.events;

  for (;;) {
    const output = await renderOnce(args, events, args.projectDir, costs, colors);
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(output);
    await new Promise(resolve => setTimeout(resolve, args.watchSeconds * 1000));
    const delta = await advanceCursor(logPath, cursor.offset);
    cursor = { offset: delta.offset };
    events = delta.reset ? delta.events : events.concat(delta.events);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const logPath = path.join(args.projectDir, 'tasks', 'events.ndjson');
  const costs = await loadCosts();

  if (args.watch) {
    await watch(args, logPath, costs);
    return;
  }

  const snapshot = await initialCursor(logPath);
  const colors = makeColors(process.stdout.isTTY && args.mode !== 'json');
  const output = await renderOnce(args, snapshot.events, args.projectDir, costs, colors);
  process.stdout.write(output);
}

main().catch(err => {
  console.error(err.message);
  process.exit(err.exitCode || 1);
});
