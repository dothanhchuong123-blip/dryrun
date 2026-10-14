# A4: calibration

| | |
|---|---|
| When | Oct 17 and Oct 25 · optional |
| Upload | `SPEC.md`, `types.py`, `fixtures/scenarios/` (packed for you) |
| Pack | `uv run scripts/argon.py pack A4` |
| After | `uv run scripts/argon.py import A4`, then Claude check |

Steps: `prompts/argon/HOW-TO.md` → "Run a review". The prompt below is copied into `dist/argon/A4/PROMPT.txt` for you.

```text
The attached UPLOAD_ME.md contains the scenario files and parameter defaults (types.py) for a two-firm market simulator with logit consumer choice, an outside good, capacity limits, raw-material lead times and stockouts. Each tick is about one day of a consumer-electronics-style market.
For each parameter, say whether the value is plausible, too high or too low, and what behaviour a bad value would cause (for example everyone buys the outside good, permanent stockouts, prices pinned at the clamp). Give a suggested range with reasoning from economics, not invented citations. Flag any scenario whose shock size would make the market degenerate. Answer as a table.
```
