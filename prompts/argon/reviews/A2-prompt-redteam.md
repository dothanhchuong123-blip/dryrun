# A2: prompt redteam

| | |
|---|---|
| When | Oct 17, after T05 is committed · optional |
| Upload | `SPEC.md`, `backend/agents/`, `fixtures/archetypes.json` (packed for you) |
| Pack | `uv run scripts/argon.py pack A2` |
| After | `uv run scripts/argon.py import A2`, then Claude check |

Steps: `prompts/argon/HOW-TO.md` → "Run a review". The prompt below is copied into `dist/argon/A2/PROMPT.txt` for you.

```text
The attached UPLOAD_ME.md contains the prompts and JSON schemas for the LLM agents in a market simulator (CEO agents choose price, production and marketing; a parser turns news text into a shock vector; a crowd model outputs sentiment per consumer archetype), plus SPEC.md. Outputs are validated by strict JSON schema and then clamped.
Find: ambiguous instructions; fields the model could satisfy while being useless (for example always hitting the clamp); places where the prompt invites the model to compute outcomes it should not (only decisions are allowed; the engine computes revenue and profit); prompt-injection risk from news text in the parser; anything that would make the reasoning very long (reasoning length is controlled only by the prompt).
Then write 8 adversarial test states, as JSON matching the prompts' input, that would most likely break these prompts, each with the failure you expect.
Cite file:line with the quoted line for every finding.
```
