---
name: context-packer
description: Extract the minimal slice of spec/plan/data-model/contracts relevant to one task. Produces context-pack.md ≤500 lines. Runs on a cheap model (GPT-5.4-mini or Spark).
---

# context-packer (Codex adapter)

Implementation: see `core/skills/context-packer/SKILL.md` for the full protocol. This file is a Codex-specific adapter; the behavior is identical.

## Inputs (via env)
- `$NIGHTSHIFT_TASK_CONTRACT` — path to contract.md
- `$NIGHTSHIFT_PROJECT_DIR` — project root

## Output
`tasks/waves/<N>/<TASK-ID>/context-pack.md` with sections:
- Non-negotiables (verbatim from constitution)
- Goal (from contract)
- Allowed files (from contract)
- Spec excerpt
- Plan excerpt
- Data model excerpt
- API contract excerpt
- Reuse candidates
- Gotchas

## Hard rules
- ≤500 lines. Aim for 200-300.
- Never paraphrase constitution rules — quote verbatim.
- Never infer missing info. Mark as `[UNKNOWN — not in spec]` in Gotchas.

## Event
Emit `task.context_packed` with tokens consumed.
