# &lt;project&gt;

Scaffolded by [nightshift](https://github.com/3d-wiki-admin/nightshift).

## Setup

```bash
pnpm install
cp .env.template .env.local        # then fill real values via your SecretBackend
pnpm dev
```

## Agent-driven development

This repo is designed to be built by AI agents under nightshift discipline:

- `memory/constitution.md` — agents must read this before every action.
- `tasks/spec.md`, `tasks/plan.md` — product + design.
- `tasks/events.ndjson` — canonical audit log (append-only).
- `tasks/compliance.md` — human-readable audit generated from the log.

See CLAUDE.md for workflow details.
