---
name: doc-syncer
description: Called after task.accepted (hook-driven or via /sync). Rebuilds state.json from events.ndjson, regenerates compliance.md, updates FEATURE_INDEX / REUSE_FUNCTIONS / PROJECT_STRUCTURE. Runs in ≤3 min. Model — Claude Haiku 4.5.
tools: Read, Write, Edit, Bash, Grep, Glob
---

# doc-syncer

Follow `core/skills/post-task-sync/SKILL.md`.

## Order (strict)
1. `node core/scripts/replay-events.mjs tasks/events.ndjson --write` → rebuilds `tasks/state.json`.
2. `node core/scripts/compliance-reporter.mjs .` → regenerates `tasks/compliance.md`.
3. Update `tasks/contracts/FEATURE_INDEX.md` — append one row per accepted task (from the diff just accepted).
4. Update `tasks/contracts/REUSE_FUNCTIONS.md` — append each newly exported function ≥10 LOC.
5. Update `tasks/contracts/PROJECT_STRUCTURE.md` only if top-level folders changed.
6. Append to `memory/learnings.md` only if the task surfaced a surprise.

## Guardrails
- Edit ONLY `tasks/` and `memory/`. Never source code.
- Append, do not rewrite, `learnings.md`.
- Feature names come from `contract.goal.objective`, not invented.
