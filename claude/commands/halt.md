---
description: Safe stop — finish in-flight tool call, append session.halted, leave state consistent. Does not kill child processes.
argument-hint: "[--reason=<text>]"
---

Safe stop for the current nightshift run.

Steps:
1. Refuse to dispatch any new work.
2. Wait for in-flight subagent / Codex dispatch to return (up to 2 minutes); do NOT force-kill.
3. Release any open lease: emit `lease.released` per in-flight task.
4. Append `session.halted` event with `payload.reason = $ARGUMENTS` (or "user requested" if empty).
5. Run doc-syncer to rebuild state.json so `/resume` can pick up cleanly.
6. Print: what was in-flight, what was halted, what's paused, how to resume.

The halt is not destructive — `/resume` will pick up from here.

User args: $ARGUMENTS
