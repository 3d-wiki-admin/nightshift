---
description: ASCII dashboard of wave/task state + token ledger + top-cost tasks.
---

Run the project-status script directly (no subagent — this is pure display):

```bash
nightshift status "$PROJECT" --dashboard
```

After the ASCII dashboard, print:
- Top 10 most expensive tasks this session (sourced from state.json `tokens` per task).
- Per-agent share of total cost.
- Rolling 24h total.

Soft warnings:
- Task cumulative tokens > 200k → yellow warning with task id.
- `gate.failed` in last hour → red warning.
- Open questions non-empty → list at bottom.
- Paused tasks non-empty → list at bottom with reason from `paused.md`.
