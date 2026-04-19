# core/schemas

JSON Schemas (draft-07) for the canonical data shapes used by nightshift.

| File | Purpose |
|---|---|
| `event.schema.json` | One line of `events.ndjson` (the append-only canonical log). |
| `state.schema.json` | `state.json` — materialized projection. Never hand-edited. |
| `contract.schema.json` | Task contract frontmatter (YAML parsed). |
| `manifest.schema.json` | `tasks/waves/<N>/manifest.yaml`. |
| `costs.json` | Unit cost table (USD per 1M tokens). Not live-fetched. |

All schemas are validated via `ajv` in the event store and dispatch layer. If a write fails validation, it is rejected — callers must fix the payload, not the schema.
