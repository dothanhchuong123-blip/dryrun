# A7: nemotron vs argon

| | |
|---|---|
| When | Oct 25 · optional (gives honest data for Devpost Q12) |
| Upload | `dist/ceo_prompt_example.md`. **First**, ask any Claude session: *"Print the fully rendered CEO messages for Scenario 1 at tick 40 to `dist/ceo_prompt_example.md`, plus Ultra's actual decision for that state if one is logged."* |
| Pack | `uv run scripts/argon.py pack A7` |
| After | `uv run scripts/argon.py import A7`, then compare Argon's answer with Ultra's yourself, then add one row to `docs/FEEDBACK_LOG.md` marked **qualitative, n = 1** |

Steps: `prompts/argon/HOW-TO.md` → "Run a review". The prompt below is copied into `dist/argon/A7/PROMPT.txt` for you.

```text
The attached UPLOAD_ME.md contains a decision prompt for a CEO agent in a market simulator. Answer it exactly as the prompt asks: give your reasoning first in under 200 words, then output only the JSON it requests.
```
