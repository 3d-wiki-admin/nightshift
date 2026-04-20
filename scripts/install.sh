#!/usr/bin/env bash
# install.sh — sets up nightshift on a fresh Mac.
# Idempotent. Safe to re-run.
#
# Flags:
#   --link-bin           Symlink `nightshift` into the user-local bin (default).
#                        Prefers ~/.local/bin or ~/bin if either is in PATH.
#   --system-bin         Symlink into /usr/local/bin (requires sudo).
#   --no-link-bin        Skip the symlink step.
#   --no-launchd         Skip installing launchd agents (macOS only, opt-in).
#   --yes                Non-interactive: accept defaults.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

link_bin=1
system_bin=0
skip_launchd=1   # default now: do NOT auto-register launchd (see ТЗ P0.6)
yes=0

for arg in "$@"; do
  case "$arg" in
    --link-bin) link_bin=1 ;;
    --system-bin) system_bin=1; link_bin=1 ;;
    --no-link-bin) link_bin=0 ;;
    --no-launchd) skip_launchd=1 ;;
    --with-launchd) skip_launchd=0 ;;
    --yes) yes=1 ;;
    -h|--help)
      sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
  esac
done

echo "[install] nightshift at $root"

# 1. Node deps (pnpm preferred; npm fallback)
if [ -f package.json ]; then
  echo "[install] installing node deps..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --silent
  elif command -v npm >/dev/null 2>&1; then
    npm install --silent
  else
    echo "[install] neither pnpm nor npm found; please install pnpm v10+ and re-run" >&2
    exit 1
  fi
fi

# 2. chmod scripts
chmod +x core/scripts/*.sh core/scripts/*.mjs scripts/*.sh 2>/dev/null || true

# 3. Build the self-contained Claude plugin runtime (P0.3: plugin must work
#    after Claude copies it to cache).
echo "[install] packaging Claude plugin runtime..."
bash "$root/scripts/prepare-claude-plugin-runtime.sh" >/dev/null

# 4. Top-level `nightshift` CLI on PATH.
if [ "$link_bin" = "1" ]; then
  bin_source="$root/scripts/nightshift.sh"
  if [ ! -f "$bin_source" ]; then
    echo "[install] bin source missing: $bin_source" >&2
    exit 3
  fi
  chmod +x "$bin_source"

  if [ "$system_bin" = "1" ]; then
    target="/usr/local/bin/nightshift"
    echo "[install] linking nightshift → $target (sudo required)..."
    sudo ln -sf "$bin_source" "$target"
    echo "[install] linked to $target"
  else
    # Prefer a user-local bin already in PATH.
    target=""
    for candidate in "$HOME/.local/bin" "$HOME/bin"; do
      if [ -d "$candidate" ] && [[ ":$PATH:" == *":$candidate:"* ]]; then
        target="$candidate/nightshift"
        break
      fi
    done
    if [ -z "$target" ]; then
      # Neither is in PATH — create ~/.local/bin and advise user.
      mkdir -p "$HOME/.local/bin"
      target="$HOME/.local/bin/nightshift"
      echo "[install] ~/.local/bin was not in PATH — linking there anyway." >&2
      echo "[install]   Add this to your shell rc and re-source:" >&2
      echo "[install]     export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
    fi
    ln -sf "$bin_source" "$target"
    echo "[install] linked to $target"
  fi
fi

# 5. Codex CLI adapter — available at $root/codex (no auto-install, advisory).
if [ -d "$root/codex" ]; then
  echo "[install] Codex adapter lives at: $root/codex"
fi

# 6. Launchd — opt-in and MUST target a concrete project path.
#    Nightshift core dir is NOT an acceptable target.
if [ "$skip_launchd" = "0" ] && [ "$(uname)" = "Darwin" ]; then
  echo "[install] launchd agents require an explicit --project <path>." >&2
  echo "[install] after 'nightshift init <path>' run: nightshift launchd install --project <path>" >&2
fi

# 7. Self-test — full 100+ suite.
echo "[install] self-test..."
if pnpm test >/dev/null 2>&1 || npm test >/dev/null 2>&1; then
  echo "[install] core self-test: OK"
else
  echo "[install] core self-test: FAIL — investigate before using on real projects" >&2
  exit 2
fi

cat <<EOF

Installed.

Next:
  1. Make sure 'nightshift' is on PATH:
       which nightshift
  2. Open Claude Code — the plugin is already packaged.
  3. In Claude:
       /plugin install $root/claude
  4. Start a project:
       nightshift init ~/dev/<your-project-name>

Docs: README.md, docs/ARCHITECTURE.md, docs/SECRETS.md.
EOF
