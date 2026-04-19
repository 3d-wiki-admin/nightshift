# TASK-XXX: <title>

<!-- Frontmatter MUST validate against core/schemas/contract.schema.json. -->
<!-- Copy this template; fill every field. Leave lists empty only when a field does not apply. -->

```yaml
task_id: WAVE-ID-NUM
wave: 1
risk_class: safe | review-required | approval-required
parallel_marker: "[P]"             # omit if serial
target_model: gpt-5.4              # per §6.1
reasoning_effort: default          # default | high | xhigh
diff_budget_lines: 150
owner_agent: implementer
reviewer_agent: task-impl-reviewer
reviewer_model: claude-opus-4.7    # MUST differ from target_model
created_at: 2026-MM-DDTHH:MM:SSZ

lease:
  worktree: .nightshift/worktrees/wave-1-task-1
  write_lock:
    - path/to/file.ts
  lease_until: 2026-MM-DDTHH:MM:SSZ

goal:
  objective: "Describe the outcome in one sentence."
  business_value: "What user-visible win does this produce?"

scope:
  in_scope:
    - "Concrete list"
  out_of_scope:
    - "Concrete list"
  dependencies:
    - PRIOR-TASK-ID

source_of_truth:
  - memory/constitution.md
  - tasks/spec.md
  - tasks/plan.md
  - tasks/data-model.md
  - tasks/contracts/API.md

allowed_files:
  - path/to/file.ts
forbidden_files:
  - "**/*.test.ts"
  - "supabase/migrations/**"

acceptance_criteria:
  functional:
    - "Measurable outcome #1"
  edge_cases:
    - "What must not happen"
  gates_required: [tests, types, lint, build]

halt_conditions:
  - "3 consecutive implementation failures"
  - "new top-level dependency required"
  - "contract violation detected by write-guard"
  - "constitution conflict"

verification_plan:
  commands:
    - pnpm test
    - pnpm typecheck
    - pnpm lint
  manual_checks:
    - "User-visible behavior check"

post_task_updates:
  - tasks/contracts/FEATURE_INDEX.md
  - tasks/contracts/REUSE_FUNCTIONS.md
```

## Body (free prose for context)

- Link to relevant spec/plan sections.
- Why now (ordering within the wave).
- Known traps or prior art.
