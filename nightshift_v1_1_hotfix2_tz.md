# Nightshift v1.1.1 — Hotfix-2 TZ (round 2)

Three improvements caught live during kw-injector-v1 overnight run on
2026-04-21. Goal: next overnight is dramatically more transparent (live
monitor) and the pinger stops wasting cycles on awaiting-human sessions.
Suite must stay green end-to-end (current baseline 253/253 on Darwin).

> **History.** Round 1 (`nightshift_v1_1_hotfix2_tz.md`@9a85eb1) returned
> `revise` from gpt-5.4 with 8 required changes (see
> `.nightshift/review-hotfix2-gpt-5.4.md`). This round 2 addresses each.
> Substantive design changes are noted under each H-item with `← FROM
> REVIEW`.

> **Scope frozen.** This TZ covers H10 + H11 + H14 only. H9, H13, B-02 are
> separate work items deferred to hotfix-3.

---

## H14 — pinger detects "awaiting human" from STATE, not last event

### Symptom (live)
launchd pinger fires every 30 min. Detects `last event > 15 min` →
considers session stale → spawns `claude --continue`. But if a question is
actually unanswered, the Claude process is alive and waiting on stdin —
`claude --continue` cannot answer for the user. Pinger spends the rest of
the night looping uselessly.

Observed on kw-injector-v1: rate-limit hit at 03:13Z, pinger tapped 6+
times through to 09:30Z, all wasted.

### Why "look at last event" doesn't work ← FROM REVIEW
`health-ping.mjs:30-37` appends `pinger.ping` BEFORE doing any
liveness/staleness reasoning. After the very first tick on a question-
waiting project, the last event in `events.ndjson` is `pinger.ping`, NOT
`question.asked`. A naive "if last event is question.asked, skip" check
fires correctly on tick 1 and silently regresses on tick 2+.

### Fix — Layer A (P0)

**Reorder the pinger pipeline.** Compute "awaiting human" FIRST, BEFORE
appending `pinger.ping`:

1. Read `events.ndjson` into memory.
2. Compute open-question set via shared `openQuestions(events)` helper
   (see Cross-cutting). The helper:
   - Adds an entry on `question.asked` keyed by `payload.question_id`.
   - **Drops the entry entirely if `payload.question_id` is missing
     or empty** (don't fall back to `event_id` — a malformed
     `question.asked` without an id can never be resolved by
     `decision.recorded{question_id}` or `question.answered{question_id}`,
     so it would be sticky-forever and produce permanent false positives
     in the pinger / digest / dashboard). The helper logs a warning to
     stderr listing dropped event_ids so the operator notices the bad
     producer. ← REVIEW NICE-TO-HAVE adopted as spec.
   - Removes the entry on either `question.answered{question_id}` OR
     `decision.recorded{payload.question_id}`. Matches what
     `core/event-store/src/projection.mjs:184-190` already does.
3. If open-question set is non-empty:
   - Append `session.paused` with
     `notes: "orchestrator awaiting human approval on Q-XX, Q-YY (N open). Recover: open the Claude session and answer."`
     and `payload.open_question_ids: [...]`.
   - Append `pinger.ping` with `payload.skipped: "awaiting_human"`.
   - On Darwin, fire `say "nightshift is waiting for your answer"`
     ONLY if `<project>/.nightshift/last-notified-questions` differs
     from the current open-question set (compare as sorted-joined string).
     Update the sentinel file regardless.
   - Exit without dispatching `claude --continue`.
4. If open-question set is empty: pipeline continues to current behavior
   (append `pinger.ping`, then staleness check, then `claude --continue`).

The `task.blocked{kind:approval-required}` branch is **dropped**. Per
review: `provision.mjs:87-102` and `claude/agents/orchestrator.md:28-31`
already use `question.asked` for "approval needed" — there is no separate
`task.blocked{kind:approval-required}` event in current code, my round-1
TZ invented it. The unresolved-question detection above covers the
approval-required case as a side effect.

### Fix — Layer B (P0)

`core/scripts/morning-digest.mjs`: add a topmost section
`## ⚠ Waiting for your answer` BEFORE the regular accomplishments
section. Same open-question computation as Layer A — reuse the same
helper. Each line: `Q-id`, `payload.question` text (or
`(no question text)` if missing), `ts`, `wave/task` (skip those subfields
if absent in payload).

> **Required by review #5**: question matching must subtract
> `decision.recorded{question_id}` as well as `question.answered`. Done.

### Acceptance ← EXPANDED PER REVIEW

New test `core/scripts/test/hotfix2-pinger-question-aware.test.mjs`:

