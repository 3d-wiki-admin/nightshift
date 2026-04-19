#!/usr/bin/env bash
# worktree-manager.sh — create/release git worktrees for parallel [P] tasks.
# Worktrees live under .nightshift/worktrees/wave-<N>-task-<ID>/ and share the main repo's .git.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  worktree-manager.sh create <wave> <task-id>
  worktree-manager.sh release <wave> <task-id>
  worktree-manager.sh list
  worktree-manager.sh prune                  # remove leftover worktrees from abandoned tasks
EOF
}

die() { echo "worktree-manager: $*" >&2; exit 1; }

root_dir() {
  git rev-parse --show-toplevel 2>/dev/null || die "not inside a git repo"
}

ensure_clean() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "working tree has uncommitted changes; commit or stash first"
  fi
}

cmd="${1:-}"; shift || true

case "$cmd" in
  create)
    wave="${1:-}"; task="${2:-}"
    [ -z "$wave" ] || [ -z "$task" ] && die "create requires <wave> <task-id>"
    root="$(root_dir)"
    cd "$root"
    wt="$root/.nightshift/worktrees/wave-${wave}-task-${task}"
    if [ -d "$wt" ]; then
      echo "$wt"; exit 0
    fi
    mkdir -p "$(dirname "$wt")"
    branch="nightshift/wave-${wave}-task-${task}"
    if git show-ref --verify --quiet "refs/heads/${branch}"; then
      git worktree add "$wt" "$branch" >/dev/null
    else
      git worktree add -b "$branch" "$wt" >/dev/null
    fi
    echo "$wt"
    ;;
  release)
    wave="${1:-}"; task="${2:-}"
    [ -z "$wave" ] || [ -z "$task" ] && die "release requires <wave> <task-id>"
    root="$(root_dir)"
    cd "$root"
    wt="$root/.nightshift/worktrees/wave-${wave}-task-${task}"
    if [ ! -d "$wt" ]; then
      echo "(no worktree at $wt)" >&2
      exit 0
    fi
    git worktree remove --force "$wt" >/dev/null
    ;;
  list)
    git worktree list
    ;;
  prune)
    git worktree prune -v
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    usage; exit 2
    ;;
esac
