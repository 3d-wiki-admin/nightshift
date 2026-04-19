#!/usr/bin/env bash
# preflight.sh — pre-sleep readiness validator.
# Exits 0 if the project is safe to run overnight; non-zero with diagnostics otherwise.
set -uo pipefail

target="${1:-$PWD}"
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
  if launchctl list 2>/dev/null | grep -q ai.nightshift.pinger; then check_ok "pinger launchd agent loaded"
  else check_warn "pinger launchd agent not loaded — overnight safety off"; fi
else
  check_warn "non-Darwin system — launchd safety disabled"
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
