# NightShift — follow-up task brief for plugin developer

This file is a **delivery brief**, not a loose suggestion list.
It is based on the current NightShift repo audit and is intended to close the biggest gaps between:

- what the repo **claims** to do,
- what Claude/Codex **officially support today**, and
- what the current code **actually wires up**.

Use this as the next implementation batch.

---

## 0. Goal

Make NightShift v1 **honest, installable, and recoverable** across Claude + Codex without changing the product vision.

Concretely, after this batch:

1. Claude plugin hooks should load through the **documented plugin surface**.
2. Codex integration should be either:
   - a **real installable plugin**, or
   - an explicitly documented **skill-pack / adapter**, not something that only *looks* like a plugin.
3. Codex executions should receive the **contract/context/constitution inputs** that the skills already expect.
4. Overnight recovery should use a **supported Claude CLI resume path**.
5. Project memory should stop being mostly write-only: key human decisions and live service state must become **retrievable inputs** for later planning/implementation.

---

## 1. Non-goals

Do **not** do these in this batch unless absolutely required by one of the fixes below:

- no UI/dashboard rebuild
- no vector DB / embeddings / graph memory
- no rewrite of event-store architecture
- no major redesign of the artifact pipeline
- no attempt to build full multi-project orchestration yet
- no runtime product feature work unrelated to plugin wiring

---

## 2. Why this batch matters

The repo already has a strong core:

- append-only `events.ndjson`
- derived `state.json`
- compliance artifacts
- template project structure
- test-covered event-store / scripts / secrets

The main risk is **not architecture quality**.
The main risk is that several critical guarantees still depend on assumptions that are either:

- not wired into the actual runtime,
- not aligned with current Claude/Codex plugin mechanics,
- or not retrievable by later agents even though the files exist.

This batch fixes those gaps.

---

## 3. Required work (P0)

### P0.1 — Fix Claude plugin hook packaging

### Problem
The repo currently stores hook config in:

- `claude/settings.json`

but plugin hooks are expected on the plugin surface, not as arbitrary plugin-root settings. The plugin root `settings.json` is only a narrow default-settings surface; hook config belongs in the documented hook locations.

### Why this matters
Right now the hook scripts may exist and be executable, but the plugin packaging strongly suggests that the hook config may be loaded from the wrong place or be partly ignored.

### Files involved
- `claude/settings.json`
- `claude/hooks/` scripts
- **new:** `claude/hooks/hooks.json`
- optionally `claude/.claude-plugin/plugin.json`

### What to do
Choose one of these two documented approaches and make it explicit:

#### Option A — preferred
- create `claude/hooks/hooks.json`
- move the current hook configuration from `claude/settings.json` into that file
- keep hook scripts where they are
- reduce `claude/settings.json` to only actually supported plugin-default keys, or remove it if not needed

#### Option B
- inline hook config in `claude/.claude-plugin/plugin.json`
- remove misleading config from `claude/settings.json`

### Acceptance criteria
- local validation passes for the Claude plugin
- hooks actually fire in local plugin test mode
- README/install docs no longer imply plugin hooks are loaded from the wrong place
- there is exactly **one** source of truth for Claude hook configuration

### Pushback allowed
If you think keeping hook config in `settings.json` is still valid for the current plugin API, do not just say “works for me”.
Provide:
1. the exact official reference proving it,
2. a minimal reproducible local test,
3. why `hooks/hooks.json` would be worse in this repo.

---

### P0.2 — Make the Codex side honest and installable

### Problem
`codex/` currently looks like a plugin/adapter, but it is not yet a fully installable Codex plugin surface.
It has:

- `codex/skills/...`
- `codex/automations/nightshift.json`

but no real plugin manifest.

### Why this matters
This creates false confidence: the repo reads like “Claude plugin + Codex plugin”, while the Codex side is still closer to a skill-pack / adapter.

### Files involved
- `codex/automations/nightshift.json`
- `codex/README.md`
- **new:** `codex/.codex-plugin/plugin.json`
- maybe repo-level marketplace/test wiring if you want local install testing

### What to do
Choose one of two honest paths:

#### Option A — preferred
Promote `codex/` into a **real Codex plugin**:
- add `codex/.codex-plugin/plugin.json`
- wire `skills` from the plugin manifest
- document the local install/test path clearly
- keep automations only if they serve a separate purpose

#### Option B
If you do **not** want plugin packaging yet:
- stop calling it a plugin in README/docs
- describe it explicitly as a Codex adapter / repo-local skills pack
- remove or rename misleading packaging language

### Acceptance criteria
- after reading the repo, a developer can tell whether Codex support is:
  - a real plugin,
  - or a local skill-pack
- install/test steps are accurate
- no file or README text claims a stronger integration than actually exists

### Pushback allowed
You may choose Option B for v1 **if** you explain why pluginization is premature and document the operational install path cleanly.

---

### P0.3 — Wire `dispatch.mjs` to pass the inputs Codex skills already require

### Problem
`core/scripts/dispatch.mjs` shells out to `codex exec`, but the Codex skill layer expects environment variables such as:

