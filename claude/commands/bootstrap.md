---
description: INTERNAL recovery command — scaffold the current directory as a nightshift target project. For a fresh project, prefer `nightshift init <path>` (idea-first flow). This stays as a manual recovery path.
argument-hint: "[--stack=nextjs-supabase-vercel|blank]"
---

Scaffold this directory as a nightshift target project.

**Note:** this is an INTERNAL recovery command — the supported entry point for a new project is `nightshift init <path>` (idea-first: discuss → approve → scaffold). Use `/bootstrap` only to repair a project whose files were accidentally deleted.

Follow `core/skills/project-bootstrap/SKILL.md`. Template files live under the nightshift install at `core/templates/project-starter/` — the running Claude plugin cannot rely on repo-relative paths, so copy via `nightshift` subcommands where possible.

Steps:
1. The project-bootstrap skill copies the template tree. Claude MUST ask the user for the nightshift install path if it is not on PATH; otherwise `nightshift --version` confirms the CLI is reachable.
2. Create folders: `memory/`, `tasks/{contracts,waves,history}`, `scripts/`, `.github/workflows/`.
3. Copy `.env.template`, CI workflow, CLAUDE.md, constitution template, spec/plan/data-model/research stubs, contract templates.
4. If `memory/constitution.md` is missing, instantiate from template, filling `<project>` with the directory name.
5. Initialize empty `tasks/events.ndjson` if absent.
6. `git init -b main` if no `.git` exists.
7. Write initial events via `nightshift dispatch append`:
   - `session.start` with `payload.project = <dir-name>`.
   - `wave.planned` for wave 0.
   - `decision.recorded` for the chosen stack preset.

Report the result in a short table: what was created, what was skipped (already present). Don't pretend to create what you actually skipped.

User args: $ARGUMENTS
