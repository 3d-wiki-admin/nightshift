#!/usr/bin/env bash
# snapshot.sh — create a tar.gz of tasks/ + memory/ for post-mortem analysis.
# Does NOT capture source code (git is already the snapshot for that).
set -euo pipefail

target_dir="${1:-$PWD}"
out_dir="${2:-${HOME}/.nightshift/snapshots}"

[ -d "$target_dir" ] || { echo "not a directory: $target_dir" >&2; exit 2; }

cd "$target_dir"
if [ ! -d tasks ] || [ ! -d memory ]; then
  echo "snapshot: tasks/ and memory/ must exist in $target_dir" >&2
  exit 2
fi

mkdir -p "$out_dir"
project="$(basename "$target_dir")"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
name="${project}-${ts}.tgz"
out="${out_dir}/${name}"

tar -czf "$out" tasks memory 2>/dev/null
echo "$out"
