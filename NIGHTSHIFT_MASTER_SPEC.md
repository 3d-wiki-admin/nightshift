# nightshift — Master Product Specification

> **Status:** v1.0 (frozen for build). Any amendment must be done via PR that lands in `/constitution.md` of the `nightshift` repo.
> **Owner:** @ksokolovsky
> **Purpose of this doc:** single authoritative source used by Claude Code / Codex to build the plugin overnight without further clarification. Read top-to-bottom before touching code.

---

## 0. How to use this document

This file is a **build brief**, not a marketing description. Every section is load-bearing. If something seems ambiguous, **stop and open `questions.md` in the build directory** — do not guess.

Two rules:
1. **No feature not listed here. No feature listed here skipped.** Scope is frozen for v1.0.
2. **Build order follows Section 24 (Build Roadmap).** Do not start a later wave before the previous is accepted.

---

## 1. Vision

**nightshift** is a multi-agent development plugin. You describe a project in chat, sleep, and wake up to a reviewed, deployed, documented implementation with an audit trail that proves the agents followed the rules.

It is **not** a general chatbot, **not** a no-code builder, and **not** an autonomous IDE. It is a **production-discipline harness** on top of Claude Code + Codex CLI that enforces:

- contracts before code;
- hard gates before acceptance;
- evidence before trust;
- event log before any mutable state.

It must be **boring and predictable**. If a choice is between "clever" and "auditable", pick auditable.

### Primary user
Solo founder / senior engineer running 3–10 parallel B2C projects, already using Claude Code and Codex, already comfortable with worktrees, git, and CLI tooling. Not a beginner. Values control, observability, and reproducibility over UX polish.

### Primary use case
> "I have an idea for a service for X. Let's brainstorm in chat. When I say go, you execute end-to-end: repo, architecture, UI, backend, deploy, smoke. I sleep. I wake up to a dashboard showing what you did, what's pending my approval, what's broken, and how many tokens it cost per agent."

### Non-goals (v1)
- No web UI (terminal + files only — UI is v2).
- No multi-user / team mode.
- No cloud runner — runs on user's Mac only.
- No support for languages/stacks not in the default template pack (TS/Next.js + Supabase + Vercel to start).
- No automated production writes (migrations/deploys gated on human approval).

---

## 2. Core Principles

Non-negotiable. These are enforced by agents and hooks, not just hoped for.

1. **Constitution first.** `memory/constitution.md` holds the non-negotiables for the *current target project*. Every agent MUST read it before acting and MUST refuse actions that violate it. Violations are logged as CRITICAL events.

2. **Canonical event log, materialized state.** `events.ndjson` is the **only** canonical store. `state.json`, `compliance.md`, dashboards, history — all are deterministic projections of the log. If state and log disagree, the log wins and state is rebuilt.

3. **Artifact pipeline for new work.** New projects or large features traverse a fixed pipeline: `constitution → spec → plan → analyze → tasks → implement → review → sync → deploy`. No skipping. Micro-changes use a separate short lane (§5).

4. **Disjoint writes, enforced by lease.** Every task declares `allowed_files`. Parallel `[P]` tasks must have **non-overlapping** `allowed_files` and hold a worktree lease. Lease expiry is a retry condition, not a merge.

5. **Hard gates before quality score.** Acceptance requires all applicable hard gates (tests / types / lint / build / migrations / smoke) to pass. A quality score (0–1) is computed only for ranking and is never grounds for acceptance on its own.

6. **Adversarial review by a different model.** Reviewer model ≠ implementer model. Reviewer covers a fixed set of dimensions (§14) and must submit an **evidence block** per dimension. Zero findings is allowed; zero evidence is not.

7. **Evidence before trust.** Every accepted task has an `evidence/` folder with: smoke output, test output, diff summary, screenshots where UI changed, preview URL where deployable.

8. **Missing inputs are gathered, not fatal.** If an implementer lacks a key, library, or decision, it does not halt the run. It delegates to `infra-provisioner` or files a question in `questions.md` and moves to the next task in its queue.

9. **Risk-class gating.** Every task has a `risk_class` of `safe | review-required | approval-required`. `approval-required` tasks are never merged or deployed without a recorded human response in `decisions.md`.

10. **Context-zone awareness.** Orchestrator monitors its own context usage: Green 0–75% (normal), Yellow 75–85% (compact verbosity), Red 85%+ (route everything to subagents, do not reason in main). Never hit context limit in the middle of a wave.

11. **Scheduling lives outside the chat.** Pinger, retries, morning digest are **not** internal Claude scheduled tasks. They are **launchd agents** on macOS. Chat is event-driven, not timer-driven.

12. **No lying clause.** Every implementer and reviewer prompt contains the literal sentence: *"Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING."* This is empirically effective and must not be removed "for tone".

---

## 3. Architecture Overview

