# T05: Agent schemas and prompts

| | |
|---|---|
| Model | **Sonnet 5.5** at effort high, or Opus 5.5 if you want the best CEO prompt |
| Time | ~3 h |
| Depends on | nothing |
| Run in parallel with | T01, T02, T04, T10 |

---
You are writing the LLM contracts and prompts for the Market Digital Twin.

**Read only these:**
- `SPEC.md` §2, §3.3, §4.4 (labels), §5, §6 (Grounding bullet), §13 (reasoning-cap finding)
- `backend/engine/types.py`

**`backend/agents/schemas.py`** (Pydantic v2, with `Field` constraints):
- Models: `Evidence`, `ShockVector`, `InventoryDecision`, `CEODecision`, `ArchetypeSentiment`, `CrowdBatch`, and `ScoutQuery {query}`.
  - Keep them flat. Avoid Optional/Union, so the strict json_schema stays simple.
  - `ArchetypeSentiment` fields: `id, mu_a, mu_b, sigma_a, sigma_b, bubble (≤60 chars)`. **Update the SPEC §5 snippet to match.**
- Helpers:
  - `ceo_pair_to_decision(a, b) -> FirmDecision`
  - `crowd_to_sentiment(batches) -> CrowdSentiment (12, 2)`
  - `shock_to_engine(ShockVector) -> Shock`

**`backend/agents/prompts.py`**: pure functions that return `messages` lists.
- `ceo_messages(firm, state_summary: dict, rival_history, nash_hint: dict | None)`
  - System prompt covers:
    - the CEO role, and the objective: maximise cumulative profit over the horizon and survive shocks
    - repeated-game reasoning: anticipate the rival's best response, and avoid ruinous price wars without being naive
    - the hard constraints, and the instruction to output JSON only
  - **Tell the model to keep its reasoning short (about 8 steps or fewer).** Token Factory ignores reasoning-budget parameters, so the prompt is our only cost lever.
  - The state summary must stay under ~1.5k tokens. It covers:
    - the last 8 ticks of prices, sales, inventory and profit for both firms
    - MC, ATC, c_raw and lead time
    - quotes from the active shock
    - the rival's last action
- `shock_parser_messages(articles: list[{url, title, content}], scenario_hint)`
  - Ask for a `ShockVector` with conservative magnitudes and a severity.
  - Every evidence quote must be **an exact substring** of the provided text.
- `inventory_messages(firm, inventory_summary, shock)`: choose ω ∈ [-0.5, 2] with a one-line rationale. Explain the behavioural meaning of ω to the model.
- `crowd_messages(archetypes: list[dict], market_view)`: covers 6 archetypes per call. For each, return μ and σ toward A and B, plus a fun first-person thought bubble of 60 characters or fewer.
- `scout_query_messages(symptom)`: write one news-search query.

**`fixtures/archetypes.json`:** the 12 archetypes, each with `id, label, income, sensitivity, loyalty, persona`.
- IDs 1..12 in this nested order: income {low, mid, high} × sensitivity {hunter, moderate} × loyalty {A, B}. This must match T01's `make_archetypes`.

**Tests in `tests/test_agents.py`:**
- Every schema converts to a strict schema and round-trips a sample (copy `to_strict_schema` locally if T04 hasn't landed yet).
- Clamping works.
- Each prompt builder's output is under ~6k tokens (estimate as chars/4).

**Live check** (≤ $0.05; ask me before spending more): write `scripts/try_prompts.py`, using the raw `openai` client pattern from `scripts/day1_check.py`.
- Run each prompt once against its real model, with a realistic fake state.
- Save the results to `bench/results/prompts_try_<ts>.json`.
- Report the CEO prompt's reasoning tokens and latency. If reasoning goes over ~1,500 tokens, tighten the prompt and test again.

**Done when** pytest and ruff pass. Commit as `T05: agent schemas, prompts, archetypes`.
