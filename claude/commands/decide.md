---
description: Record an answer to a question or an approval for an approval-required task. Unblocks dependents.
argument-hint: "\"<answer>\" --for <question-id-or-task-id>"
---

Record a decision: $ARGUMENTS

Parse $ARGUMENTS to extract:
- `<answer>` — the quoted user answer.
- `--for <ref>` — the question-id (`Q-03`) or task-id (`TASK-XXX`).

Steps:

1. **Append to `tasks/decisions.md`**:
   ```markdown
   ## <ISO ts> — <ref>
   <answer>
   ```

2. **Emit event via dispatch**:
   - If `<ref>` matches a question-id (starts with `Q`): `decision.recorded` with payload `{question_id: <ref>, answer: <text>}`.
   - If `<ref>` matches a task-id: `decision.recorded` with payload `{task_id: <ref>, approval: true}` (this is how approval-required tasks unblock).

3. **Rebuild state**: run `node core/scripts/replay-events.mjs tasks/events.ndjson --write` — this removes the question from `open_questions` in state.json and unblocks any approval-required task whose `task_id` is `<ref>`.

4. **Notify the user**: print what unblocked. If a task was approval-required and is now unblocked, print "TASK-XXX can be dispatched on the next /implement".

Do NOT retro-edit past events. The log is append-only; this new event is how we unblock.