### 3.1 Repo topology — monorepo
```
nightshift/
├── core/                    # platform-agnostic brain
│   ├── mcp-server/          # MCP endpoints used by both clients
│   ├── event-store/         # ndjson reader/writer + projection builder
│   ├── scripts/             # shell/node tooling (truth-score, checkpoint, snapshot, sync)
│   ├── skills/              # reusable skill bundles (loaded by clients via symlink or copy)
│   ├── templates/           # project-starter templates (Next.js+Supabase default)
│   └── schemas/             # JSON Schemas for events, state, contracts
├── claude/                  # Claude Code plugin (thin frontend)
│   ├── .claude-plugin/plugin.json
│   ├── agents/              # Opus/Haiku subagent definitions
│   ├── commands/            # slash commands
│   └── hooks/               # PostToolUse / PreToolUse / SessionStart / Stop
├── codex/                   # Codex CLI plugin (thin frontend)
│   ├── skills/              # Codex-flavored skills that call core/
│   └── automations/         # Codex automations manifest
├── launchd/
│   ├── ai.nightshift.pinger.plist      # every 30 min health check
│   └── ai.nightshift.digest.plist      # 8am morning digest
├── examples/
│   └── demo-project/        # end-to-end tested reference project
├── docs/
│   ├── ARCHITECTURE.md
│   ├── AGENTS.md
│   ├── SECRETS.md
│   └── CONTRIBUTING.md
├── README.md
├── CHANGELOG.md
└── constitution.md          # nightshift's own constitution (meta)
```

### 3.2 Client responsibilities
- **core** holds state, schemas, event writers, skill prompts, shell tooling. Has no opinion on LLM routing.
- **claude** supplies: spec writer, reviewers, orchestrator, doc syncer, blocker resolver. Claude-specific commands/hooks.
- **codex** supplies: implementer, context-packer. Codex-specific automations.
- When both are installed, Claude acts as **front door** (chat, orchestration, review) and Codex as **execution engine** (implementation). Either can work standalone in a degraded mode (documented in §23).

### 3.3 Data flow per task
```
orchestrator (Claude Opus)
  → writes contract.md to waves/N/TASK-XXX/
  → appends event: task.contracted
  → delegates to implementer via Task tool or Codex subprocess
implementer (Codex GPT-5.x per router)
  → reads contract + constitution + allowed_files
  → writes code into allowed_files only
  → appends event: task.implemented + writes result.md + evidence/
task-impl-reviewer (Claude Opus, different from implementer model)
  → reads contract + diff + evidence
  → runs hard gates (Bash)
  → writes review.md with dimension-by-dimension evidence block
  → appends event: task.reviewed with verdict accept|reject|revise
orchestrator
  → on accept: tag checkpoint, append task.accepted, trigger doc-syncer
  → on reject/revise: return to implementer with delta request
```

---

## 4. Artifact Pipeline (heavy lane)

Mandatory for: new projects, new top-level features, breaking changes, any task with `risk_class >= review-required`.

```
IDEA
  ↓ /nightshift start          chat with orchestrator, outputs:
                                 memory/constitution.md
                                 tasks/spec.md
  ↓ /plan                       outputs:
                                 tasks/plan.md
                                 tasks/research.md
                                 tasks/data-model.md
                                 tasks/contracts/API.md
  ↓ /analyze                    READ-ONLY cross-artifact consistency check
                                 halts on contradictions, ambiguities, underspecification
  ↓ /tasks                      decomposes plan into waves of TASK_TEMPLATE contracts
                                 marks [P] where disjoint writes allow parallelism
  ↓ /implement                  fire-and-forget execution, orchestrator drives waves
  ↓ /review-wave                GPT-5.4 adversarial review of full wave (60 min background)
  ↓ /sync                       updates graphs/index/state/compliance/history
  ↓ /deploy                     provisioner creates prod resources, runs migrations
                                 (approval-required if any risk-class upgrade)
  ↓ morning: /status            ASCII dashboard + compliance summary + token ledger
```

Each command is a thin wrapper over `core/scripts/<command>.sh` which takes/returns JSON. LLMs never compute paths, branch names, or wave indices; the shell does.

### 4.1 Analyze gate (critical — steals heavily from Spec Kit)
`/analyze` is **strictly read-only**. It walks spec ↔ plan ↔ tasks ↔ constitution and reports:
- **Ambiguity:** claim in spec not resolved in plan.
- **Contradiction:** plan violates constitution.
- **Underspecification:** task lacks measurable AC.
- **Duplication:** task overlaps with accepted task in previous wave.
- **Constitution conflict:** plan proposes action forbidden by constitution.

Any CRITICAL finding halts the pipeline until resolved in a new spec/plan revision. Non-critical findings are logged as warnings on the wave manifest.

---

## 5. Two Lanes: Heavy & Micro

**Heavy lane** = §4 full pipeline. For new projects or large features.

**Micro lane** = `/micro-task "description"`. For small changes that do not touch architecture, do not change contracts, are `risk_class = safe`, and touch ≤ 5 files, ≤ 200 lines of diff.

Micro lane flow:
```
/micro-task <desc>
  → orchestrator drafts mini-contract (goal, allowed_files, AC) in waves/micro/TASK-XXX/
  → task-spec-reviewer approves (≤3 min)
  → implementer executes
  → task-impl-reviewer runs hard gates + dimension review
  → on accept: doc-syncer, checkpoint tag, compliance entry
```

Rules for micro lane:
- If during work a task is discovered to touch >5 files or > 200 lines, agent **promotes** it to heavy lane (new contract, re-analyze) instead of finishing it quietly. Promotion is an event: `task.promoted_to_heavy`.
- Micro lane never triggers `/review-wave` (no wave).
- Micro lane never deploys on its own; merges to main and leaves deploy decision to a later heavy run or manual `/deploy`.

---

## 6. Agent Roster & Model Routing (Path C — hybrid)

Model routing for implementer is **decided per task by the orchestrator**, based on task contract fields, not pre-declared globally.

