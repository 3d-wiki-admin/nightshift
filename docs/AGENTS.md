# Agents reference

All agents are defined once in `core/skills/<name>/SKILL.md` (the authoritative prompt). Frontend wrappers live in `claude/agents/<name>.md` and `codex/skills/<name>/SKILL.md`.

## Roster

| Agent | Frontend | Model | Invocation | Timeout |
|---|---|---|---|---|
| `orchestrator` | Claude | Claude Opus 4.7 | Chat / Task | — |
| `spec-writer` | Claude | Claude Opus 4.7 | Task | 10 min |
| `plan-writer` | Claude | Claude Opus 4.7 | Task | 10 min |
| `analyzer` | Claude | Claude Sonnet 4.6 | Task | 5 min |
| `task-decomposer` | Claude | Claude Opus 4.7 | Task | 10 min |
| `context-packer` | Codex | GPT-5.4-mini or Spark | `codex exec` | 5 min |
| `implementer` | Codex | **Router** (§6.1) | `codex exec` | 15 min |
| `task-spec-reviewer` | Claude | Sonnet 4.6 or 5.4-mini | Task / Bash | 5 min |
| `task-impl-reviewer` | Claude | Claude Opus 4.7 | Task | 10 min |
| `wave-reviewer` | Background | GPT-5.4 | `codex exec` (bg) | 60 min |
| `blocker-resolver` | Claude | Claude Opus 4.7 | Task | 10 min |
| `infra-provisioner` | Claude | Claude Opus 4.7 | Task | 15 min |
| `doc-syncer` | Claude | Claude Haiku 4.5 | Task | 3 min |
| `health-pinger` | launchd | Claude Haiku 4.5 | CLI | 2 min |
| `morning-digest` | launchd | Claude Haiku 4.5 | CLI | 2 min |

## Implementer router (§6.1)

| Condition | Model | Effort |
|---|---|---|
| `risk_class=safe` AND `diff_budget_lines ≤ 150` AND straightforward scope | `gpt-5.4` | default |
| `risk_class=review-required` OR `diff_budget_lines > 150` OR touches core types OR refactor | `gpt-5.3-codex` | high / xhigh |
| Mechanical fix (rename, obvious bugfix, text-only) | `gpt-5.3-codex-spark` | default |
| `risk_class=approval-required` | `gpt-5.3-codex` | xhigh |

Decision recorded as `task.routed` with `{model, effort, reason}`.

## Reviewer ≠ implementer

Enforced at dispatch time. If `reviewer_model == target_model`, the reviewer refuses and emits `guard.violation`. In practice:

- Codex implementer → Claude Opus reviewer.
- Claude implementer (degraded) → wherever possible, Codex reviewer; otherwise a different Claude tier.

## "NO LYING OR CHEATING"

The literal sentence *"Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING."* appears in every implementer and reviewer prompt. This is empirically effective; do not remove it "for tone".
