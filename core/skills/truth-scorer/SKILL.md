---
name: truth-scorer
description: Use to compute quality score from gate results. Score is for ranking only — never an acceptance criterion on its own. Formula in spec §14.2.
---

# truth-scorer

## Inputs

A gates JSON object:
```json
{
  "tests": "pass" | "fail" | {"passed": 3, "total": 4},
  "types": "pass" | "fail",
  "lint":  "pass" | "fail",
  "build": "pass" | "fail",
  "reuse":     0..1,   // optional
  "file_size": 0..1,   // optional
  "docs_sync": 0..1    // optional
}
```

## Protocol

Run:
```bash
node core/scripts/truth-score.mjs <gates.json>
```

Returns:
```json
{"score": 0.86, "breakdown": {...}, "weights": {...}}
```

## Guardrails
- **Never use the score as an acceptance threshold.** Hard gates decide acceptance.
- **Do not compute your own formula.** The formula is the script. Bumping weights is a schema change.
- **Optional gates missing = 1.0** (best-case) per spec §14.2. A missing `reuse` signal is not a reason to fail.
