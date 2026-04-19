export function initialState() {
  return {
    version: 1,
    built_from_event_id: null,
    built_at: new Date().toISOString(),
    session_id: null,
    project: { name: '', constitution_version: 0 },
    context_zone: 'green',
    waves: {},
    open_questions: [],
    paused_tasks: [],
    totals: { tokens: 0, cost_usd_estimate: 0, events: 0 }
  };
}

function ensureWave(state, wave) {
  if (wave == null) return null;
  if (!state.waves[wave]) {
    state.waves[wave] = {
      status: 'planned',
      checkpoint_tag: null,
      started_at: null,
      ended_at: null,
      tasks: {}
    };
  }
  return state.waves[wave];
}

function ensureTask(state, wave, taskId) {
  const w = ensureWave(state, wave);
  if (!w) return null;
  if (!w.tasks[taskId]) {
    w.tasks[taskId] = {
      status: 'contracted',
      risk_class: null,
      parallel_marker: null,
      model: null,
      effort: null,
      retries: 0,
      lease: null,
      gates: {},
      quality_score: null,
      tokens: {},
      evidence_folder: null,
      last_event_ts: null
    };
  }
  return w.tasks[taskId];
}

export function applyEvent(state, event) {
  state.built_from_event_id = event.event_id || state.built_from_event_id;
  state.built_at = new Date().toISOString();
  state.totals.events += 1;

  if (event.tokens) {
    state.totals.tokens += (event.tokens.input || 0) + (event.tokens.output || 0);
  }
  if (typeof event.cost_usd_estimate === 'number') {
    state.totals.cost_usd_estimate = +(state.totals.cost_usd_estimate + event.cost_usd_estimate).toFixed(4);
  }

  const action = event.action;

  if (action === 'session.start') {
    state.session_id = event.session_id || state.session_id;
    if (event.payload?.project) state.project.name = event.payload.project;
    if (typeof event.payload?.constitution_version === 'number') {
      state.project.constitution_version = event.payload.constitution_version;
    }
  }

  if (action === 'wave.planned') {
    ensureWave(state, event.wave);
  }
  if (action === 'wave.started') {
    const w = ensureWave(state, event.wave);
    if (w) {
      w.status = 'in_progress';
      w.started_at = event.ts;
    }
  }
  if (action === 'wave.reviewed') {
    const w = ensureWave(state, event.wave);
    if (w) w.status = 'reviewing';
  }
  if (action === 'wave.accepted') {
    const w = ensureWave(state, event.wave);
    if (w) {
      w.status = 'accepted';
      w.ended_at = event.ts;
    }
  }
  if (action === 'checkpoint.tagged') {
    const w = ensureWave(state, event.wave);
    if (w && event.payload?.tag) w.checkpoint_tag = event.payload.tag;
  }
  if (action === 'rollback.performed') {
    const w = ensureWave(state, event.wave);
    if (w) w.status = 'rolled_back';
  }

  if (event.task_id) {
    const task = ensureTask(state, event.wave, event.task_id);
    if (task) {
      task.last_event_ts = event.ts;
      switch (action) {
        case 'task.contracted':
          task.status = 'contracted';
          if (event.payload?.risk_class) task.risk_class = event.payload.risk_class;
          if (event.payload?.parallel_marker) task.parallel_marker = event.payload.parallel_marker;
          if (event.payload?.evidence_folder) task.evidence_folder = event.payload.evidence_folder;
          break;
        case 'task.context_packed': task.status = 'context_packed'; break;
        case 'task.routed':
          task.status = 'routed';
          if (event.payload?.model) task.model = event.payload.model;
          if (event.payload?.effort) task.effort = event.payload.effort;
          break;
        case 'task.dispatched': task.status = 'dispatched'; break;
        case 'task.blocked': task.status = 'blocked'; break;
        case 'task.resolved': task.status = 'dispatched'; break;
        case 'task.implemented': task.status = 'implemented'; break;
        case 'task.reviewed':
          task.status = 'reviewing';
          if (typeof event.payload?.quality_score === 'number') {
            task.quality_score = event.payload.quality_score;
          }
          break;
        case 'task.accepted': task.status = 'accepted'; break;
        case 'task.rejected':
          task.status = 'rejected';
          task.retries += 1;
          break;
        case 'task.revised':
          task.status = 'revised';
          task.retries += 1;
          break;
        case 'task.promoted_to_heavy': task.status = 'promoted'; break;
        case 'gate.passed':
          if (event.payload?.gate) task.gates[event.payload.gate] = 'pass';
          break;
        case 'gate.failed':
          if (event.payload?.gate) task.gates[event.payload.gate] = 'fail';
          break;
        case 'lease.acquired':
          task.lease = {
            worktree: event.payload?.worktree || null,
            until: event.payload?.until || null,
            locks: event.payload?.locks || []
          };
          break;
        case 'lease.extended':
          if (task.lease && event.payload?.until) task.lease.until = event.payload.until;
          break;
        case 'lease.expired':
        case 'lease.released':
          task.lease = null;
          break;
      }

      if (event.agent && event.tokens) {
        const bucket = task.tokens[event.agent] || { in: 0, out: 0, cost: 0 };
        bucket.in += event.tokens.input || 0;
        bucket.out += event.tokens.output || 0;
        bucket.cost = +(bucket.cost + (event.cost_usd_estimate || 0)).toFixed(4);
        task.tokens[event.agent] = bucket;
      }
    }
  }

  if (action === 'question.asked') {
    const qid = event.payload?.question_id;
    if (qid && !state.open_questions.includes(qid)) state.open_questions.push(qid);
  }
  if (action === 'question.answered' || action === 'decision.recorded') {
    const qid = event.payload?.question_id;
    if (qid) state.open_questions = state.open_questions.filter(q => q !== qid);
  }
  if (action === 'context_zone.changed') {
    if (event.payload?.zone) state.context_zone = event.payload.zone;
  }
  if (action === 'pinger.unstuck.failed' || action === 'session.halted') {
    const tid = event.task_id;
    if (tid && !state.paused_tasks.includes(tid)) state.paused_tasks.push(tid);
  }

  return state;
}

export function buildState(events) {
  let state = initialState();
  for (const ev of events) {
    state = applyEvent(state, ev);
  }
  return state;
}
