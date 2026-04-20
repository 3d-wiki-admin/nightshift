# Changelog

All notable changes to nightshift are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-04-20

Hardening + idea-first UX + retrieval memory + adapter honesty. Scope
frozen per `nightshift_v1_1_dev_brief.md`. 223+ tests passing; each wave
gated by an independent gpt-5.4 review.

### Added — Wave A (install + wiring hardening, P0 fixes)

- `scripts/nightshift.sh` top-level CLI installed as `nightshift` on
  PATH (user-local bin default, `--system-bin` opts into sudo).
  Subcommands: `doctor`, `dispatch`, `replay`, `compliance`, `status`,
  `provision`, `router`, `truth-score`, `checkpoint`, `preflight`,
  `health-ping`, `digest`, `wave-reviewer`, `wave-review-consumer`,
  `post-sync-docs`, `infra-audit`, `worktree`, `run-with-secrets`,
  `snapshot`.
- `scripts/prepare-claude-plugin-runtime.sh` — builds
  `claude/bin/runtime/` (self-contained) with `MANIFEST.json`
  (schema_version + sha256 per file + ajv deps). The Claude plugin
  keeps working after Claude copies it to its cache dir.
- `claude/hooks/lib/common.sh` resolves runtime via
  `NIGHTSHIFT_RUNTIME_DIR` derived from `PLUGIN_ROOT`; no more
  `$NIGHTSHIFT_HOME` references (enforced by grep-style regression).
- `core/codex/client.mjs` — hardened Codex subprocess wrapper with
  taxonomy (`ABSENT` / `AUTH_FAILED` / `RATE_LIMITED` / `INVALID_MODEL`
  / `TIMEOUT` / `SPAWN_FAILED` / `NONZERO`), streaming stdio, process-
  group timeout kill, token extraction, retry-with-backoff.
  `buildTaskEnv` plumbs `NIGHTSHIFT_TASK_CONTRACT` /
  `NIGHTSHIFT_CONTEXT_PACK` / `NIGHTSHIFT_CONSTITUTION` /
  `NIGHTSHIFT_PROJECT_DIR` before `codex exec` spawn.
- `scripts/install-launchd.sh` requires explicit `--project`, refuses
  nightshift repo itself unless `--allow-self-target`, refuses
  unmanaged dirs.
- `core/registry/index.mjs` — project registry at
  `~/.nightshift/registry/` (override via `NIGHTSHIFT_REGISTRY_ROOT`).
  Atomic writes, `.bak` on overwrite, schema_version guard, lockfile.
- `core/scripts/health-ping.mjs` — spawns `claude -p /resume` with
  `cwd: projectDir`; no fabricated `--project` flag.

### Added — Wave B (idea-first project intake)

- `nightshift init <path>` — creates ONLY minimal meta scaffold
  (`.nightshift/intake-pending` marker, empty intake log, empty event
  log, `NIGHTSHIFT.md` pointer). Does NOT create constitution, spec,
  template files, or CI. Registers project at stage=intake.
- `claude/commands/nightshift.md` dispatches `intake --project <path>`
  / `confirm-scaffold` / `start` (legacy).
- `claude/agents/intake-interview.md` — six-question interview,
  proposes stack/template/providers/initial risk class, asks for
  approval. Tool frontmatter EXCLUDES Write/Edit; ALL intake state
  flows through `nightshift intake-record`.
- `core/scripts/intake-record.mjs` — CLI helper: `q` / `proposal` /
  `approve-last` (atomic flip) / `revision` / `abort`.
- `nightshift scaffold <path>` — gates on approved proposal
  (NOT_INITIALIZED / NO_PROPOSAL / NOT_APPROVED), copies template
  (excluding files rendered from intake), renders
  `memory/constitution.md` and `tasks/spec.md` from intake answers,
  emits `decision.recorded` + `session.start`, flips registry stage
  intake→ready, renames intake-pending → intake-complete.
- `/bootstrap` demoted to internal recovery command; `nightshift init`
  is the public entry.

### Added — Wave C (retrieval memory as first-class input)

- Four memory surfaces per project:
  - `memory/decisions.ndjson` — append-only architecture/stack/policy
    decisions (id/ts/kind/subject/answer/supersedes).
  - `memory/incidents.ndjson` — append-only symptom/root_cause/fix/
    evidence.
  - `memory/services.json` — atomic live infra state (URLs, resource
    IDs, secret refs; NEVER secret values) with schema_version + `.bak`
    recovery AND hard schema_version guard that applies equally to the
    primary file and `.bak` recovery path.
  - `memory/reuse-index.json` — atomic reuse catalog with the same
    guarantees (file/symbol/purpose/tags/safe_to_extend/examples).
- `core/memory/*.mjs` isolated helpers per surface + `readAll()` for
  retrieval.
- `nightshift memory-record` / `nightshift memory-retrieve` CLI.
- `context-packer`, `plan-writer`, `wave-orchestrator` prompts hard-
  wired to retrieve via `nightshift memory-retrieve` and persist via
  `nightshift memory-record`. All three explicitly forbid raw writes
  to `memory/*.{ndjson,json}`. "Decisions in memory override plan" and
  "Reuse first" are code-level gates in the plan-writer prompt.
- `nightshift scaffold` seeds the memory surface on project creation,
  with supabaseServer + supabaseBrowser pre-seeded in the reuse index.
- `PROJECT_STRUCTURE.md` documents memory layout + CLI-only write rule.

### Added — Wave D (adapter honesty + docs)

- `codex/README.md` rewritten: codex/ is an adapter (not a plugin).
  codex-cli 0.121 has no first-class plugin system; the automations
  manifest is documentation-grade because dispatch invokes prompts
  directly via `--prompt`.
- `README.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md` use "Codex CLI
  adapter" in layout descriptions. `NIGHTSHIFT_MASTER_SPEC.md` is v1.0
  frozen; the honesty shift is documented here + `codex/README.md`.
- `package.json` bumped to `1.1.0`; description reframed around
  harness semantics (idea-first intake, contracts, retrieval memory,
  hard gates).

### Tests

223 tests (up from 105 at the start of v1.1) across:
- event-store, projection, schemas, truth-score (Wave 0 baseline)
- hooks + plugin self-containment + codex client + registry + codex
  fallback + health-ping resume flow (Wave A)
- init + intake-record + scaffold + prompt-contract (Wave B)
- memory helpers + memory CLI (all subcommands + retrieval flags) +
  retrieval integration prompt-contract + scaffold memory seeding +
  schema_version>1 rejection paths (Wave C)

### Live-test gaps (honest)

The following cannot be verified without the user's real Mac and
accounts: (a) `/plugin install` into Claude Code; (b) codex happy-path
live dispatch (the dispatch + env plumbing is unit-tested, but the
full `codex exec` run against the real API has not been exercised);
(c) overnight launchd cycle (plists + install-launchd are correct by
code review but have not been loaded).

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
