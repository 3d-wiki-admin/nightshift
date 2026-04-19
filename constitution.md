# Constitution — nightshift (meta)

This is nightshift's own constitution. Agents working on nightshift itself must read this. The constitution for **target projects** lives in each target project's `memory/constitution.md`.

## 1. Stack

- Runtime: Node 22 ESM only.
- Shell: bash (macOS + Linux).
- Package manager: pnpm 10+.
- No TypeScript in `core/` (plain JS/ESM for portability). TS only in target project **templates**.
- JSON Schema for contracts (ajv validation).

## 2. Forbidden

- Secrets in the repo (including `.env.local`, `.env.*`). Use `.env.template` only.
- Files larger than 500 lines of code.
- Any code path that writes to `events.ndjson` outside the dispatch layer (`core/scripts/dispatch.mjs`).
- Any code that mutates `state.json` directly. State is only rebuilt from the log.
- Editing existing events in `events.ndjson`. Log is append-only.
- Shell operations outside project root (enforced by `bash-budget.sh` hook).
- Reviewer model equal to implementer model on the same task.
- Automatic production deploys. All deploys are `approval-required` by spec.
- Omitting the literal sentence "Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING." from any implementer or reviewer prompt.

## 3. Required

- Every event written to `events.ndjson` MUST validate against `core/schemas/event.schema.json`.
- Every task contract MUST validate against `core/schemas/contract.schema.json`.
- Every skill MD file MUST have the Claude Code frontmatter block (`name`, `description`).
- Every shell script MUST start with `#!/usr/bin/env bash` and `set -euo pipefail`.
- Every Node script MUST be ESM and work with `node --test` (no external test runner).
- Every agent prompt MUST cite `memory/constitution.md` as required reading.
- Every new skill MUST be added to `core/skills/INDEX.md` index.

## 4. Constraints

- No runtime dependencies in `core/event-store/` beyond Node stdlib. (Dev deps like `ajv` are OK.)
- No TypeScript in `core/` source. (TS only in target project templates under `core/templates/`.)
- `core/scripts/*.sh` must be runnable with `/bin/bash` (no zsh-isms).
- LaunchD plists target macOS only; Linux users use the degraded mode (manual triggers).
- Every change to schema format MUST bump the `version` field in `state.json` projection and add a migration branch in `replay-events.mjs`.

## 5. Degraded modes (must always work)

- No Codex CLI → implementer role falls back to Claude Sonnet.
- No launchd → pinger/digest disabled; `/status` manual only.
- No 1Password CLI → LocalFolderBackend.
- Network down → orchestrator halts, `session.halted` event appended, state preserved.
