---
description: Run the deploy pipeline for the current project. Always approval-required per spec §26; every deploy task must carry decision.recorded.
argument-hint: "[--for-task <TASK-ID>] [--env production|preview]"
---

Deploy the current project. This command does NOT bypass the approval gate — every deploy task is `approval-required` per spec §26, and `provision.mjs --execute` refuses without a matching `decision.recorded` event for the task_id.

> Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING.

## Preconditions
1. The current wave must be `accepted` (all tasks in it passed review and hard gates). Check `state.json`.
2. A deploy task_id must exist with `risk_class: approval-required` in the manifest.
3. `/decide "approved" --for <DEPLOY-TASK-ID>` must have been recorded. If not, refuse and surface the question.

## Flow

1. **Preflight.** Run `nightshift preflight "$PWD"`. Exit code must be 0 or 2 (warn). Refuse on 1 (halt).
2. **Resolve target.** Determine the deploy task_id for this wave. Usually the last-in-manifest task with `approval-required`.
3. **Verify decision.** Grep the log:
   ```
   node -e 'const fs=require("fs"); const l=fs.readFileSync("tasks/events.ndjson","utf8").split("\n").filter(Boolean).map(JSON.parse); process.exit(l.some(e=>e.action==="decision.recorded"&&e.payload?.task_id==="<TASK-ID>")?0:1)'
   ```
   If the decision is missing, emit `question.asked` and STOP.
4. **Invoke `infra-provisioner` subagent** (via Task tool) with the deploy target. It MUST:
   - WebFetch the platform's deploy docs before acting.
   - Run dry-run (no `--execute`) and show the plan.
   - Only run `--execute --for-task <TASK-ID>` after a visible plan.
5. **Evidence.** The subagent writes preview URL (if any) to `tasks/waves/<N>/<TASK-ID>/evidence/preview.url` and records `infra.provisioned`.
6. **Post-deploy.** Invoke `doc-syncer` to refresh `state.json`, `compliance.md`, `FEATURE_INDEX`.

## Guardrails
- No plaintext secrets in deploy logs, result.md, or events. Use SecretBackend refs.
- No autorevoke of old keys during rotation. Grace period (default 24h) is recorded in `tasks/decisions.md`.
- No production target without explicit `--env production` AND approval.

User args: $ARGUMENTS
