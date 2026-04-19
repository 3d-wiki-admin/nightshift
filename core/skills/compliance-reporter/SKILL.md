---
name: compliance-reporter
description: Use after every task.accepted or wave.accepted to regenerate tasks/compliance.md. Read-only on events.ndjson. Human-readable audit per spec §13.
---

# compliance-reporter

## Protocol

Run:
```bash
node core/scripts/compliance-reporter.mjs <project-dir>
```

The script:
1. Reads `tasks/events.ndjson` (never mutates).
2. Builds state via projection.
3. Renders a per-task block with: accepted timestamp, model, reviewer, hard gate outcomes, quality score, constitution checks, dimension review evidence, tokens + cost, evidence folder path.
4. Writes `tasks/compliance.md` (full rewrite, not append — idempotent).

## Guardrails
- **Do not mutate events** ever.
- **Do not mutate state.json** (that's projection's job, invoked elsewhere).
- **Every accepted task MUST have a block.** If missing data → write `[UNKNOWN]` and file a warning in the summary header.
- **Output is for humans.** No JSON in compliance.md unless in fenced code blocks.
