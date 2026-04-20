---
description: Launch the 60-min adversarial wave review (GPT-5.4) in the background. Orchestrator polls for the result.
argument-hint: "[<wave-number>]"
---

Launch wave review for wave $ARGUMENTS (defaults to the most recent accepted wave).

Prerequisites:
- All tasks in the wave must be `accepted` (check state.json).
- Codex CLI must be available. If not, degrade: fall back to Claude Opus in Task with `run_in_background=true`.

Steps:

1. Determine wave N: if $ARGUMENTS is empty, pick the latest wave with status = `accepted`.
2. Run the background launcher:
   ```bash
   nightshift wave-reviewer "$PWD" <N>
   ```
   This spawns `codex exec --json --model gpt-5.4` with the wave-review prompt in the background and returns a PID.

3. Print to the user: "Wave <N> review started (pid=..., budget=60min). Poll via: `node .../wave-reviewer.mjs poll "$PWD" <N>`. Result will land at `tasks/waves/<N>/wave-review.md`."

4. The orchestrator will poll periodically (every few minutes) or on next `/status` invocation. When `wave-review.md` exists, read the verdict:
   - `accept` → emit `wave.accepted`, tag checkpoint `wave-<N>-end`.
   - `revise` → for each delta task, emit `task.revised` with the specific delta; these go into a new wave N+1.

If Codex unavailable, launch a Claude Opus subagent via Task with `run_in_background=true` using the wave-review skill directly. Same polling pattern.
