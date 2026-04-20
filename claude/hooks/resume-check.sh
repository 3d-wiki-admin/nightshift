#!/usr/bin/env bash
# SessionStart — if an in-progress wave exists and the last event is >15 min old,
# inject a system message recommending /resume.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

ns_read_event >/dev/null

project="$(ns_project_dir)"
log="$project/tasks/events.ndjson"
state="$project/tasks/state.json"
[ -f "$log" ] || { ns_allow; }
[ -f "$state" ] || { node "$NIGHTSHIFT_RUNTIME_DIR/scripts/replay-events.mjs" "$log" --write >/dev/null 2>&1 || true; }

if [ ! -f "$state" ]; then
  ns_allow
fi

# Decide if we should hint /resume.
hint="$(node -e '
  const fs = require("fs");
  const path = require("path");
  const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const log = process.argv[2];
  const lines = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
  const last = lines.length ? JSON.parse(lines.at(-1)) : null;
  const hasInProgress = Object.values(state.waves || {}).some(w => w.status === "in_progress");
  if (!hasInProgress || !last) process.exit(0);
  const ageMin = (Date.now() - new Date(last.ts).getTime()) / 60000;
  if (ageMin > 15) {
    process.stdout.write(`nightshift: resuming a wave in progress (last event ${Math.round(ageMin)} min ago). Running /resume is recommended.`);
  }
' "$state" "$log" 2>/dev/null)"

if [ -n "$hint" ]; then
  # Claude Code SessionStart hook: echo a system notice.
  node -e 'process.stdout.write(JSON.stringify({ systemMessage: process.argv[1] }))' "$hint"
fi

ns_allow
