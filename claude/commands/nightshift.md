---
description: nightshift subcommands — use "/nightshift start" to begin a project chat → constitution + spec.
argument-hint: "start"
---

Nightshift entry point. Subcommand from user: $ARGUMENTS

Supported subcommands:

### `start`
Invoke the `spec-writer` subagent via the Task tool. It will interview the user in chat and produce:
- `memory/constitution.md`
- `tasks/spec.md`

Before invoking, confirm that `/bootstrap` has been run (`memory/` exists). If not, suggest the user run `/bootstrap` first; do not auto-bootstrap.

The interview has six questions (what / who / must-not-miss / out-of-scope / constraints / success-criteria). The spec-writer must write user's exact words into `tasks/questions.md` when answers are ambiguous — it never guesses.

At completion: print a 5-line summary and the file paths created.

### Any other subcommand
Respond: "nightshift: unknown subcommand. Try `/nightshift start`, or see `/help`."
