---
description: Read-only consistency check across spec / plan / tasks / constitution. Halts pipeline on CRITICAL findings.
---

Run the `analyzer` subagent via the Task tool.

Analyzer is READ-ONLY: it produces `tasks/analysis-<timestamp>.md` and emits events. It does NOT modify spec, plan, or contracts.

If CRITICAL findings are present:
- Print them inline in chat.
- Tell the user: "pipeline is halted until these are resolved in a new spec/plan revision".
- Do NOT proceed to `/tasks`.

If only WARNING findings: print them, record on the wave manifest, proceed is allowed.

If 0 findings: print "analysis clean — safe to /tasks".
