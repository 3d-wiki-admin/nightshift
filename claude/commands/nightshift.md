---
description: nightshift subcommands — primary flow is "intake" → "confirm-scaffold". Legacy "start" still works.
argument-hint: "intake --project <path> | confirm-scaffold | status | start"
---

Nightshift entry point. Parse $ARGUMENTS to find the subcommand.

## `intake --project <path>`  (v1.1 default flow)

Invoke the **`intake-interview`** subagent via the Task tool, passing the project path.

Pre-checks (fail fast, clear message):
1. `<path>/.nightshift/intake-pending` must exist. If missing, tell user:
   "Run `nightshift init <path>` first. That registers the project and creates the intake marker."
2. `<path>/memory/constitution.md` must NOT exist (would indicate the project is already scaffolded). If present, tell user to run `/nightshift confirm-scaffold` (pick up where they left off) or start in a fresh path.

The intake-interview subagent conducts a six-question interview + proposes stack/template/providers/initial risk class + asks for approval. All answers go to `<path>/.nightshift/intake.ndjson` (append-only). The subagent returns one of:

- **`approved`**  — user said yes to the proposed plan. Tell user to run `/nightshift confirm-scaffold` next.
- **`revise`**   — user wants to change answers. Re-invoke `intake-interview` with the revision hint.
- **`abort`**    — user wants out. Tell them `rm -rf <path>/.nightshift/` + `nightshift init` can restart clean.

## `confirm-scaffold` (v1.1 approval checkpoint)

Only runs after `intake` ended with verdict=approved. Execute the flow:
1. Read `.nightshift/intake.ndjson`. Find the most recent entry with `kind=proposal` and confirm it is flagged as `approved: true`. If not, refuse and tell user to finish the interview.
2. Run: `nightshift dispatch append < /tmp/decision.json` to record a `decision.recorded` event pointing at the approval. Use a temp file populated via Bash.
3. Run: `nightshift scaffold <path>` (shell CLI). It expands the minimal meta into the full project: memory/constitution.md, tasks/spec.md, tasks/contracts/, .env.template, .github/workflows/ci.yml, CLAUDE.md — all populated from the intake answers.
4. Ask the user whether to install the launchd pinger/digest now (optional). If yes, run `bash scripts/install-launchd.sh --project <path>` (via the packaged runtime path).
5. Print a summary table and point them at `/plan` as the next step.

## `start`  (legacy — intake-interview + confirm-scaffold behind one command)

For backward-compat. Invoke intake; on approval, immediately call confirm-scaffold. New users should prefer the explicit two-step.

## Any other subcommand

Respond:
```
nightshift: unknown subcommand '$ARGUMENTS'.
Valid: intake --project <path>, confirm-scaffold, start (legacy).
Shell CLI:  nightshift init <path>   to create a new project.
```

## User args
$ARGUMENTS
