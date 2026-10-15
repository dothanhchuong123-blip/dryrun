"""Replay one grid cell week by week (SPEC §15.9; docs/EVENTS.md "Replay stream events").

U1 = the plan, U2 = "Do nothing", one path on the analysis's seed. Each week sends the U1 and U2 `tick`s, then that
week's `marker`s, then waits `week_seconds`. A cell of an analysis that was itself played from a recording is served
from `fixtures/replays/cell_*.jsonl` when that file exists; every other cell is simulated on demand (< 0.3 s).
"""
from __future__ import annotations

import asyncio
import base64
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import numpy as np

from backend.engine import planner
from backend.services import replay

HORIZON = 24


def choices_b64(choices: list[int]) -> str:
    """N int8 choices (0 = outside, 1 = A, 2 = B) as base64, for the arena's typed array."""
    return base64.b64encode(np.asarray(choices, dtype=np.int8).tobytes()).decode("ascii")


async def _emit(emit: Callable[[str, dict], Any], event: str, data: dict) -> None:
    res = emit(event, data)
    if asyncio.iscoroutine(res):
        await res


async def play_cell(
    analysis_state: Any,
    plan_name: str,
    shock_id: str,
    emit: Callable[[str, dict], Any],
    *,
    week_seconds: float = 0.75,
    replay_id: str | None = None,
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    use_recording: bool = True,
) -> dict:
    """Stream one cell. `analysis_state` is a `backend.sim.analysis.Analysis` (anything with `cal`, `seed`,
    `plan_spec`, `shock`, `crowd_for`, `example_id`, `from_recording`). Returns `{replay_id, cum_profit_usd}`.
    Raises KeyError for an unknown plan or column."""
    a = analysis_state
    replay_id = replay_id or uuid.uuid4().hex[:12]
    spec = a.plan_spec(plan_name)
    case = a.shock(shock_id)

    path = None
    if use_recording and getattr(a, "from_recording", False) and getattr(a, "example_id", None):
        path = replay.cell_path(a.example_id, plan_name, shock_id)
    if path is not None and path.exists():
        return await _play_recorded(path, replay_id, emit, week_seconds, sleep)

    detail = await asyncio.to_thread(
        planner.simulate_detail, a.cal, spec, case, a.crowd_for(plan_name), HORIZON, a.seed
    )
    await _emit(emit, "replay_start", {
        "replay_id": replay_id, "plan_name": spec.name,
        "shock_id": case.id, "shock_label": case.label, "weeks": HORIZON,
        "n_consumers": detail["n_consumers"], "week_seconds": week_seconds,
    })
    markers: dict[int, list[dict]] = {}
    for m in detail["markers"]:
        markers.setdefault(int(m["week"]), []).append(m)
    last: dict[str, dict] = {}
    for t, week in enumerate(detail["weeks"]):
        u1 = dict(week["U1"])
        u1["choices_b64"] = choices_b64(u1.pop("choices"))
        u2 = dict(week["U2"])
        u2.pop("choices", None)
        u2.pop("cum_cash_delta", None)
        await _emit(emit, "tick", u1)
        await _emit(emit, "tick", u2)
        for m in markers.get(t, []):
            await _emit(emit, "marker", dict(m))
        last = {"U1": u1, "U2": u2}
        if week_seconds > 0:
            await sleep(week_seconds)
    cum = {u: float(last[u]["cum_profit"][0]) if last else 0.0 for u in ("U1", "U2")}
    await _emit(emit, "replay_done", {"replay_id": replay_id, "cum_profit_usd": cum})
    return {"replay_id": replay_id, "cum_profit_usd": cum}


async def _play_recorded(
    path: Any, replay_id: str, emit: Callable[[str, dict], Any], week_seconds: float,
    sleep: Callable[[float], Awaitable[Any]],
) -> dict:
    lines = replay.load(path)
    start = next((line["data"] for line in lines if line["event"] == "replay_start"), {})
    recorded = float(start.get("week_seconds") or 0.0)
    speed = float("inf") if week_seconds <= 0 or recorded <= 0 else recorded / week_seconds
    done: dict = {}

    def transform(event: str, data: dict) -> dict:
        if event == "replay_start":
            return {**data, "replay_id": replay_id, "week_seconds": week_seconds}
        if event == "replay_done":
            done.update(data, replay_id=replay_id)
            return {**data, "replay_id": replay_id}
        return data

    await replay.play(lines, emit, speed=speed, sleep=sleep, transform=transform)
    return {"replay_id": replay_id, "cum_profit_usd": done.get("cum_profit_usd", {})}
