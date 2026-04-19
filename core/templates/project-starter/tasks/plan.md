# Plan — <project>

<!-- Fill by the plan-writer skill after /plan. -->

## Architecture
_(one paragraph — component boundaries, data flow)_

## Feature decomposition
_(map must-not-miss features from spec → implementable units)_

## Phases
- P0 — skeleton and golden path
- P1 — features
- P2 — polish

## Risks
_(known hard problems)_

## Dependencies
- Infra: Supabase project, Vercel project
- Libraries: zod, @supabase/ssr

## Testing strategy
- Unit: vitest for lib/
- E2E smoke: Playwright via scripts/smoke.sh