- **F-A**: Fixture with one `question.asked` followed by `pinger.ping`,
  then a stale `task.implemented`. Run pinger TWICE in succession.
  - Tick 1: assert `claude --continue` NOT spawned, assert `session.paused`
    appended with `payload.open_question_ids` containing the question id,
    assert `pinger.ping{skipped:"awaiting_human"}` appended.
  - Tick 2: SAME assertions (must still skip — this is the regression
    against round-1 design). ← REVIEW REQ #3 + #6.
- **F-B**: Fixture where `question.asked` is followed by
  `decision.recorded{question_id: <same>}`. Pinger sees set as resolved →
  proceeds to staleness check normally. ← REVIEW REQ #5.
- **F-C**: Fixture where `question.asked` is followed by
  `question.answered{question_id: <same>}`. Same as F-B. ← REVIEW REQ #5.
- **F-D**: Fixture with no questions, just stale `task.dispatched` > 15
  min ago. Current behavior preserved: `claude --continue` IS spawned.
  Acts as the don't-break-existing-pinger guard against
  `core/scripts/test/health-ping-resume.test.mjs`.
- **F-E**: First-run fixture with empty `events.ndjson` (no
  `.nightshift/` dir, no sentinel, no project state). Pinger exits
  cleanly (current "no in-progress waves" path) without crashing on the
  open-question helper.
- **F-F**: Sentinel de-dup. Run pinger twice on the same unanswered
  question. `say` called only once (mock the `spawn('say', ...)` call,
  count invocations).
- **F-G**: Multiple open questions. `say` fires once per first
  observation of the SET (sorted-joined key), not once per question.

New test `core/scripts/test/hotfix2-digest-questions-on-top.test.mjs`:

- Fixture with 3 `question.asked`, 1 matched by `question.answered`, 1
  matched by `decision.recorded{question_id}`. Digest's first H2 is
  `## ⚠ Waiting for your answer` and lists exactly the 1 unanswered
  question. The accomplishments section appears below.
- Negative test: same fixture but ALL questions resolved → no
  `## ⚠ Waiting for your answer` section emitted.
- Negative test: question with `payload` lacking `question` text →
  rendered as `(no question text)`, no crash. ← REVIEW edge case.

`core/event-store/src/projection.mjs`: existing tests must still pass.

### Out of scope

- `osascript` Notification Center push — defer to hotfix-3.
- Process-liveness probing on the running Claude PID — defer.
- Spec §19 update (`NIGHTSHIFT_MASTER_SPEC.md:657-663` says pinger does
  not write to project repo, but current code already does) — see
  cross-cutting note below.

---

## H10 — `session.end` dedup at the TOP of checkpoint.sh

### Symptom (live)
Stop hook (`claude/hooks/checkpoint.sh`) fires on every Claude turn
boundary. On overnight kw-injector-v1: 13/48 events were `session.end`
(27% noise), and ALSO 13 git tags `nightshift/session-end-*` and 13
`tasks/history/session-*.summary.md` files.

### Why "skip append at the bottom" isn't enough ← FROM REVIEW
`checkpoint.sh:18-25` writes the git tag and `:27-35` writes the summary
file BEFORE `:38-41` appends the `session.end` event. Round-1 TZ said
"dedup before appending" — that would skip the EVENT but the tag and
summary file still pile up. The dedup must run at the very TOP of the
script, before any side effect.

### Fix

