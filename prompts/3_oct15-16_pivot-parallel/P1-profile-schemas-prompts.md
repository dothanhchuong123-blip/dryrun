# P1: Pivot schemas, prompts and example businesses

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort high |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/3_oct15-16_pivot-parallel/P1-profile-schemas-prompts.md` |
| Parallel with | P2 (Argon, engine planner) · D7 (Argon, mockup). No shared files. |
| Time | ~3 h |
| Depends on | nothing (T05's schemas and prompts are already committed) |
| Target date | Oct 15 |
| Live spend | ≤ $0.05. Ask me before the live part. |

---
You are writing the LLM contracts, prompts and example data for the pivot: "Test your plans" (SPEC §15).

**Read only these:**
- `SPEC.md` §15 (all of it), §5, §13
- `docs/EVENTS.md` (v2): the "Shared objects" block
- `backend/agents/schemas.py` and `backend/agents/prompts.py`: extend them, and don't break what's there
- the public API of `backend/services/router.py` (`NemotronRouter.call`)
- `fixtures/scenarios/*.json` and `fixtures/archetypes.json`

**1. `backend/agents/schemas.py`: add these models.** Keep them flat (no Optional/Union) so the strict json_schema stays simple. The field names and bounds must match SPEC §15.3–15.4 exactly, because the engine (P2) uses the same keys.
- `BusinessProfile`.
  - `guessed_fields` is a `list[Literal[...]]` of the numeric field names.
  - Add a `model_validator` that clamps `unit_cost` below `0.95 × price`.
- `PlanSpecModel`: every PlanSpec field, with its bounds.
  - Add `def to_engine(self) -> dict`, which returns the plain dict P2's `PlanSpec(**d)` accepts.
- `AnalystStep`:
  - `thought` str ≤ 300
  - `action` Literal["test","finish"]
  - `plans` list[PlanSpecModel], 0–3
  - `pick` str ≤ 40
  - `why` str ≤ 300
- `MemoDraft`:
  - `headline` str ≤ 90
  - `why` str ≤ 400
  - `watch_out` str ≤ 300
  - `recheck_when` str ≤ 150

**2. `backend/agents/prompts.py`: add these pure message builders.** They return OpenAI-style `messages`.
- `profile_parser_messages(text)` → Super, thinking OFF.
  - Extract the profile and convert any currency to USD using fixed rough rates written into the prompt (25,000 VND = $1, €1 = $1.08). Never put notes inside fields.
  - List every value it had to infer in `guessed_fields`.
  - Write `search_terms` as news queries about the product's input costs and the supply route, not about the business itself.
- `analyst_messages(profile, news_items, results_table, crowd_notes, round, max_rounds, tested_names)` → Ultra, thinking ON.
  - The system prompt says it's a careful small-business analyst and the simulator is its tool.
  - It proposes at most 3 **new, different** plans per round (never re-test a name in `tested_names`), then picks.
  - It prefers plans that are still OK in the bad case, because a small business can't afford to gamble.
  - **It outputs decisions only and never invents numbers.** Every number it may cite is in the results table.
  - "Keep your reasoning SHORT: at most about 8 steps" (the §13 cost finding).
  - `results_table` is a compact text table: plan × shock with mean / bad case / % better, in $k with one decimal.
- `memo_messages(profile, pick_name, pick_spec, numbers, news_items)` → Ultra, thinking OFF.
  - Plain words for a busy owner.
  - It must not write any number that isn't in `numbers`. Tell it to refer to them as "the figures above".
- `plan_crowd_messages(archetypes, profile, plan_spec, rival_price, batch)` → Lightning.
  - The same output as `crowd_messages`.
  - The market view is: the business, its customers (`profile.customers` flavours each archetype's persona), the plan's price change, the rival's price, and any stock/supplier change.
  - Bubbles are ≤ 60 characters, first person, about the plan.

**3. Example businesses: `fixtures/examples/{pc_parts,furniture_eu,coffee_hcmc}.json`** (SPEC §15.8).
- Each file has `{id, title, subtitle, text, scenario_id, seed_queries, fallback_shock, profile}`.
- `text` is 2–4 plain sentences, as an owner would type them.
  - `coffee_hcmc`: a Ho Chi Minh City roaster selling robusta to about 60 independent cafés, rival Highland Supply.
  - `furniture_eu`: a Bình Dương maker shipping to Europe.
  - `pc_parts`: an online shop importing graphics cards.
- `seed_queries` and `fallback_shock`:
  - `pc_parts` and `furniture_eu` copy them from their scenario.
  - `coffee_hcmc` writes new robusta/coffee-price queries and uses `commodity_war`'s fallback shock.
- `profile` is filled in step 5.

**4. Tests: `tests/test_pivot_agents.py`** (no live calls).
- Every new model produces a strict schema through `router.to_strict_schema` with no `$ref`/`anyOf` surprises.
- Out-of-range values are rejected.
- `PlanSpecModel.to_engine()` keys equal the SPEC §15.4 field list.
- Each prompt builder renders with realistic inputs, stays under ~3k tokens (estimate with `len(text) / 4`) and mentions the JSON fields.
- All three example files load and their `profile` validates.

**5. Live check.** Ask me first. Expected cost ≤ $0.05.
- Run `profile_parser_messages` through `NemotronRouter` (Super) on the 3 example texts.
  - Hand-check each result against the text, fix the prompt until it's right, then save the checked profile into each example's `profile`.
- **Native tool calling, once, for the feedback log:**
  - Call Ultra with `tools=[{type:"function", function:{name:"test_plan", parameters: <PlanSpec schema>}}]` and a one-line request. Use the raw `openai` client; don't change the router.
  - Record whether it returns `tool_calls`, how the reasoning arrives, and the latency.
  - Add a row to `docs/FEEDBACK_LOG.md` either way. Our build uses strict-JSON actions (SPEC §15.6) whatever the result.
- One `analyst_messages` call on `coffee_hcmc` with a fake results table. Confirm the JSON validates and the plans make sense. Paste the `thought` and plans in your reply.

**Done when** pytest and ruff pass. Commit only your files as `P1: pivot schemas, prompts, example businesses`.
