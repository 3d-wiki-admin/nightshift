# Plan — demo (fixture)

## Architecture
Single client page (`app/page.tsx`) with a name input bound to localStorage.

## Phases
- P0: scaffold + page (wave 1)
- (no further phases in this fixture)

## Risks
None.

## Dependencies
Template-provided only.

## Testing strategy
- vitest for the localStorage helper.
- Playwright smoke: enter name, reload page, name persists.
