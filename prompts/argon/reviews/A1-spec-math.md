# A1: spec math

| | |
|---|---|
| When | Oct 15 (today) · **must-do** |
| Upload | `SPEC.md`, `backend/engine/types.py` (packed for you) |
| Pack | `uv run scripts/argon.py pack A1` |
| After | `uv run scripts/argon.py import A1`, then Claude check (`prompts/argon/check-review.md`) |

Steps: `prompts/argon/HOW-TO.md` → "Run a review". The prompt below is copied into `dist/argon/A1/PROMPT.txt` for you.

```text
You are reviewing the design of a market simulator before it is coded. The attached UPLOAD_ME.md contains SPEC.md (the design) and backend/engine/types.py (the data contract).
Check ONLY: §4 (engine math), §4.6 (statistics), §4.7 (tick order) and their consistency with types.py.
Look for: math errors; formulas that can produce NaN, inf or negative stock; spillover or goodwill rules that leak or create demand; tick-order steps that read a value before it is computed; statistical tests whose assumptions do not hold (paired t-test with common random numbers, Cohen's d, chi-square); fields used in §4 but missing from types.py.
For each finding give: severity (bug / risk / nit), the § and the exact quoted line, why it is wrong, and the smallest fix. Max 15 findings, most severe first. Do not rewrite the spec. Say "no issue" for each area you checked and found clean.
```
