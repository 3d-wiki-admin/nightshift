# CLAUDE.md — nightshift (meta)

This file is for Claude Code working on **nightshift itself**, not on target projects built *by* nightshift.

## What this repo is

A multi-agent development plugin on top of Claude Code + Codex CLI. It ships:
- `core/` — platform-agnostic brain (event store, schemas, scripts, skills, templates)
- `claude/` — Claude Code plugin (agents, commands, hooks)
- `codex/` — Codex CLI **adapter** (skill prompts + automations manifest; codex-cli has no plugin surface comparable to Claude Code — see codex/README.md)
- `launchd/` — macOS agents for overnight safety

The authoritative design is in `NIGHTSHIFT_MASTER_SPEC.md`. Read it before touching code.

## Non-negotiables (mirror of `constitution.md`)

1. **Events.ndjson is canonical.** For target projects. Never edit events or state.json directly — only append via the dispatch layer.
2. **No feature not listed in spec. No feature listed in spec skipped.** Scope is frozen for v1.0.
3. **Reviewer model ≠ implementer model** at dispatch time.
4. **NO LYING OR CHEATING** clause is literal and must appear verbatim in every implementer and reviewer prompt.
5. **Hard gates before quality score.** Quality score is for ranking, never for acceptance.
6. **Files-based handoff between agents.** No pasting full diffs into orchestrator context.

## Running tests

```bash
pnpm install
pnpm test
```

Tests live in `core/event-store/test/` and `core/scripts/test/`. They use `node --test`.

## Layout

See `NIGHTSHIFT_MASTER_SPEC.md` §3.1 for monorepo topology.

## Conventions

- ESM only (`"type": "module"`). Node ≥ 22.
- No comments explaining WHAT code does. Comments only when WHY is non-obvious.
- Shell scripts: `#!/usr/bin/env bash`, `set -euo pipefail`.
- Event action names: `<domain>.<verb_past_tense>` (e.g. `task.accepted`, `gate.passed`).
- Event schema version bumps require migration in `replay-events.mjs`.
