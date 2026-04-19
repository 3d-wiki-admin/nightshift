#!/usr/bin/env bash
# PreToolUse(Write|Edit) — block writes outside the active task's allowed_files.
# Emits guard.violation event on block.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ns_read_event >/dev/null

tool_name="$(ns_event_field tool_name)"
case "$tool_name" in
  Write|Edit|MultiEdit|NotebookEdit) ;;
  *) ns_allow ;;
esac

# The write target
target="$(ns_event_field tool_input.file_path)"
[ -z "$target" ] && ns_allow

project="$(ns_project_dir)"
# Only guard writes inside the project.
case "$target" in
  "$project"/*) ;;
  *) ns_allow ;;
esac

rel="${target#$project/}"

# Hard-block paths that must never be written directly (events.ndjson, state.json).
# Emit guard.violation BEFORE ns_block so the audit trail captures the attempt.
hard_block() {
  local reason="$1"
  ns_append_event "$(cat <<EOF
{"agent":"system","action":"guard.violation","session_id":"$(ns_event_field session_id)","payload":{"attempted_path":"$rel","kind":"hard_block","reason":$(printf '%s' "$reason" | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))')}}
EOF
)"
  ns_block "$reason"
}

case "$rel" in
  tasks/events.ndjson) hard_block "Never write to events.ndjson directly. Use core/scripts/dispatch.mjs appendEvent / append." ;;
  tasks/state.json)    hard_block "state.json is a projection. Use core/scripts/replay-events.mjs --write." ;;
  tasks/compliance.md) ns_allow ;;
  tasks/questions.md)  ns_allow ;;
  tasks/decisions.md)  ns_allow ;;
  tasks/paused.md)     ns_allow ;;
  tasks/history/*)     ns_allow ;;
  tasks/analysis-*)    ns_allow ;;
  memory/learnings.md) ns_allow ;;
esac

# Find the active task; if none, allow (orchestrator / bootstrap writes are global).
active="$(ns_active_task)"
[ -z "$active" ] && ns_allow

wave="${active%%$'\t'*}"
task="${active##*$'\t'}"
contract="$project/tasks/waves/$wave/$task/contract.md"
[ -f "$contract" ] || ns_allow

# Narrow artifact exceptions to THIS task's own folder only — other tasks'
# artifacts are not writable from here.
task_artifact_prefix="tasks/waves/$wave/$task/"
case "$rel" in
  "$task_artifact_prefix"result.md)           ns_allow ;;
  "$task_artifact_prefix"review.md)           ns_allow ;;
  "$task_artifact_prefix"evidence/*)          ns_allow ;;
  "$task_artifact_prefix"context-pack.md)     ns_allow ;;
  "$task_artifact_prefix"spec-review.md)      ns_allow ;;
  "$task_artifact_prefix"block-resolution.md) ns_allow ;;
esac

allowed="$(ns_allowed_files "$contract")"
if [ -z "$allowed" ]; then
  ns_allow
fi

if ns_file_matches_any "$rel" $allowed; then
  ns_allow
fi

# Block + audit event.
ns_append_event "$(cat <<EOF
{"agent":"system","action":"guard.violation","task_id":"$task","wave":$wave,"session_id":"$(ns_event_field session_id)","payload":{"attempted_path":"$rel","kind":"allowed_files_violation","reason":"path not in allowed_files"}}
EOF
)"

ns_block "write-guard: path '$rel' is outside the active task's allowed_files. Task=$task wave=$wave. See $contract."
