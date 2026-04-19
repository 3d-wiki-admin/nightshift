# DEMO_002: name-store unit test

```yaml
task_id: DEMO_002
wave: 1
risk_class: safe
parallel_marker: "[P]"
target_model: gpt-5.4
reasoning_effort: default
diff_budget_lines: 60
owner_agent: implementer
reviewer_agent: task-impl-reviewer
reviewer_model: claude-opus-4.7
created_at: "2026-04-19T00:00:04.000Z"
goal:
  objective: "Unit-test get/set name-store roundtrip and empty-storage behavior."
scope:
  in_scope:
    - "vitest test for lib/name-store.ts."
  out_of_scope:
    - "Modifying lib/name-store.ts itself."
source_of_truth:
  - memory/constitution.md
  - tasks/plan.md
allowed_files:
  - tests/name-store.test.ts
forbidden_files:
  - "app/**"
  - "lib/**"
acceptance_criteria:
  functional:
    - "vitest passes locally."
  gates_required: [tests, types, lint]
halt_conditions:
  - "3 consecutive test failures with no progress."
verification_plan:
  commands:
    - pnpm test -- name-store
    - pnpm typecheck
    - pnpm lint tests/name-store.test.ts
```
