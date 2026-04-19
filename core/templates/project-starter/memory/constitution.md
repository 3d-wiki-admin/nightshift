# Constitution — <project>

> The non-negotiable rules for this project. Every agent reads this before acting. Violations are logged as CRITICAL events.
> Edit this file carefully. Changes mid-project require re-running `/analyze`.

## 1. Stack
- Frontend: Next.js 15 (App Router) + TypeScript strict + Tailwind CSS.
- Backend: Supabase (Postgres + RLS + Auth + Storage).
- Deploy: Vercel.
- Package manager: pnpm 10+.
- Node: 22+.

## 2. Forbidden
- Secrets in the repo (including `.env.local`). Use `.env.template` with `{{SECRET:KEY}}` placeholders.
- Files larger than 500 lines.
- Any code that bypasses Supabase Row-Level Security.
- Auto-generated migrations committed without human review (approval-required).
- Deleting `events.ndjson` or editing past lines (log is append-only).
- Marking a task accepted without all applicable hard gates passing.

## 3. Required
- Every API route has a Zod input schema and a Zod output schema.
- Every feature has at least one smoke path exercised in CI.
- Reuse-check before creating any helper > 10 lines (see `tasks/contracts/REUSE_FUNCTIONS.md`).
- TypeScript `strict: true`.
- `NO LYING OR CHEATING` in every implementer and reviewer prompt (literal).

## 4. Constraints
- No new top-level runtime dependency without an `approval-required` task.
- No silent broadcast to users (email/push) without a `decision.recorded` entry.
- No production deploy without an `approval-required` task and recorded approval.
