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

ns_allow