- `NIGHTSHIFT_TASK_CONTRACT`
- `NIGHTSHIFT_CONTEXT_PACK`
- `NIGHTSHIFT_CONSTITUTION`
- `NIGHTSHIFT_PROJECT_DIR`

The current dispatch flow describes those inputs in docs/skill prompts, but does not actually guarantee they are present when spawning Codex.

### Why this matters
This is the biggest real runtime gap in the repo.
The Codex side is described as contract-driven, but the dispatcher is not yet fully handing the contract to it.

### Files involved
- `core/scripts/dispatch.mjs`
- `codex/skills/implementer/SKILL.md`
- `codex/skills/context-packer/SKILL.md`
- tests under `core/scripts/test/` (new or existing)

### What to do
- update the Codex spawn call to pass the required env vars explicitly
- ensure all paths are absolute or resolved safely relative to the project root
- include at least:
  - task contract path
  - context pack path
  - constitution path
  - project dir
  - maybe wave/task ids if useful for evidence writing
- add tests around env plumbing or at minimum a deterministic smoke/integration check

### Acceptance criteria
- `implementer` and `context-packer` both receive the env they document
- one test proves the env contract is present when dispatch spawns Codex
- no hidden dependence on shell-global state for required NightShift paths

### Pushback allowed
If you prefer not to use env vars, you may propose an alternative input channel **only if** it is:
- deterministic,
- testable,
- documented,
- and available to both Codex skills without leaking secrets into prompts.

---

### P0.4 — Replace the health-ping resume path with a supported Claude CLI flow

### Problem
`core/scripts/health-ping.mjs` currently tries to unstick work by shelling out to Claude with a resume invocation that should be treated as suspect until validated against the current CLI surface.

### Why this matters
Night recovery is one of the core selling points of NightShift.
If resume is brittle or unsupported, overnight safety becomes marketing instead of engineering.

### Files involved
- `core/scripts/health-ping.mjs`
- maybe `scripts/install-launchd.sh`
- maybe docs/README if invocation semantics change

### What to do
- switch to a documented Claude CLI recovery path
- prove it with a local/manual repro or integration test
- if exact session targeting is required, persist the necessary session name/id in a robust place
- if resuming by session name is safer than directory-coupled invocation, encode that

### Acceptance criteria
- the recovery path uses supported CLI behavior
- local test instructions exist for “stalled task → ping → resume/unstick attempt”
- the code does not depend on undocumented flags for project selection

### Pushback allowed
If the current path is in fact correct, prove it with:
1. the current official CLI reference,
2. a reproducible command transcript,
3. and why the current implementation is reliable enough for overnight automation.

---

## 4. Recommended work (P1) — memory / retrieval layer

This is the part that currently feels missing.

The repo already records a lot of information, but much of it is **write-only**.
The next agents can often only recover it by re-reading markdown loosely, rather than querying a structured memory layer.

The recommendation here is **not** vector memory.
It is **structured operational memory**.

### P1.1 — Add machine-readable decisions memory

### Problem
Human answers and approvals are important, but they are not yet first-class retrieval objects.
A future planner/context-packer should be able to ask:
- what was decided?
- when?
- for which task/wave?
- does this supersede an earlier decision?

### Proposed addition
Add:
- `memory/decisions.ndjson`

Keep `tasks/decisions.md` if you want human readability, but make `decisions.ndjson` the retrieval-friendly log.

### Suggested event shape
```json
{
  "ts": "2026-04-19T02:44:19Z",
  "decision_id": "DEC-014",
  "type": "approval",
  "subject": "Rotate Railway production token",
  "answer": "approved",
  "scope": { "wave": 3, "task_id": "TASK-042" },
  "supersedes": null,
  "evidence_paths": ["tasks/decisions.md"]
}
```

### Why this matters
Without structured decisions memory, the system keeps asking the same questions or forgetting approved constraints.

### Acceptance criteria
- planners / context-packers can read recent relevant decisions without grepping prose
- new decisions are appended in both human-readable and machine-readable form, or one is generated from the other deterministically

---

### P1.2 — Add structured service memory

### Problem
The system provisions services and tracks deploy status, but there is no clearly retrievable project-level memory of “what live infra exists right now”.

### Proposed addition
Add:
- `memory/services.json`

### Suggested contents
- project id
- preview URL
- prod URL
- provider resource ids
- environment names
- secret refs (not secret values)
- ownership / deployment notes

### Why this matters
This becomes the operational source for deploy/check/recovery logic.
Otherwise the system has to reconstruct live infra state from scattered events and text.

### Acceptance criteria
- provisioner updates it
- status/digest can read it
- it never stores plaintext secrets

---

### P1.3 — Add incident memory

### Proposed addition
Add:
- `memory/incidents.ndjson`

### Why this matters
NightShift claims overnight resilience. That only gets smarter over time if repeated breakages become searchable structured memory.

### Suggested fields
- incident id
- symptom
- root cause
- fix
- linked task/wave
- linked evidence

---

### P1.4 — Add machine-readable reuse memory

### Problem
`REUSE_FUNCTIONS.md` is useful for humans, but weak as a retrieval layer.

### Proposed addition
Add:
- `memory/reuse-index.json`

