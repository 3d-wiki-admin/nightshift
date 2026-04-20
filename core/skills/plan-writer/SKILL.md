---
name: plan-writer
description: Use after spec-writer/intake-interview accepted the spec (invoked by /plan). Produces tasks/plan.md + tasks/research.md + tasks/data-model.md + tasks/contracts/API.md. Reads spec + constitution + retrieval memory; never invents scope.
---

# plan-writer

> Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING.

## Inputs
- `memory/constitution.md` — hard rules (MUST read first).
- `tasks/spec.md` — what we're building.
- `tasks/questions.md` — open questions (do not assume answers).
- **Retrieval memory** (first-class inputs — v1.1, MUST read before writing):
  - `memory/decisions.ndjson` — prior architectural/stack/policy decisions. New plan MUST NOT silently contradict these.
  - `memory/reuse-index.json` — existing reusable symbols. The plan must route through them, not reinvent.
  - `memory/services.json` — live infra state. Planning that assumes a provider must reference its `services.json` record (or declare that provisioning is required).
  - `memory/incidents.ndjson` — prior failures. Plan MUST include preventive steps for any relevant prior incident.

  **Required call before writing plan.md:**
  ```bash
  nightshift memory-retrieve "$PROJECT" --include decisions,reuse,services,incidents
  ```
  Treat the output as first-class — cite decision ids in plan.md where applicable.

## Outputs (all four required)

### `tasks/plan.md`
Structure:
```markdown
# Plan — <project>

## Architecture (one paragraph + diagram if useful)
## Feature decomposition (must-not-miss from spec → list of features)
## Phases (P0, P1, P2) — grouped into waves later
## Decisions consulted
- dec_abc123 — "use Supabase RLS" (memory/decisions.ndjson). Plan honors this by: ...
- dec_def456 — "no new top-level deps without approval". Plan avoids new deps where possible.
## Reuse plan
- lib/supabase/server.ts:supabaseServer — reused for all server-side reads (see reuse-index).
- lib/x.ts:y                              — reused for ...
## Risks
## Dependencies (infra, libraries, keys)
- Reference services.json entries where the provider is already set up.
## Testing strategy
## Preventive measures (from memory/incidents.ndjson)
- inc_xxx — Playwright timed out on cold dev server → smoke uses `next start` on port 3001.
```

### `tasks/research.md`
For each unfamiliar library, stack choice, or non-trivial decision: one section with:
- Question
- Options considered (≥2)
- Recommendation + one-line rationale
- Sources (URLs)

Use WebFetch for anything library-specific. Do not claim to know APIs without checking.

### `tasks/data-model.md`
Entities, relationships, fields with types, indexes. Match the stack (e.g. SQL for Supabase).

### `tasks/contracts/API.md`
Every API route: method, path, request schema, response schema, errors. Zod shape if Next.js + TS.

## Events to append
- `decision.recorded` for each concrete **new** decision. Also persist via:
  ```bash
  nightshift memory-record "$PROJECT" decision --subject "<one-line>" --answer "<what was chosen>" --kind architecture|stack|policy --notes "rationale"
  ```
  Both the event log AND the memory ndjson must carry each real decision — the event log is canonical, memory is the retrieval surface.
- `question.asked` for each unresolved fork.

## Guardrails
- **Do not add scope not in the spec.** If you find missing scope, file a question — do NOT extend the spec.
- **Constitution overrides plan.** If a planning choice would violate the constitution, stop and surface it.
- **Decisions in memory override plan.** If an earlier `decisions.ndjson` entry settles a question, honor it; do not re-litigate. If you disagree, write a `supersedes: <old-id>` decision explaining why.
- **Research is required for libs you haven't used recently** — do not fabricate API shapes.
- **Reuse first.** If `reuse-index.json` has an entry that fits, plan to use it. Create a new helper ONLY if no existing entry applies.
- **NEVER write `memory/*.{ndjson,json}` directly** with Write/Edit/MultiEdit/NotebookEdit. All persisted memory state (decisions, incidents, services, reuse-index) flows through the `nightshift memory-record` CLI. Raw writes corrupt the append-only + atomic invariants.
- **NO LYING OR CHEATING.** Cite sources and decision ids. If you guessed, say you guessed in notes.
