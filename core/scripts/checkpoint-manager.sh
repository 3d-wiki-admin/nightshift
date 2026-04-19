#!/usr/bin/env bash
# checkpoint-manager.sh — tag / list / rollback git checkpoints for a nightshift wave.
# Checkpoints let us restore tree to a pre-wave state if a wave goes sideways.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  checkpoint-manager.sh tag <label>         # create annotated tag at HEAD
  checkpoint-manager.sh list [--prefix P]   # list checkpoints (optionally filtered)
  checkpoint-manager.sh rollback <label>    # hard reset HEAD to tagged commit
  checkpoint-manager.sh show <label>        # show tag details
EOF
}

die() { echo "checkpoint-manager: $*" >&2; exit 1; }

cmd="${1:-}"; shift || true

case "$cmd" in
  tag)
    label="${1:-}"; [ -z "$label" ] && die "tag requires <label>"
    git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repo"
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    fullTag="nightshift/${label}-${ts}"
    git tag -a "$fullTag" -m "nightshift checkpoint: ${label} @ ${ts}"
    echo "$fullTag"
    ;;
  list)
    prefix="nightshift/"
    if [ "${1:-}" = "--prefix" ] && [ -n "${2:-}" ]; then
      prefix="$2"
    fi
    git tag --list "${prefix}*" --sort=-creatordate
    ;;
  rollback)
    label="${1:-}"; [ -z "$label" ] && die "rollback requires <label>"
    git rev-parse "refs/tags/${label}" >/dev/null 2>&1 || die "tag not found: ${label}"
    if ! git diff --quiet || ! git diff --cached --quiet; then
      die "working tree has uncommitted changes; commit or stash first"
    fi
    echo "rolling back to ${label}..." >&2
    git reset --hard "refs/tags/${label}"
    ;;
  show)
    label="${1:-}"; [ -z "$label" ] && die "show requires <label>"
    git show --stat "refs/tags/${label}"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    usage; exit 2
    ;;
esac
