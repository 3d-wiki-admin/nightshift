# Walkthrough (script for the "first overnight run" demo)

Scene: user wants to build a shared grocery list. They already have Claude Code installed. It's 23:00.

## 0. Install nightshift (one-time)

```
$ git clone https://github.com/3d-wiki-admin/nightshift ~/.nightshift
$ cd ~/.nightshift && ./scripts/install.sh
[install] nightshift at /Users/user/.nightshift
[install] installing node deps...
[install] Claude Code plugin lives at: /Users/user/.nightshift/claude
          After starting Claude Code, run: /plugin install /Users/user/.nightshift/claude
[install] installing launchd agents...
[launchd] installing for project: /Users/user/.nightshift
  wrote /Users/user/Library/LaunchAgents/ai.nightshift.pinger.plist
  wrote /Users/user/Library/LaunchAgents/ai.nightshift.digest.plist
[install] core self-test: OK
```

Inside Claude Code:
```
> /plugin install /Users/user/.nightshift/claude
```

## 1. Bootstrap project (23:05)

The recommended entry point (v1.1+) is `nightshift init`, which registers
the project at stage=intake and hands back exactly one command to paste:

```
$ nightshift init ~/dev/groceries
  ✓ doctor prerequisites satisfied
  ✓ project registered     ns_…
  ✓ minimal meta scaffold  (4 files)
  — full scaffold will run AFTER intake approval

Project:  /Users/user/dev/groceries
Stage:    intake

Next (copy-paste one command):
  cd /Users/user/dev/groceries && claude "/nightshift intake --project /Users/user/dev/groceries"
```

Paste it; the Claude session opens in the project dir and jumps straight
into the intake interview. `/nightshift confirm-scaffold` after approval
runs the real scaffold (template copy, memory snapshot, retrieval memory
seeding, `git init -b main` + initial commit).

Output after `/nightshift confirm-scaffold`:
```
✓ memory/constitution.md (template + intake snapshot)
✓ tasks/{spec,plan,data-model,research}.md
✓ tasks/contracts/{TASK_TEMPLATE,REVIEW_DIMENSIONS,...}.md
✓ .env.template, .github/workflows/ci.yml, CLAUDE.md, README.md
✓ memory/{decisions,incidents}.ndjson + memory/{services,reuse-index}.json (seeded)
✓ tasks/events.ndjson (intake-approval recorded exactly once)
✓ git init -b main + initial commit (`chore: nightshift scaffold`)
```

Legacy `/bootstrap` still exists as a repair command — use it only to
re-seed a project whose files were accidentally deleted.

## 2. Spec interview (23:10)

```
> /nightshift start

spec-writer: "What are we building?"
user:        "A shared grocery list — roommates add items, everyone sees."
spec-writer: "Who is the primary user?"
user:        "My two roommates and me."
spec-writer: "Single most important thing it must do?"
user:        "Sync in real-time across phones."
spec-writer: "Explicitly out of scope? (≥2 items)"
user:        "No recipes, no price tracking, no store integrations."
spec-writer: "Hard constraints?"
user:        "Free tier only. Supabase + Vercel. No native app."
spec-writer: "Success criteria at wake-up?"
user:        "I can add a banana from my phone and my roommate sees it."
spec-writer: "Got it. Writing memory/constitution.md and tasks/spec.md."

✓ memory/constitution.md
✓ tasks/spec.md  (must-not-miss: add items, sync across devices)
events: session.start, decision.recorded × 5
```

## 3. Plan (23:15)

```
> /plan

plan-writer reading spec...
plan-writer: WebFetching Supabase Realtime docs...
plan-writer: WebFetching Next.js 15 App Router caching docs...

✓ tasks/plan.md (P0=skeleton, P1=CRUD+realtime, P2=auth polish)
✓ tasks/research.md (3 decisions cited with URLs)
✓ tasks/data-model.md (items table + RLS policy)
✓ tasks/contracts/API.md (POST /api/items, GET /api/items, DELETE /api/items/[id])
events: decision.recorded × 4, question.asked × 1 (auth mechanism — Supabase magic links?)
```

## 4. Decide pending question (23:18)

```
> /decide "Use Supabase magic links" --for Q-01

✓ appended to tasks/decisions.md
✓ decision.recorded event appended
✓ state rebuilt — Q-01 removed from open_questions
```

## 5. Analyze (23:20)

