# Result — DEMO_001

## Summary
- Added `lib/name-store.ts` with `getName()`/`setName()` backed by `localStorage`.
- Converted `app/page.tsx` to a client component using the store and rendering `hello, <name>`.
- Added debounced persistence on input change.

## Files changed
- app/page.tsx (+32 / -4)
- lib/name-store.ts (+24 / -0)

## Verification
- tests: PASS — evidence/tests.txt
- types: PASS — evidence/types.txt
- lint: PASS — evidence/lint.txt
- build: PASS — evidence/build.txt
- smoke: N/A (no deploy in this fixture)

## Follow-ups
- None.
