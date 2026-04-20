# codex/ — Codex CLI adapter (not a plugin)

**Honest positioning.** Codex CLI does not (as of codex-cli 0.121) ship a first-class plugin system comparable to Claude Code's `.claude-plugin/plugin.json`. What lives in this folder is an **adapter**: a pair of skill prompts + an automations manifest that the nightshift dispatch layer hands to `codex exec`. No marketplace, no auto-discovery, no cross-project install surface.

If you see the word "plugin" in older docs referring to this folder, read it as "adapter".

What the adapter provides:
- `skills/implementer/SKILL.md` — the prompt fed to `codex exec` on every implementer dispatch (ран per-task).
- `skills/context-packer/SKILL.md` — the cheap-model context-packer prompt.
- `automations/nightshift.json` — manifest declaring the skills + their default models / reasoning-effort / required env vars. Codex CLI can resolve this manifest if placed under `~/.codex/automations/` (see Install below). If your Codex CLI version doesn't auto-discover it, the nightshift dispatch layer still invokes the prompts directly via `--prompt <path>`, so the manifest is documentation-grade rather than load-bearing.

## How dispatch flows

```
Claude orchestrator
  └─► nightshift dispatch codex <task.json>          # core/scripts/dispatch.mjs
        └─► buildTaskEnv resolves:
              NIGHTSHIFT_TASK_CONTRACT    (abs path)
              NIGHTSHIFT_CONTEXT_PACK     (abs path)
              NIGHTSHIFT_CONSTITUTION     (abs path)
              NIGHTSHIFT_PROJECT_DIR      (abs path)
        └─► runCodex (core/codex/client.mjs):
              spawn codex exec --json --model <routed-model>
                    [--reasoning-effort <effort>] --prompt <prompt-path>
              with taxonomy-based error classification, timeout with
              process-group kill, token extraction from --json stream.
```

The dispatch layer is the ONLY writer to `events.ndjson`. Codex skills emit events by calling back into `nightshift dispatch append` (or `nightshift memory-record` for the retrieval-memory surface) — never by `echo >> events.ndjson` or direct Write/Edit.

## Install (optional — manifest side)

The adapter works **without** the manifest being installed, because dispatch invokes the skill prompts directly via `--prompt`. Installing the manifest is useful only if you want Codex CLI to list the skills in its own UI.

```bash
mkdir -p ~/.codex/automations
ln -sf "$NIGHTSHIFT_HOME/codex/automations/nightshift.json" ~/.codex/automations/nightshift.json
```

If your Codex CLI version uses a different automation location, symlink there instead.

## Degraded mode

If `codex` is not on `PATH` (or auth is missing), the nightshift router falls back to Claude Sonnet 4.6 on the implementer role (§23 / spec.md). `nightshift dispatch codex` detects this and exits with code 5 (`EXIT_CODEX_UNAVAILABLE`) after writing a `task.routed` event with `payload.fallback_from = <original-target>`. The orchestrator treats exit 5 as a signal to route the same task to a Claude implementer.

## What this adapter DOES NOT provide

- **A plugin marketplace entry.** Codex CLI 0.121 doesn't have one; this is documentation, not packaging.
- **Cross-project auto-install.** Each nightshift project reuses the same adapter by virtue of the nightshift CLI being on PATH, not through codex-cli discovery.
- **Graceful UI for manual `codex exec`.** Users don't usually run `codex exec --prompt codex/skills/implementer/SKILL.md` by hand — the dispatch layer does it with the right env + arg set. Running the prompt manually without that env is not supported.
