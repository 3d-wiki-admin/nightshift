#!/usr/bin/env bash
# nightshift — top-level CLI for the nightshift harness.
#
# This file is installed (via `scripts/install.sh --link-bin`) as
# `nightshift` on the user's PATH. It dispatches to subcommands that wrap
# the scripts under core/scripts/ — so Claude Code agent prompts can
# reference `nightshift <sub>` instead of repo-relative paths that break
# once the plugin is copied to cache (see P0.3).
#
# Subcommands (Wave A scope):
#   nightshift doctor                      — preflight environment check
#   nightshift --version | -V              — print version
#   nightshift --help | -h                 — this help
#
# Runtime passthroughs (for scripts + agents):
#   nightshift dispatch <args>             — core/scripts/dispatch.mjs
#   nightshift replay <args>               — core/scripts/replay-events.mjs
#   nightshift compliance [project]        — core/scripts/compliance-reporter.mjs
#   nightshift status [project]            — core/scripts/project-status.mjs
#   nightshift provision <args>            — core/scripts/provision.mjs
#   nightshift truth-score <args>          — core/scripts/truth-score.mjs
#   nightshift router <contract.json>      — core/scripts/router.mjs
#   nightshift checkpoint <cmd> ...        — core/scripts/checkpoint-manager.sh
#   nightshift preflight [project]         — core/scripts/preflight.sh
#   nightshift health-ping [project]       — core/scripts/health-ping.mjs
#   nightshift digest [project]            — core/scripts/morning-digest.mjs
#   nightshift wave-reviewer <cmd> ...     — core/scripts/wave-reviewer.mjs
#   nightshift wave-review-consumer <args> — core/scripts/wave-review-consumer.mjs
#   nightshift post-sync-docs [project]    — core/scripts/post-sync-docs.mjs
#   nightshift infra-audit [project]       — core/scripts/infra-audit.mjs
#   nightshift worktree <cmd> ...          — core/scripts/worktree-manager.sh
#   nightshift run-with-secrets <cmd> ...  — core/scripts/run-with-secrets.sh
#   nightshift snapshot <dir>              — core/scripts/snapshot.sh
#   nightshift launchd install|uninstall|status  — manage macOS launchd agents
#
# v1.1 user-facing subcommands (idea-first flow):
#   nightshift init <path> [--claude-now]   — register + scaffold meta
#   nightshift new  <path> [--claude-now]   — alias for init
#   nightshift doctor                       — preflight environment check
set -euo pipefail

