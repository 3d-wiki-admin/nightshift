---
description: Manually run doc-syncer — rebuild state.json + compliance.md from events.ndjson; refresh FEATURE_INDEX / REUSE_FUNCTIONS / PROJECT_STRUCTURE.
---

Invoke the `doc-syncer` subagent via the Task tool.

The sync is normally driven by the PostToolUse(Write|Edit) hook after each accepted task; run it manually when you suspect drift (e.g. after editing `tasks/events.ndjson` outside the dispatch layer — which you should never do, but recovery is needed).

Steps are deterministic:
1. `nightshift replay tasks/events.ndjson --write`
2. `nightshift compliance .`
3. Update FEATURE_INDEX / REUSE_FUNCTIONS / PROJECT_STRUCTURE.
4. Append to memory/learnings.md only if a new surprise was surfaced.

Report: diff in state.json event count, any new features added to FEATURE_INDEX.