| Agent | Model | Invocation | Timeout | Purpose |
|---|---|---|---|---|
| `orchestrator` | Claude Opus 4.7 | Chat / Task tool | — | Runs chat with user, drives pipeline, routes work, gates merges |
| `spec-writer` | Claude Opus 4.7 | Task tool | 10 min | Produces `constitution.md` + `spec.md` from chat |
| `plan-writer` | Claude Opus 4.7 | Task tool | 10 min | Produces `plan.md` + `research.md` + `data-model.md` + `contracts/API.md` |
| `analyzer` | Claude Sonnet 4.6 | Task tool | 5 min | Read-only cross-artifact consistency (`/analyze`) |
| `task-decomposer` | Claude Opus 4.7 | Task tool | 10 min | Plan → wave of task contracts with `[P]` markers, lease plans, risk classes |
| `context-packer` | GPT-5.4-mini **or** GPT-5.3-codex-spark | Bash (`codex exec`) | 5 min | Per-task: bundles minimal context pack (allowed_files, reuse candidates, gotchas) for implementer |
| `implementer` | **Router** (see 6.1) | Bash (`codex exec`) | 15 min | Executes task contract |
| `task-spec-reviewer` | GPT-5.4-mini or Claude Sonnet 4.6 | Task/Bash | 5 min | Reviews contract BEFORE implementation |
| `task-impl-reviewer` | **Claude Opus 4.7** | Task tool | 10 min | Reviews implementation with dimension evidence block; **must differ** from implementer model |
| `wave-reviewer` | **GPT-5.4** | Bash `run_in_background` | **60 min** | Final adversarial wave review, cross-task regression |
| `blocker-resolver` | Claude Opus 4.7 | Task tool | 10 min | Called by implementer on block: web search, lib source read, workaround |
| `infra-provisioner` | Claude Opus 4.7 | Task tool | 15 min | Creates / rotates resources and keys; WebFetches official docs before ANY infra change |
| `doc-syncer` | **Claude Haiku 4.5** | Task tool | 3 min | Updates graphs/index/state/compliance after acceptance |
| `health-pinger` | Claude Haiku 4.5 | launchd → CLI | 2 min | Every 30 min: checks liveness, unsticks stalled work |
| `morning-digest` | Claude Haiku 4.5 | launchd → CLI | 2 min | 08:00 summary of night's work |

### 6.1 Implementer router (Path C)

Orchestrator sets `target_model` on every task contract before dispatch, per this table:

| Condition | Model | Reasoning effort |
|---|---|---|
| `risk_class=safe` AND `diff_budget_lines<=150` AND scope is straightforward | **GPT-5.4** | default |
| `risk_class=review-required` OR `diff_budget_lines>150` OR touches core types OR refactor | **GPT-5.3-codex** | high or xhigh |
| Micro-lane mechanical fix (rename, obvious bugfix, text-only) | **GPT-5.3-codex-spark** | default |
| Anything `risk_class=approval-required` | **GPT-5.3-codex xhigh** (and requires explicit approval before merge regardless of verdict) | xhigh |

Routing decision is itself an event: `task.routed` with `{reason, model, effort}`. If a task escalates (e.g., first pass rejected 2×), orchestrator may auto-upgrade effort on retry.

### 6.2 Never mix models on the same task
If implementer = Codex 5.4, reviewer = Claude Opus. Never reviewer = Codex 5.4 on a Codex 5.4 implementation. This is enforced at dispatch time.

---

## 7. Skills Catalog (in `core/skills/`)

Each skill is a `SKILL.md` with frontmatter following Claude Code skill format; Codex consumes the same file via a thin adapter.

1. **`project-bootstrap`** — creates `memory/`, `tasks/`, `scripts/`, `.github/workflows/ci.yml`, `.env.template`, empty state/events files, git init if needed.
2. **`spec-writer`** — interviews user, produces constitution + spec.
3. **`plan-writer`** — from spec produces plan + research + data-model + API contracts.
4. **`analyzer`** — read-only consistency check.
5. **`task-decomposer`** — plan → wave of task contracts.
6. **`wave-orchestrator`** — drives execution of a wave: dispatch, track leases, collect results, trigger reviews.
7. **`context-packer`** — builds per-task context bundle for implementer.
8. **`task-impl-review`** — dimension review protocol.
9. **`wave-review`** — GPT-5.4 adversarial wave review protocol.
10. **`post-task-sync`** — updates graphs/index/state/compliance/history.
11. **`project-status`** — ASCII dashboard generator.
12. **`infra-provisioner`** — service/resource provisioning protocol.
13. **`preflight-check`** — pre-sleep readiness validator.
14. **`truth-scorer`** — computes quality score from raw gate output.
15. **`compliance-reporter`** — generates `compliance.md` from events log.
16. **`checkpoint-manager`** — git tag checkpoint/rollback.

---

## 8. Commands Catalog (in `claude/commands/`)

- `/nightshift start` — begin new project chat → outputs constitution + spec.
- `/plan` — produces plan artifacts from spec.
- `/analyze` — runs analyzer, halts pipeline on CRITICAL findings.
- `/tasks` — decomposes plan into next wave of contracts.
- `/implement` — runs the current wave.
- `/review-wave` — triggers wave-reviewer (background 60 min).
- `/sync` — manual doc-sync (normally hook-driven).
- `/deploy` — provisioner + deploy. Promotes risk-class, requires approvals recorded.
- `/micro-task "<desc>"` — short lane.
- `/status` — dashboard.
- `/compliance [wave N]` — show audit for a wave or overall.
- `/questions` — lists open questions awaiting user response.
- `/decide "<answer>" --for <question-id>` — records a decision and unblocks dependents.
- `/resume` — resumes interrupted work by replaying events → state.
- `/rollback wave <N>` — git-reset to checkpoint before wave N.
- `/preflight` — pre-sleep readiness check.
- `/provision <service>` — manual provisioner call.
- `/provision rotate <service>` — key rotation runbook.
- `/halt [--reason <s>]` — safe stop, leaves state consistent.

