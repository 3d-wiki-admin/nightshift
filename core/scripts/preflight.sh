#!/usr/bin/env bash
# preflight.sh — pre-sleep readiness validator.
# Exits 0 if the project is safe to run overnight; non-zero with diagnostics otherwise.
set -uo pipefail

require_launchd=0
positional=()
while [ $# -gt 0 ]; do
  case "$1" in
    --require-launchd) require_launchd=1; shift ;;
    *) positional+=("$1"); shift ;;
  esac
done

target="${positional[0]:-$PWD}"
cd "$target"

ok=0
warn=0
fail=0

check_ok()   { printf "  \e[32m✓\e[0m %s\n" "$1"; ok=$((ok+1)); }
check_warn() { printf "  \e[33m!\e[0m %s\n" "$1"; warn=$((warn+1)); }
check_fail() { printf "  \e[31m✗\e[0m %s\n" "$1"; fail=$((fail+1)); }

echo "preflight for: $target"
echo

# 1. constitution exists
if [ -f memory/constitution.md ]; then check_ok "memory/constitution.md present"
else check_fail "memory/constitution.md missing — agents have no rules to follow"; fi

# 2. spec exists
if [ -f tasks/spec.md ]; then check_ok "tasks/spec.md present"
else check_fail "tasks/spec.md missing"; fi

# 3. events log is writable
if mkdir -p tasks && touch tasks/events.ndjson 2>/dev/null; then check_ok "tasks/events.ndjson writable"
else check_fail "tasks/events.ndjson not writable"; fi

# 4. git repo clean or at least committed
if git rev-parse --git-dir >/dev/null 2>&1; then
  if git diff --quiet && git diff --cached --quiet; then check_ok "git tree clean"
  else check_warn "git tree has uncommitted changes"
  fi
else check_warn "not a git repo — checkpoints unavailable"; fi

# 5. node available
if command -v node >/dev/null 2>&1; then check_ok "node $(node --version)"
else check_fail "node not on PATH"; fi

# 6. codex available
if command -v codex >/dev/null 2>&1; then check_ok "codex CLI present"
else check_warn "codex CLI not installed — implementer will degrade to Claude-only"; fi

# 7. launchd plists loaded (macOS)
if [ "$(uname)" = "Darwin" ]; then
  if launchctl list 2>/dev/null | grep -q ai.nightshift.pinger; then
    check_ok "pinger launchd agent loaded"
  elif [ "$require_launchd" = "1" ]; then
    check_fail "launchd pinger not loaded — run nightshift launchd install --project $target"
    echo "nightshift launchd install --project $target" >&2
  else
    check_warn "launchd pinger not loaded — optional, needed only for overnight runs"
  fi
else
  if [ "$require_launchd" = "1" ]; then
    check_fail "--require-launchd specified but system is not Darwin"
  else
    check_warn "non-Darwin system — launchd safety disabled"
  fi
fi

# 7b. Hotfix-3 H16: if a recent wave.handoff exists, derive the
# claim filename the pinger would use and warn when no claim exists
# and no task.dispatched has landed for the next wave yet.
if [ -f tasks/events.ndjson ] && command -v node >/dev/null 2>&1; then
  handoff_info="$(
    node -e '
      const fs = require("node:fs");
      const logPath = process.argv[1];
      let raw = "";
      try {
        raw = fs.readFileSync(logPath, "utf8").trim();
      } catch {
        process.exit(0);
      }
      if (!raw) process.exit(0);
      const events = raw.split("\n").filter(Boolean).map(line => JSON.parse(line));
      const handoff = [...events].reverse().find(event => event.action === "wave.handoff");
      if (!handoff) process.exit(0);
      const payload = handoff.payload || {};
      const sw = payload.source_wave;
      const nw = payload.next_wave;
      const nm = payload.next_manifest;
      if (sw == null || nw == null || typeof nm !== "string" || nm.length === 0) process.exit(0);
      const dispatched = events.some(event =>
        event.action === "task.dispatched" && Number(event.wave) === Number(nw)
      );
      if (dispatched) process.exit(0);
      process.stdout.write(`${sw}\t${nw}\t${nm}`);
    ' tasks/events.ndjson 2>/dev/null
  )"
  if [ -n "$handoff_info" ]; then
    IFS=$'\t' read -r SW NW NM <<EOF
$handoff_info
EOF
    KEY=$(printf '%s:%s:%s' "$SW" "$NW" "$NM" | shasum -a 256 | head -c 16)
    CLAIM_FILE=".nightshift/wave-claim-${KEY}"
    if [ ! -f "$CLAIM_FILE" ]; then
      check_warn "wave $NW handoff is waiting; pinger should resurrect within 30 min, or run \`/nightshift:implement --wave=$NW\` manually."
    fi
  fi
fi

# 8. questions.md resolved
if [ -f tasks/questions.md ] && [ -s tasks/questions.md ]; then
  if grep -q '^- \[ \]' tasks/questions.md 2>/dev/null; then check_warn "unresolved questions in tasks/questions.md"
  else check_ok "no open questions"; fi
else check_ok "no questions file (clean)"; fi

# 9. paused tasks
if [ -f tasks/paused.md ] && [ -s tasks/paused.md ]; then check_warn "paused tasks present (review before sleep)"
else check_ok "no paused tasks"; fi

echo
printf "preflight: \e[32m%d ok\e[0m  \e[33m%d warn\e[0m  \e[31m%d fail\e[0m\n" "$ok" "$warn" "$fail"

if [ "$fail" -gt 0 ]; then exit 1; fi
if [ "$warn" -gt 0 ]; then exit 2; fi
exit 0
