# Contributing

## Principles

1. **No feature not in the spec. No feature in the spec skipped.** The spec (`NIGHTSHIFT_MASTER_SPEC.md`) is frozen for v1.0. Changes require a PR that lands in `/constitution.md` first.
2. **Follow the spec's own discipline.** Use task contracts, hard gates, evidence, and dimension reviews on your own work. Yes, for nightshift itself too.
3. **Don't over-abstract.** Three similar lines is better than a premature helper.

## Dev setup

```bash
git clone https://github.com/3d-wiki-admin/nightshift
cd nightshift
pnpm install
pnpm test                          # 41+ unit tests
./scripts/install.sh               # self-test, optional
```

Requires: Node ≥ 22, pnpm ≥ 10, git, bash. macOS for launchd.

## Running tests

```bash
pnpm test                                        # all
pnpm test:event-store                            # core/event-store/test
pnpm test:scripts                                # core/scripts/test
node --test core/provisioners/test/*.test.mjs    # provisioners
node --test core/secrets/test/*.test.mjs         # secrets backends
```

All tests use Node's built-in test runner. No external framework.

## Conventions

- **ESM only** (`"type": "module"`). Node ≥ 22.
- **No TypeScript in `core/`** — plain JS/ESM for portability. TS lives only in target project **templates** under `core/templates/`.
- **Shell scripts**: `#!/usr/bin/env bash`, `set -euo pipefail`. Avoid zsh-isms.
- **Event action names**: `<domain>.<verb_past_tense>` (e.g. `task.accepted`, `gate.passed`).
- **No comments explaining WHAT** code does. Comments only when WHY is non-obvious.
- **No backwards-compat hacks** for v1. Ship the right shape; migrate later.

## Adding an event action

1. Add the enum value to `core/schemas/event.schema.json` `action.enum`.
2. Handle the action in `core/event-store/src/projection.mjs` if it mutates state.
3. Add a projection test in `core/event-store/test/projection.test.mjs`.
4. Document it in `NIGHTSHIFT_MASTER_SPEC.md` §11.1.

## Adding a provisioner adapter

1. Create `core/provisioners/<service>.mjs` implementing the `BaseProvisioner` interface.
2. Add it to the registry in `core/provisioners/index.mjs`.
3. Add a test in `core/provisioners/test/<service>.test.mjs`.
4. Update `docs/SECRETS.md` and `docs/ARCHITECTURE.md`.

## PR checklist

- [ ] Tests pass locally (`pnpm test`).
- [ ] No new top-level dependency without discussion (constitution §3).
- [ ] No plaintext secrets in diff.
- [ ] Every new skill includes the "NO LYING OR CHEATING" clause where applicable.
- [ ] `CHANGELOG.md` updated.
