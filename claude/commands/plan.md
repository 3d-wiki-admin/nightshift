---
description: From tasks/spec.md produce tasks/plan.md + research.md + data-model.md + contracts/API.md. WebFetches for unfamiliar libs.
---

Run the plan-writer subagent via the Task tool.

Pre-check: `tasks/spec.md` must exist and be non-stub (not the unedited template). If it's a stub, instruct the user to run `/nightshift start` first; do not proceed.

The plan-writer will:
1. Read constitution + spec + open questions.
2. Produce plan.md, research.md, data-model.md, contracts/API.md.
3. For any lib not used elsewhere in the repo, WebFetch the official docs and cite the URL in research.md.
4. Emit `decision.recorded` events for each concrete decision; `question.asked` for unresolved forks.

Report back: files written, number of decisions recorded, number of new open questions.
