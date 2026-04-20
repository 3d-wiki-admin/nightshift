---
description: Create or rotate infra resources (Vercel, Supabase, Railway, Redis). Always approval-required. Dry-run by default; pass --execute to actually create.
argument-hint: "<service> [--name <n>] [--<k> <v>] [--execute]  |  rotate <service> <resourceId> <key> [--execute]  |  docs <service>"
---

Invoke the `infra-provisioner` subagent via the Task tool.

Before anything: the subagent MUST WebFetch the adapter's docs URL (returned by `docs <service>`). This is non-negotiable per spec §18 / §6 table / infra-provisioner skill.

Parse $ARGUMENTS:
- `<service>` — vercel | supabase | railway | redis
- Optional: `--name`, `--region`, `--org-id`, `--db-password` (read from SecretBackend, never literal), `--execute`.
- Or `rotate <service> <resourceId> <key>`.
- Or `docs <service>` (print docs URL only).

Pre-checks:
1. Unless `docs <service>`: the task driving this must be `approval-required` AND have a matching `decision.recorded` event for its `task_id`. If not → STOP, emit `question.asked`, tell the user to `/decide "approved" --for <task-id>`.
2. `preflight()` on the adapter (CLI present, logged in). If not → surface remediation.
3. WebFetch the docs URL; include the URL in the task's `result.md`.

Then shell out:
```bash
nightshift provision $ARGUMENTS
```

Without `--execute`, the adapter runs in DRY-RUN and emits `infra.provisioned` with `dry_run: true`. With `--execute`, real CLI calls happen and secrets land in the active SecretBackend. Plaintext secret values NEVER appear in chat, events, result.md, or logs.

Post-action:
- Run `nightshift infra-audit .` to refresh `tasks/infra-audit.ndjson`.
- Print what was created/rotated (IDs and refs — no secret values).
- Print recommended follow-up: consumers to update (Vercel env, GH Actions secrets), grace period before old-key revoke (default 24h).

User args: $ARGUMENTS
