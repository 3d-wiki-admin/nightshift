---
description: Pre-sleep readiness validator. Checks constitution, spec, git cleanliness, node/codex/launchd availability, open questions, paused tasks.
---

Run preflight:

```bash
bash ${NIGHTSHIFT_HOME:-~/.nightshift}/core/scripts/preflight.sh "$PWD"
```

Interpret the exit code:
- 0 → report GREEN (safe to sleep).
- 2 → report YELLOW (warnings — surface them to the user, ask for explicit ack before long runs).
- 1 → report RED (halt). Do NOT start waves in this state.

Additionally print:
- Event log size.
- `launchctl list | grep ai.nightshift` summary.
- "Codex CLI: PRESENT" vs "ABSENT (degraded mode — implementer → Claude Sonnet fallback)".

If RED, list exact remediations per the preflight output.
