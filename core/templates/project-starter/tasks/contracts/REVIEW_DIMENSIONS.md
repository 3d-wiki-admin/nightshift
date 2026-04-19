# Review dimensions (per spec §14, §17)

The task-impl-reviewer MUST produce a verdict (OK / NOTE / FAIL) with a concrete evidence path for every dimension below.

A dimension without an evidence path → automatic FAIL on that dimension → reject the task.

| # | Dimension | What to check | Typical evidence |
|---|---|---|---|
| 1 | `scope_drift` | Diff stayed inside `allowed_files`? | `evidence/diff.patch` byte range |
| 2 | `missed_deps` | New imports? package.json updated? lockfile committed? | `evidence/diff.patch` + `pnpm audit` |
| 3 | `dup_abstractions` | Does the diff duplicate code listed in `REUSE_FUNCTIONS.md`? | `evidence/reuse-check.txt` |
| 4 | `verification_gaps` | Every acceptance criterion has a test that exercises it? | `evidence/tests.txt` + contract diff |
| 5 | `security` | Secret in code? PII in logs? auth bypass? RLS respected? | `evidence/secret-scan.txt` |
| 6 | `data_contract` | Diff aligns with `contracts/API.md` and `data-model.md`? | line citation in review.md |
| 7 | `deploy_risk` | Migration? env var? infra change? Approval recorded if required? | reviewer notes |

## Verdict legend

- `OK` — no concerns.
- `NOTE` — minor observation, not blocking (log it, move on).
- `FAIL` — blocks acceptance. Reviewer MUST recommend `revise` or `reject`.

## Aggregate verdict rule

`accept` ⇔ (all hard gates PASS or N/A-with-justification) ∧ (all 7 dimensions non-FAIL) ∧ (risk_class ≠ approval-required OR decision.recorded exists for task_id).

Otherwise → `revise` (with delta request) or `reject` (abandon, reassign, or escalate).