### Suggested fields
- file
- export
- one-line purpose
- tags
- safe_to_extend
- example usage path(s)

### Why this matters
This directly attacks duplicate abstractions.
It also makes `context-packer` better.

---

### P1.5 — Actually use memory in planning/packing

### Problem
Even where useful memory already exists, later stages do not consistently read it.

### Minimum fix
Update:
- context packing
- planning
- maybe analyzer

to explicitly consult:
- `memory/constitution.md`
- `memory/learnings.md`
- **new** `memory/decisions.ndjson`
- **new** `memory/services.json`
- **new** `memory/reuse-index.json`

### Acceptance criteria
A later task can inherit prior decisions and infra reality **without** re-asking or rediscovering them manually.

### Pushback allowed
If you think NDJSON/JSON files are too much for v1, propose a smaller retrieval layer.
But the alternative must still satisfy:
- machine-readable
- append-safe or projection-safe
- queryable by scripts/skills
- easy to diff and inspect in git

---

## 5. Nice-to-have / defer unless cheap (P2)

### P2.1 — Global multi-project registry
Add a NightShift home-level registry, e.g.:
- `~/.nightshift/registry/projects.json`

Not required for this batch, but it is the first bridge from “one project overnight” to “many projects from one control plane”.

### P2.2 — Reconcile `codex/automations/nightshift.json`
If Codex plugin packaging is adopted, decide whether this file remains:
- as runtime automation config,
- or is folded into plugin setup,
- or is removed as premature abstraction.

### P2.3 — Install-time validation
The top-level install flow should ideally validate:
- Claude plugin structure
- Codex plugin/skill-pack structure
- required executables
- self-test status

---

## 6. What can be removed or simplified

These are not mandatory removals, but should be evaluated during implementation.

### Candidate simplification A — reduce packaging ambiguity
If Codex pluginization is deferred, remove packaging language that implies a complete plugin exists today.

### Candidate simplification B — avoid duplicate truth for hooks
Do not keep the same hook config in multiple places.
Choose one authoritative location.

### Candidate simplification C — avoid memory bloat
Do not add embeddings/vector memory in this batch.
The system first needs good structured retrieval memory, not a fuzzy memory layer.

---

## 7. Deliverables

At the end of this task, I expect:

1. **Code changes** implementing the selected P0 fixes.
2. A short **ADR-style summary** in `docs/` or `tasks/` explaining:
   - what was changed,
   - what was intentionally deferred,
   - what remains debatable.
3. Updated **install / usage docs** that match reality.
4. At least one **integration-level validation path** for:
   - Claude hooks loading
   - Codex dispatch env plumbing
   - health-ping resume flow
5. A proposal or implementation for the **P1 memory retrieval layer**.
   - Full implementation is great.
   - A concrete schema + partial wiring is acceptable if clearly documented.

---

## 8. Suggested acceptance checklist

### Required before merge
- [ ] Claude plugin hooks use a documented plugin surface
- [ ] `claude/settings.json` no longer pretends to configure unsupported plugin keys
- [ ] Codex support is honestly packaged/documented
- [ ] `dispatch.mjs` passes required NightShift env inputs to Codex runs
- [ ] health-ping resume path is supported and tested
- [ ] install docs match the actual integration surfaces

### Strongly recommended in same batch
- [ ] machine-readable decisions memory added
- [ ] machine-readable services memory added
- [ ] context-packer reads decisions/services/learnings/reuse memory
- [ ] no plaintext secrets introduced into memory files

---

## 9. How to challenge these recommendations

I want pushback to be possible, but it must be grounded.

If you disagree with any item in this brief, answer in this format:

### Challenge template
- **Item challenged:**
- **Why the current brief is wrong or too heavy:**
- **Evidence:** code path, docs, or runtime behavior
- **Safer/smaller alternative:**
- **Trade-off introduced:**
- **Why that trade-off is acceptable for v1:**

Good pushback examples:
- “pluginizing Codex now adds more ceremony than value; adapter mode is enough for v1 if docs are corrected”
- “`decisions.ndjson` is overkill if we derive it deterministically from a constrained markdown format”
- “health-ping should not resume Claude sessions at all; it should enqueue a human-visible recovery request instead”

Bad pushback examples:
- “seems unnecessary”
- “works on my machine”
- “we can do that later” without identifying what breaks in the meantime

---

## 10. Suggested implementation order

1. Fix Claude plugin hook packaging
2. Make Codex packaging honest (plugin or adapter)
3. Wire `dispatch.mjs` env plumbing
4. Fix and test health-ping resume flow
5. Add `memory/decisions.ndjson`
6. Add `memory/services.json`
7. Teach context-packer / planner to read the new memory
8. Decide what to defer to the next batch

---

## 11. Short summary for the developer

NightShift already has a good brain.
This task is **not** asking for a rewrite.
It is asking you to:

- align the plugin surfaces with current Claude/Codex mechanics,
- close the biggest runtime integration gaps,
- and add the missing structured memory layer so the system can remember decisions and live infra state in a retrievable way.

That should make the project much more trustworthy without changing its core philosophy.
