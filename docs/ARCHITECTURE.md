# Architecture

## The short version

nightshift is a **discipline harness** on top of Claude Code + Codex CLI. It enforces four rules:

1. **Contracts before code** — every unit of work has a machine-checkable contract (allowed_files, gates, risk class).
2. **Event log before mutable state** — `tasks/events.ndjson` is the only canonical store; `state.json` is a deterministic projection.
3. **Hard gates before acceptance** — tests/types/lint/build (etc.) must pass. Quality score only ranks.
4. **Evidence before trust** — every accepted task has an `evidence/` folder reviewed by a different model.

## Monorepo topology

```
nightshift/
├── core/              # platform-agnostic brain
│   ├── event-store/   # append-only ndjson writer + projection + validator (ajv)
│   ├── scripts/       # replay, truth-score, checkpoint, dispatch, router, worktree, health-ping, morning-digest, wave-reviewer, provision
│   ├── schemas/       # JSON Schemas for event/state/contract/manifest + costs.json
│   ├── secrets/       # SecretBackend interface + LocalFolder + OnePassword adapters
│   ├── provisioners/  # vercel / supabase / railway / redis adapters
│   ├── skills/        # 16 SKILL.md files (the authoritative behavioral prompts)
│   └── templates/     # Next.js 15 + Supabase + Vercel project-starter
├── claude/            # Claude Code plugin (thin frontend)
│   ├── .claude-plugin/plugin.json
│   ├── agents/        # 10 subagents
│   ├── commands/      # 16 slash commands
│   ├── hooks/         # 6 hook scripts + settings.json wiring
│   └── settings.json
├── codex/             # Codex CLI adapter (not a true plugin — codex-cli 0.121 has no plugin system)
│   ├── skills/        # implementer + context-packer prompts
│   └── automations/   # nightshift.json manifest (load-bearing only if codex-cli auto-discovers it; dispatch works without)
├── launchd/           # macOS overnight safety (pinger + digest plists)
└── scripts/           # install.sh + install-launchd.sh
```

## Data flow (one task)

```
orchestrator (Claude Opus 4.7)
  └─► writes contract.md under tasks/waves/<N>/<TASK-ID>/
  └─► appends task.contracted event
  └─► delegates to context-packer (GPT-5.4-mini)
        └─► writes context-pack.md (≤500 lines) — appends task.context_packed
  └─► routes via core/scripts/router.mjs → {model, effort, reason}
  └─► appends task.routed
  └─► calls core/scripts/dispatch.mjs codex <task.json>
        └─► spawns `codex exec --json --model <m> --reasoning-effort <e>` with the implementer prompt
        └─► captures tokens from `response.usage` in codex --json output
        └─► appends task.implemented (or task.blocked on failure)
  └─► delegates to task-impl-reviewer (Claude Opus; different model from implementer)
        └─► runs hard gates (typecheck, lint, test, build, smoke as applicable)
        └─► writes review.md with per-dimension evidence paths
        └─► appends gate.passed/gate.failed per gate, then task.reviewed
  └─► on accept: tag checkpoint, append task.accepted, trigger doc-syncer (Haiku 4.5)
  └─► on reject/revise: re-dispatch with delta, cap 3 retries
```

## Why an event log as source of truth

- **Audit.** Every decision is reproducible from the log.
- **Recovery.** Kill an agent mid-run, and `replay-events` rebuilds state exactly.
- **Determinism.** State and compliance are functions of the log; they cannot drift.
- **No lying surface.** An agent cannot retroactively "correct" its history by editing state.json — the log overrides.

Appends go through `core/scripts/dispatch.mjs append` only. The `write-guard` hook blocks any direct write to `events.ndjson`/`state.json` and emits `guard.violation`.

## Context economy

Each agent invocation gets the minimum it needs:

- The **context-packer** (cheap model) extracts a ≤500-line slice of spec/plan/data-model relevant to the task.
- The **implementer** reads the pack + allowed_files only — never the whole project.
- The **reviewer** sees contract + diff + evidence — never the whole project.
- The **orchestrator** monitors its own context zone: Green 0-75% (normal), Yellow 75-85% (summary-only), Red 85%+ (delegate everything; never reason in main).
- **File-based handoff**: subagents return a pointer (`result.md` path) + a 3-line summary. No inlining of full diffs.

## Degraded modes

| Missing | Behavior |
|---|---|
| Codex CLI | Implementer falls back to Claude Sonnet 4.6. Logged in `task.routed.reason`. |
| launchd | Pinger/digest disabled. `/preflight` emits a WARN. |
| 1Password CLI | `LocalFolderBackend` at `~/.nightshift/secrets/<project>/.env`. |
| Network | Orchestrator halts, writes `session.halted`, state preserved for replay. |

## Schema versioning

- Every event validates against `core/schemas/event.schema.json`.
- Every state.json carries `version`. Migrations in `core/scripts/replay-events.mjs` must add branches when schema bumps.
- Past events are **never edited**. Migration means the replay function handles old shapes, not that the log mutates.

## Command surface (v1.0)

See §8 of [NIGHTSHIFT_MASTER_SPEC.md](../NIGHTSHIFT_MASTER_SPEC.md) for the full list. In short:

- **Lifecycle**: `/bootstrap`, `/nightshift start`, `/plan`, `/analyze`, `/tasks`, `/implement`, `/review-wave`, `/sync`, `/deploy`.
- **Micro lane**: `/micro-task "<desc>"`.
- **Observability**: `/status`, `/compliance`, `/questions`.
- **Control**: `/decide`, `/halt`, `/resume`, `/rollback`, `/preflight`.
- **Infra**: `/provision`, `/provision rotate <service>`.
