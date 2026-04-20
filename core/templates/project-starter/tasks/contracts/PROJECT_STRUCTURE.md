# Project structure

<!-- Updated by post-task-sync when top-level folders change. Do not edit by hand. -->

```
<project>/
├── app/                # Next.js 15 App Router pages, layouts, route handlers
├── lib/                # shared server/client helpers
│   └── supabase/       # Supabase client factories
├── public/             # static assets
├── supabase/           # migrations, SQL (managed by infra-provisioner)
├── scripts/            # smoke.sh and project-local tooling
├── tests/              # vitest + playwright
├── memory/             # agent-readable state (retrieval memory, v1.1)
│   ├── constitution.md          # non-negotiables (read first)
│   ├── learnings.md             # human narrative (optional)
│   ├── decisions.ndjson         # architecture/stack/policy decisions (append-only)
│   ├── incidents.ndjson         # prior failures + fixes (append-only)
│   ├── services.json            # live infra state (URLs, refs; NEVER secret values)
│   └── reuse-index.json         # machine-readable reuse catalog
├── tasks/              # canonical agent workspace (see NIGHTSHIFT spec §10)
│   ├── spec.md
│   ├── plan.md
│   ├── research.md
│   ├── data-model.md
│   ├── contracts/
│   ├── waves/
│   ├── events.ndjson   # canonical log (append-only)
│   ├── state.json      # projection (derived)
│   ├── compliance.md   # audit (derived)
│   ├── decisions.md
│   ├── questions.md
│   └── paused.md
├── .env.template
├── next.config.mjs
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## Retrieval memory conventions (v1.1)

All four `memory/*.{ndjson,json}` files are read as first-class inputs by
`context-packer`, `plan-writer`, and `wave-orchestrator`. They MUST only be
written through the `nightshift memory-record` CLI (never `Write`/`Edit`).

| File | Shape | Writer |
|---|---|---|
| `decisions.ndjson` | append-only; `{ id, ts, kind, subject, answer, supersedes, ... }` | `nightshift memory-record decision` |
| `incidents.ndjson` | append-only; `{ id, ts, symptom, root_cause, fix, evidence, ... }` | `nightshift memory-record incident` |
| `services.json` | atomic; `{ schema_version, providers: { vercel: {...}, supabase: {...} } }` | `nightshift memory-record service` |
| `reuse-index.json` | atomic; `{ schema_version, entries: [{ file, symbol, purpose, tags, ... }] }` | `nightshift memory-record reuse` |

Retrieve relevant slices for a task with:
```bash
nightshift memory-retrieve "$PROJECT" --query "<task keywords>" --markdown
```
