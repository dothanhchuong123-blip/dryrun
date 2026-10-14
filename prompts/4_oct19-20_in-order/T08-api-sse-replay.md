# T08: FastAPI, SSE, replay, spend guard

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort medium |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/4_oct19-20_in-order/T08-api-sse-replay.md` |
| Parallel with | nothing in this folder. **Run T08 first, then T09.** T09 part 1 (deploy `/health` only) may start alongside. |
| Time | ~3 h |
| Depends on | P4 (the analysis orchestrator). You can start earlier against a fake `Analysis`. |

---
You are building the HTTP layer for the pivot ("Test your plans", SPEC §15). **EVENTS.md v2 is the contract.**

**Read only these:**
- `docs/EVENTS.md` v2 (all of it)
- `SPEC.md` §15.6–15.8, §7, §7.1, §6 ("Check live news")
- `backend/main.py`
- the public APIs of `backend/sim/analysis.py`, `backend/sim/replay_cell.py`, `backend/services/replay.py` and `SpendGuard` in `backend/services/telemetry.py`

**`backend/main.py`:**
- **Implement every v2 endpoint.** Remove the v1 `/api/runs*` and `/api/scenarios` routes.
- **Registry:** an in-memory registry of analyses and replays, with a 2-hour TTL.
  - At most 3 concurrent LIVE analyses; REPLAY is unlimited.
  - Keep each analysis's state, because `/plans`, `/replay`, `/verify` and `/memo` all need it.
- **SSE:** `sse-starlette`, one asyncio queue per stream, and a heartbeat comment every 15 s.
  - A client that connects late first gets every event already emitted for that analysis (buffer them), then the live ones. The UI may open the stream after the POST returns.
- **LIVE gating** for custom profiles and LIVE examples:
  - At most 2 LIVE analyses per IP per hour, and 5 profile parses per IP per hour.
  - `SpendGuard(settings.public_live_daily_cap_usd)`.
  - When a limit trips: an example downgrades to its REPLAY recording, with a `mode` event giving the reason. A custom profile gets HTTP 429 with a plain-words `reason`, which the UI shows.
- **`/plans` and `/replay`:** engine only, so they work in REPLAY. Recorded cells are served from `fixtures/replays/cell_*.jsonl` when present.
- **`/news-check`:** works in LIVE **and** REPLAY. Limits: 1 per IP per minute, plus `settings.tavily_daily_credit_cap`. The Super call goes through `SpendGuard`. It never changes the analysis (`applied: false`).
- **`/verify`:** delegates to `backend/services/nebius_jobs.py` when T09 has built it. Until then, return `{accepted: false, reason: "not deployed yet"}`.
- **`/memo?format=md`:** `Analysis.memo_markdown()` as a file download.
- **CORS** from env `FRONTEND_ORIGIN`. If `frontend/out/` exists, serve it as static files, so one container hosts everything.
- **`/api/benchmark/export?format=json|md`:** build it from `telemetry/*.jsonl`.

**Tests** (httpx `AsyncClient` plus a fake `Analysis`):
- create an example analysis in REPLAY and read its first N events;
- a late subscriber still receives the `analysis` event;
- a custom profile is rejected with 429 when the spend guard trips;
- `/plans` works in REPLAY and makes no LLM call;
- `/replay` streams 24 weeks;
- `/news-check` works in REPLAY with `applied: false`, and is rejected after the credit cap (fake scout);
- `/memo` returns Markdown;
- the per-IP limits.

**Done when** pytest and ruff pass. Commit as `T08: API v2, SSE, replay, spend guard`.
