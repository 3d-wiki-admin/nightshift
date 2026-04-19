#!/usr/bin/env bash
# PreToolUse(Task) — validate that before dispatching a subagent:
#   - constitution is present,
#   - active task contract (if any) has non-empty allowed_files.
# This catches "orchestrator forgot to bootstrap" failures early.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ns_read_event >/dev/null

tool_name="$(ns_event_field tool_name)"
[ "$tool_name" = "Task" ] || ns_allow

project="$(ns_project_dir)"

# Only enforce inside nightshift-managed projects.
if [ ! -f "$project/memory/constitution.md" ] && [ ! -f "$project/tasks/events.ndjson" ]; then
  ns_allow
fi

if [ ! -f "$project/memory/constitution.md" ]; then
  ns_block "pre-task-preflight: memory/constitution.md is missing. Run /bootstrap first."
fi

# If dispatching implementer or reviewer, ensure an active task exists with a valid contract.
subagent_type="$(ns_event_field tool_input.subagent_type)"
case "$subagent_type" in
  implementer|task-impl-reviewer|task-spec-reviewer|context-packer)
    active="$(ns_active_task)"
    if [ -z "$active" ]; then
      ns_block "pre-task-preflight: dispatching '$subagent_type' without an active task (no dispatched task in events.ndjson). Run /tasks to create a wave."
    fi
    wave="${active%%$'\t'*}"
    task="${active##*$'\t'}"
    contract="$project/tasks/waves/$wave/$task/contract.md"
    if [ ! -f "$contract" ]; then
      ns_block "pre-task-preflight: active task '$task' has no contract at $contract."
    fi
    allowed="$(ns_allowed_files "$contract")"
    if [ -z "$allowed" ]; then
      ns_block "pre-task-preflight: contract for '$task' has empty allowed_files."
    fi
    ;;
esac

ns_allow
