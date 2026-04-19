#!/usr/bin/env bash
# smoke.sh — shortest golden-path verification for this project.
# Edit this when a feature needs a smoke check — do not delete.
set -euo pipefail

echo "[smoke] build..."
pnpm build

echo "[smoke] dev-server boot (60s timeout)..."
pnpm start -p 3001 >/tmp/nightshift-smoke.log 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT

for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -sf http://localhost:3001/ >/dev/null 2>&1; then
    echo "[smoke] server responded on /"
    exit 0
  fi
  sleep 5
done

echo "[smoke] server did not respond within 60s"
tail -20 /tmp/nightshift-smoke.log
exit 1
