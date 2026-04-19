# Skills index

All skills below are `SKILL.md` files under `core/skills/<name>/`. They follow the Claude Code skill format (frontmatter: `name`, `description`). Codex consumes the same files via a thin adapter in `codex/skills/`.

| # | Name | Model | Purpose |
|---|---|---|---|
| 1 | `project-bootstrap` | Opus 4.7 | New project scaffold (memory/, tasks/, CI, .env.template). |
| 2 | `spec-writer` | Opus 4.7 | Interview → constitution + spec. |
| 3 | `plan-writer` | Opus 4.7 | Spec → plan + research + data-model + API. |
| 4 | `analyzer` | Sonnet 4.6 | Read-only cross-artifact consistency check. |
| 5 | `task-decomposer` | Opus 4.7 | Plan → wave of contracts with `[P]` markers. |
| 6 | `wave-orchestrator` | Opus 4.7 | Drives a wave: dispatch, leases, review, accept. |
| 7 | `context-packer` | GPT-5.4-mini / spark | Minimal per-task context pack (≤500 lines). |
| 8 | `task-impl-review` | Opus 4.7 (differ from implementer) | Dimension review + hard gates. |
| 9 | `wave-review` | GPT-5.4 | 60-min adversarial wave review. |
| 10 | `post-task-sync` | Haiku 4.5 | Update index/state/compliance after acceptance. |
| 11 | `project-status` | Haiku 4.5 | ASCII dashboard. |
| 12 | `infra-provisioner` | Opus 4.7 | Service creation / rotation with WebFetch-first. |
| 13 | `preflight-check` | Haiku 4.5 | Pre-sleep readiness validator. |
| 14 | `truth-scorer` | deterministic (no LLM) | Quality score per §14.2 formula. |
| 15 | `compliance-reporter` | deterministic (no LLM) | Rebuild compliance.md from log. |
| 16 | `checkpoint-manager` | deterministic (no LLM) | Git tag / rollback. |

## Invariants (for all skills)

1. Every LLM-driven skill MUST carry the literal sentence *"Never mark a task complete unless ALL acceptance criteria are met. Never fabricate evidence. NO LYING OR CHEATING."* where it performs acceptance decisions.
2. No skill writes to `events.ndjson` directly — only through `core/scripts/dispatch.mjs`.
3. Reviewer skills MUST refuse to run if their model equals the implementer's model for the same task.
4. Read-only skills (`analyzer`, `preflight-check`, `project-status`, `truth-scorer`) MUST NOT modify any file outside their own report output.
