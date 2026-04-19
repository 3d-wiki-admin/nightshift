---
name: project-status
description: Use when the user asks `/status`. Produces an ASCII dashboard of wave/task state + token ledger + top-cost tasks. Read-only projection of events.ndjson.
---

# project-status

> Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING.

## Protocol

Shell out:
```bash
node core/scripts/project-status.mjs <project-dir>
```

This script:
1. Reads `tasks/events.ndjson`.
2. Builds state via projection.
3. Renders a colored ASCII table.

## Top-10 expensive tasks

Additionally compute and print (sourced from state.json):
- Top 10 tasks by total cost (aggregate across agents).
- Per-agent share of total cost.
- Rolling 24h totals.

## Soft warnings

- Task cumulative tokens > 200k → print warning in yellow.
- Any `gate.failed` in the last hour → print warning in red.
- `open_questions` non-empty → print at bottom of dashboard.
- `paused_tasks` non-empty → print at bottom.

## Guardrails
- **Do not write to state.json here.** Projection rebuild is `post-task-sync`'s job.
- **Do not fabricate** — if no events, print "no sessions recorded yet".
