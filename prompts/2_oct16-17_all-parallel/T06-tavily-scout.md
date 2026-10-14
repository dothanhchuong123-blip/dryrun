# T06: Tavily scout, shock grounding, scenarios

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort medium |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/2_oct16-17_all-parallel/T06-tavily-scout.md` |
| Parallel with | T03, T11, T12 (Argon) |
| Time | ~3 h |
| Depends on | T04 and T05 merged |

---
You are implementing the Tavily integration for the Market Digital Twin. It's also our entry for the Best Use of Tavily prize.

**Read only these:**
- `SPEC.md` §6, §7.1 (Tavily credits)
- the `grounding` event in `docs/EVENTS.md`
- the public API of `backend/services/router.py` and `backend/agents/schemas.py` / `prompts.py`

Check the installed `tavily-python` API first, e.g. `uv run python -c "import tavily, inspect; print(inspect.signature(tavily.AsyncTavilyClient.search))"`.

**`backend/services/tavily_scout.py`:**
- `TavilyScout(cache_dir="fixtures/tavily_cache", offline=False)`
  - Methods: `search(query, depth, time_range="week", include_domains)` and `extract(urls, query)`.
  - Disk cache keyed by the sha1 of the request. A cache hit makes no API call.
  - `offline=True` raises if a request isn't cached. Tests and REPLAY use this mode.
  - Count credits as you go: advanced search = 2, basic search = 1, extract = 1 per 5 URLs.
- `async ground_shock(scenario) -> (ShockVector, list[card])`:
  1. Advanced search.
  2. Extract the top 2 URLs.
  3. Send the text to Super with `shock_parser_messages` (thinking off).
  4. **Check that every quote appears in the extracted text.** Drop quotes that don't. If none are left, use the scenario's fallback shock.
  5. Emit cards in the EVENTS.md `grounding` format.
- `async news_check(scenario) -> (ShockVector | None, list[card])`: the judges' "Check live news" button (SPEC §6).
  - One `basic` search of the scenario's first seed query, then extract the top URL (≈ 2 credits), then the same Super parse and quote check.
  - **Bypasses the cache on purpose**: it must be a real runtime call. It still writes the response to the cache.
  - Cards carry `live: true`. The caller sets `applied`.
  - Report the credits used, so T08 can enforce `TAVILY_DAILY_CREDIT_CAP`.
- `DeepScout`
  - `should_trigger(history) -> str | None`: trigger on a margin drop of more than 15% over 3 ticks with no new shock, or on a lead-time spike.
  - When it triggers: Super writes the query (`ScoutQuery`), then run a basic search and the same pipeline.
  - At most one scout per epoch.

**Scenario files:** `fixtures/scenarios/{gpu_tariff,red_sea,commodity_war}.json`. Each needs:
- id, title, subtitle
- seed queries and `include_domains`
- `params_overrides` and `horizon_ticks` (≈ 80)
- a `fallback_shock`, used if Tavily or the parser fails

**Licensing:** `fixtures/tavily_cache/` is gitignored, because full article text must not go into the public repo. Only short quotes (≤ 300 chars) and URLs appear in events and replays.

**Tests** (mock both Tavily and the router):
- A cache hit makes no call.
- A fabricated quote is dropped.
- The trigger logic fires correctly.
- Offline mode raises on a cache miss.
- `news_check` skips the cache read and reports its credits.

**Live run** (≤ 15 Tavily credits and ≤ $0.03 of tokens): run `ground_shock` once for each of the 3 scenarios to fill the local cache. Report the cards it produced.

**Done when** pytest and ruff pass. Commit as `T06: Tavily scout + scenarios`.
