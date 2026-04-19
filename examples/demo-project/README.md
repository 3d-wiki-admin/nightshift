# demo-project (fixture)

A frozen snapshot of a nightshift-driven project at the end of wave 1.

This folder is CHECKED IN as a demonstration — it is not meant to be run.
It illustrates:

- `memory/constitution.md` filled in.
- `tasks/spec.md`, `tasks/plan.md` with real content.
- `tasks/waves/1/manifest.yaml` + three task contracts.
- `tasks/events.ndjson` with the full lifecycle (session.start → wave.accepted).
- `tasks/state.json` projected from the log.
- `tasks/compliance.md` regenerated from the log.

To see the replay behavior:

```bash
node ../../core/scripts/replay-events.mjs tasks/events.ndjson --compact
```

To regenerate compliance.md:

```bash
node ../../core/scripts/compliance-reporter.mjs .
```
