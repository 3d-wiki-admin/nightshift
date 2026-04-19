---
name: preflight-check
description: Use before long unattended runs (/preflight). Validates constitution, spec, git cleanliness, node/codex/launchd availability, open questions, paused tasks. Halts on CRITICAL.
---

# preflight-check

## Protocol

Shell out:
```bash
bash core/scripts/preflight.sh <project-dir>
```

Exit codes:
- 0 = safe to sleep.
- 1 = CRITICAL (missing constitution, unwritable log, no node, etc.) — agents refuse to run.
- 2 = warnings only (uncommitted changes, no codex, no launchd) — prompt user; run proceeds only with user ack.

## Additional report

Append to the script's output:

```markdown
# Preflight — <project>

## Readiness: <GO | WARN | HALT>

## Ready
- [x] constitution present
- [x] spec present (NOT empty stub)
- [x] event log writable
...

## Warnings
- [ ] ...

## Halts
- [ ] ...

## Recommendations
- If HALT: list exact remediations.
```

## Guardrails
- **Never auto-fix missing constitution.** That's a user decision.
- **Never bypass HALT.** If exit=1, the orchestrator must refuse to start waves.
- **Print the event log size** so the user knows how much history will accumulate overnight.
