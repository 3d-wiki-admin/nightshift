#!/usr/bin/env bash
# install.sh — sets up nightshift on a fresh Mac.
# Idempotent. Safe to re-run.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "[install] nightshift at $root"

# 1. Node deps
if [ -f package.json ]; then
  echo "[install] installing node deps..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
  else
    echo "[install] pnpm not found; please install pnpm v10+ and re-run" >&2
    exit 1
  fi
fi

# 2. chmod scripts
chmod +x core/scripts/*.sh core/scripts/*.mjs scripts/*.sh 2>/dev/null || true

# 3. Claude Code plugin — user installs inside Claude via /plugin install
echo "[install] Claude Code plugin lives at: $root/claude"
echo "          After starting Claude Code, run: /plugin install $root/claude"

# 4. Codex plugin — available at $root/codex
if [ -d "$root/codex" ]; then
  echo "[install] Codex adapter lives at: $root/codex"
fi

# 5. Launchd (macOS only, Wave 3)
if [ "$(uname)" = "Darwin" ] && [ -f "$root/scripts/install-launchd.sh" ]; then
  echo "[install] installing launchd agents..."
  bash "$root/scripts/install-launchd.sh" || echo "[install] launchd install skipped (rerun manually if needed)"
fi

# 6. Self-test
echo "[install] self-test..."
if node --test core/event-store/test/*.test.mjs core/scripts/test/*.test.mjs core/secrets/test/*.test.mjs >/dev/null 2>&1; then
  echo "[install] core self-test: OK"
else
  echo "[install] core self-test: FAIL — investigate before using on real projects" >&2
  exit 2
fi

cat <<'EOF'

Installed.

Next:
  1. Open Claude Code in any project directory.
  2. /plugin install /path/to/nightshift/claude
  3. /bootstrap     (scaffolds the project)
  4. /nightshift start  (begin chat → constitution + spec)

Docs: README.md, docs/ARCHITECTURE.md, docs/SECRETS.md.
EOF
