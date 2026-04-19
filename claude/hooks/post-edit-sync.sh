#!/usr/bin/env bash
# PostToolUse(Write|Edit) — debounced trigger for doc-syncer.
# Writes a "dirty" marker; the orchestrator runs doc-syncer after task acceptance,
# so we only run it here if the write landed a terminal event (task.accepted).
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ns_read_event >/dev/null

tool_name="$(ns_event_field tool_name)"
case "$tool_name" in
  Write|Edit|MultiEdit|NotebookEdit) ;;
  *) ns_allow ;;
esac

project="$(ns_project_dir)"
log="$project/tasks/events.ndjson"
[ -f "$log" ] || ns_allow

# Look at the last event — only sync if it's a terminal task event.
last_action="$(tail -1 "$log" 2>/dev/null | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{try{const e=JSON.parse(s);process.stdout.write(e.action||"")}catch{}})')"

case "$last_action" in
  task.accepted|wave.accepted|rollback.performed) ;;
  *) ns_allow ;;
esac

# Debounce: skip if we already synced within the last 30 seconds.
marker="$project/.nightshift/last-sync"
mkdir -p "$(dirname "$marker")"
if [ -f "$marker" ]; then
  now=$(date +%s)
  last=$(cat "$marker" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt 30 ]; then
    ns_allow
  fi
fi
date +%s >"$marker"

# Fire-and-forget sync (replay + compliance). Do not block the tool call.
(
  node "$NIGHTSHIFT_HOME/core/scripts/replay-events.mjs" "$log" --write >/dev/null 2>&1 || true
  node "$NIGHTSHIFT_HOME/core/scripts/compliance-reporter.mjs" "$project" >/dev/null 2>&1 || true
) &
disown 2>/dev/null || true

ns_allow