```
> /analyze

analyzer (Sonnet) read-only walk of spec ↔ plan ↔ constitution ↔ API...

tasks/analysis-20260419T2320Z.md
  CRITICAL: 0
  WARNING:  1 — data-model §items.created_by uses uuid but API.md §POST /items doesn't specify who sets it

Pipeline halt: no. Proceed to /tasks.
```

## 6. Decompose into wave 1 (23:22)

```
> /tasks

task-decomposer:
  wave 1 — 5 tasks
    G1-001  safe           [P]  gpt-5.4        Scaffold app/layout + page
    G1-002  safe           [P]  gpt-5.4        Create items Supabase migration (app/api/_infra only)
    G1-003  review-req          gpt-5.3-codex  POST/GET /api/items (app/api/items/route.ts)
    G1-004  review-req          gpt-5.3-codex  items list UI (app/page.tsx)
    G1-005  approval-req        gpt-5.3-codex  Deploy preview to Vercel    ← BLOCKED until /decide

events: wave.planned, task.contracted × 5
```

## 7. Preflight and sleep (23:25)

```
> /preflight

preflight for: /Users/user/dev/groceries
  ✓ memory/constitution.md present
  ✓ tasks/spec.md present
  ✓ tasks/events.ndjson writable
  ✓ git tree clean
  ✓ node v22
  ✓ codex CLI present
  ✓ pinger launchd agent loaded
  ✓ no open questions
  ✓ no paused tasks

preflight: 9 ok  0 warn  0 fail

GO. Safe to sleep.
```

```
> /implement
```

Orchestrator starts dispatching tasks. User closes laptop lid.

## 8. Overnight (between runs)

- Every 30 min: `ai.nightshift.pinger` runs. If a task went stale >15 min, it invokes `claude --continue` (cwd = project dir) to unstick. If that exits non-zero, the pinger emits `session.paused` and, after 3 consecutive failures, writes the task into `tasks/paused.md` with a recovery command.
- At 08:00: `ai.nightshift.digest` writes `~/.nightshift/digest/2026-04-20.md` with: accepted tasks, paused tasks, token ledger, open questions. `say "Digest is ready"` plays.

## 9. Morning (08:15)

User reads digest:

```
# nightshift digest — 2026-04-20

Project: groceries
Events in last 12h: 134
Overnight tokens: 412k   |   cost: $1.82

## Accepted (4)
- G1-001
- G1-002
- G1-003
- G1-004

## Paused (0)

## Preview URLs (0)
(G1-005 blocked on approval — see /questions)

## Open questions (1)
- Q-02  "Deploy to Vercel preview?" — approval-required for G1-005
```

## 10. Unblock deploy (08:20)

```
$ claude
> /questions

Open questions (1):

Q-02 — "Deploy to Vercel preview?"
    asked: 02:14Z  by infra-provisioner  about task G1-005
    "Vercel project exists. Creating preview will expose current branch
     publicly via <uuid>.vercel.app. Approve?"

Answer via `/decide "..." --for Q-02`.
```

```
> /decide "yes approved for preview only" --for G1-005

✓ decision.recorded
✓ G1-005 unblocked for next /implement
```

## 11. Finish and open preview

```
> /implement
```

G1-005 runs: infra-provisioner WebFetches Vercel docs, runs preflight, creates preview, writes preview URL to state. doc-syncer adds to FEATURE_INDEX.

```
✓ G1-005 accepted
  preview: https://groceries-<uuid>.vercel.app
  evidence: tasks/waves/1/G1-005/evidence/preview.url

/status:

=== nightshift - groceries ===
Session sess_01KPJZ...  uptime 9h  zone green  last-event 42s ago

PIPELINE
  ✓ intake     (session.start{stage:intake})
  ✓ scaffold   (decision.recorded{kind:intake_approval})
  ✓ plan       (plan.completed)
  ✓ analyze    (analyze.completed)
  ✓ tasks      (task.contracted)
  ✓ implement  (task.dispatched)
  ◐ accept     (wave.accepted)
  ◌ deploy     (task.accepted{task_id~/(deploy|prod|ship|release)/i})

WAVES
  Wave 1  ✓ accepted  [####################] 100% [5/5]

BUDGET
  in 412,000   out 40,000   cached 0
  ~$1.82 (24h) / ~$1.97 (all-time)
```

User opens the preview URL on their phone, types "banana", roommate's phone shows it. Success criteria met.

That's the walkthrough.
