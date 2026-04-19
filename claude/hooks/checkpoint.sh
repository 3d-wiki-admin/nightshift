#!/usr/bin/env bash
# Stop — tag session-end checkpoint + write a session summary.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ns_read_event >/dev/null

project="$(ns_project_dir)"
[ -d "$project/.git" ] || ns_allow

cd "$project"

# Tag only if we're inside a nightshift-managed project (tasks/events.ndjson exists).
if [ ! -f tasks/events.ndjson ]; then
  ns_allow
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
cat >"$summary" <<EOF
# Session summary — $ts

Events logged: $(wc -l <tasks/events.ndjson | tr -d ' ')
Tag: $tag
EOF

# Emit session.end event.
ns_append_event "$(cat <<EOF
{"agent":"system","action":"session.end","session_id":"$(ns_event_field session_id)","payload":{"tag":"$tag"}}
EOF
)"

ns_allow
