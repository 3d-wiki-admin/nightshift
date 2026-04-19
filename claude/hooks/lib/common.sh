#!/usr/bin/env bash
# Common helpers for all nightshift hooks.
# Source this at the top of a hook script:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

# Locate nightshift installation root (monorepo root).
if [ -z "${NIGHTSHIFT_HOME:-}" ]; then
  # hooks/lib/common.sh → ../.. is the plugin dir (claude/) → one more .. is the repo root.
  NIGHTSHIFT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
  export NIGHTSHIFT_HOME
fi

# Read the hook event JSON from stdin into $HOOK_EVENT (once).
ns_read_event() {
  if [ -z "${HOOK_EVENT:-}" ]; then
    HOOK_EVENT="$(cat)"
    export HOOK_EVENT
  fi
  printf '%s' "$HOOK_EVENT"
}

# Extract a field from the hook event via node (jq may not be installed).
ns_event_field() {
  local path="$1"
  node -e '
    const p = process.argv[1].split(".");
    const e = JSON.parse(process.env.HOOK_EVENT || "{}");
    let cur = e;
    for (const k of p) { if (cur == null) break; cur = cur[k]; }
    if (cur == null) process.exit(0);
    process.stdout.write(typeof cur === "string" ? cur : JSON.stringify(cur));
  ' "$path"
}

# Get the project dir (cwd of the Claude Code session).
ns_project_dir() {
  ns_event_field cwd
}

# Append one event via the dispatch layer.
# Usage: ns_append_event '{"agent":"system","action":"guard.violation",...}'
ns_append_event() {
  local payload="$1"
  local log
  log="$(ns_project_dir)/tasks/events.ndjson"
  if [ ! -d "$(dirname "$log")" ]; then
    return 0
  fi
  echo "$payload" | node "$NIGHTSHIFT_HOME/core/scripts/dispatch.mjs" append --log "$log" >/dev/null 2>&1 || true
}

# Decide "block" with a reason (Claude Code hook response).
ns_block() {
  local reason="$1"
  node -e '
    const r = process.argv[1];
    process.stdout.write(JSON.stringify({ decision: "block", reason: r }));
  ' "$reason"
  exit 2
}

# Allow (no-op; exit 0 also means allow).
ns_allow() {
  exit 0
}

# Most recently dispatched task without a subsequent terminal event.
# Echoes: "WAVE\tTASK_ID" (tab-separated) or empty if none.
ns_active_task() {
  local log
  log="$(ns_project_dir)/tasks/events.ndjson"
  [ -f "$log" ] || return 0
  node -e '
    const fs = require("fs");
    const log = process.argv[1];
    const lines = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
    const tasks = {};
    for (const l of lines) {
      try {
        const e = JSON.parse(l);
        if (!e.task_id) continue;
        if (!tasks[e.task_id]) tasks[e.task_id] = { wave: e.wave, last: null };
        tasks[e.task_id].last = e.action;
      } catch {}
    }
    const terminal = new Set(["task.accepted","task.rejected","task.implemented","task.blocked","task.promoted_to_heavy"]);
    let best = null;
    for (const [id, t] of Object.entries(tasks)) {
      if (t.last === "task.dispatched" || t.last === "task.context_packed") {
        best = { id, wave: t.wave };
      }
    }
    if (best) process.stdout.write(`${best.wave}\t${best.id}`);
  ' "$log"
}

# Extract `allowed_files` list from a task contract (simple YAML parse via node).
ns_allowed_files() {
  local contract="$1"
  [ -f "$contract" ] || return 0
  node -e '
    const fs = require("fs");
    const t = fs.readFileSync(process.argv[1], "utf8");
    const m = t.match(/```yaml\s*\n([\s\S]*?)```/);
    if (!m) process.exit(0);
    const yaml = m[1];
    const lines = yaml.split(/\r?\n/);
    let inSection = false;
    const out = [];
    for (const ln of lines) {
      if (/^allowed_files:\s*$/.test(ln)) { inSection = true; continue; }
      if (inSection) {
        if (/^\s*-\s+/.test(ln)) out.push(ln.replace(/^\s*-\s+/, "").trim().replace(/^["\x27]|["\x27]$/g, ""));
        else if (/^[a-z_]+:/.test(ln)) break;
      }
    }
    process.stdout.write(out.join("\n"));
  ' "$contract"
}

# Match a file path against a glob list. Returns 0 if any matches, 1 otherwise.
ns_file_matches_any() {
  local path="$1"; shift
  local globs="$*"
  [ -z "$globs" ] && return 1
  node -e '
    const p = process.argv[1];
    const globs = process.argv.slice(2);
    function toRegex(g) {
      const esc = g.replace(/[.+^${}()|\\]/g, "\\$&");
      const re = esc
        .replace(/\*\*/g, "§§DOUBLESTAR§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§DOUBLESTAR§§/g, ".*")
        .replace(/\?/g, ".");
      return new RegExp("^" + re + "$");
    }
    for (const g of globs) if (toRegex(g).test(p)) process.exit(0);
    process.exit(1);
  ' "$path" $globs
}
