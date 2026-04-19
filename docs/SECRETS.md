# Secrets

nightshift never stores secret plaintext in the project repo. Placeholders live in `.env.template`; values are resolved at runtime via a `SecretBackend`.

## Backends

### LocalFolderBackend (default)

- Location: `~/.nightshift/secrets/<project>/.env`
- Permissions: `0600`
- Write via `b.write(project, key, value)`.
- Rotation audit log: `~/.nightshift/secrets/<project>/rotation.log`.

### OnePasswordBackend (opt-in)

- Activated by `NIGHTSHIFT_SECRET_BACKEND=1password`.
- Requires the `op` CLI (`brew install --cask 1password-cli`), signed in to your account.
- Vault: `nightshift` (default — override by editing `core/secrets/onepassword-backend.mjs`).
- Item path: `op://nightshift/<project>/<key>`.

## `.env.template` format

```env
NEXT_PUBLIC_SUPABASE_URL={{SECRET:NEXT_PUBLIC_SUPABASE_URL}}
NEXT_PUBLIC_SUPABASE_ANON_KEY={{SECRET:NEXT_PUBLIC_SUPABASE_ANON_KEY}}
SUPABASE_SERVICE_ROLE_KEY={{SECRET:SUPABASE_SERVICE_ROLE_KEY}}
```

## Runtime resolution

```bash
core/scripts/run-with-secrets.sh <command>
```

Reads `.env.template` in CWD, resolves every `{{SECRET:KEY}}` via the active backend, exports resolved vars, and execs `<command>`.

## Rotation runbook

The `infra-provisioner` skill performs key rotations. User-driven trigger:

```
/provision rotate <service> <resourceId> <key>
```

Steps the skill runs (see `core/skills/infra-provisioner/SKILL.md` §5):

1. WebFetch the provider's docs (non-negotiable — APIs change).
2. Call the provider CLI to generate a new key.
3. Write new key to the active `SecretBackend` with `meta.rotatedFrom = <oldRef>`.
4. Update consumers: Vercel env, GitHub Actions secrets, any other in `contract.post_task_updates`.
5. Deploy consumers.
6. Wait `grace_hours` (default 24) — record the planned old-key revoke time in `tasks/decisions.md`.
7. After grace period, revoke the old key and emit `infra.rotated` with `{service, key, oldRef, newRef}`. Never the value.

## Constitutional rules (from target project `memory/constitution.md` template)

- Secrets in repo (including `.env.local`) are forbidden.
- Every new secret added requires an `approval-required` task.
- Any event that carries a secret value is a CRITICAL violation. Values are refs; refs are opaque.

## Exposed secret incident

If a secret leaks:

1. Immediately `/provision rotate` the affected key.
2. Scan the log: `grep -E '(secret|key|token|password)' tasks/events.ndjson` — if anything suspicious, **the log cannot be edited**. Quarantine the project (do not push), export a redacted snapshot, and decide with the user whether to continue.
3. File a CRITICAL `question.asked` for the user.
