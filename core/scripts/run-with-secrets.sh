#!/usr/bin/env bash
# run-with-secrets.sh — resolve {{SECRET:KEY}} placeholders from the active secret backend
# and exec the provided command with resolved env vars.
#
# Usage:
#   run-with-secrets.sh <command> [args...]
#
# Reads .env.template in cwd, substitutes placeholders via the backend, then execs.
set -euo pipefail

project="${NIGHTSHIFT_PROJECT:-$(basename "$PWD")}"
backend="${NIGHTSHIFT_SECRET_BACKEND:-local}"
template="${NIGHTSHIFT_ENV_TEMPLATE:-.env.template}"

if [ ! -f "$template" ]; then
  exec "$@"
fi

resolve() {
  local key="$1"
  case "$backend" in
    local)
      local file="${HOME}/.nightshift/secrets/${project}/.env"
      [ -f "$file" ] || return 1
      grep "^${key}=" "$file" | head -1 | cut -d= -f2- || return 1
      ;;
    1password)
      op read "op://nightshift/${project}/${key}" 2>/dev/null || return 1
      ;;
    *)
      echo "run-with-secrets: unknown backend '$backend'" >&2
      return 2
      ;;
  esac
}

tmp_env="$(mktemp)"
trap 'rm -f "$tmp_env"' EXIT

while IFS= read -r line; do
  if [[ "$line" =~ ^[[:space:]]*#.*$ || -z "$line" ]]; then
    echo "$line" >>"$tmp_env"
    continue
  fi
  key="${line%%=*}"
  val="${line#*=}"
  if [[ "$val" == \{\{*\}\} ]]; then
    inner="${val:2:${#val}-4}"
    secret_key="${inner#SECRET:}"
    secret_key="${secret_key#LOCAL:}"
    resolved="$(resolve "$secret_key" || true)"
    if [ -z "$resolved" ]; then
      echo "run-with-secrets: unresolved secret '$secret_key' for project '$project'" >&2
      exit 3
    fi
    echo "${key}=${resolved}" >>"$tmp_env"
  else
    echo "${line}" >>"$tmp_env"
  fi
done < "$template"

set -a
# shellcheck disable=SC1090
. "$tmp_env"
set +a

exec "$@"