---

## 9. Hooks (in `claude/hooks/`)

Implemented per Claude Code hook API.

- **`SessionStart` → `resume-check.sh`** — if `state.json` shows an in-progress wave and the last event is >15 min old, auto-runs `/resume`.
- **`PreToolUse(Task)` → `pre-task-preflight.sh`** — validates that task contract exists, allowed_files is non-empty, constitution is present.
- **`PreToolUse(Write|Edit)` → `write-guard.sh`** — blocks any write outside the active task's `allowed_files`. Writes a `guard.violation` event.
- **`PostToolUse(Write|Edit)` → `post-edit-sync.sh`** — debounced (1 event per task); triggers `doc-syncer` when task is marked done.
- **`Stop` → `checkpoint.sh`** — tags `session-end-<timestamp>` and writes a session summary.
- **`PreToolUse(Bash)` → `bash-budget.sh`** — blocks shell operations on paths outside project root (defense against runaway agents).

---

## 10. File & State Contracts

### 10.1 In-project layout (the target project that nightshift is operating on)
```
<target-project>/
├── memory/
│   ├── constitution.md             # non-negotiable project rules
│   └── learnings.md                # append-only lessons learned
├── tasks/
│   ├── spec.md
│   ├── plan.md
│   ├── research.md
│   ├── data-model.md
│   ├── contracts/
│   │   ├── API.md
│   │   ├── TASK_TEMPLATE.md
│   │   ├── REVIEW_DIMENSIONS.md
│   │   ├── PROJECT_STRUCTURE.md
│   │   ├── REUSE_FUNCTIONS.md
│   │   └── FEATURE_INDEX.md
│   ├── waves/
│   │   └── <N>/
│   │       ├── manifest.yaml        # list of tasks in wave, [P] marker, leases
│   │       └── <TASK-ID>/
│   │           ├── contract.md
│   │           ├── context-pack.md  # written by context-packer
│   │           ├── result.md        # written by implementer
│   │           ├── review.md        # written by task-impl-reviewer
│   │           └── evidence/
│   │               ├── tests.txt
│   │               ├── lint.txt
│   │               ├── types.txt
│   │               ├── build.txt
│   │               ├── smoke.txt
│   │               ├── diff.patch
│   │               └── screenshots/
│   ├── events.ndjson                # CANONICAL append-only log
│   ├── state.json                   # materialized projection
│   ├── compliance.md                # generated audit
│   ├── decisions.md                 # user answers to questions.md
│   ├── questions.md                 # open questions
│   ├── paused.md                    # halted tasks with reason
│   └── history/
│       ├── session-<ts>.metrics.json
│       └── session-<ts>.summary.md
├── scripts/
│   ├── snapshot.sh
│   ├── preflight.sh
│   ├── truth-score.mjs
│   ├── checkpoint-manager.sh
│   ├── replay-events.mjs            # rebuilds state.json from events.ndjson
│   └── smoke.sh
└── .env.template                    # op:// or {{LOCAL:VAR}} placeholders
```

### 10.2 Task contract (minimal required fields)
```yaml
task_id: PHASE2-ANALYTICS-003
wave: 3
risk_class: review-required
parallel_marker: "[P]"
target_model: gpt-5.3-codex
reasoning_effort: xhigh
diff_budget_lines: 180
owner_agent: implementer
reviewer_agent: task-impl-reviewer
reviewer_model: claude-opus-4.7
created_at: 2026-04-19T02:10:00Z
lease:
  worktree: .nightshift/worktrees/wave-3-task-3
  write_lock:
    - lib/analytics.ts
    - app/api/analytics/route.ts
  lease_until: 2026-04-19T02:30:00Z
goal:
  objective: "Add structured analytics events for editor save actions."
  business_value: "KPI visibility for power-user feature adoption."
scope:
  in_scope: [...]
  out_of_scope: [...]
  dependencies: [PHASE2-ANALYTICS-001]
source_of_truth: [memory/constitution.md, tasks/spec.md, tasks/plan.md, tasks/data-model.md, tasks/contracts/API.md]
allowed_files: [...]
forbidden_files: ["**/*.test.*", "supabase/migrations/**"]
acceptance_criteria:
  functional: [...]
  edge_cases: [...]
  gates_required: [tests, types, lint, build]
halt_conditions:
  - "3 consecutive implementation failures"
  - "new top-level dependency required"
  - "contract violation detected by write-guard"
  - "constitution conflict"
verification_plan:
  commands:
    - pnpm test -- analytics
    - pnpm typecheck
    - pnpm lint lib/analytics.ts
  manual_checks:
    - "Editor save emits event in dev console"
post_task_updates:
  - tasks/contracts/FEATURE_INDEX.md
  - tasks/contracts/REUSE_FUNCTIONS.md
```

### 10.3 Constitution (example skeleton)
```markdown
# Constitution — <project>

## 1. Stack
Frontend: Next.js 15 (App Router) + TS + Tailwind. Backend: Supabase. Deploy: Vercel.

## 2. Forbidden
- secrets in repo (including `.env.local`)
- files > 500 lines
- any code that bypasses Supabase RLS
- auto-generated migrations without human review

## 3. Required
- every API route has input zod schema
- every feature has at least one smoke path exercised in CI
- reuse-check before creating any helper > 10 lines

## 4. Constraints
- TS strict mode on
- no new top-level dep without `approval-required` task
- no silent broadcast to users (email/push) without decision.md entry
```

