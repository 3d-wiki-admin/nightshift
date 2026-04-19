# Changelog

All notable changes to nightshift are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-19

First public release. Frozen scope per `NIGHTSHIFT_MASTER_SPEC.md`.

### Added — Wave 0 (core skeleton)

- `core/event-store/` — append-only ndjson writer with ajv-validated append + deterministic projection (events → state.json).
- `core/schemas/` — JSON Schemas for event, state, contract, manifest; unit cost table.
- `core/scripts/` — replay-events, truth-score, checkpoint-manager, snapshot, preflight, run-with-secrets, dispatch (the only writer to events.ndjson), compliance-reporter, project-status.
- `core/secrets/` — SecretBackend interface, LocalFolderBackend (default), OnePasswordBackend (opt-in).
- `core/skills/` — 16 skill prompts covering the full pipeline.
- `core/templates/project-starter/` — Next.js 15 + Supabase + Vercel template with constitution, CI, contract templates.

### Added — Wave 1 (Claude plugin + heavy lane)

- `claude/.claude-plugin/plugin.json` — plugin manifest.
- `claude/agents/` — 9 subagents (orchestrator, spec-writer, plan-writer, analyzer, task-decomposer, task-spec-reviewer, task-impl-reviewer, doc-syncer, blocker-resolver).
- `claude/commands/` — 11 slash commands: /bootstrap, /nightshift start, /plan, /analyze, /tasks, /implement, /sync, /status, /halt, /resume, /rollback.
- `claude/hooks/` — write-guard (blocks writes outside allowed_files; blocks direct writes to events.ndjson/state.json), bash-budget (blocks ops outside project root), resume-check (SessionStart), checkpoint (Stop), post-edit-sync (debounced doc-syncer trigger), pre-task-preflight (validates active contract before Task dispatch).

### Added — Wave 2 (Codex + micro lane + worktrees)

- `core/scripts/router.mjs` — Path C implementer routing per §6.1.
- `core/scripts/worktree-manager.sh` — create/release/list/prune git worktrees for `[P]` parallel tasks.
- `codex/` — Codex adapter with implementer + context-packer skill prompts and automations manifest.
- `/micro-task` command with auto-promotion to heavy lane (files > 5, diff > 200 LOC, new deps, architecture shift).

### Added — Wave 3 (overnight safety)

- `launchd/ai.nightshift.pinger.plist` (30 min) + `launchd/ai.nightshift.digest.plist` (08:00) with `scripts/install-launchd.sh`.
- `core/scripts/health-ping.mjs` — detects stale in-progress waves, spawns `claude -p /resume`, moves to paused.md after 3 consecutive failures.
- `core/scripts/morning-digest.mjs` — 12h event window → accepted/rejected/paused tasks, preview URLs, open questions, token ledger. Writes `~/.nightshift/digest/<date>.md`. Optional `say` on macOS.
- `core/scripts/wave-reviewer.mjs` — detached background `codex exec --json --model gpt-5.4` for 60-min adversarial wave review; separate `poll` subcommand.
- Commands: `/decide`, `/review-wave`, `/preflight`, `/questions`, `/compliance`.

### Added — Wave 4 (infra + secrets)

- `core/provisioners/` — Vercel, Supabase, Railway, Upstash Redis adapters with shared BaseProvisioner (preflight, docsUrl, create, rotate, deleteRequested). DRY-RUN by default; `--execute` opt-in.
- `core/scripts/provision.mjs` — CLI entry.
- `core/scripts/infra-audit.mjs` — filter events.ndjson → infra-audit.ndjson subset view.
- `/provision` command and `infra-provisioner` subagent enforcing the approval gate (task must be `approval-required` with matching `decision.recorded` before `--execute`).

### Added — Wave 5 (polish)

- `docs/ARCHITECTURE.md`, `docs/AGENTS.md`, `docs/SECRETS.md`, `docs/CONTRIBUTING.md`, `docs/WALKTHROUGH.md`.
- `CHANGELOG.md` (this file).
- `examples/demo-project/` — checked-in fixture illustrating an accepted wave 1.
- CI via `.github/workflows/ci.yml`.

### Tests

- 41 unit tests across: event store append + validation + read; projection rules for every event action; truth-score formula; LocalFolderBackend roundtrip + rejection of bad keys; router branches (each routing rule); provisioner registry + dry-run event emission.

### Known degraded modes (documented)

- **Codex unavailable** → implementer falls back to Claude Sonnet 4.6, logged in `task.routed.reason`.
- **launchd not installed** → pinger/digest disabled, `/preflight` emits WARN.
- **1Password missing** → LocalFolderBackend is used automatically.
- **Network down** → orchestrator halts, writes `session.halted`, state preserved for replay.
