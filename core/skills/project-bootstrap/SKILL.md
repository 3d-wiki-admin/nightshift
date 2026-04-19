---
name: project-bootstrap
description: Use when starting a new target project. Creates memory/, tasks/, scripts/, .github/workflows/ci.yml, .env.template, empty state/events files; runs git init if needed; scaffolds a minimal CLAUDE.md. Idempotent — safe to re-run.
---

# project-bootstrap

> Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING.

## Inputs
- Target directory (defaults to CWD).
- Stack preset: `nextjs-supabase-vercel` (default per spec §25 Q1) or `blank`.
- Project name (defaults to basename of directory).

## Steps

1. **Read the target project constitution.** If `memory/constitution.md` does not exist, create it from `core/templates/project-starter/memory/constitution.md`, filling in `<project>` and the stack line. Do NOT invent rules beyond the template.
2. **Create folders** (skip if they exist): `memory/`, `tasks/`, `tasks/contracts/`, `tasks/waves/`, `tasks/history/`, `scripts/`, `.github/workflows/`.
3. **Create empty canonical files** (do NOT overwrite if they exist):
   - `tasks/events.ndjson`
   - `tasks/state.json` — write `{"version":1,"built_from_event_id":null,"project":{"name":"<name>","constitution_version":1},"context_zone":"green","waves":{},"open_questions":[],"paused_tasks":[],"totals":{"tokens":0,"cost_usd_estimate":0,"events":0}}`.
   - `tasks/questions.md`, `tasks/decisions.md`, `tasks/paused.md` — empty.
4. **Copy contract templates** from `core/templates/project-starter/tasks/contracts/` into `tasks/contracts/` (TASK_TEMPLATE, REVIEW_DIMENSIONS, PROJECT_STRUCTURE, REUSE_FUNCTIONS, FEATURE_INDEX).
5. **Copy scripts** from `core/templates/project-starter/scripts/` (smoke.sh, replay shim).
6. **Drop `.env.template`** with placeholders (use `{{SECRET:KEY}}` syntax, never real values).
7. **Drop CI workflow** at `.github/workflows/ci.yml` from template.
8. **Drop CLAUDE.md** from template. It should reference the constitution and the event log.
9. **`git init` if no `.git` exists**, then set default branch to `main`.
10. **Emit events**: `session.start` (agent=orchestrator) then `wave.planned` (wave=0) then one `decision.recorded` for stack preset.

## Outputs
- Populated directory tree matching spec §10.1.
- Event log with 3 initial events (validated).

## Guardrails
- Never overwrite an existing `events.ndjson`, `state.json`, or `constitution.md`. These may already encode user decisions.
- Never write real secrets to `.env.template`.
- If the target directory is not empty and not a git repo, STOP and file a question — do not clobber unfamiliar state.
