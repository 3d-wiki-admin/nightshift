#!/usr/bin/env bash
# Stop — tag session-end checkpoint + write a session summary.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ns_read_event >/dev/null

project="$(ns_project_dir)"
[ -d "$project/.git" ] || ns_allow

cd "$project"

# Hotfix-2 H10: dedup consecutive session.end events for the same
# canonical session_id. Without this, every Claude turn boundary
# produces a session.end + git tag + tasks/history/session-*.summary.md,
# 27% of overnight events on kw-injector-v1 were noise like this.
if [ -f tasks/events.ndjson ] && [ -s tasks/events.ndjson ]; then
  last_line="$(tail -n 1 tasks/events.ndjson)"
  last_action="$(printf '%s' "$last_line" | jq -r '.action // ""' 2>/dev/null || echo '')"
  if [ "$last_action" = "session.end" ]; then
    last_sid="$(printf '%s' "$last_line" | jq -r '.session_id // ""' 2>/dev/null || echo '')"
    canonical_sid="$(ns_session_id 2>/dev/null || echo '')"
    if [ -n "$last_sid" ] && [ "$last_sid" = "$canonical_sid" ]; then
      ns_allow
    fi
  fi
fi

ts="$(date -u +%Y%m%dT%H%M%SZ)"
tag="nightshift/session-end-$ts"

if git rev-parse HEAD >/dev/null 2>&1; then
  if git diff --quiet && git diff --cached --quiet; then
    git tag -a "$tag" -m "nightshift session end" >/dev/null 2>&1 || true
  fi
fi

# Write a brief summary into tasks/history/
mkdir -p tasks/history
summary="tasks/history/session-$ts.summary.md"
events_logged="0"
if [ -f tasks/events.ndjson ]; then
  events_logged="$(wc -l <tasks/events.ndjson | tr -d ' ')"
fi
cat >"$summary" <<EOF
# Session summary — $ts

Events logged: $events_logged
Tag: $tag
EOF

# Emit session.end event.
ns_append_event "$(cat <<EOF
{"agent":"system","action":"session.end","session_id":"$(ns_event_field session_id)","payload":{"tag":"$tag"}}
EOF
)"

ns_allow
