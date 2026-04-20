---
description: Show compliance.md for a wave or overall. Read-only derived view.
argument-hint: "[wave <N>]"
---

Regenerate + display compliance.md.

Steps:

1. `nightshift compliance "$PWD"`
2. Print `tasks/compliance.md`:
   - If $ARGUMENTS is `wave <N>`: print only that wave's section.
   - Otherwise: print the full file.

This file is regenerated from `events.ndjson` on every invocation — it is not a live-edited document.
