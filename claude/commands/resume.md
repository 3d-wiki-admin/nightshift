---
description: Resume interrupted work — replays events → state.json and re-enters the live wave where it left off.
---

Resume the most recent session.

Steps:
1. Run `nightshift replay tasks/events.ndjson --write` to refresh `state.json`.
2. Inspect state.json:
   - If no session is open (last event was `session.end` / `session.halted` before any new work), print "no in-flight session to resume" and stop.
   - Otherwise find the most recent wave with status `in_progress` and its tasks with status ∈ {`dispatched`, `blocked`, `reviewing`, `context_packed`}.
3. For each stalled task (last event > 15 min ago):
   - If status = `blocked` → invoke `blocker-resolver`.
   - If status = `dispatched` but lease expired → release lease, re-route per §6.1 with upgraded effort.
   - If status = `reviewing` → invoke `task-impl-reviewer` again.
4. For each healthy in-flight task: wait for the existing dispatch to return.
5. Emit `pinger.ping` with `source: /resume`.

Print a 3-line summary: resumed tasks / newly paused tasks / nothing-to-do.
