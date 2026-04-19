---
description: List open questions awaiting user response. Answer with /decide "<text>" --for <Q-id>.
---

Read `tasks/questions.md` and `tasks/state.json` → `open_questions[]`.

Print as:

```
Open questions (<N>):

Q-01 — <title>
    asked: <ts>   by <agent>   about task <task_id?> / spec § <section?>
    <body first 3 lines>

Q-02 — ...
```

Tail: "Answer via `/decide \"<your answer>\" --for Q-01` to unblock dependents."

If `open_questions` is empty, print "no open questions — clean" and exit.
