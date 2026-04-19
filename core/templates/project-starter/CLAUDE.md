# CLAUDE.md — <project>

Scaffolded by the nightshift `project-bootstrap` skill. Edit freely; just don't remove load-bearing sections.

## Read first
- `memory/constitution.md` — non-negotiable rules. **Read before every action.**
- `tasks/spec.md` — what we're building.
- `tasks/plan.md` — how we're building it.

## Source of truth
- `tasks/events.ndjson` is the **only** canonical store. `tasks/state.json` and `tasks/compliance.md` are derived.
- Never append to `events.ndjson` directly — go through the dispatch layer (`core/scripts/dispatch.mjs` in nightshift).

## Commands
- Dev: `pnpm dev`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Build: `pnpm build`
- Smoke: `pnpm smoke`

## Workflow for agents
- Every task has a contract at `tasks/waves/<N>/<TASK-ID>/contract.md`.
- Writes outside `contract.allowed_files` are rejected by the `write-guard` hook.
- Before marking a task accepted: run hard gates, collect evidence in `evidence/`, produce `review.md` with per-dimension evidence paths.
- **Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING.**
