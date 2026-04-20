---
description: Run the current wave — dispatch, implement, review, accept or revise.
argument-hint: "[--wave=<N>] [--cap=<parallelism>]"
---

Invoke the `orchestrator` subagent via the Task tool to run the wave.

Before dispatch:
1. Run `/preflight` equivalent checks (constitution present, events log writable, git tree clean or at least committed).
2. Confirm the wave's manifest validates against `core/schemas/manifest.schema.json`.
3. Tag a pre-wave checkpoint: `nightshift checkpoint tag wave-<N>-start`.

The orchestrator will:
- Run each task's context-packer → implementer → task-impl-reviewer chain.
- Enforce `[P]` parallelism with lease expiry (default 15 min).
- On per-task accept: doc-syncer runs, wave accumulates.
- On wave end: tag `wave-<N>-end`, emit `wave.accepted`, print summary.

Degraded mode (no Codex CLI): implementer falls back to Claude Sonnet 4.6. Reviewer stays Opus. The contract's `target_model` is updated accordingly and `task.routed` records the fallback with `reason: codex-unavailable`.

On any task's `approval-required` without matching `decision.recorded`: skip the task, continue the wave, surface the question.

User args: $ARGUMENTS
