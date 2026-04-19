# Reuse catalog

<!-- Appended by post-task-sync. Check BEFORE creating any helper > 10 LOC (see constitution §3). -->

| File | Symbol | Purpose |
|---|---|---|
| `lib/supabase/server.ts` | `supabaseServer()` | Server-side Supabase client (SSR cookies) |
| `lib/supabase/client.ts` | `supabaseBrowser()` | Browser-side Supabase client (singleton) |
