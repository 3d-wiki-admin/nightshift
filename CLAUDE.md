# CLAUDE.md — nightshift

Auto-loaded by Claude Code whenever a session opens inside this repo. Two audiences: a **new user** (wants to USE nightshift to build something) and a **contributor** (wants to WORK ON nightshift itself). Read the user's first message; pick the right section; do not dump both on them.

---

## AUDIENCE A — new user, just cloned nightshift

If the user says anything like *"что делать?"*, *"как начать?"*, *"help"*, *"я только что поставил"*, *"как этим пользоваться?"*, treat them as a new user and **walk them through the steps below, one at a time**. Do not paste the whole thing at once. Ask a single question per step, wait for confirmation, then move on.

### Step 0 — environment check (silent, don't narrate)

Before the first instruction, run:
```bash
which nightshift && nightshift --version
which claude && claude --version
which codex && codex --version 2>/dev/null || echo "codex missing — fallback to Claude Sonnet implementer"
node --version
pnpm --version
```
Report a single-line verdict: *"prereqs OK"* / *"need to install X"*. If `nightshift` is missing, the user hasn't run `./scripts/install.sh --link-bin` yet — walk them through the install first. If `nightshift` exists but isn't on PATH, tell them to add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` and re-source.

### Step 1 — install the Claude plugin (if not already)

Check: `claude plugin list 2>/dev/null | grep -q nightshift && echo installed || echo missing`.

If missing, instruct (these are slash-commands for THEM to type inside Claude Code — not tool calls):

```
/plugin marketplace add <repo-root>
/plugin install nightshift@nightshift
```

Substitute `<repo-root>` with the actual path of this repo (`pwd` from cwd). When the UI prompts for scope, user picks **"Install for you (user scope)"** — so the plugin works in every Claude session, in any dir.

After install they run `/reload-plugins` and should see `1 plugin · 19 skills · 16 agents · 6 hooks · 0 errors`. If they see hook errors, tell them to re-clone — their copy is older than commit `b320649` (hooks.json wrapper fix).

Important: slash commands from the plugin land under the **`/nightshift:` namespace** — `/nightshift:plan`, `/nightshift:tasks`, `/nightshift:implement`, etc. Bare `/plan` will not work. The intake entry points are:
- `/nightshift:nightshift intake --project <abs-path>`
- `/nightshift:nightshift confirm-scaffold`

### Step 2 — first project

Ask the user where they want the project to live (absolute path). Recommend a sibling dir, NOT inside `~/.nightshift`. Then instruct:

```bash
nightshift init <path> --claude-now
```

`--claude-now` makes `nightshift init` exec `claude` straight into the intake session — one command, no copy-paste. Without it, init prints a single copy-paste command (`cd <path> && claude "/nightshift:nightshift intake --project <path>"`).

### Step 3 — intake interview

Inside the spawned Claude session, the `intake-interview` subagent asks 6 questions:

1. What are we building? (one sentence)
2. Who is the primary user? (concrete type, not vague persona)
3. Most important feature — the thing without which it's pointless? (one)
4. Explicitly out of scope? (≥2 items; force the user to name what they're NOT building)
5. Hard constraints? (stack, compliance, budget, integrations, auth, payments, background jobs, storage)
6. Success criteria at wake-up? (one observable outcome: live URL with feature X working)

If the user dodges a question or gives an ambiguous answer, intake-interview writes it to `tasks/questions.md` instead of inventing. Don't let them skip.

When the six are answered, the subagent proposes `{ template, stack, providers, initial_risk_class }` plus a summary of decisions. User says *"да" / "go" / "ok"* to approve, *"измени X"* to revise, or aborts.

### Step 4 — scaffold

After approval run:
```
/nightshift:nightshift confirm-scaffold
```

This invokes `nightshift scaffold <path>` under the hood — the CLI is the SINGLE writer of the intake-approval `decision.recorded` event. It creates:
- `memory/constitution.md` (Stack block rendered dynamically from the approved proposal)
- `memory/{decisions,incidents}.ndjson` + `memory/{services,reuse-index}.json` (seeded)
- `tasks/spec.md`, `plan.md` (placeholder), `research.md`, `data-model.md`, `contracts/*`
- `.env.template`, `CLAUDE.md`, `README.md`, `.gitignore`, CI workflow, `scripts/smoke.sh`
- Stack-specific runtime files if the stack includes Next.js (`app/`, `lib/`, `tsconfig.json`, `middleware.ts`, `next.config.mjs`)
- `package.json` shape: workspace-root for monorepo, Next-app for Next-only, absent for pure-Python
- `pnpm-workspace.yaml` only for monorepo layouts
- `git init -b main` + initial `chore: nightshift scaffold` commit

> **Live gotcha (v1.1.1).** The Stack block in `memory/constitution.md` is now built from the proposal, but a few other system files may still need a manual review if the intake picked an exotic stack. If the scaffolded tree looks off for the user's stated stack, tell them to say *"pass 2: проверь системные файлы против реального стека"* — the subagent knows how to reconcile.

### Step 5 — the pipeline

Only after the user confirms the scaffolded tree looks right:
```
/nightshift:plan         # plan-writer + research + data-model + API contracts
/nightshift:analyze      # read-only consistency check across spec ↔ plan ↔ contracts
/nightshift:tasks        # decompose next phase into a wave of task contracts
/nightshift:implement    # dispatch → code → review → accept for each task in the wave
/nightshift:review-wave  # cross-task adversarial GPT-5.4 review at wave end
/nightshift:status       # ASCII dashboard — what's accepted, what's blocked
```

Each of those is a **checkpoint** — let the user stop and inspect between them. Don't chain them autonomously unless asked.

### Behaviors to keep (rules for Claude helping the new user)

- **Never run `/nightshift:implement` on their behalf without explicit "go".** It spawns long, expensive subagents.
- **If you hit an error (plugin not found, command not recognized, scaffold refuses):** give one diagnostic command, wait for output, then advise. Don't guess.
- **If the user pasted a slash command that doesn't work**, common causes: leading whitespace (must be first char of line), wrong namespace (`/plan` instead of `/nightshift:plan`), plugin not reloaded (`/reload-plugins`), or installed copy is out-of-date (re-install via `/plugin uninstall nightshift; /plugin install nightshift@nightshift`).
- **Do NOT write files yourself in this repo** unless the user explicitly asked (`memory/*.{ndjson,json}` and `tasks/events.ndjson` go through the `nightshift` CLI, never `Write`/`Edit`). You're a guide here, not an implementer.

### Quick reference — CLI subcommands

| Shell command | Purpose |
|---|---|
| `nightshift doctor` | env preflight (node, claude, codex, pnpm, runtime packaged) |
| `nightshift init <path>` | register a new project (stage=intake) |
| `nightshift init <path> --claude-now` | same + exec `claude` in the new dir |
| `nightshift launchd install --project <path>` | install overnight pinger + digest for a project |
| `nightshift status <path>` | ASCII dashboard for a scaffolded project |
| `nightshift memory-retrieve <path> --markdown` | dump decisions/incidents/services/reuse-index |

Slash-command equivalents (all under `/nightshift:` namespace) are the normal way for the user to drive the pipeline — CLI subcommands are the escape hatch.

### Known live-run caveats

The suite is 252/252 green on Darwin, but three end-to-end flows can only be verified on the user's machine and may need a nudge:

1. `/plugin install` on Claude Code versions < 2.1 (requires marketplace; we tested on 2.1.114).
2. Codex `dispatch` with real auth on the user's account — error taxonomy handles the common failures, but transient issues happen.
3. Overnight launchd cycle — plists install, but the first real 8am digest is the proof. Tell the user to check `~/.nightshift/digest/<date>.md` the morning after.

---

## AUDIENCE B — contributor, working on nightshift itself

> If the user is modifying files under `core/`, `claude/`, `codex/`, `launchd/`, `scripts/` — they're a contributor. The rest of this file applies to them.

### What this repo is

A multi-agent development plugin on top of Claude Code + Codex CLI. It ships:
- `core/` — platform-agnostic brain (event store, schemas, scripts, skills, templates)
- `claude/` — Claude Code plugin (agents, commands, hooks). Shipped as a single-plugin marketplace via `.claude-plugin/marketplace.json` at repo root.
- `codex/` — Codex CLI **adapter** (skill prompts + automations manifest; codex-cli has no plugin surface comparable to Claude Code — see `codex/README.md`).
- `launchd/` — macOS agents for overnight safety.

The authoritative design is in `NIGHTSHIFT_MASTER_SPEC.md`. Read it before touching code. Open hotfix items live in `nightshift_v1_1_hotfix_tz.md`.

### Non-negotiables (mirror of `constitution.md`)

1. **Events.ndjson is canonical.** For target projects. Never edit events or state.json directly — only append via the dispatch layer.
2. **No feature not listed in spec. No feature listed in spec skipped.** Scope is frozen for v1.0; v1.1 scope is frozen per `nightshift_v1_1_dev_brief.md`.
3. **Reviewer model ≠ implementer model** at dispatch time.
4. **NO LYING OR CHEATING** clause is literal and must appear verbatim in every implementer and reviewer prompt.
5. **Hard gates before quality score.** Quality score is for ranking, never for acceptance.
6. **Files-based handoff between agents.** No pasting full diffs into orchestrator context.

### Running tests

```bash
pnpm install
pnpm test
```

Tests live under `core/**/test/`, `claude/hooks/test/`, and a few colocated spots. They use `node --test`.

### Conventions

- ESM only (`"type": "module"`). Node ≥ 22.
- No comments explaining WHAT code does. Comments only when WHY is non-obvious.
- Shell scripts: `#!/usr/bin/env bash`, `set -euo pipefail`.
- Event action names: `<domain>.<verb_past_tense>` (e.g. `task.accepted`, `gate.passed`).
- Event schema version bumps require migration in `replay-events.mjs`.
- Plugin hooks live in `claude/hooks/hooks.json` with a top-level `{ "hooks": { <event>: [...] } }` wrapper — NOT in `claude/settings.json` (the plugin loader ignores `hooks` there).
- Stack-specific scaffold surface is rendered from the approved intake proposal (`stackFlags()` + `render*()` in `core/scripts/nightshift-scaffold.mjs`); never hard-code Next.js-isms in `core/templates/project-starter/`.

### Layout

See `NIGHTSHIFT_MASTER_SPEC.md` §3.1 for the monorepo topology.
