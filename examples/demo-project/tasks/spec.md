# Spec — demo (frozen fixture)

## 1. Problem
Make a minimal "hello" app that exercises the nightshift pipeline end-to-end.

## 2. Primary user
The nightshift docs reader — this project exists to demonstrate, not to ship.

## 3. Must-not-miss features
- Page that renders "hello, <name>".
- Name persisted to localStorage (no backend).

## 4. Out of scope
- Auth.
- Backend.
- Multi-user.

## 5. Constraints
- Next.js 15 App Router, client components only.
- No external deps beyond the starter.

## 6. Success criteria at wake-up
- `pnpm build && pnpm smoke` passes.
- Preview URL renders the page.
