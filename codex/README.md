# codex/ — Codex CLI adapter

The Codex plugin for NightShift is intentionally thin. All behavior lives in `core/skills/` and `core/scripts/`; this folder only provides:

- `skills/implementer/SKILL.md` — the prompt fed to `codex exec` on every implementer dispatch.
- `skills/context-packer/SKILL.md` — the context-packer prompt (cheap model).
- `automations/nightshift.json` — a Codex automations manifest declaring the skills.

## How dispatch flows

```
Claude orchestrator
  └─► node core/scripts/dispatch.mjs codex <task.json>
        └─► spawn codex exec --json --model <routed-model> \
               --reasoning-effort <routed-effort> \
               --prompt <prompt-path>
             └─► codex runs `codex/skills/implementer/SKILL.md` with env:
                   NIGHTSHIFT_TASK_CONTRACT=<path>
                   NIGHTSHIFT_CONTEXT_PACK=<path>
                   NIGHTSHIFT_CONSTITUTION=<path>
```

The dispatch layer is the ONLY writer to `events.ndjson`. Codex skills emit events by calling back into `dispatch.mjs append` (via a helper wrapper) — never by `echo >> events.ndjson`.

## Install

Codex CLI picks up automations from a path set by `CODEX_AUTOMATIONS` or from the project's `.codex/` folder. To install globally:

```bash
mkdir -p ~/.codex/automations
ln -sf "$NIGHTSHIFT_HOME/codex/automations/nightshift.json" ~/.codex/automations/
```

(If your Codex CLI version uses a different location, symlink there instead.)

## Degraded mode

If `codex` is not on `PATH` or `openai`/API auth is missing, the NightShift router falls back to Claude Sonnet 4.6 on the implementer role (§23 degraded mode). Work continues; the `task.routed` event records `reason: codex-unavailable`.