---

## 11. Event Log Schema (`events.ndjson`)

One JSON object per line. Append-only. Never edited or deleted. Schema in `core/schemas/event.schema.json`.

```json
{
  "ts": "2026-04-19T02:12:04.811Z",
  "event_id": "ev_01HXYZ...",
  "session_id": "sess_...",
  "wave": 3,
  "task_id": "PHASE2-ANALYTICS-003",
  "agent": "implementer",
  "model": "gpt-5.3-codex",
  "action": "task.implemented",
  "outcome": "success | failure | halted | revised",
  "tokens": { "input": 12034, "output": 2891, "cached": 4120 },
  "cost_usd_estimate": 0.18,
  "duration_ms": 48210,
  "evidence_paths": ["tasks/waves/3/PHASE2-ANALYTICS-003/result.md"],
  "notes": ""
}
```

### 11.1 Required event actions
- `session.start`, `session.end`
- `wave.planned`, `wave.started`, `wave.reviewed`, `wave.accepted`
- `task.contracted`, `task.context_packed`, `task.routed`
- `task.dispatched`, `task.blocked`, `task.resolved`, `task.implemented`
- `task.reviewed`, `task.accepted`, `task.rejected`, `task.revised`
- `task.promoted_to_heavy`
- `gate.passed`, `gate.failed`
- `guard.violation`
- `question.asked`, `question.answered`
- `decision.recorded`
- `infra.provisioned`, `infra.rotated`, `infra.deleted_requested`
- `checkpoint.tagged`, `rollback.performed`
- `pinger.ping`, `pinger.unstuck`
- `budget.exceeded`, `context_zone.changed`

### 11.2 Replay rules
`scripts/replay-events.mjs` rebuilds `state.json` from scratch by iterating `events.ndjson`. This script is the **definition** of state semantics. If a question arises about what state should be, read this script, not `state.json`.

---

## 12. state.json (projection)

Never written directly by agents — only by the projection builder after an event is appended.

```json
{
  "version": 1,
  "built_from_event_id": "ev_01HXYZ...",
  "project": { "name": "", "constitution_version": 1 },
  "context_zone": "green",
  "waves": {
    "3": {
      "status": "in_progress",
      "checkpoint_tag": "wave-3-start-20260419-0210",
      "started_at": "...",
      "tasks": {
        "PHASE2-ANALYTICS-003": {
          "status": "reviewing",
          "risk_class": "review-required",
          "parallel_marker": "[P]",
          "model": "gpt-5.3-codex",
          "effort": "xhigh",
          "retries": 0,
          "lease": { "worktree": "...", "until": "...", "locks": [...] },
          "gates": { "tests": "pass", "types": "pass", "lint": "pass", "build": "pass", "smoke": null },
          "quality_score": 0.86,
          "tokens": {
            "context-packer": { "in": 1800, "out": 900, "cost": 0.02 },
            "implementer": { "in": 45230, "out": 7200, "cost": 0.19 },
            "task-impl-reviewer": { "in": 8900, "out": 1400, "cost": 0.08 },
            "total_tokens": 65430,
            "total_cost_usd": 0.29
          },
          "evidence_folder": "tasks/waves/3/PHASE2-ANALYTICS-003/evidence/",
          "last_event_ts": "..."
        }
      }
    }
  },
  "open_questions": ["Q-03"],
  "paused_tasks": [],
  "totals": { "tokens": 892340, "cost_usd_estimate": 3.41 }
}
```

---

## 13. Compliance Audit (`compliance.md`)

Generated by `compliance-reporter` after every `task.accepted` or `wave.accepted`. Human-readable. Every accepted task gets a block:

```
## TASK PHASE2-ANALYTICS-003 — Add structured analytics events
  Accepted: 2026-04-19T02:42:11Z  |  Model: gpt-5.3-codex (xhigh)  |  Reviewer: claude-opus-4.7
  Hard gates:
    tests   PASS   tasks/waves/3/PHASE2-ANALYTICS-003/evidence/tests.txt
    types   PASS   evidence/types.txt
    lint    PASS   evidence/lint.txt
    build   PASS   evidence/build.txt
    smoke   N/A    (not applicable — no UI change)
  Quality score: 0.86
  Constitution checks: allowed_files respected, no secret leak, no file > 500 lines
  Dimension review (6 dimensions):
    scope_drift        OK    evidence: diff stayed in allowed_files (review.md §1)
    missed_deps        OK    evidence: no new top-level deps introduced
    dup_abstractions   NOTE  small overlap with lib/telemetry.ts — logged as future dedup
    verification_gaps  OK    smoke waived by design
    security           OK    events do not carry PII
    data_contract      OK    matches contracts/API.md §analytics
    deploy_risk        OK    no migration required
  Tokens: 65430 total  |  Cost: $0.29
  Evidence: tasks/waves/3/PHASE2-ANALYTICS-003/evidence/
```

---

## 14. Hard Gates & Quality Score

