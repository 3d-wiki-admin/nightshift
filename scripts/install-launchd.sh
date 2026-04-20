#!/usr/bin/env bash
# install-launchd.sh — install nightshift launchd agents for a SPECIFIC
# project. v1.1 rule: target project must be supplied explicitly (no cwd
# fallback) and cannot be the nightshift repo itself (P0.6).
#
# Usage:
#   install-launchd.sh --project /path/to/target/project
#   install-launchd.sh --project /path/to/project --allow-self-target   (escape hatch)
#   install-launchd.sh --uninstall
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="$HOME/Library/LaunchAgents"
logdir="$HOME/.nightshift/logs"
project=""
uninstall=0
allow_self=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) shift; project="${1:-}"; shift ;;
    --uninstall) uninstall=1; shift ;;
    --allow-self-target) allow_self=1; shift ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-launchd: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

plists=(ai.nightshift.pinger.plist ai.nightshift.digest.plist)

if [ "$(uname)" != "Darwin" ]; then
  echo "install-launchd: macOS only; skipping."
  exit 0
fi

mkdir -p "$target_dir" "$logdir"

unload_all() {
  for p in "${plists[@]}"; do
    if [ -f "$target_dir/$p" ]; then
      launchctl bootout "gui/$(id -u)/${p%.plist}" 2>/dev/null || \
        launchctl unload "$target_dir/$p" 2>/dev/null || true
    fi
  done
}

if [ "$uninstall" = "1" ]; then
  echo "[launchd] uninstalling..."
  unload_all
  for p in "${plists[@]}"; do rm -f "$target_dir/$p"; done
  echo "[launchd] removed."
  exit 0
fi

# P0.6: --project is REQUIRED. No cwd fallback — accidentally running this
# from inside nightshift itself once was enough.
if [ -z "$project" ]; then
  echo "install-launchd: --project <path> is required." >&2
  echo "  Example: install-launchd.sh --project ~/dev/my-app" >&2
  exit 2
fi

# Validate the path exists BEFORE resolving; otherwise set -e can short-
# circuit on the failed cd inside the command substitution.
if [ ! -d "$project" ]; then
  echo "install-launchd: project dir not found or not a directory: $project" >&2
  exit 2
fi

# Resolve to absolute, canonical path so nightshift-repo check can't be bypassed
# via relative paths or symlinks.
project_abs="$(cd "$project" && pwd -P)"
root_abs="$(cd "$root" && pwd -P)"

if [ "$project_abs" = "$root_abs" ] && [ "$allow_self" != "1" ]; then
  echo "install-launchd: refusing to attach launchd to the nightshift repo itself." >&2
  echo "  This is almost always a mistake (P0.6). Pass --allow-self-target if truly intended." >&2
  exit 2
fi

if [ ! -f "$project_abs/tasks/events.ndjson" ] && [ ! -f "$project_abs/memory/constitution.md" ]; then
  echo "install-launchd: '$project_abs' does not look like a nightshift-managed project" >&2
  echo "  (missing tasks/events.ndjson AND memory/constitution.md)" >&2
  echo "  Run 'nightshift init $project_abs' first, then re-run 'nightshift launchd install --project $project_abs'." >&2
  exit 2
fi

echo "[launchd] installing for project: $project_abs"
unload_all

for p in "${plists[@]}"; do
  src="$root/launchd/$p"
  dst="$target_dir/$p"
  [ -f "$src" ] || { echo "missing $src" >&2; exit 2; }

  sed \
    -e "s|__NIGHTSHIFT_HOME__|$root_abs|g" \
    -e "s|__NIGHTSHIFT_ACTIVE_PROJECT__|$project_abs|g" \
    -e "s|__HOME__|$HOME|g" \
    "$src" > "$dst"

  echo "  wrote $dst"
  launchctl bootstrap "gui/$(id -u)" "$dst" 2>/dev/null || launchctl load "$dst"
done

# Record launchd_enabled in the registry if the project is registered.
if command -v node >/dev/null 2>&1 && [ -f "$root/core/registry/index.mjs" ]; then
  node --input-type=module -e '
    import("'"$root"'/core/registry/index.mjs").then(async m => {
      const reg = new m.Registry();
      const p = process.argv[1];
      const rec = await reg.get(p);
      if (rec) await reg.update(rec.project_id, { launchd_enabled: true });
    }).catch(e => { process.stderr.write("[launchd] registry update skipped: " + e.message + "\n"); });
  ' "$project_abs" 2>/dev/null || true
fi

launchctl list | grep ai.nightshift || true
echo "[launchd] installed. Logs at: $logdir/"
