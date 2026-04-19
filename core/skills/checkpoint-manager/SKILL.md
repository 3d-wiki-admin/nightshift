---
name: checkpoint-manager
description: Use to tag git checkpoints at wave boundaries and roll back when a wave goes sideways. Invoked automatically by orchestrator; manually via /rollback wave <N>.
---

# checkpoint-manager

## Protocol

### Tag at wave start
```bash
core/scripts/checkpoint-manager.sh tag wave-<N>-start
```

### Tag at wave end (accepted)
```bash
core/scripts/checkpoint-manager.sh tag wave-<N>-end
```

### List checkpoints
```bash
core/scripts/checkpoint-manager.sh list
```

### Rollback
```bash
core/scripts/checkpoint-manager.sh rollback <full-tag>
```

After a rollback:
- Emit `rollback.performed` with payload `{tag, wave}`.
- Leave `events.ndjson` unchanged (the log is history, not state).
- Regenerate `state.json` from the log. State catches up naturally.

## Guardrails
- **Tags are nightshift/ prefixed.** Never delete tags in this namespace.
- **Rollback requires clean tree.** If dirty, ask the user to commit or stash. Do not `--force`.
- **Event log is the source of truth.** Rolling back code does NOT rewrite history. All "what happened" evidence stays in events.ndjson.