### 14.1 Hard gates (acceptance requires ALL applicable to pass)
| Gate | Tool | Applicable when | Command template |
|---|---|---|---|
| `tests` | project test runner | diff touches code covered by tests OR new test added | per template |
| `types` | `tsc --noEmit` | TS changes | `pnpm typecheck` |
| `lint` | eslint/biome | always (path-scoped) | `pnpm lint <files>` |
| `build` | `next build` or equiv | diff touches build graph | template |
| `migrations` | supabase CLI dry-run | migrations folder touched | template |
| `smoke` | Playwright script from `scripts/smoke.sh` | UI changed | template |
| `security` | `pnpm audit` + secret-scan on diff | any dependency touched | template |

`not applicable` (N/A) must be justified in `review.md` with one sentence.

### 14.2 Quality score (ranking, never acceptance)
```
score = 0.30 * tests_pass_ratio
      + 0.20 * types_pass
      + 0.15 * lint_pass
      + 0.15 * build_pass
      + 0.10 * reuse_adherence          (no dup helpers)
      + 0.05 * file_size_compliance
      + 0.05 * docs_sync_completeness
```
Reported in state.json and compliance.md. Used for wave summary and retrospectives.

---

## 15. Risk Classes

| Class | Trigger | Workflow |
|---|---|---|
| `safe` | pure internal code, no external surface, no secrets, no migrations | auto-accept on hard gates + review pass |
| `review-required` | any UI change, API shape change, new dependency, file > 300 lines touched | acceptance requires `task-impl-reviewer` explicit accept, logged |
| `approval-required` | infra creation/deletion, secret rotation, prod migration, auth changes, billing, user-visible broadcast, data deletion | merge blocked until `/decide` records human approval for this specific task_id |

`task-decomposer` assigns risk class at contract creation. Implementer may request upgrade (never downgrade) with justification.

---

## 16. Task Lease / Lock Model

For any wave, `[P]` tasks run in parallel **iff**:
- `allowed_files` sets are pairwise disjoint (checked by `task-decomposer`);
- each task owns a distinct git worktree under `.nightshift/worktrees/wave-<N>-task-<id>/`;
- each task holds a lease with `lease_until` (default 15 min from dispatch);
- on lease expiry, orchestrator inspects progress and either extends (if events show liveness) or reassigns task.

Non-`[P]` tasks within a wave run serially after their `dependencies` complete.

Lease events: `lease.acquired`, `lease.extended`, `lease.expired`, `lease.released`.

---

## 17. Evidence Requirements

Every task folder has `evidence/`. Minimum contents depending on gate applicability:

- `diff.patch` — always.
- `tests.txt` — stdout of test command.
- `types.txt` / `lint.txt` / `build.txt` — as applicable.
- `smoke.txt` — for UI tasks.
- `screenshots/` — for visible UI changes (Playwright `page.screenshot`).
- `preview.url` — for deployed previews (Vercel preview URL).
- `notes.md` — reviewer's annotated observations when ambiguous.

Reviewer **references** evidence paths in review.md per dimension. A review without evidence paths is rejected.

---

## 18. Secret Backend Interface

Default = local folder. 1Password = optional adapter.

```ts
interface SecretBackend {
  read(project: string, key: string): Promise<string>;
  write(project: string, key: string, value: string, meta: { rotatedFrom?: string }): Promise<void>;
  list(project: string): Promise<string[]>;
  rotate(project: string, key: string): Promise<{ oldRef: string; newRef: string }>;
}
```

Adapters:
- **`LocalFolderBackend`** — reads/writes `~/.nightshift/secrets/<project>/.env`. Default.
- **`OnePasswordBackend`** — wraps `op` CLI; stores in vault `nightshift/<project>`. Used if `NIGHTSHIFT_SECRET_BACKEND=1password`.

Repo `.env.template` uses placeholders `{{SUPABASE_URL}}` resolved at runtime by `scripts/run-with-secrets.sh` which calls the active backend. **Secrets never land in plaintext inside the repo.**

Rotation runbook (`/provision rotate <service>`):
1. Backend calls service API to create new key.
2. Updates consumers: Vercel env, GitHub Actions secrets, local mirror.
3. Deploys consumers.
4. Waits grace period (default 24h) before revoking old.
5. Logs `infra.rotated` event with old/new refs (never values).

---

## 19. Overnight Safety (launchd)

Two launchd agents in `launchd/`. Installed by `scripts/install-launchd.sh` into `~/Library/LaunchAgents/` and loaded with `launchctl`.

- **`ai.nightshift.pinger.plist`** — every 30 min runs `scripts/health-ping.mjs <active-project>`. Reads `state.json`, if last event > 15 min ago and wave in progress → runs `/resume` via Claude CLI. If 3 consecutive unstucks fail for same task → moves to `paused.md` with diagnostics and writes `pinger.unstuck.failed` event.
- **`ai.nightshift.digest.plist`** — 08:00 local, runs `scripts/morning-digest.mjs`. Produces a terminal file `~/.nightshift/digest/<date>.md`: tasks accepted, paused, tokens spent, preview URLs, open questions. Optional: `say "Digest is ready"` on macOS.

Both agents log to `~/.nightshift/logs/<date>.log` with rotation.

**Design constraint:** neither agent writes to project repo directly. They drive Claude CLI or Codex CLI, which writes events. This keeps the event log canonical.

---

## 20. Token Accounting

Each agent invocation is wrapped by the dispatch layer which:
1. Captures tokens from the LLM response (Claude usage block, Codex `--json` usage, OpenAI API `response.usage`).
2. Appends event with `tokens` and `cost_usd_estimate` (rough unit-cost table in `core/schemas/costs.json`).
3. Projection updates per-task breakdown.

