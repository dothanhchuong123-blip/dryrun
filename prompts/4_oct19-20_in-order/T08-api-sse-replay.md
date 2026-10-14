# T08: FastAPI, SSE, replay, spend guard

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort medium |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/4_oct19-20_in-order/T08-api-sse-replay.md` |
| Parallel with | nothing in this folder. **Run T08 first, then T09.** T09 part 1 (deploy `/health` only) may start alongside. |
| Time | ~3 h |
| Depends on | T07. You can start earlier against a fake Simulation. |

---
You are building the HTTP layer for the Market Digital Twin.

**Read only these:**
- `docs/EVENTS.md` (the contract)
- `SPEC.md` §7, §7.1
- `backend/main.py`
- the public API of `backend/sim/orchestrator.py` and of `SpendGuard` in `backend/services/telemetry.py`
- `SPEC.md` §6 ("Check live news") and the public API of `TavilyScout.news_check` in `backend/services/tavily_scout.py`

**`backend/main.py`:**
- Implement every endpoint in EVENTS.md.
- In-memory run registry: at most 3 concurrent LIVE runs; REPLAY runs are unlimited.
- SSE via `sse-starlette`, one asyncio queue per run, and a heartbeat comment every 15 s.
- LIVE gating:
  - at most 2 LIVE runs per IP per hour;
  - `SpendGuard(settings.public_live_daily_cap_usd)`.

  When either limit trips, downgrade the run to REPLAY and emit a `mode` event with the reason.
- `POST /api/runs/{id}/news-check`:
  - Works in LIVE **and** REPLAY. It's how judges trigger a real Tavily call, which the Tavily prize requires.
  - Limits: 1 per IP per minute, plus a daily Tavily credit counter against `settings.tavily_daily_credit_cap`. The Super call goes through `SpendGuard`.
  - In REPLAY: push the cards as `grounding` events with `applied: false`, and never touch the replayed run.
  - In LIVE: apply the shock as usual and send `applied: true`.
- CORS from env `FRONTEND_ORIGIN`.
- If `frontend/out/` exists, serve it as static files, so one container hosts everything.
- `/api/benchmark/export?format=json|md`: build it from `telemetry/*.jsonl`.

**`backend/services/replay.py`:**
- `Recorder(emit)`: wraps `emit` and writes JSONL with `t` timestamps.
- `Player(path, speed=1.0)`: an async generator that re-emits events at their recorded times.

**Tests** (httpx `AsyncClient` plus a fake simulation):
- Creating a run and reading its first N SSE events.
- Replay timing at speed 100.
- Spend-guard downgrade.
- The per-IP limit.
- news-check: works in REPLAY with `applied: false`, and gets rejected once the credit cap trips (fake scout).

**Done when** pytest and ruff pass. Commit as `T08: API, SSE, replay, spend guard`.