# ---------- resolve repo root even when invoked via a symlink ----------
self="${BASH_SOURCE[0]}"
# Chase symlinks portably (macOS lacks GNU readlink -f).
while [ -L "$self" ]; do
  link_target="$(readlink "$self")"
  case "$link_target" in
    /*) self="$link_target" ;;
    *)  self="$(cd "$(dirname "$self")" && cd "$(dirname "$link_target")" && pwd)/$(basename "$link_target")" ;;
  esac
done
root="$(cd "$(dirname "$self")/.." && pwd)"

VERSION="$(node -e "console.log(require('$root/package.json').version)" 2>/dev/null || echo 'unknown')"

# ---------- helpers ----------
print_help() {
  # Print the top banner comment block verbatim (stripping the leading `# `).
  # The range stops at the first `set -euo pipefail` line so help stays in
  # sync when the header grows — previous fixed 1..40 window leaked shell
  # directives once new subcommands were appended.
  awk '
    /^set -euo pipefail/ { exit }
    NR == 1 { next }
    { sub(/^# ?/, ""); print }
  ' "${BASH_SOURCE[0]}"
}

die() { echo "nightshift: $*" >&2; exit 2; }

# ---------- doctor ----------
cmd_doctor() {
  local ok=0 warn=0 fail=0
  pass() { printf "  \e[32m✓\e[0m %s\n" "$1"; ok=$((ok+1)); }
  warn() { printf "  \e[33m!\e[0m %s\n" "$1"; warn=$((warn+1)); }
  fail() { printf "  \e[31m✗\e[0m %s\n" "$1"; fail=$((fail+1)); }

  echo "nightshift doctor (v$VERSION)"
  echo "repo: $root"
  echo

  # Required tooling
  command -v node       >/dev/null 2>&1 && pass "node: $(node --version)"       || fail "node missing (need v22+)"
  command -v git        >/dev/null 2>&1 && pass "git: $(git --version | head -1)" || fail "git missing"
  command -v claude     >/dev/null 2>&1 && pass "claude CLI present"             || warn "claude CLI not on PATH — Claude plugin wiring untested"
  command -v codex      >/dev/null 2>&1 && pass "codex CLI: $(codex --version 2>/dev/null | head -1)" || warn "codex CLI missing — implementer will fall back to Claude Sonnet"

  # Package manager
  if   command -v pnpm >/dev/null 2>&1; then pass "pnpm: $(pnpm --version)"
  elif command -v npm  >/dev/null 2>&1; then warn "pnpm missing, npm present — pnpm is preferred"
  else                                         fail "neither pnpm nor npm available"
  fi

  # Claude plugin runtime
  if [ -d "$root/claude/bin/runtime" ] && [ -f "$root/claude/bin/runtime/MANIFEST.json" ]; then
    local count
    count="$(node -e "console.log(require('$root/claude/bin/runtime/MANIFEST.json').files.length)" 2>/dev/null || echo '?')"
    pass "claude plugin runtime packaged ($count files)"
  else
    warn "claude plugin runtime not packaged — run: nightshift prepare-plugin"
  fi

  # launchd agents (informational, macOS only)
  if [ "$(uname)" = "Darwin" ]; then
    if launchctl list 2>/dev/null | grep -q ai.nightshift; then
      pass "launchd: ai.nightshift.* loaded"
    else
      warn "launchd agents not loaded — optional, needed only for overnight runs"
    fi
  fi

  # Node deps
  if [ -d "$root/node_modules" ]; then pass "node_modules present"
  else                                  warn "node_modules missing — run: pnpm install"
  fi

  # Git cleanliness (advisory)
  if git -C "$root" diff --quiet 2>/dev/null && git -C "$root" diff --cached --quiet 2>/dev/null; then
    pass "git tree clean"
  else
    warn "nightshift repo has uncommitted changes"
  fi

  echo
  printf "doctor: \e[32m%d ok\e[0m  \e[33m%d warn\e[0m  \e[31m%d fail\e[0m\n" "$ok" "$warn" "$fail"
  [ "$fail" -gt 0 ] && exit 1
  [ "$warn" -gt 0 ] && exit 2
  exit 0
}

# ---------- subcommand dispatch ----------
sub="${1:-}"
shift || true

case "$sub" in
  ''|-h|--help|help)          print_help; exit 0 ;;
  -V|--version|version)        echo "nightshift $VERSION"; exit 0 ;;

  doctor)                      cmd_doctor "$@" ;;
  prepare-plugin)              exec bash "$root/scripts/prepare-claude-plugin-runtime.sh" "$@" ;;

  # Wave B — intake / scaffold / intake-record are defined just above.

  # Runtime passthroughs (Node scripts)
  dispatch)                    exec node "$root/core/scripts/dispatch.mjs" "$@" ;;
  replay)                      exec node "$root/core/scripts/replay-events.mjs" "$@" ;;
  compliance)                  exec node "$root/core/scripts/compliance-reporter.mjs" "$@" ;;
  status)                      exec node "$root/core/scripts/project-status.mjs" "$@" ;;
  provision)                   exec node "$root/core/scripts/provision.mjs" "$@" ;;
  truth-score)                 exec node "$root/core/scripts/truth-score.mjs" "$@" ;;
  router)                      exec node "$root/core/scripts/router.mjs" "$@" ;;
  health-ping)                 exec node "$root/core/scripts/health-ping.mjs" "$@" ;;
  digest|morning-digest)       exec node "$root/core/scripts/morning-digest.mjs" "$@" ;;
  wave-reviewer)               exec node "$root/core/scripts/wave-reviewer.mjs" "$@" ;;
  wave-review-consumer)        exec node "$root/core/scripts/wave-review-consumer.mjs" "$@" ;;
  post-sync-docs)              exec node "$root/core/scripts/post-sync-docs.mjs" "$@" ;;
  infra-audit)                 exec node "$root/core/scripts/infra-audit.mjs" "$@" ;;

  # Runtime passthroughs (shell scripts)
  checkpoint)                  exec bash "$root/core/scripts/checkpoint-manager.sh" "$@" ;;
  preflight)                   exec bash "$root/core/scripts/preflight.sh" "$@" ;;
  worktree)                    exec bash "$root/core/scripts/worktree-manager.sh" "$@" ;;
  run-with-secrets)            exec bash "$root/core/scripts/run-with-secrets.sh" "$@" ;;
  snapshot)                    exec bash "$root/core/scripts/snapshot.sh" "$@" ;;

  # Wave B: idea-first project intake
  init|new)
    project_path="${1:-}"
    shift || true
    if [ -z "$project_path" ]; then
      die "usage: nightshift init <project-path> [--force]"
    fi
    # Delegate to nightshift-init.mjs (writes minimal meta + registers project).
    # Preserve --force and friends as passthrough args.
    node "$root/core/scripts/nightshift-init.mjs" "$project_path" "$@" || {
      rc=$?
      exit $rc
    }
    # Remind the user of the single next command. Launching claude
    # automatically from this script is an intentional non-goal: the user
    # may want to `cd` and inspect the meta before starting the interview.
    ;;

  intake-record)
    # Used by the intake-interview Claude subagent to append structured
    # records to <project>/.nightshift/intake.ndjson without reconstructing
    # the schema each turn.
    exec node "$root/core/scripts/intake-record.mjs" "$@"
    ;;

  memory-record)
    # Wave C — append to retrieval memory (decisions/incidents/services/
    # reuse-index). Agents call this instead of writing the files directly.
    exec node "$root/core/scripts/memory-record.mjs" "$@"
    ;;

  memory-retrieve)
    # Wave C — dump relevant memory slices for context-pack inclusion.
    exec node "$root/core/scripts/memory-retrieve.mjs" "$@"
    ;;

  scaffold)
    # Internal: called by /nightshift confirm-scaffold after the intake
    # interview is approved. Expands the minimal meta into a full project.
    project_path="${1:-}"
    shift || true
    if [ -z "$project_path" ]; then
      die "usage: nightshift scaffold <project-path>"
    fi
    node "$root/core/scripts/nightshift-scaffold.mjs" "$project_path" "$@"
    ;;

  launchd)
    # TZ fix-batch P0.6: unified CLI wrapper for launchd install/uninstall/
    # status. The prompt layer and docs now reference `nightshift launchd`
    # exclusively; raw `scripts/install-launchd.sh` is kept as the bundled
    # implementation (with the `--project` guard intact).
    op="${1:-}"
    shift || true
    case "$op" in
      install)
        proj=""
        passthru=()
        while [ $# -gt 0 ]; do
          case "$1" in
            --project) shift; proj="${1:-}"; shift ;;
            *) passthru+=("$1"); shift ;;
          esac
        done
        if [ -z "$proj" ]; then
          die "usage: nightshift launchd install --project <path> [--allow-self-target]"
        fi
        # bash 3.2 (default on macOS) + set -u barfs on an empty array
        # expansion `"${passthru[@]}"` — the `+` form expands to nothing
        # when passthru is empty, preserving all args otherwise.
        exec bash "$root/scripts/install-launchd.sh" --project "$proj" ${passthru[@]+"${passthru[@]}"}
        ;;
      uninstall)
        exec bash "$root/scripts/install-launchd.sh" --uninstall "$@"
        ;;
      status)
        if [ "$(uname)" != "Darwin" ]; then
          echo "launchd is macOS-only; nothing to report." >&2
          exit 0
        fi
        loaded="$(launchctl list 2>/dev/null | awk '/ai\.nightshift/ { print "  loaded: " $3 " (pid=" $1 ")" }')"
        if [ -n "$loaded" ]; then
          echo "nightshift launchd agents:"
          echo "$loaded"
          exit 0
        else
          echo "nightshift launchd agents: not loaded." >&2
          exit 1
        fi
        ;;
      ''|-h|--help|help)
        cat >&2 <<'USAGE'
Usage:
  nightshift launchd install --project <path> [--allow-self-target]
  nightshift launchd uninstall
  nightshift launchd status
USAGE
        [ -z "${op:-}" ] && exit 2 || exit 0
        ;;
      *) die "unknown launchd op '$op' (expected install|uninstall|status)" ;;
    esac
    ;;

  *) die "unknown subcommand '$sub'. Try: nightshift --help" ;;
esac
