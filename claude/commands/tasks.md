---
description: Decompose the next plan phase into a wave of task contracts. Assigns risk class, [P] markers, target models.
argument-hint: "[--phase=P0|P1|...] [--max=<n>]"
---

Run the `task-decomposer` subagent via the Task tool.

Pre-check: `tasks/analysis-<most-recent>.md` must show CRITICAL: 0. If not, halt and tell the user to re-run `/analyze` after fixing spec/plan.

The decomposer will:
1. Read plan, data-model, API contracts, constitution, existing waves, REUSE_FUNCTIONS.
2. Break the next unfinished phase into tasks with disjoint `allowed_files`.
3. Assign risk class per §15 and target model per §6.1.
4. Mark `[P]` only for disjoint write sets with no dependency.
5. Write `tasks/waves/<N>/manifest.yaml` + one `contract.md` per task.
6. Emit `wave.planned` + one `task.contracted` per task.

Report: wave number, number of tasks (separated by `[P]` vs serial), routing breakdown (how many to each model), and any `approval-required` tasks that will block.

User args: $ARGUMENTS
