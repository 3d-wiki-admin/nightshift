---
description: Scaffold the current directory as a nightshift target project (memory/, tasks/, contracts, CI, .env.template, CLAUDE.md). Idempotent.
argument-hint: "[--stack=nextjs-supabase-vercel|blank]"
---

Scaffold this directory as a nightshift target project.

Follow `core/skills/project-bootstrap/SKILL.md` exactly. Do not overwrite `events.ndjson`, `state.json`, or an existing `memory/constitution.md`.

Steps:
1. Read `~/.nightshift/core/templates/project-starter/` (or the equivalent location — check `$NIGHTSHIFT_HOME`).
2. Create folders: `memory/`, `tasks/{contracts,waves,history}`, `scripts/`, `.github/workflows/`.
3. Copy `.env.template`, CI workflow, CLAUDE.md, constitution template, spec/plan/data-model/research stubs, contract templates.
4. If `memory/constitution.md` is missing, instantiate from template, filling `<project>` with the directory name.
5. Initialize empty `tasks/events.ndjson` if absent.
6. `git init -b main` if no `.git` exists.
7. Write initial events via `core/scripts/dispatch.mjs append`:
   - `session.start` with `payload.project = <dir-name>`.
   - `wave.planned` for wave 0.
   - `decision.recorded` for the chosen stack preset.

Report the result in a short table: what was created, what was skipped (already present). Don't pretend to create what you actually skipped.

User args: $ARGUMENTS
