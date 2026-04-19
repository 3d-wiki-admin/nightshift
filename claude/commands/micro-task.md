---
description: Short lane for a small change — ≤5 files, ≤200 LOC, risk_class=safe, no architecture shift. Auto-promotes to heavy lane if it grows.
argument-hint: "<description>"
---

Run the micro lane for: $ARGUMENTS

Micro lane rules (spec §5):
- Mini-contract, no `/analyze`, no wave review.
- `risk_class = safe` only.
- Budget: ≤5 files, ≤200 LOC diff.
- If mid-work any rule is violated → PROMOTE to heavy lane (new contract, re-analyze). Promotion is an event: `task.promoted_to_heavy`.

Flow:

1. **Draft a mini-contract** at `tasks/waves/micro/TASK-<timestamp>/contract.md`:
   - `goal.objective` = the $ARGUMENTS string cleaned up.
   - `risk_class: safe`.
   - `diff_budget_lines: 200`.
   - Infer `allowed_files` from the description (best-effort). If unclear, stop and ask.
   - `verification_plan.commands`: `pnpm typecheck && pnpm lint && pnpm test`.
2. **Invoke `task-spec-reviewer`** (≤3 min) to validate the mini-contract.
3. **Route via `node core/scripts/router.mjs`**. For trivial edits, expect `gpt-5.3-codex-spark`.
4. **Dispatch implementer** (`node core/scripts/dispatch.mjs codex <task.json>`, or Claude Sonnet fallback).
5. **Invoke `task-impl-reviewer`** — hard gates + dimension review.
6. **On accept**: tag a checkpoint `micro-<timestamp>`, run doc-syncer, merge to main (or leave branch if user prefers). Print one-line summary.

Promotion check (at every implementer turn):
- Files touched > 5 → promote.
- Diff size > 200 LOC → promote.
- Discovered new top-level dep needed → promote.
- Discovered architecture change needed → promote.

On promotion:
- Emit `task.promoted_to_heavy` with payload `{reason}`.
- Create a normal heavy-lane contract in the next wave.
- Release the worktree cleanly; do not leave half-finished code merged.

No wave review. No deploy. Merges to main; deploy decisions stay with heavy lane or manual `/deploy`.
