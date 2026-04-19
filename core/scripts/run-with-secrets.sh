#!/usr/bin/env bash
# run-with-secrets.sh — resolve {{SECRET:KEY}} placeholders from the active
# secret backend and exec the provided command with resolved env vars.
#
# IMPORTANT: values are passed as literal `KEY=value` argv tokens to `env`,
# never sourced as shell. A secret value like $(rm -rf /) is therefore inert.
#
# Usage:
#   run-with-secrets.sh <command> [args...]
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
      local line
      line="$(grep "^${key}=" "$file" | head -1)" || return 1
      printf '%s' "${line#*=}"
      ;;
    1password|op)
      op read "op://nightshift/${project}/${key}" 2>/dev/null || return 1
      ;;
    *)
      echo "run-with-secrets: unknown backend '$backend'" >&2
      return 2
      ;;
  esac
}

env_args=()
while IFS= read -r line || [ -n "$line" ]; do
  # skip blank and comment lines
  if [[ -z "${line//[[:space:]]/}" || "${line#"${line%%[![:space:]]*}"}" == \#* ]]; then
    continue
  fi
  key="${line%%=*}"
  val="${line#*=}"
  if [[ "$val" == "{{"*"}}" ]]; then
    inner="${val:2:${#val}-4}"
    secret_key="${inner#SECRET:}"
    secret_key="${secret_key#LOCAL:}"
    resolved="$(resolve "$secret_key" || true)"
    if [ -z "$resolved" ]; then
      echo "run-with-secrets: unresolved secret '$secret_key' for project '$project'" >&2
      exit 3
    fi
    env_args+=("${key}=${resolved}")
  else
    env_args+=("${key}=${val}")
  fi
done < "$template"

# `env KEY=value [KEY2=value2 ...] -- cmd [args...]` sets the vars as literal
# strings and execs cmd. Shell substitution in values does NOT happen here —
# env treats each arg as an opaque KEY=VALUE assignment.
if [ "${#env_args[@]}" -gt 0 ]; then
  exec env "${env_args[@]}" "$@"
else
  exec "$@"
fi
