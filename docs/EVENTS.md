# Backend ↔ Frontend contract (SSE + REST), v2

**v2, 2026-10-14: the "Test your plans" pivot (SPEC §15).** v1's run/CEO events are gone. `tick`, `crowd`, `reasoning`, `telemetry`, `mode` and `error` keep their v1 shape, with small additions marked **(v2)**.

The backend (T08) and the frontend (F0–F3) are built in parallel against this file. **If you change it, update both sides in the same commit.**

All arrays indexed by firm are `[A, B]`: A = the user's business, B = the rival. Shares are `[outside, A, B]`. Money is in USD. Time is in weeks (1 tick = 1 week).

## Shared objects

```jsonc
// BusinessProfile (SPEC §15.3)
{ "business_name": "Saigon Roasters", "product_unit": "bag of roasted coffee",
  "price": 38.0, "unit_cost": 21.0, "weekly_sales": 280, "lead_time_weeks": 3, "stock_weeks": 2,
  "rival_name": "Highland Supply", "rival_price": 37.0, "supplier_region": "Central Highlands, Vietnam",
  "customers": "independent cafés", "search_terms": ["robusta coffee price Vietnam"], "guessed_fields": ["lead_time_weeks", "stock_weeks"] }

// PlanSpec (SPEC §15.4)
{ "name": "Stock up 4 wk + raise 3% wk 3", "price_change_pct": 3, "price_change_week": 3,
  "extra_stock_weeks": 4, "stock_week": 0, "marketing_change_pct": 0,
  "switch_supplier": false, "alt_cost_change_pct": 0, "alt_lead_time_weeks": 3, "alt_shock_exposure": 0.3 }

// ShockCase (SPEC §15.5)
{ "id": "news", "label": "Beans +31% (today's news)", "delta_c_raw": 0.31, "delta_lead_time": 1,
  "demand_shock": 0.0, "onset_week": 2, "ramp_weeks": 3 }
```

## REST

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | none | `{"status":"ok"}` |
| GET | `/api/examples` | none | `[{id, title, subtitle, text, has_replay}]` (the 3 example businesses, SPEC §15.8) |
| POST | `/api/profile/parse` | `{text}` | `{profile: BusinessProfile, fallback_used}`. One Super call. Rate limit: 5 per IP per hour; spend guard. |
| POST | `/api/analyses` | `{example_id}` **or** `{profile}`, plus `mode: "live"\|"replay"` | `{analysis_id, mode}`. An example in REPLAY plays its recording. A custom profile always runs LIVE; if the per-IP limit or the spend guard trips, it returns HTTP 429 with `{reason}`. |
| GET | `/api/analyses/{id}/events` | none | SSE stream (below) |
| POST | `/api/analyses/{id}/plans` | `{plan: PlanSpec}` | `{accepted}`. Adds a user plan row. Engine only, so it's free and **also works in REPLAY**. The cells arrive as `plan` + `grid_cell` events with `source: "user"`. At most 4 user plans per analysis. |
| POST | `/api/analyses/{id}/news-check` | none | `{accepted, reason?}`. "Check live news" (SPEC §6, §15.7): a real Tavily call for this profile, in LIVE **and** REPLAY. The result arrives as a `news` event with `live: true, applied: false`. Limits: 1 per IP per minute, plus `TAVILY_DAILY_CREDIT_CAP`. |
| POST | `/api/analyses/{id}/verify` | none | `{accepted, job_id?}`. Submits the 10,000-per-cell Serverless Job (P1). Progress arrives in `telemetry.job`, and the results as `grid_cell` events with `source: "cloud"`. |
| POST | `/api/analyses/{id}/replay` | `{plan_name, shock_id, speed?}` | `{replay_id}`. Simulates one cell week by week (SPEC §15.9). |
| GET | `/api/replays/{replay_id}/events` | none | SSE stream of `replay_start`, `tick`, `marker`, `replay_done` |
| GET | `/api/analyses/{id}/memo` | `?format=md` | The decision memo as a Markdown download |
| POST | `/api/analyses/{id}/stop` | none | `{stopped: true}` |
| GET | `/api/benchmark/export` | `?format=json\|md` | File download |

## Analysis stream events

Each event is sent as `event: <name>` followed by `data: <json>`, in roughly this order:

