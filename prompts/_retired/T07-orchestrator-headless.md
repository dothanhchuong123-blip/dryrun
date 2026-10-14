# T07: Simulation orchestrator and headless CLI (Milestone A)

| | |
|---|---|
| Builder | **Claude Code**: **Opus 5.5**, effort high. This is the integration piece. |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/3_oct18_one-task/T07-orchestrator-headless.md` |
| Parallel with | nothing. It wires everything together, so run it alone. |
| Time | ~5 h |
| Depends on | T01–T06 |
| Target date | Oct 18 |

---
You are wiring the Market Digital Twin together: the two-speed loop, both universes, and the agent calls.

**Read only these:**
- `SPEC.md` §3.2, §4.4, §4.7, §5, §6 (Deep-Scout), §7.1
- `docs/EVENTS.md`
- the public APIs in `backend/engine/*`, `backend/services/*` and `backend/agents/*`

**Create `backend/sim/orchestrator.py`** with `class Simulation(scenario, settings, router, scout, telemetry, seed)`. It holds the params, archetypes, α, the U1 and U2 states, the `montecarlo.Schedule` recorder, the current decisions, the crowd sentiment and the active shock.

`async run(emit, *, tick_seconds=1.5, epoch_ticks=8, horizon=None)`. Each part of the loop runs on its own cadence.

**Every tick:**
- Step U1 and U2.
  - In U2, A uses `baseline.cost_plus_decision` and B replays U1's B decision.
- Emit both `tick` events.
- Emit `telemetry`.
- Run the Deep-Scout check.

**Every epoch:**
- Start background tasks for CEO A and CEO B (Ultra, thinking on) and for inventory ω (Super).
  - Stream reasoning out as `reasoning` events.
  - Apply each result at the first tick boundary after it arrives, then emit `decision`.
- Emit `nash`.
  - Use `game.payoff_matrix` with a closure over expected demand.
  - `chosen` = the `action_index` of each CEO's price change.
- Emit `stats` from the local `montecarlo.preview` (n=100, source `live`).

**Every 3 ticks:**
- Make two parallel fast-tier calls, 6 archetypes each, and emit `crowd`.

**Rules and fallbacks:**
- **Never block a tick on an LLM call.** If the previous epoch's calls are still running, skip starting new ones and log it.
- Fallbacks:
  - CEO → `game.best_response`
  - inventory → keep the previous ω
  - crowd → decay μ by 20%
- `inject_shock(text)`: Super parses the text; the shock applies from the next tick.
- At the end of a run, export the `Schedule` JSON for the 10k Serverless Job (T09).

**`backend/sim/cli.py`:** `uv run python -m backend.sim.cli --scenario gpu_tariff --ticks 40 [--cheap] [--offline]`
- Prints one compact line per tick, plus each decision.
- `--cheap` routes the CEOs to Super (the dev rule in SPEC §7.1).
- Records the event stream to `fixtures/replays/<scenario>_<ts>.jsonl`, in the replay format from EVENTS.md.

**Tests** (fake router with configurable latency and deterministic decisions; `tick_seconds=0`):
- A 30-tick run produces events whose keys match EVENTS.md.
- U2 diverges from U1 once A's prices differ.
- A CEO slower than one epoch does not stall ticks.
- The fallback paths work.

**Milestone A** (ask me before running; expect ≈ $0.15 with `--cheap` and ≈ $0.40 at full cost):
1. Run `gpu_tariff` for 40 ticks with `--cheap`.
2. Run it once at full cost.
3. Report the spend from telemetry, and paste the last 5 tick lines.

Commit as `T07: orchestrator + headless CLI (Milestone A)`.
