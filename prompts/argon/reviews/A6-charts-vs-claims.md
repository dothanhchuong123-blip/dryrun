# A6: charts vs claims

| | |
|---|---|
| When | Oct 26 · optional |
| Upload | `docs/FEEDBACK.md` + benchmark PNGs (packed for you) |
| Pack | `uv run scripts/argon.py pack A6` |
| After | `uv run scripts/argon.py import A6`, then Claude check |

Steps: `prompts/argon/HOW-TO.md` → "Run a review". The prompt below is copied into `dist/argon/A6/PROMPT.txt` for you.

```text
Attached: benchmark and statistics charts plus a draft report (UPLOAD_ME.md) that makes claims about them.
For each claim in the report, check it against the charts: supported / not supported / can't tell. Point out charts that mislead (truncated axes, missing units, n not shown, missing confidence intervals) and any claim stronger than the data. Answer as a table.
```
