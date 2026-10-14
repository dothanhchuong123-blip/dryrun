# Backend ↔ Frontend contract (SSE + REST)

Backend (T08) and frontend (T10–T12) are built in parallel against this file. **If you change it, update both sides in the same commit.**

All arrays indexed by firm are `[A, B]`. Shares are `[outside, A, B]`. Money is in USD. Time is in ticks.

## REST

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | none | `{"status":"ok"}` |
| GET | `/api/scenarios` | none | `[{id, title, subtitle, has_replay}]` |
| POST | `/api/runs` | `{scenario_id, mode: "live"\|"replay"}` | `{run_id, mode}`. Mode can be downgraded to `replay` by the spend guard. |
| GET | `/api/runs/{run_id}/events` | none | SSE stream (below) |
| POST | `/api/runs/{run_id}/shock` | `{text}` | `{accepted: bool}`. Custom shock goes to the Super parser. LIVE only. |
| POST | `/api/runs/{run_id}/stop` | none | `{stopped: true}` |
| GET | `/api/benchmark/export` | `?format=json\|md` | File download |

## SSE events

Each event is sent as `event: <name>` followed by `data: <json>`.

| event | data |
|---|---|
| `scenario` | `{run_id, scenario_id, title, mode, n_consumers, tick_seconds, epoch_ticks}` |
| `tick` | see below |
| `decision` | `{tick, role: "ceo_A"\|"ceo_B"\|"inventory"\|"shock_parser"\|"crowd", tier: "ultra"\|"super"\|"fast", model, decision: {...}, fallback_used, latency_ms}` |
| `reasoning` | `{role, delta}`: a streamed chunk of Ultra reasoning text |
| `reasoning_done` | `{role}` |
| `crowd` | `{tick, archetypes: [{id, label, mu:[a,b], sigma:[a,b], bubble}]}` |
| `grounding` | `{id, query, url, title, quote, param: "delta_c_raw"\|"delta_lead_time"\|"demand_shock", value, ts}` |
| `nash` | `{tick, actions: ["cut","hold","raise"], payoff_A: 3x3, payoff_B: 3x3, pure_ne: [[i,j],...], mixed_ne: {p_A:[3], p_B:[3]}\|null, chosen: [i,j], label: "nash"\|"price_war"\|"collusion"\|"other"}` |
| `stats` | `{tick, source: "live"\|"cloud", n, delta_mean, ci95: [lo,hi], cohens_d, p_value, chi2\|null, chi2_p\|null}` |
| `telemetry` | `{tiers: {ultra\|super\|fast: {calls, tokens_in, tokens_out, p50_ttft_ms, tok_per_s, errors}}, call_share: {tier: pct}, token_share: {tier: pct}, cost_usd, cost_all_ultra_usd, savings_pct, job: {id, status: "idle"\|"queued"\|"running"\|"verified"\|"failed"}}` |
| `mode` | `{mode: "live"\|"replay", reason}` |
| `error` | `{message, recoverable}` |

### `tick` payload

```json
{
  "tick": 12, "universe": "U1",
  "price": [95.0, 90.0], "qty": [210, 190], "demand": [220.5, 180.2], "sales": [210, 185],
  "unmet": [10.5, 0], "spill_in": [0, 5.0], "lost": 5.5,
  "inventory": [0, 40], "raw_inv": [120, 300], "rop": [260, 240], "orders": [400, 0],
  "profit": [1520.3, 980.1], "cum_profit": [15022.0, 11870.4],
  "shares": [0.18, 0.44, 0.38], "c_raw": 62.5, "lead_time": 5,
  "mc": [64.1, 63.0], "atc": [75.2, 76.9], "bullwhip": [1.8, 1.1],
  "choices_b64": "<base64 of N int8: 0=outside 1=A 2=B; U1 only>"
}
```

- Each tick sends one `tick` event for `U1` and one for `U2`. The U2 event omits `choices_b64`.
- `bullwhip` may be `null` until 8 ticks have passed.
- **Throttle:** the frontend applies at most one store update per tick. The arena reads `choices_b64` into a typed array held in a ref.

## Replay format

`fixtures/replays/<scenario_id>.jsonl` has one line per SSE event: `{"t": <seconds since start>, "event": "<name>", "data": {...}}`. The replayer re-emits each event at its recorded `t`.
