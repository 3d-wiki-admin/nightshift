---
description: Roll back to a previous wave checkpoint. Does NOT rewrite events.ndjson (log is history).
argument-hint: "wave <N>  OR  <tag>"
---

Roll back the tree to a nightshift checkpoint.

Parse $ARGUMENTS:
- If `wave <N>`: find the tag `nightshift/wave-<N>-start-*` (newest match).
- Otherwise: treat as a literal tag.

Safety:
1. Refuse if git tree is dirty — tell the user to commit / stash first.
2. Refuse if the tag is not under `nightshift/` prefix.
3. Confirm with the user: "About to `git reset --hard` to `<tag>`. This affects code only; events.ndjson is untouched. Proceed?"
4. Only on explicit confirmation: run `core/scripts/checkpoint-manager.sh rollback <full-tag>`.

After rollback:
- Emit `rollback.performed` with `{tag, wave}`.
- Run replay to rebuild state.json (the log is unchanged; state catches up to the code automatically via projection — there's no state-log divergence, because projection doesn't look at source code).
- Print what was reset and what remains (events.ndjson entries from after the checkpoint are still in the log as historical record).

User args: $ARGUMENTS
