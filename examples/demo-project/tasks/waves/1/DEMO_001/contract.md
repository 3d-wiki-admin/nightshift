# DEMO_001: name-input page + localStorage store

```yaml
task_id: DEMO_001
wave: 1
risk_class: safe
target_model: gpt-5.4
reasoning_effort: default
diff_budget_lines: 100
owner_agent: implementer
reviewer_agent: task-impl-reviewer
reviewer_model: claude-opus-4.7
created_at: "2026-04-19T00:00:03.000Z"
goal:
  objective: "Render hello, <name> on app/page.tsx; persist name to localStorage."
  business_value: "Demonstrates nightshift end-to-end pipeline on a trivial app."
scope:
  in_scope:
    - "Client component with text input."
    - "Read/write helper in lib/name-store.ts."
  out_of_scope:
    - "Server-side persistence."
    - "Authentication."
source_of_truth:
  - memory/constitution.md
  - tasks/spec.md
  - tasks/plan.md
allowed_files:
  - app/page.tsx
  - lib/name-store.ts
forbidden_files:
  - "**/*.test.ts"
acceptance_criteria:
  functional:
    - "User can type a name; page displays 'hello, <name>'."
    - "Name survives a page reload (localStorage)."
  gates_required: [tests, types, lint, build]
halt_conditions:
  - "3 consecutive implementation failures"
  - "new top-level dependency required"
verification_plan:
  commands:
    - pnpm typecheck
    - pnpm lint
    - pnpm test -- name-store
    - pnpm build
post_task_updates:
  - tasks/contracts/FEATURE_INDEX.md
  - tasks/contracts/REUSE_FUNCTIONS.md
```
