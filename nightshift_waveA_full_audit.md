# Nightshift v1.1 Wave A audit

## Verdict
Wave A is a meaningful improvement, but not fully closed. Core/runtime is strong; plugin wiring and UX still have important gaps.

## What I checked
- `npm test`
- `bash scripts/nightshift.sh doctor`
- structure and key files:
  - `scripts/nightshift.sh`
  - `scripts/install.sh`
  - `claude/.claude-plugin/plugin.json`
  - `claude/settings.json`
  - `core/scripts/dispatch.mjs`
  - `core/codex/client.mjs`
  - `core/scripts/health-ping.mjs`
  - `scripts/install-launchd.sh`
  - `README.md`
  - `docs/WALKTHROUGH.md`

## Results
- Tests: **150/154 passed**, **4 failed**
- `nightshift doctor` works
- top-level `nightshift` CLI exists
- self-contained Claude runtime is generated in `claude/bin/runtime/`

## Main findings

### Good
- Strong `core/` architecture
- Better install flow with user-local bin
- launchd is no longer auto-installed on the wrong path
- Codex client abstraction exists
- registry layer exists
- runtime packaging exists

### Problems
1. **Test suite is not green**
   - 2 failures in `dispatch-codex-e2e`
   - 2 failures in `install-launchd` tests

2. **Claude hook wiring still looks wrong**
   - hooks are in `claude/settings.json`
   - current Claude plugin docs say plugin-root `settings.json` only supports `agent` and `subagentStatusLine`; hooks belong in `hooks/hooks.json`

3. **Self-contained plugin is incomplete**
   - many Claude prompts still reference `core/...`
   - in real installed plugin sessions those repo-relative paths will not exist in the target project

4. **Codex availability detection is brittle**
   - `codexAvailable()` uses `bash -lc 'command -v codex'`
   - this likely causes the failing e2e tests and can also be brittle in real shells/PATH setups

5. **health-ping resume strategy is likely wrong**
   - it runs `claude -p /resume`
   - `-p` is print/headless mode; resume is a separate CLI concept
   - this is likely not a reliable “unstick” mechanism

6. **User-facing flow is still old**
   - `nightshift init` is not implemented yet
   - current CLI still explicitly says Wave B placeholder

7. **Docs are stale**
   - README and WALKTHROUGH still describe the old `/bootstrap` flow
   - package/plugin versioning is still `1.0.0`

8. **Codex is still an adapter, not a real plugin**
   - no `.codex-plugin/plugin.json`

## Practical user flow right now
Current realistic flow is still:

1. clone nightshift
2. run `./scripts/install.sh --link-bin`
3. install Claude plugin manually
4. create project directory manually
5. open Claude manually
6. run `/bootstrap`
7. run `/nightshift start`
8. continue with `/plan`, `/analyze`, `/tasks`, `/implement`, `/review-wave`, `/sync`, `/status`

That means the promised “one command → discuss idea → approve → scaffold” UX is **not there yet**.

## Recommended next pass
1. make tests fully green
2. move Claude hooks to supported plugin hook surface
3. remove all `core/...` references from Claude prompt layer
4. fix Codex detection
5. replace `claude -p /resume` strategy with a supported resume/continue path
6. implement `nightshift init`
7. update README / WALKTHROUGH / versions
