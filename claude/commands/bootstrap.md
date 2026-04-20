---
description: INTERNAL recovery command — scaffold the current directory as a nightshift target project. For a fresh project, prefer `nightshift init <path>` (idea-first flow). This stays as a manual recovery path.
argument-hint: "[--stack=nextjs-supabase-vercel|blank]"
---

Scaffold this directory as a nightshift target project.

**Note:** this is an INTERNAL recovery command — the supported entry point for a new project is `nightshift init <path>` (idea-first: discuss → approve → scaffold). Use `/bootstrap` only to repair a project whose files were accidentally deleted.

Follow the `project-bootstrap` skill. The running Claude plugin cannot reach repo-relative paths, so delegate file creation to the `nightshift` CLI, which has the templates bundled.

Steps:
1. Confirm the CLI is reachable: `nightshift --version`. If it is not on PATH, ask the user where nightshift is installed and retry with an absolute path.
2. Invoke `nightshift scaffold <this-dir>` — the CLI creates `memory/`, `tasks/{contracts,waves,history}`, `scripts/`, `.github/workflows/`, copies `.env.template`, CI workflow, CLAUDE.md, constitution + spec/plan/data-model/research stubs, contract templates, and seeds memory surfaces. It also runs `git init -b main` and an initial commit if no repo exists.
3. If the scaffold reports files already present, do not overwrite — report them as "skipped".
4. Write initial events via `nightshift dispatch append`:
   - `session.start` with `payload.project = <dir-name>`.
   - `wave.planned` for wave 0.
   - `decision.recorded` for the chosen stack preset.

Report the result in a short table: what was created, what was skipped (already present). Don't pretend to create what you actually skipped.

User args: $ARGUMENTS
