#!/usr/bin/env bash
# Integration test for run-with-secrets.sh. Verifies that a secret whose
# value contains shell syntax like $(...) or `` does NOT execute at
# resolution time.
set -uo pipefail

TOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$TOP/core/scripts/run-with-secrets.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp" "$HOME/.nightshift/secrets/ns-sec-test"' EXIT

# Write malicious secret value (contains command substitution syntax).
mkdir -p "$HOME/.nightshift/secrets/ns-sec-test"
marker="$tmp/INJECTED_$$"
# Use single quotes to ensure the literal $(...) is stored, not expanded.
printf 'DB_PASSWORD=%s\n' '$(touch '"$marker"')' > "$HOME/.nightshift/secrets/ns-sec-test/.env"

cat >"$tmp/.env.template" <<'EOF'
DB_PASSWORD={{SECRET:DB_PASSWORD}}
EOF

cd "$tmp"
NIGHTSHIFT_PROJECT=ns-sec-test bash "$SCRIPT" /usr/bin/env > "$tmp/env-out.txt" 2>&1
got_env=$?

if [ "$got_env" -ne 0 ]; then
  echo "FAIL: script exited $got_env"
  cat "$tmp/env-out.txt"
  exit 1
fi

if [ -e "$marker" ]; then
  echo "FAIL: shell injection — marker file was created: $marker"
  exit 1
fi

if ! grep -q '^DB_PASSWORD=' "$tmp/env-out.txt"; then
  echo "FAIL: DB_PASSWORD not exported"
  cat "$tmp/env-out.txt"
  exit 1
fi

if ! grep -qF 'DB_PASSWORD=$(touch '"$marker"')' "$tmp/env-out.txt"; then
  echo "FAIL: DB_PASSWORD did not retain literal value (expected value to contain the literal $(...)):"
  grep '^DB_PASSWORD=' "$tmp/env-out.txt"
  exit 1
fi

echo "PASS: run-with-secrets.sh treats secret value as literal; no injection."