`claude/hooks/checkpoint.sh`: at the very top (after `ns_read_event`
returns the hook payload, before line 18's git-tag block), check the
last line of `tasks/events.ndjson`:

- If file does not exist OR is empty → proceed normally (this is the
  first session.end ever; let it through).
- If `tail -n1` parses as JSON with `action == "session.end"` AND
  `session_id` MATCHES the canonical session id we'd write next →
  exit 0 with `ns_allow` (no tag, no summary file, no event append).
  Suppress shell trace.
- Otherwise → proceed normally.

> **Critical: compare against the CANONICAL session id**, not the raw
> `ns_event_field session_id` value. ← REVIEW REQ #1. The raw hook
> payload is best-effort (`claude/hooks/lib/common.sh:58-69`);
> `ns_append_event` validates and may regenerate it via `ns_session_id()`.
> The dedup helper must call the same canonical resolver to avoid
> false-positives (treating two different sessions as the same) AND
> false-negatives (treating two same sessions as different).

> **TOCTOU caveat acknowledged**: `appendEvent` in
> `core/scripts/dispatch.mjs:39-46` and `EventStore.append` in
> `core/event-store/src/index.mjs:17-35` use unlocked `fs.appendFile`.
> If two checkpoint.sh invocations race, both might read the same
> "previous last event" and both decide to append. This is a known
> nightshift v1.0 limitation, not introduced by H10. Document but
> do not fix here.

### Acceptance ← EXPANDED PER REVIEW

New test **lives in `claude/hooks/test/hotfix2-checkpoint-dedup.test.mjs`**
← REVIEW REQ #2 (was wrongly under `core/scripts/test/`):

- **F-A** (empty log): events.ndjson empty / missing. Run checkpoint.sh
  with synthesized stdin. Assert: 1 git tag created, 1 summary file
  written, 1 session.end appended. (First end of new session — must
  pass through.)
- **F-B** (consecutive duplicate): events.ndjson ends with
  `session.end` having canonical session_id = `sess_X`. Run checkpoint.sh
  with hook stdin where same `sess_X` resolves canonically. Assert: NO
  new tag, NO new summary, NO new session.end appended. ← REVIEW REQ #2.
- **F-C** (different session): events.ndjson ends with
  `session.end{sess_X}`. Run checkpoint.sh where canonical resolves to
  `sess_Y` (new session, e.g. NIGHTSHIFT_SESSION_ID env unset and
  state.json shows different active session). Assert: 1 new tag, 1 new
  summary, 1 new session.end appended (first end of NEW session).
  ← REVIEW REQ #2.
- **F-D** (pass-through after non-session.end last event): events.ndjson
  ends with `[session.start, session.end{sess_X}, decision.recorded]`
  (last event is a `decision.recorded`, NOT a `session.end`). Run
  checkpoint.sh resolving canonical session_id = `sess_X`. Assert: 1
  new tag, 1 new summary, 1 new session.end appended (the FIRST
  session.end after a non-session.end event must pass through, even
  though an earlier session.end with the same session_id exists).
  Then immediately run checkpoint.sh AGAIN with same session_id:
  assert NO new tag/summary/event (now consecutive duplicate).
  ← REVIEW REQ #3: round-2 fixture incorrectly ended on `session.end`,
  contradicting its own assertion; corrected to end on
  `decision.recorded`.
- **F-E** (concurrent dispatch — best-effort): document the TOCTOU
  caveat in test comment; no race-condition test (out of scope).

`claude/hooks/test/hooks.test.mjs` (existing) must still pass.

### Out of scope

- Time-window dedup (e.g. "skip if <15 min since previous").
- Locking around events.ndjson append (TOCTOU is a v2 concern).
- Reorganizing where git tags / session summaries live (current path).

---

## H11 — `nightshift status --dashboard [--watch]` (preserves existing contract)

### Symptom (request, not bug)
User running an overnight needs glanceable mid-run status without entering
the live Claude session. Current `nightshift status` prints 3 lines
(session_id, zone, event count) — useful for sanity, useless for
monitoring.

### Hard constraints from existing contract ← FROM REVIEW

`/status` already specifies (per
`NIGHTSHIFT_MASTER_SPEC.md:673-676`,
`claude/commands/status.md:11-20`,
`core/skills/project-status/SKILL.md:22-34`):

- Top-10 expensive tasks (aggregate cost across agents)
- Per-agent share of total cost
- Rolling 24h totals
- Paused-task reasons (sourced from `tasks/paused.md`)
- Soft warnings: task >200k tokens (yellow), `gate.failed` in last hour
  (red), `open_questions` at bottom, `paused_tasks` at bottom

**The new dashboard MUST preserve all of these.** It adds the new live-
overnight surface (pipeline, wave progress bar, guards/gates rollup,
honest budget) on top — it does not replace the existing surface.

### Pipeline derivation — canonical-events only ← FROM REVIEW (round 2 + 3 corrections)

Round 1 used "manifest exists" and invented event kinds. Round 2 still
mismatched what the codebase actually emits. Round 3 verified each
signal via grep + the live `kw-injector-v1/tasks/events.ndjson`:

| Stage | Signal (canonical events.ndjson) | Producer evidence |
|---|---|---|
| `intake` | `session.start` with `payload.stage == "intake"` | `core/scripts/nightshift-init.mjs:142-151` |
| `scaffold` | `decision.recorded` with `payload.kind == "intake_approval"` | `core/scripts/nightshift-scaffold.mjs:1296-1308` |
| `plan` | ≥1 `plan.completed` event (canonical, NEW in this hotfix) | Adds `plan.completed` to `core/schemas/event.schema.json` action enum + updates `core/skills/plan-writer/SKILL.md` to emit it as the final event of every successful plan-writer run via `nightshift dispatch append`. Stable signal, not best-effort. ← REVIEW REQ #1 fix |
| `analyze` | ≥1 `analyze.completed` event (canonical, NEW in this hotfix) | Adds `analyze.completed` to action enum + updates `core/skills/analyzer/SKILL.md` to emit on every successful analyzer run. Distinguishes the user-facing verdict from the existing `wave.reviewed` launch-trace at `core/scripts/wave-reviewer.mjs:124-132`. Stable signal. ← REVIEW REQ #1 + new-hole #1 fix (single predicate everywhere) |
| `tasks` | ≥1 `task.contracted` event | task-decomposer per spec §10 |
| `implement` | ≥1 `task.dispatched` event | `core/scripts/dispatch.mjs` |
| `accept` | ≥1 `wave.accepted` event | `core/scripts/wave-review-consumer.mjs:108-124` |
| `deploy` | ≥1 `task.accepted` whose **top-level `event.task_id`** matches `/deploy\|prod\|ship\|release/i` | `task_id` is a top-level event field per `core/schemas/event.schema.json` and `core/event-store/src/projection.mjs:115-142`, NOT inside payload. ← REVIEW NEW HOLE fix |

If a signal is absent from `events.ndjson`, the pipeline shows that stage
as `◌ pending`. **No filesystem inspection.** ← REVIEW REQ #7.

### Schema + skill prerequisites (land BEFORE the dashboard code)

> **Round-4 review correction**: `nightshift dispatch append` does NOT take
> `--session` / `--agent` / `--action` / `--payload` flags. The real
> surface (`core/scripts/dispatch.mjs:cmdAppend` + the `--log` flag only)
> reads a complete event JSON from stdin. Specs below use the real
> surface. Session id is resolved by reading the last event in the log
> (every project always has at least the `session.start` from
> `nightshift init`, so this is safe).

1. `core/schemas/event.schema.json`: add `"plan.completed"` and
   `"analyze.completed"` to the `action.enum` array (currently around
   line 60-100 of the file). Comment in the diff: "added in hotfix-2
   for grounded pipeline-stage signals".

2. `core/skills/plan-writer/SKILL.md`: at the bottom of the protocol
   add a final mandatory step:

   ```markdown
   ## 9. Emit completion event (canonical pipeline-stage signal)

   On a successful plan-writer run, BEFORE returning, emit ONE event:

     SID="$(tail -n 1 tasks/events.ndjson | jq -r .session_id)"
     jq -nc --arg sid "$SID" '{
       session_id: $sid,
       agent: "plan-writer",
       action: "plan.completed",
       outcome: "success",
       payload: {
         artefacts: [
           "tasks/plan.md",
           "tasks/research.md",
           "tasks/data-model.md",
           "tasks/contracts/API.md"
         ]
       }
     }' | nightshift dispatch append --log tasks/events.ndjson

   Source of truth for session_id: the last existing event's session_id
   (every project has at least one `session.start` from
   `nightshift init`, so the tail is always populated). Do NOT generate
   a new session id — reuse the active one so the dashboard / status
   keeps the pipeline grouped.

   This event is what the dashboard / status reads to mark the `plan`
   pipeline stage as done. If you skip this step, /status will show
   `plan: ◌ pending` even after artefacts exist.
   ```

3. `core/skills/analyzer/SKILL.md`: identical pattern, **self-contained**
   (analyzer agent fills the values inline — no undefined shell vars).
   The agent ALREADY has these values in its working context from the
   report it just wrote (`tasks/analysis-<ts>.md`):

   ```markdown
   ## 9. Emit completion event (canonical pipeline-stage signal)

   On a successful analyzer run, BEFORE returning, emit ONE event.
   Compute the values from your own report file you just produced
   (count CRITICAL/WARNING/NOTE markers, extract the verdict line).
   Then substitute them inline — do NOT rely on shell variables
   that aren't defined in this prompt:

     SID="$(tail -n 1 tasks/events.ndjson | jq -r .session_id)"
     jq -nc --arg sid "$SID" '{
       session_id: $sid,
       agent: "analyzer",
       action: "analyze.completed",
       outcome: "success",
       payload: {
         verdict: "<VERDICT>",
         critical: <CRITICAL>,
         warning: <WARNING>,
         note: <NOTE>,
         report: "<REPORT_PATH>"
       }
     }' | nightshift dispatch append --log tasks/events.ndjson

   Substitute every `<...>` placeholder with a concrete value from
   the report you just produced — the jq program above is INVALID
   until you do, but is valid jq after substitution:
   - `<VERDICT>` → `accept` or `revise` (from your report's Verdict line).
   - `<CRITICAL>` → integer; count of CRITICAL findings.
   - `<WARNING>` → integer; count of WARNING findings.
   - `<NOTE>` → integer; count of NOTE findings.
   - `<REPORT_PATH>` → the path of the report you wrote, e.g.
     `tasks/analysis-20260421T012548Z.md`.

   Example after substitution (this WILL run):
     jq -nc --arg sid "$SID" '{
       session_id: $sid,
       agent: "analyzer",
       action: "analyze.completed",
       outcome: "success",
       payload: { verdict: "accept", critical: 0, warning: 12, note: 8,
                  report: "tasks/analysis-20260421T012548Z.md" }
     }' | nightshift dispatch append --log tasks/events.ndjson

   The dashboard / status reads this event to mark the `analyze`
   pipeline stage done.
   ```

4. Add regression test `core/event-store/test/schema-action-enum.test.mjs`
   (extend if exists, create if not) that asserts both `plan.completed`
   and `analyze.completed` validate against
   `core/schemas/event.schema.json` AND can round-trip through
   `EventStore.append()` + `read()` without raising
   `Invalid event: /action must be equal to one of the allowed values`
   (the actual rejection class for unknown action enum values, per
   reviewer's r5 reproduction). Without this regression, a future
   schema-pruner could remove the actions silently.

5. **Reviewer-only nice-to-have** (defer to hotfix-3 if time-tight): add
   a thin `nightshift dispatch event` helper that takes individual
   flags (`--session`, `--agent`, `--action`, `--payload`) and
   constructs the JSON, so skill prompts don't have to embed `jq`
   syntax. Out of scope for this hotfix; current jq-based form is
   the documented real surface.

### Implementation atomicity (CRITICAL — addresses round-5 hole #2)

The schema enum patch (step 1) and the SKILL.md changes (steps 2-3)
**must land in the same commit**. Order matters:

- If SKILL.md changes ship first: agents start emitting `plan.completed`
  / `analyze.completed`, the validator rejects them with
  `Invalid event: /action must be equal to one of the allowed values`
  (current behavior reproduced by reviewer in round 5; see
  `.nightshift/review-hotfix2-r5-gpt-5.4.md:8,12`). Every plan-writer /
  analyzer call would fail at the dispatch step.
- If schema patch ships first (without SKILL.md updates): the new enum
  values are valid but no producer emits them — pipeline section in
  H11 dashboard shows `pending` permanently for plan/analyze.

Therefore step 1 + 2 + 3 + 4 ship together as one atomic commit. Until
that commit lands, the snippets in steps 2 + 3 are NOT executable on
HEAD — they become executable only after the schema patch is in place.
Acknowledged explicitly so reviewer can stop flagging "not executable
today" — **correct claim is "executable AFTER atomic commit lands"**.

### Fix

Extend `core/scripts/project-status.mjs`:

#### `--dashboard` flag (default when invoked without other display flags)

Renders an ASCII panel covering 9 sections (top→bottom). Sections marked
**[NEW]** are added by H11; sections marked **[KEPT]** are preserved
from the existing contract:

```
═══ nightshift — <project_name> ═══
Session <id>  uptime <h>  zone <GREEN|YELLOW|RED>  last-event <Ns ago>  [NEW]

PIPELINE                              [NEW]
  ✓ intake               (signal: session.start{stage:intake})
  ✓ scaffold             (signal: decision.recorded{kind:intake_approval})
  ✓ plan                 (≥1 plan.completed)
  ✓ analyze              (≥1 analyze.completed)
  ◐ tasks                (≥1 task.contracted)
  ◌ implement            (no task.dispatched yet)
  ◌ deploy               (no deploy task accepted)

WAVES                                 [KEPT, expanded]
  Wave 0  ✓ accepted   N tasks
  Wave 1  ◐ in-progress ━━━━━━━━━ XX%  [accepted/total]
    TASK-ID  name                <status>   <model_or_?>
    ...
  Wave 2  ◌ pending

GUARDS / GATES (last hour)            [NEW]
  guard.violation: N
  gate.passed: N    gate.failed: N (RED if >0)

TOP COST                              [KEPT]
  TASK-ID name      <tokens>   $X.XX  <agent>
  ... (top 10 by aggregate cost)

PER-AGENT SHARE                       [KEPT]
  orchestrator      40%
  plan-writer       30%
  task-impl-reviewer 20%
  ... (rolling 24h)

BUDGET                                [NEW + KEPT 24h]
  in <K>   out <K>   cached <K>
  ~$X.XX (24h)  /  ~$Y.YY (all-time)  ← rolling-24h KEPT from existing
                                        /status contract per spec §...
  budget_partial: <true|false>        ← REVIEW REQ #8: true if any event
                                        on the dispatched/accepted path
                                        lacks `model` or `tokens` (H9
                                        deferral fallout). When true,
                                        print `~$≥X.XX (under-counted —
                                        see H9)` instead of a precise
                                        figure.

EVENTS: N    last: <Ns> ago (<action>)  [NEW]

OPEN QUESTIONS  N                     [KEPT — at bottom per existing
                                       /status contract]
  Q-01  <payload.question>  [wave/task]
  ...

PAUSED TASKS  N                       [KEPT — sourced from tasks/paused.md,
                                       at bottom per existing contract]
  TASK-ID — <reason from paused.md>
  ...
```

> **Section ordering decision** ← REVIEW REQ #3: round-2 had OPEN QUESTIONS
> + PAUSED TASKS moved up. That conflicts with `claude/commands/status.md:19-20`
> and `core/skills/project-status/SKILL.md:33-34` which place them at the
> bottom. Round 3 keeps them at the bottom to preserve the contract. The
> live-overnight visibility need (which motivated moving them up) is
> covered by H14 Layer B — morning digest's top section.

#### `--watch [N]` flag (default N=10s)

Clear screen + redraw every N seconds.

- ANSI clear/cursor-home ONLY when `process.stdout.isTTY === true`.
  If piped (`| grep`, `> file`), `--watch` REFUSES with exit 2 +
  message `--watch requires a TTY; use --json for piped consumption`.
  ← REVIEW REQ for TTY edge case.
- Tail-based reading: track byte offset between renders. Use
  `EventStore.read()` extension that tolerates a truncated last line
  during partial-write windows (return only complete-newline-terminated
  lines, defer the partial). ← REVIEW edge case for partial-line.

#### `--json` flag

Same data as the dashboard but as a single JSON object:

```json
{
  "session_id": "sess_...",
  "uptime_seconds": 12345,
  "zone": "green",
  "last_event_ts": "2026-...",
  "last_event_action": "task.accepted",
  "pipeline": { "intake": "done", "scaffold": "done", ... },
  "waves": [{ "wave": 0, "status": "accepted", "tasks": [...] }, ...],
  "open_questions": [{ "id": "Q-01", "text": "...", "wave": null, "task_id": null }, ...],
  "paused_tasks": [{ "task_id": "T0-X", "reason": "..." }, ...],
  "guards_last_hour": { "guard.violation": 0, "gate.passed": 12, "gate.failed": 0 },
  "top_cost": [{ "task_id": "...", "tokens": 12345, "cost_usd": 1.23, "agent": "..." }, ...],
  "per_agent_share": { "orchestrator": 0.40, ... },
  "budget": {
    "input_tokens": 312000,
    "output_tokens": 48000,
    "cached_tokens": 89000,
    "estimate_usd_all_time": 4.12,
    "estimate_usd_24h": 1.87,        ← REVIEW REQ #2: rolling-24h preserved
    "budget_partial": true,
    "missing_model_event_count": 23
  },
  "soft_warnings": [
    { "kind": "tokens_over_threshold", "task_id": "T0-X", "tokens": 234567, "threshold": 200000 },
    { "kind": "gate_failed_recent", "count": 1, "since_minutes": 45 }
  ],
  "events_total": 270
}
```

#### Slash command parity

Update `claude/commands/status.md` to invoke
`nightshift status "$PROJECT" --dashboard`. User typing
`/nightshift:status` inside Claude gets the rich dashboard, not the 3-
line summary.

### Acceptance ← EXPANDED PER REVIEW

New test `core/scripts/test/hotfix2-status-dashboard.test.mjs`:

- **F-A** (mid-wave fixture): events.ndjson representing project mid-
  wave-1 with 3 tasks accepted, 1 in progress, 2 pending, 2 open
  questions, 1 guard.violation, 1 paused task, 1 task with cumulative
  tokens > 200k, events spanning the last 30 hours (so rolling-24h is
  meaningfully different from all-time totals). Run dashboard.
  - Assert all 9 sections present.
  - Assert progress bar shows correct `[3/6]` and `50%`.
  - Assert open questions section lists exactly the 2 unanswered.
  - Assert paused-task section lists 1 reason from a synthetic
    `tasks/paused.md` in the fixture.
  - Assert NO ANSI escape codes when `process.stdout.isTTY === false`.
  - Assert top-cost / per-agent share survive (regression against
    existing `/status` contract).
  - **Assert rolling-24h total** appears as a distinct line in BUDGET
    section: `~$X.XX (24h) / ~$Y.YY (all-time)`. Numbers must differ
    on this fixture (events outside the 24h window contribute only to
    all-time). ← REVIEW REQ #2 fix.
  - **Assert >200k token warning** appears for the qualifying task:
    yellow highlight in TOP COST section + a soft-warnings line at the
    bottom of WAVES section reading
    `⚠ TASK-X cumulative tokens 234,567 (>200k threshold)`. ← REVIEW REQ #2 fix.
  - **Assert gate.failed warning** (red): if fixture has any
    `gate.failed` event in the last hour, GUARDS / GATES section's
    `gate.failed: N` count is rendered red. ← Existing soft-warning
    contract preserved.
- **F-B** (empty log): no events. Per
  `core/skills/project-status/SKILL.md:36-38`: assert output contains
  `"no sessions recorded yet"` and exits 0. ← REVIEW edge case.
- **F-C** (--watch piped): `--watch` invoked with `stdout` not a TTY.
  Assert exit 2 + helpful stderr. ← REVIEW REQ for TTY.
- **F-D** (partial-line tolerance): events.ndjson ending with a
  half-written JSON line (truncated). Dashboard renders the rest, does
  not crash. ← REVIEW edge case.
- **F-E** (--json budget honesty): fixture where some
  `task.dispatched` events lack `payload.model` (simulating H9
  deferral). Assert:
  - `budget.budget_partial === true`
  - `budget.missing_model_event_count > 0`
  - Both `budget.estimate_usd_24h` and `budget.estimate_usd_all_time`
    are present (numbers; under-count is the actual sum, not zero) —
    field names match the JSON shape spec at line 376-388. ← REVIEW
    new-hole #3 fix.
  - In the dashboard text rendering: BUDGET section line shows
    `~$≥X.XX (24h, under-counted) / ~$≥Y.YY (all-time, under-counted)`
    instead of precise `~$X.XX` figures.
- **F-F** (slash-command parity): assert `claude/commands/status.md`
  invokes the new flag.

New test `core/scripts/test/hotfix2-status-json.test.mjs`:

- Same F-A fixture, run with `--json`, JSON.parse stdout, assert all
  top-level keys present and types correct.

`core/scripts/test/nightshift-cli.test.mjs` (existing) must still pass —
the bare `nightshift status` (no flags) keeps backward compatibility:
either default-to-dashboard OR keep the 3-line summary if a flag isn't
provided. **Decision**: default to dashboard so user typing `nightshift
status` gets the new rich output (most common path); the old 3-line
form is reachable via `nightshift status --compact`. Update the CLI
test to reflect this. ← REVIEW suite-break risk.

### Out of scope

- Per-task token breakdown — reserved for hotfix-3.
- Cost computation override flags — read costs from
  `core/schemas/costs.json` only.
- Curses/blessed-style UI — pure ANSI clear+redraw is enough.

---

## Cross-cutting

### Implementation order ← REVIEW NOTE

Round-1 said H10 → H14 → H11. Round 2 keeps the same order BUT extracts
a shared "unresolved-human-wait" helper as the FIRST action of the H14
implementation. H11 (open-questions section) and H14 (Layer A + Layer B)
all consume this helper. Otherwise three modules will ship three
matching rules and drift. ← REVIEW cross-cutting #1.

Concrete: add `core/event-store/src/open-questions.mjs` exporting
`openQuestions(events)` returning `[{ id, ts, payload, wave, task_id }]`.
Reused by:
- `core/scripts/health-ping.mjs` (H14 Layer A)
- `core/scripts/morning-digest.mjs` (H14 Layer B)
- `core/scripts/project-status.mjs` (H11 OPEN QUESTIONS section)

This helper is the single source of truth on what counts as "resolved" —
both `question.answered` and `decision.recorded{question_id}`.

### Suite-break risk register ← REVIEW NOTE

| File | Why it might break | Mitigation |
|---|---|---|
| `claude/hooks/test/hooks.test.mjs` | H10 changes checkpoint.sh top-of-file behavior | New `hotfix2-checkpoint-dedup.test.mjs` covers; verify existing tests still see git tag + summary on first end |
| `core/scripts/test/health-ping-resume.test.mjs` | H14 reorders pinger pipeline | F-D fixture above explicitly preserves stale-task → claude --continue path |
| `core/scripts/test/single-writer.test.mjs` | H14 adds new `session.paused` calls | Single-writer invariant unchanged (still goes through `appendEvent`) |
| `core/scripts/test/nightshift-cli.test.mjs` | H11 changes default output of `nightshift status` | Update test expectations; add `--compact` form for backwards-compat |
| `docs/WALKTHROUGH.md:238-248` | Currently shows the old compact 3-line output; will go stale when default flips to dashboard | Update example block in same commit as H11 implementation. ← REVIEW NICE-TO-HAVE adopted. |

### Spec drift acknowledgement ← REVIEW NOTE

`NIGHTSHIFT_MASTER_SPEC.md:657-663` says pinger and digest do not write
to the project repo. Current code (pre-hotfix) already violates this:
`core/scripts/health-ping.mjs:32-37` writes `pinger.ping`,
`:135-165` writes `paused.md`, etc. H14 extends the violation by adding
`session.paused`. **This hotfix does not update the spec.** A spec
correction is a separate PR; document the deviation in the commit
message. The spec author's intent (don't write user code) is preserved —
we only write to ops surface (`tasks/events.ndjson`, `tasks/paused.md`,
`.nightshift/last-notified-questions`).

### Cross-cutting acceptance

- `pnpm test` green end-to-end. Current baseline: 253/253 on Darwin.
- Each hotfix lands as a separate commit with descriptive message
  matching the H{N}-{title} pattern. Order: open-questions helper →
  H10 → H14 → H11.
- `nightshift_v1_1_hotfix_tz.md` master file gets H10/H11/H14 marked
  as **done** in the Priority section.
- CHANGELOG entry under `[unreleased]`.

### Out of scope (this hotfix)

- H9 (skill subagents drop `model`) — graduates to hotfix-3.
- H13 (router tuning) — graduates to hotfix-3.
- B-02 (orchestrator without Task tool) — needs investigation pass first.
- H1 (namespace split for /nightshift:nightshift) — cosmetic, low priority.

---

## Round-7 closure of round-6 review's 2 cosmetic holes

Round-6 verdict: `revise` with two narrow issues:
1. ✅ `← inline:` annotations were INSIDE the jq code block, breaking
   syntax. Fixed: removed annotations from the jq program; placeholder
   guidance + worked example moved OUTSIDE the code block as prose.
2. ✅ Validator-error wording was `additionalProperties` (wrong);
   actual error is `/action must be equal to one of the allowed values`.
   Fixed verbatim per round-5 reproduction citation.

## Round-6 closure of round-5 review's 2 holes

Round-5 verdict: `revise` with two narrow issues:
1. ✅ Analyzer snippet was not self-contained ($VERDICT etc undefined).
   Fixed: rewritten as inline placeholders the analyzer agent fills
   from its own report. No undeclared shell variables.
2. ✅ Claim "executable as written today" was false because schema
   patch hasn't landed. Fixed: added explicit "Implementation atomicity"
   section requiring schema enum + SKILL.md changes to land in ONE
   atomic commit. Snippet correct claim is now "executable AFTER atomic
   commit lands", not "executable today on HEAD".

## Round-5 closure of round-4 review's 1 remaining hole

Round-4 verdict: `revise` with 1 issue — the `nightshift dispatch
append` call in the SKILL.md additions used flag-based syntax that
doesn't exist (real CLI takes JSON via stdin) and assumed `$SESSION` is
available without spec'ing where it comes from.

Round-5 fix:
- Skill prompts re-spec'd to use the real surface: stdin-JSON via
  `nightshift dispatch append --log tasks/events.ndjson`, with
  `session_id` resolved by reading the last event in events.ndjson via
  `tail -n 1 ... | jq -r .session_id`. Both producers (plan-writer and
  analyzer) use identical pattern via jq pipeline.
- Explicit note that the dashboard pipeline signal regresses to
  `pending` if the skill skips this step — agent has clear incentive to
  not forget.
- Optional flag-based helper (`nightshift dispatch event --session ...
  --agent ... --action ...`) acknowledged as a nice-to-have, deferred
  to hotfix-3 to avoid scope creep.

## Round-4 closure of round-3 review's 1 remaining + 3 new holes

Round-1 8 required → all closed in round 2.
Round-2 3 required + 2 nice-to-haves → 2/3 closed in round 3 (plan signal
deferred), 2/2 nice-to-haves done.
Round-3 1 remaining + 3 new internal-consistency holes → all closed in
round 4:

1. ✅ H11 `plan` signal grounded canonically: TZ now adds `plan.completed`
   AND `analyze.completed` to `core/schemas/event.schema.json` action
   enum + updates `core/skills/plan-writer/SKILL.md` and
   `core/skills/analyzer/SKILL.md` to emit them as the final step of
   each successful run. No more "best-effort". Pipeline derivation uses
   only canonical events.
2. ✅ Internal consistency on `analyze`: stage table, dashboard sketch,
   JSON shape, and acceptance F-A all use `analyze.completed` (single
   predicate everywhere). Round-3 had `payload.verdict=="accept"` in the
   table but old launch-trace match in the sketch.
3. ✅ Section ordering: OPEN QUESTIONS / PAUSED TASKS kept at bottom per
   existing `/status` contract (`claude/commands/status.md:19-20`,
   `core/skills/project-status/SKILL.md:33-34`). Round-3 had moved them
   up; reverted. Live-overnight visibility need covered by morning
   digest's top section (H14 Layer B).
4. ✅ JSON budget field names match in F-E: asserts on
   `budget.estimate_usd_24h` and `budget.estimate_usd_all_time` (the
   actual JSON spec keys at line 376-388), not nonexistent
   `budget.estimate_usd`.

Round-2 nice-to-haves still closed:
- ✅ `openQuestions()` drops malformed entries lacking `question_id`
  + logs to stderr.
- ✅ `docs/WALKTHROUGH.md:238-248` in suite-break register.
