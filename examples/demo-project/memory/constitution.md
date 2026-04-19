# Constitution — demo

## 1. Stack
- Frontend: Next.js 15 + TypeScript strict + Tailwind.
- Backend: Supabase (Postgres + RLS + Auth).
- Deploy: Vercel.
- Package manager: pnpm 10+.

## 2. Forbidden
- Secrets in repo.
- Files > 500 lines.
- Bypassing Supabase RLS.
- Writing directly to events.ndjson.

## 3. Required
- Every API route has a Zod input + output schema.
- Every feature has a smoke path in CI.
- Reuse-check before creating any helper > 10 LOC.
- "NO LYING OR CHEATING" literal in every implementer/reviewer prompt.

## 4. Constraints
- TS strict on.
- No new top-level dep without approval-required task.
