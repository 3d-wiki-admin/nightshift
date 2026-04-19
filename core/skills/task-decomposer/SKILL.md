---
name: task-decomposer
description: Use to turn a plan phase into a wave of task contracts (invoked by /tasks). Assigns risk classes, `[P]` markers only when write sets are disjoint, chooses target_model per §6.1, produces manifest.yaml.
---

# task-decomposer

## Inputs
- `tasks/plan.md`, `tasks/data-model.md`, `tasks/contracts/API.md`
- `memory/constitution.md`
- Existing `tasks/waves/*/manifest.yaml` (for numbering)
- `tasks/contracts/REUSE_FUNCTIONS.md` (to avoid re-inventing helpers)

## Output

### `tasks/waves/<N>/manifest.yaml`
Must validate against `core/schemas/manifest.schema.json`.

### `tasks/waves/<N>/<TASK-ID>/contract.md`
Frontmatter must validate against `core/schemas/contract.schema.json`. See `tasks/contracts/TASK_TEMPLATE.md`.

## Steps

1. **Read plan + constitution.** Pick the next unfinished phase.
2. **Break phase into tasks.** Each task must:
   - be completable in one `diff_budget_lines` (default 150, max 500).
   - touch a disjoint set of files from its `[P]` siblings.
   - have at least one measurable acceptance criterion.
3. **Assign risk class** per §15:
   - `safe` — internal code, no UI, no deps, no migrations.
   - `review-required` — UI change, API shape change, new dep, file >300 LOC touched.
   - `approval-required` — infra, secret rotation, prod migration, auth, billing, user-visible broadcast, data deletion.
4. **Route to model** per §6.1:
   - `safe` + small → `gpt-5.4` default.
   - `review-required` or large or refactor → `gpt-5.3-codex` high/xhigh.
   - mechanical fix (micro lane) → `gpt-5.3-codex-spark`.
   - `approval-required` → `gpt-5.3-codex` xhigh.
5. **Pick `[P]` pairs only when**: `allowed_files` are pairwise disjoint AND no dependency relation. Verify by computing set intersection — if empty, mark `[P]`; otherwise serialize.
6. **Assign leases** — each parallel task gets a distinct worktree path.
7. **Emit events** per task: `task.contracted` (wave + task_id + risk_class + parallel_marker + evidence_folder). Emit `wave.planned` for the whole wave.

## Guardrails
- **Never downgrade risk class**. An implementer may only upgrade it mid-flight.
- **Never create a wave with 0 tasks.**
- **Every contract must cite `memory/constitution.md` in `source_of_truth`.**
- **Reviewer model must differ from `target_model`** — enforce by routing reviewer to Claude Opus when implementer is any GPT-* model, and vice versa.
- **Every contract's `allowed_files` must be non-empty**.
- If you cannot decompose the phase into tasks because inputs are ambiguous, emit `question.asked` for each ambiguity and STOP. Do not guess.