`/status` shows:
- Top 10 most expensive tasks this session.
- Per-agent share (implementer / reviewer / orchestrator / ...).
- Rolling 24h total.

No hard monetary cap in v1 (user has flat subscriptions). Soft warning logged when a single task exceeds 200k tokens cumulative.

---

## 21. Token & Context Economy Rules

Enforced via prompts and dispatch.

1. **File-based handoff.** Subagents return a pointer (`result.md` path + short summary), never paste full diffs into orchestrator context.
2. **Minimal briefing.** Implementer prompt carries only: goal, allowed_files, context-pack path, gates, halt conditions. Spec/plan/constitution are **read by the agent on demand**, not inlined.
3. **Context-packer buffers the big docs.** For each task, a cheap model extracts the 500-line slice of spec/plan/data-model relevant to this task into `context-pack.md`. Implementer reads the pack, not the originals.
4. **Reviewer context window = contract + diff + evidence.** Never the whole project.
5. **Orchestrator context zone awareness.** Above 75% usage, switches to summary-only mode; above 85%, delegates everything.
6. **Worktree per task.** Each Codex run has its own worktree → its own context. Prevents cross-task bleed.
7. **Daily compact.** At session.end, projection builder rewrites `state.json` fresh from events; old event slices > 30 days are archived but never deleted.

---

## 22. Installation & Sharing

### 22.1 Prerequisites
```bash
# macOS
brew install --cask 1password-cli        # optional
brew install gh supabase
npm i -g @openai/codex-cli
# Claude Code already installed
```

### 22.2 Install nightshift
```bash
gh repo clone ksokolovsky/nightshift ~/.nightshift
cd ~/.nightshift
./scripts/install.sh                     # symlinks core/, installs Claude plugin, installs launchd
/plugin install ~/.nightshift/claude     # inside Claude Code
```

### 22.3 Use on a project
```bash
cd ~/dev/<new-project-dir>
claude
# inside Claude
/bootstrap
/nightshift start
```

### 22.4 Sharing with a friend
They run the same prerequisites + clone, run install.sh, restart Claude. Done.

---

## 23. Degraded modes

- **Codex unavailable** → all implementation falls back to Claude Sonnet on implementer role; slower, but works.
- **launchd not installed** → pinger/digest disabled; `/status` manual only; big warning in `/preflight`.
- **1Password missing** → auto-falls back to LocalFolderBackend.
- **Network down** → orchestrator halts, writes `session.halted`, state preserved for replay.

---

## 24. Build Roadmap (for Claude Code to execute overnight)

Each wave has hard acceptance criteria. Do not advance until previous wave is ✅ in `compliance.md`.

### Wave 0 — Core skeleton (3–4 days)
**Goal:** platform-agnostic brain works standalone.

Deliverables:
- `core/event-store/` — append, read, replay API.
- `core/schemas/` — JSON Schemas for event, state, contract, manifest.
- `core/scripts/` — `replay-events.mjs`, `truth-score.mjs`, `checkpoint-manager.sh`, `snapshot.sh`, `preflight.sh`, `run-with-secrets.sh`.
- `core/templates/project-starter/` — Next.js 15 + Supabase + Vercel skeleton with `memory/`, `tasks/`, `scripts/`, `.github/workflows/ci.yml`, `CLAUDE.md`.
- `core/skills/` — all 16 skill MD files with real prompts (not stubs). Cross-reference `memory/constitution.md` path convention.
- `SecretBackend` interface + `LocalFolderBackend` adapter.
- Unit tests for projection builder (events → state).

Acceptance:
- Can run `node core/scripts/replay-events.mjs fixtures/sample.ndjson` → produces expected state.json.
- Template project starter instantiates cleanly in a fresh directory.
- `compliance.md` for this wave exists with evidence.

### Wave 1 — Claude frontend + heavy lane (4–5 days)
**Goal:** end-to-end pipeline works in Claude Code on a real project (pick a small test: "build a pomodoro timer web app").

Deliverables:
- `claude/.claude-plugin/plugin.json`.
- Agents: `orchestrator`, `spec-writer`, `plan-writer`, `analyzer`, `task-decomposer`, `task-spec-reviewer`, `task-impl-reviewer`, `doc-syncer`, `blocker-resolver`.
- Commands: `/bootstrap`, `/nightshift start`, `/plan`, `/analyze`, `/tasks`, `/implement` (Claude-only implementer fallback until Wave 2), `/sync`, `/status`, `/halt`, `/resume`, `/rollback`.
- Hooks: `write-guard.sh`, `post-edit-sync.sh`, `resume-check.sh`, `checkpoint.sh`.
- Dimension-based review protocol in `task-impl-reviewer` prompt.
- Hard gates runner invoked from review.

Acceptance:
- Pomodoro test project runs end-to-end heavy lane without manual intervention beyond approval prompts.
- `compliance.md` shows all tasks with dimension evidence blocks.
- Rollback on wave 1 restores tree to pre-wave state.

### Wave 2 — Codex integration + micro lane (3 days)
**Goal:** implementer runs on Codex with routing; micro lane works.

Deliverables:
- `codex/` plugin: skills + automations.
- Implementer router per §6.1; dispatch via `codex exec --json`.
- `context-packer` agent on GPT-5.4-mini / Spark.
- `/micro-task` command with promotion to heavy path detection.
- Task lease/lock model with worktree management.

Acceptance:
- Same pomodoro test re-run: ≥ 80% tasks routed to Codex.
- Parallel `[P]` tasks run in separate worktrees, disjoint write sets verified by `write-guard`.
- Micro-task demo: "change CTA text on landing" runs in under 5 min end-to-end.