| event | data |
|---|---|
| `analysis` | `{analysis_id, mode, example_id\|null, profile, horizon_weeks: 24, n_paths: 1000}` |
| `news` | `{items: [{id, title, url, source, published, quote, shock: {delta_c_raw, delta_lead_time, demand_shock}, impact_usd, impact_p5_usd, live, applied}], used_for_grid: id\|null}`. Sent once after the search; sent again (one item) for each "Check live news". |
| `shocks` | `{cases: [ShockCase × 4]}`: the grid's columns |
| `plan` | `{name, source: "seed"\|"ai"\|"user", round, spec: PlanSpec}` |
| `crowd` | `{plan_name, archetypes: [{id, label, mu: [a, b], sigma: [a, b], bubble}]}` **(v2: `plan_name` replaces `tick`)** |
| `grid_cell` | `{plan_name, shock_id, n, mean_delta_usd, p5_delta_usd, p_better, mean_profit_usd, source: "local"\|"cloud"}` |
| `grid_summary` | `{baseline_profit_usd: {shock_id: usd}, best_today: plan_name, safest: plan_name, verified: bool}`. Sent after each round, and again when the cloud job finishes. |
| `agent_step` | `{round, kind: "think"\|"test"\|"result"\|"shoppers"\|"finish"\|"fallback", text, plan_name\|null, tier: "ultra"\|"super"\|"fast"\|"engine", latency_ms\|null}`. `text` ≤ 300 characters, plain words. |
| `reasoning` | `{role: "analyst", round, delta}`: a streamed chunk of Ultra's raw thinking (behind "Show full Nemotron thinking") |
| `reasoning_done` | `{role: "analyst", round}` |
| `memo` | `{plan_name, headline, why, watch_out, recheck_when, numbers: {shock_id: "news", mean_delta_usd, p5_delta_usd, p_better, n, verified}, sources: [{title, url, quote}], fallback_used}` |
| `telemetry` | as v1: `{tiers: {ultra\|super\|fast: {calls, tokens_in, tokens_out, p50_ttft_ms, tok_per_s, errors}}, call_share, token_share, cost_usd, cost_all_ultra_usd, savings_pct, job: {id, status: "idle"\|"queued"\|"running"\|"verified"\|"failed"}}` |
| `mode` | `{mode: "live"\|"replay", reason}` |
| `error` | `{message, recoverable}` |
| `done` | `{analysis_id, cost_usd}` |

## Replay stream events (one grid cell, week by week)

| event | data |
|---|---|
| `replay_start` | `{replay_id, plan_name, shock_id, shock_label, weeks: 24, n_consumers, week_seconds}` |
| `tick` | the v1 payload below. `universe: "U1"` = the plan, `"U2"` = do nothing. |
| `marker` | `{week, kind: "shock"\|"price_change"\|"stock_ordered"\|"stock_arrives"\|"sold_out"\|"rival_move", firm: "A"\|"B"\|null, text}`. `text` ≤ 14 words; it drives the arena caption and the timeline pins. |
| `replay_done` | `{replay_id, cum_profit_usd: {U1, U2}}` |

### `tick` payload (unchanged from v1, values in USD and real units)

```json
{
  "tick": 12, "universe": "U1",
  "price": [39.14, 37.5], "qty": [290, 270], "demand": [301.5, 262.2], "sales": [290, 262],
  "unmet": [11.5, 0], "spill_in": [0, 5.0], "lost": 5.5,
  "inventory": [0, 40], "raw_inv": [820, 610], "rop": [700, 620], "orders": [0, 0],
  "profit": [4980.3, 4120.1], "cum_profit": [58022.0, 49870.4],
  "shares": [0.18, 0.44, 0.38], "c_raw": 27.5, "lead_time": 4,
  "mc": [27.5, 27.5], "atc": [27.9, 27.6], "bullwhip": [1.8, 1.1],
  "choices_b64": "<base64 of N int8: 0=outside 1=A 2=B; U1 only>"
}
```

- Each week sends one `tick` for `U1` and one for `U2`. The U2 event omits `choices_b64`.
- `bullwhip` may be `null` until 8 weeks have passed.
- **Throttle:** the frontend applies at most one store update per week. The arena reads `choices_b64` into a typed array held in a ref.

## Replay format

- Recorded analysis: `fixtures/replays/analysis_<example_id>.jsonl`.
- Recorded cell replay: `fixtures/replays/cell_<example_id>_<plan-slug>_<shock_id>.jsonl`. Record the memo's plan in the `news` column for each example.
- One line per SSE event: `{"t": <seconds since start>, "event": "<name>", "data": {...}}`. The replayer re-emits each event at its recorded `t`.
- Cells without a recording are simulated on demand. The engine is free and takes < 0.3 s per cell.
