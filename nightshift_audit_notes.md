# Nightshift audit notes

## Overall verdict
Promising architecture, but not fully wired yet.

What is solid:
- core event store and projection
- schema-first state/events/contracts
- target-project bootstrap template
- clear split between heavy lane and micro lane
- secrets abstraction and provisioner interfaces

What is not fully wired:
- Claude plugin hooks are packaged incorrectly for current Claude plugin behavior.
- Codex side is an adapter folder, not a real Codex plugin yet.
- dispatch -> Codex does not pass the env inputs that Codex skills expect.
- launchd currently tracks one active project, not a registry of projects.

## Key blockers
1. `claude/settings.json` defines hooks, but Claude plugins expect plugin hooks in `hooks/hooks.json` (or inline in plugin.json). Plugin settings.json only supports a small settings surface, so these hooks are unlikely to load as-is.
2. `codex/` is missing `.codex-plugin/plugin.json`, so it is not installable as a Codex plugin yet.
3. `core/scripts/dispatch.mjs` shells out to `codex exec`, but does not set:
   - `NIGHTSHIFT_TASK_CONTRACT`
   - `NIGHTSHIFT_CONTEXT_PACK`
   - `NIGHTSHIFT_CONSTITUTION`
   - `NIGHTSHIFT_PROJECT_DIR`
   even though Codex skills require them.
4. `health-ping.mjs` uses `claude --project ... -p /resume`, but `--project` is not in the current Claude CLI docs.

## Memory gaps
Nightshift already has some memory:
- `memory/constitution.md`
- `memory/learnings.md`
- `tasks/events.ndjson`
- `tasks/state.json`
- `tasks/questions.md`
- `tasks/decisions.md`

But it is missing retrieval-oriented memory.

Recommended additions:
1. `memory/decisions.ndjson` or `tasks/decisions.json`
   - machine-readable decision memory
   - every approval / answer should be queryable without grepping markdown
2. `memory/services.json`
   - preview URL, prod URL, provider project IDs, secret refs, deploy targets
3. `memory/incidents.ndjson`
   - symptom, cause, fix, linked task/result
4. `memory/reuse-index.json`
   - machine-readable mirror of REUSE_FUNCTIONS.md
5. `~/.nightshift/registry/projects.json`
   - global multi-project registry for the future dashboard/control plane

## Likely simplifications
- Keep `events.ndjson` as canonical and `state.json` as projection. Good.
- Keep `compliance.md`, but do not add more human-readable summaries until wiring is stable.
- Delay richer Codex plugin packaging until dispatch + env wiring works.
- Delay advanced "context zone" automation until there is a deterministic implementation.

## First fixes to make
1. Add `claude/hooks/hooks.json` and move hook config there.
2. Create `codex/.codex-plugin/plugin.json`.
3. Update `dispatch.mjs` to pass env + cwd into `codex exec`.
4. Replace `health-ping` resume call with a supported Claude headless invocation.
5. Add retrieval memory for decisions/services/incidents.
