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
├── memory/             # constitution + learnings
│   ├── constitution.md
│   └── learnings.md
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
