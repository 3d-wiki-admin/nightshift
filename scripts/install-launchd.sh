#!/usr/bin/env bash
# install-launchd.sh — render plist templates with absolute paths, copy to
# ~/Library/LaunchAgents, then load via launchctl.
#
# Usage:
#   install-launchd.sh [--project /path/to/active/project] [--uninstall]
#
# Idempotent. Re-running re-renders and reloads.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$HOME/Library/LaunchAgents"
logdir="$HOME/.nightshift/logs"
project=""
uninstall=0

for arg in "$@"; do
  case "$arg" in
    --project)
      shift; project="${1:-}"; shift || true ;;
    --uninstall) uninstall=1 ;;
  esac
done

plists=(ai.nightshift.pinger.plist ai.nightshift.digest.plist)

if [ "$(uname)" != "Darwin" ]; then
  echo "install-launchd: macOS only; skipping."
  exit 0
fi

mkdir -p "$target" "$logdir"

unload_all() {
  for p in "${plists[@]}"; do
    if [ -f "$target/$p" ]; then
      launchctl bootout "gui/$(id -u)/${p%.plist}" 2>/dev/null || \
        launchctl unload "$target/$p" 2>/dev/null || true
    fi
  done
}

if [ "$uninstall" = "1" ]; then
  echo "[launchd] uninstalling..."
  unload_all
  for p in "${plists[@]}"; do rm -f "$target/$p"; done
  echo "[launchd] removed."
  exit 0
fi

[ -z "$project" ] && project="$PWD"

if [ ! -d "$project" ]; then
  echo "install-launchd: project dir not found: $project" >&2
  exit 2
fi

echo "[launchd] installing for project: $project"
unload_all

for p in "${plists[@]}"; do
  src="$root/launchd/$p"
  dst="$target/$p"
  [ -f "$src" ] || { echo "missing $src" >&2; exit 2; }

  sed \
    -e "s|__NIGHTSHIFT_HOME__|$root|g" \
    -e "s|__NIGHTSHIFT_ACTIVE_PROJECT__|$project|g" \
    -e "s|__HOME__|$HOME|g" \
    "$src" > "$dst"

  echo "  wrote $dst"
  launchctl bootstrap "gui/$(id -u)" "$dst" 2>/dev/null || launchctl load "$dst"
done

launchctl list | grep ai.nightshift || true
echo "[launchd] installed. Logs at: $logdir/"
