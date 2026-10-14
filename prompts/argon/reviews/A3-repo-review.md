# A3: repo review

| | |
|---|---|
| When | Oct 18 (after T07) and Oct 26 (before freeze) · **must-do** |
| Upload | the whole repo, ~30–60k tokens (packed for you) |
| Pack | `uv run scripts/argon.py pack A3` |
| After | `uv run scripts/argon.py import A3`, then Claude check on **Opus 5.5** |

Steps: `prompts/argon/HOW-TO.md` → "Run a review". The prompt below is copied into `dist/argon/A3/PROMPT.txt` for you.

```text
The attached UPLOAD_ME.md bundles a Python (FastAPI, NumPy) + Next.js repo, one file per "## `path`" heading. SPEC.md inside it is the source of truth and CLAUDE.md lists the guardrails.
Review for real bugs only: logic errors, wrong math versus SPEC §4, async or race issues, unhandled LLM or network failures, rate-limit or spend-cap bypasses, secrets handling, and code that breaks the guardrails (an LLM computing outcomes, hardcoded telemetry numbers, model IDs hardcoded instead of read from settings, I/O inside backend/engine).
Skip style nits. For each: severity (crash / wrong result / risk), file:line, the exact quoted line, why, and the smallest fix. Max 20, most severe first. Finally list the 3 riskiest untested paths.
```