### Wave 3 — Overnight safety (2–3 days)
**Goal:** fire-and-forget for 8 hours unattended works.

Deliverables:
- launchd plists + `install-launchd.sh`.
- `health-ping.mjs`, `morning-digest.mjs`.
- `wave-reviewer` on GPT-5.4 in background via `run_in_background`, result polled and recorded.
- Hard gates runner completion, quality score math.
- Risk classes enforcement in `task-decomposer` and `/deploy`.
- Evidence folder auto-filled by reviewer.
- Decision log wiring: `/decide` command.

Acceptance:
- Run pomodoro + one added feature overnight (wall-clock 6+ hours) unattended.
- Morning digest produced at 08:00 with tokens, accepted tasks, open questions.
- One synthetic failure (kill an agent mid-run) recovered by pinger within 30 min.

### Wave 4 — Infra & secrets (3–4 days)
**Goal:** provision services, rotate keys, safe deploys.

Deliverables:
- `infra-provisioner` with Vercel / Supabase / Railway / Redis adapters (MCP where available, CLI otherwise).
- WebFetch-before-infra-change rule baked into prompt.
- `OnePasswordBackend` adapter.
- `/provision`, `/provision rotate <service>`.
- `approval-required` workflow wired through `/decide`.
- Audit log: `infra-audit.ndjson` (subset view of events).

Acceptance:
- New Supabase project created via `/provision supabase new <name>`.
- Key rotation on a real service succeeds and consumers are updated.
- `approval-required` tasks blocked merge until `/decide` response recorded.

### Wave 5 — Polish & examples (2 days)
**Goal:** shareable product.

Deliverables:
- `examples/demo-project/` — fully built by nightshift, checked in.
- `README.md`, `docs/ARCHITECTURE.md`, `docs/AGENTS.md`, `docs/SECRETS.md`, `docs/CONTRIBUTING.md`.
- Video walkthrough script (not recorded here, just the script).
- Publish to Claude Code plugin marketplace (if available) or share-by-git instructions.
- `CHANGELOG.md` v1.0.0 entry.

Acceptance:
- Friend clones and runs `/bootstrap + /nightshift start` successfully on their own Mac.
- Demo project runs smoke in CI.

---

## 25. Open Questions (for user — answer in chat or `questions.md`)

> The build may begin without these answered, but the flagged components will stub until answered.

- **Q1 — Stack template scope:** start with Next.js + Supabase + Vercel only, or also plain Node API + Railway? → default: start Next.js only; add templates in a later minor version.
- **Q2 — CI:** GitHub Actions only, or also local `act`-based runs? → default: GH Actions.
- **Q3 — Telegram pings:** skip for v1? → default: yes, skip. digest.md is enough.
- **Q4 — Cost table:** cost_usd_estimate is estimate only; we do not fetch live pricing. OK? → default: OK.
- **Q5 — Playwright vs Browser MCP:** use Playwright for smoke, or Browser MCP where available? → default: Playwright (portable).
- **Q6 — Implementer concurrency cap:** how many parallel Codex workers max? → default: 3 (safe for a dev Mac).

---

## 26. Explicit Non-Goals (do not drift)

- No GUI / web dashboard (v2).
- No multi-tenant hosted version.
- No cross-repo orchestration (one project per session).
- No automatic production deploys (always approval-required).
- No arbitrary shell execution outside project root (guard).
- No "AI PM" that writes roadmap from analytics (v2+, and explicitly out of scope per user request).
- No social / Slack integrations in v1.
- No built-in support for non-TypeScript stacks in default template (user can fork template).

---

## 27. Glossary

- **Artifact** — a file produced by a pipeline stage (constitution, spec, plan, contract, result, review, evidence).
- **Canonical log** — `events.ndjson`. Only writable by dispatch layer.
- **Constitution** — `memory/constitution.md` holding non-negotiable project rules.
- **Contract** — `TASK-XXX/contract.md` describing exactly one unit of work.
- **Dimension** — one of the fixed review axes (scope_drift, missed_deps, etc.).
- **Evidence** — artifacts produced during verification; required for acceptance.
- **Gate** — a binary pass/fail check (tests, types, lint, build, migrations, smoke, security).
- **Hard gate** — gate whose failure rejects the task regardless of quality score.
- **Heavy lane** — full artifact pipeline (§4).
- **Lease** — time-bounded claim on a worktree + write lock.
- **Micro lane** — short path for small changes (§5).
- **Projection** — state derived from the log.
- **Quality score** — 0–1 ranking number; never an acceptance criterion alone.
- **Risk class** — `safe | review-required | approval-required`.
- **Wave** — a batch of tasks decomposed from a plan segment, executed together and reviewed once at the end.

---

## 28. Build kickoff instructions (put this at the top of your Claude Code prompt)

```
Read NIGHTSHIFT_MASTER_SPEC.md top-to-bottom before touching any file.
Start at Wave 0 (Section 24). Do not advance waves out of order.
For every task within a wave: create a contract under tasks/waves/<N>/<TASK>/contract.md,
follow the full artifact pipeline (§4), write events to events.ndjson,
collect evidence, run hard gates, produce review.md with dimension evidence block,
and update compliance.md on acceptance.
If any spec item is ambiguous, append to tasks/questions.md and move to the next task.
Never skip the "NO LYING OR CHEATING" clause in implementer prompts.
Repo convention: monorepo at repo root, see Section 3.1 for layout.
```
