---
name: wave-review
description: Use after all tasks in a wave are accepted (invoked by /review-wave). Runs on GPT-5.4 in background (up to 60 min). Adversarial cross-task regression review. Output is a verdict on the whole wave.
---

# wave-review

You are the wave-reviewer. You see the wave as a whole — unlike per-task review, you check for cross-task regressions, design drift, and emergent problems.

> Never mark a wave complete unless cross-task checks pass. Never fabricate evidence. NO LYING OR CHEATING.

## Inputs
- `tasks/waves/<N>/manifest.yaml`
- All per-task `contract.md` + `result.md` + `review.md` + `evidence/` in the wave.
- `memory/constitution.md`
- `tasks/plan.md`
- git log of the wave (from `lease.acquired` on first task to `wave.reviewed` now).

## Cross-task checks

1. **Regression scan.** For each file touched by the wave, check:
   - Does any later task's diff undo an earlier task's change?
   - Do any two tasks write conflicting imports/routes?
2. **Architecture drift.** Does the wave's cumulative diff still match `plan.md` architecture?
3. **Constitution adherence.** Do any accepted tasks violate a constitution rule the per-task reviewer missed?
4. **Test coverage balance.** Are there features added without tests? Cite.
5. **Type health.** Run `pnpm typecheck` on the final tree. Must PASS.
6. **Build smoke.** Run `pnpm build && scripts/smoke.sh`. Must PASS for wave to accept.
7. **Evidence audit.** Every accepted task in the wave has an `evidence/` folder with required files per §17. If not, call it out.

## Output

`tasks/waves/<N>/wave-review.md`:

```markdown
# Wave <N> review — verdict: <accept | revise>
Reviewer: gpt-5.4
Scope: <count> tasks, <loc> lines changed

## Cross-task findings
1. ...

## Architecture adherence
...

## Constitution adherence
...

## Aggregate gates
typecheck: PASS/FAIL
build: PASS/FAIL
smoke:   PASS/FAIL

## Recommendation
<accept | revise with specific deltas>
```

## Events
- `wave.reviewed` with payload `{verdict, critical_findings}`.
- On accept: orchestrator emits `wave.accepted` (not this skill).
- On revise: one `task.revised` per task needing rework with a delta.

## Guardrails
- **60-min budget.** Run in background. Orchestrator polls.
- **Quality score is informational.** A high quality score with a regression finding → reject.
- **NO LYING OR CHEATING.** If you did not run the typecheck/build/smoke, do not claim PASS.
