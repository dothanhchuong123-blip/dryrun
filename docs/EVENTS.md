# Backend ↔ Frontend contract (SSE + REST), v2

**v2, 2026-10-14: the "Test your plans" pivot (SPEC §15).** **v2.1, 2026-10-15:** the realism update (SPEC §15 v3.1). It adds fields only; nothing was removed or renamed. v1's run/CEO events are gone. `tick`, `crowd`, `reasoning`, `telemetry`, `mode` and `error` keep their v1 shape, with small additions marked **(v2)**.

The backend (T08) and the frontend (F0–F3) are built in parallel against this file. **If you change it, update both sides in the same commit.**

All arrays indexed by firm are `[A, B]`: A = the user's business, B = the rival. Shares are `[outside, A, B]`. Money is in USD. Time is in weeks (1 tick = 1 week).

## Shared objects

```jsonc
// BusinessProfile (SPEC §15.3)
{ "business_name": "Saigon Roasters", "product_unit": "bag of roasted coffee",
  "price": 11.0, "unit_cost": 6.5, "weekly_sales": 280, "lead_time_weeks": 3, "stock_weeks": 2,
  "rival_name": "Highland Supply", "rival_price": 10.5, "supplier_region": "Central Highlands, Vietnam",
  "customers": "independent cafés", "search_terms": ["robusta coffee price Vietnam"],
  "country": "vietnam", "market_terms": ["chuỗi cà phê mới TP.HCM"],          // (v2.1)
  "exposed_cost_share": 0.85, "cash_available": 8000,                          // (v2.1) 0 = not given
  "guessed_fields": ["lead_time_weeks", "stock_weeks", "exposed_cost_share"] }

// PlanSpec (SPEC §15.4)
{ "name": "Stock up 4 wk + raise 3% wk 3", "price_change_pct": 3, "price_change_week": 3,
  "extra_stock_weeks": 4, "stock_week": 0, "marketing_change_pct": 0,
  "switch_supplier": false, "alt_cost_change_pct": 0, "alt_lead_time_weeks": 3, "alt_shock_exposure": 0.3 }

// ShockCase (SPEC §15.5). delta_c_raw = change in the news INPUT's price, not in your unit cost (§15.5.1)
{ "id": "s2", "label": "Beans +31% and Highland cuts 5%", "delta_c_raw": 0.31, "delta_lead_time": 1,
  "demand_shock": 0.0, "onset_week": 2, "ramp_weeks": 3,
  "rival_price_change_pct": -5, "share_shift_pct": 0,                              // (v2.1)
  "likelihood": "possible", "why": "Highland is bigger and may defend its cafés",   // (v2.1)
  "source_ids": ["n1", "m1"], "origin": "ai",                                       // (v2.1) origin: news|ai|default
  "cost_line": "Beans +31% × 85% of your cost is beans = your cost +26% (+$1.71 a bag)" } // (v2.1) built by wording.cost_line

// CellBridge (SPEC §15.5.2): the five lines sum to mean_delta_usd
{ "cost_usd": 2100, "price_usd": 1500, "volume_usd": -700, "marketing_usd": 0, "holding_usd": -200 }  // = +2,700
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
| `news` | `{items: [{id, kind, title, url, source, published, quote, shock: {delta_c_raw, delta_lead_time, demand_shock}\|null, cost_line\|null, impact_usd\|null, impact_p5_usd\|null, live, applied}], used_for_grid: id\|null}`. Sent once after the search; sent again (one item) for each "Check live news". **(v2.1)** `kind: "supply"\|"market"`. Supply items have ids `n1…` and carry `shock`, `cost_line` and impact. Market items (ids `m1…`, local-market search) have those fields `null` and `quote` holds a ≤ 200-char snippet. |
| `scenarios` **(v2.1)** | `{thought, unmodelled: [{text, source_id\|null}], fallback_used}`: Ultra's step 0b note and the risks it couldn't put numbers on. Sent just before `shocks`. |
| `shocks` | `{cases: [ShockCase × 2–6]}`: the grid's columns. `news` is first; then Ultra's `s1…s5`, or the 4 default columns if Ultra failed. **(v2.1: was × 4)** |
| `plan` | `{name, source: "seed"\|"ai"\|"user", round, spec: PlanSpec}` |
| `crowd` | `{plan_name, archetypes: [{id, label, mu: [a, b], sigma: [a, b], bubble}]}` **(v2: `plan_name` replaces `tick`)** |
| `grid_cell` | `{plan_name, shock_id, n, mean_delta_usd, p5_delta_usd, p_better, mean_profit_usd, source: "local"\|"cloud", bridge: CellBridge, steady_rival_delta_usd, peak_cash_usd, payback_week\|null, over_cash}` **(v2.1: everything after `source`)** |
| `grid_summary` | `{baseline_profit_usd: {shock_id: usd}, best_today: plan_name, safest: plan_name, verified: bool}`. Sent after each round, and again when the cloud job finishes. |
| `agent_step` | `{round, kind: "think"\|"test"\|"result"\|"shoppers"\|"finish"\|"fallback", text, plan_name\|null, tier: "ultra"\|"super"\|"fast"\|"engine", latency_ms\|null}`. `text` ≤ 300 characters, plain words. |
| `reasoning` | `{role: "analyst"\|"scenarios", round, delta}` (v2.1: `scenarios` is step 0b, round 0): a streamed chunk of Ultra's raw thinking (behind "Show full Nemotron thinking") |
| `reasoning_done` | `{role: "analyst"\|"scenarios", round}` |
| `memo` | `{plan_name, headline, why, watch_out, recheck_when, numbers: {shock_id: "news", mean_delta_usd, p5_delta_usd, p_better, n, verified, bridge, steady_rival_delta_usd, peak_cash_usd, payback_week, over_cash, cash_available}, cost_line, sources: [{title, url, quote}], not_modelled: {fixed: [str], found: [{text, source_id\|null}]}, fallback_used}` **(v2.1: `bridge` … `cash_available`, `cost_line`, `not_modelled`)** |
| `telemetry` | as v1: `{tiers: {ultra\|super\|fast: {calls, tokens_in, tokens_out, p50_ttft_ms, tok_per_s, errors}}, call_share, token_share, cost_usd, cost_all_ultra_usd, savings_pct, job: {id, status: "idle"\|"queued"\|"running"\|"verified"\|"failed"}}` |
| `mode` | `{mode: "live"\|"replay", reason}` |
| `error` | `{message, recoverable}` |
| `done` | `{analysis_id, cost_usd}` |

## Replay stream events (one grid cell, week by week)

| event | data |
|---|---|
| `replay_start` | `{replay_id, plan_name, shock_id, shock_label, weeks: 24, n_consumers, week_seconds}` |
| `tick` | the v1 payload below. `universe: "U1"` = the plan, `"U2"` = do nothing. |
| `marker` | `{week, kind: "shock"\|"price_change"\|"stock_ordered"\|"stock_arrives"\|"sold_out"\|"rival_move"\|"rival_price"\|"new_player", firm: "A"\|"B"\|null, text}`. `text` ≤ 14 words; it drives the arena caption and the timeline pins. |
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

- **(v2.1)** extra keys, all in real units: `"unit_cost": [6.9, 7.6]` (weighted-average material cost per unit), `"cover_weeks": [2.9, 1.4]`, `"in_transit": [560, 280]`, and on U1 only `"cum_cash_delta": -7280.0` (cumulative cash vs do nothing).
- Each week sends one `tick` for `U1` and one for `U2`. The U2 event omits `choices_b64` and `cum_cash_delta`.
- `bullwhip` may be `null` until 8 weeks have passed.
- **Throttle:** the frontend applies at most one store update per week. The arena reads `choices_b64` into a typed array held in a ref.

## Replay format

- Recorded analysis: `fixtures/replays/analysis_<example_id>.jsonl`.
- Recorded cell replay: `fixtures/replays/cell_<example_id>_<plan-slug>_<shock_id>.jsonl`. Record the memo's plan in the `news` column for each example.
- One line per SSE event: `{"t": <seconds since start>, "event": "<name>", "data": {...}}`. The replayer re-emits each event at its recorded `t`.
- Cells without a recording are simulated on demand. The engine is free and takes < 0.3 s per cell.
