#!/usr/bin/env bash
# PreToolUse(Bash) — block shell operations that touch paths outside the project root.
# Defence against runaway agents running rm -rf / or editing ~/.ssh/config.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ns_read_event >/dev/null

tool_name="$(ns_event_field tool_name)"
[ "$tool_name" = "Bash" ] || ns_allow

cmd="$(ns_event_field tool_input.command)"
[ -z "$cmd" ] && ns_allow

project="$(ns_project_dir)"

# Absolute paths the command references.
forbidden_abs='(^|[[:space:]])(rm|chmod|chown|mv|cp)[[:space:]]+.*([[:space:]]|^)(/(etc|usr|bin|sbin|var|System|Library|opt|private|Applications|Volumes)|\$HOME|~|/Users/[^/]+/(\\.(ssh|gnupg|aws|npm|pnpm|cache|config)|Documents|Downloads|Desktop|Library|Pictures|Music|Movies))'

if echo "$cmd" | grep -qE "$forbidden_abs"; then
  ns_append_event "$(cat <<EOF
{"agent":"system","action":"guard.violation","session_id":"$(ns_event_field session_id)","payload":{"tool":"Bash","reason":"command touches path outside project root","cmd":"$(echo "$cmd" | head -c 200 | sed 's/"/\\"/g')"}}
EOF
)"
  ns_block "bash-budget: command appears to touch paths outside project root ($project). Scope shell operations to the project dir."
fi

# Absolutely forbid these commands regardless of targets:
if echo "$cmd" | grep -qE '(^|[[:space:]])(sudo|launchctl (load|unload|bootout)|rm[[:space:]]+-rf[[:space:]]*/)'; then
  ns_append_event "$(cat <<EOF
{"agent":"system","action":"guard.violation","session_id":"$(ns_event_field session_id)","payload":{"tool":"Bash","reason":"forbidden command pattern","cmd":"$(echo "$cmd" | head -c 200 | sed 's/"/\\"/g')"}}
EOF
)"
  ns_block "bash-budget: forbidden command pattern (sudo / launchctl / rm -rf /)."
fi

# In-project write-target audit. If the command writes to a file inside the
# project and we have an active task with allowed_files, reject writes outside
# that list. Closes the Bash bypass of the write-guard hook.
active="$(ns_active_task)"
if [ -n "$active" ]; then
  wave="${active%%$'\t'*}"
  task="${active##*$'\t'}"
  contract="$project/tasks/waves/$wave/$task/contract.md"
  if [ -f "$contract" ]; then
    allowed="$(ns_allowed_files "$contract")"
    if [ -n "$allowed" ]; then
      task_prefix="tasks/waves/$wave/$task/"
      while IFS= read -r target; do
        [ -z "$target" ] && continue
        # Normalize: absolute → relative-to-project; strip leading ./
        case "$target" in
          "$project"/*) rel="${target#$project/}" ;;
          /*) rel="" ;;                   # absolute outside project — other guard covers it
          ./*) rel="${target#./}" ;;
          *) rel="$target" ;;
        esac
        [ -z "$rel" ] && continue
        # Always-writable paths (match write-guard.sh).
        case "$rel" in
          tasks/events.ndjson|tasks/state.json)
            ns_append_event "$(cat <<EOF
{"agent":"system","action":"guard.violation","session_id":"$(ns_event_field session_id)","task_id":"$task","wave":$wave,"payload":{"tool":"Bash","kind":"hard_block_via_bash","attempted_path":"$rel","reason":"canonical file — use dispatch/replay"}}
EOF
)"
            ns_block "bash-budget: Bash must not write to '$rel'. Use dispatch.appendEvent / replay-events.mjs."
            ;;
          tasks/compliance.md|tasks/questions.md|tasks/decisions.md|tasks/paused.md|tasks/history/*|tasks/analysis-*|memory/learnings.md)
            continue
            ;;
          "$task_prefix"result.md|"$task_prefix"review.md|"$task_prefix"evidence/*|"$task_prefix"context-pack.md|"$task_prefix"spec-review.md|"$task_prefix"block-resolution.md)
            continue
            ;;
        esac
        # Fall through: must match allowed_files.
        if ! ns_file_matches_any "$rel" $allowed; then
          ns_append_event "$(cat <<EOF
{"agent":"system","action":"guard.violation","session_id":"$(ns_event_field session_id)","task_id":"$task","wave":$wave,"payload":{"tool":"Bash","kind":"allowed_files_violation","attempted_path":"$rel","reason":"Bash redirect target outside allowed_files"}}
EOF
)"
          ns_block "bash-budget: Bash command writes '$rel' outside active task's allowed_files. Task=$task wave=$wave."
        fi
      done < <(ns_bash_write_targets "$cmd")
    fi
  fi
fi

ns_allow
