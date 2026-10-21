"""Record LIVE runs to JSONL and replay them at real speed (SPEC §7, docs/EVENTS.md "Replay format").

One line per SSE event: `{"t": <seconds since start>, "event": "<name>", "data": {...}}`. The player re-emits
each event at its recorded `t`, divided by `speed`. Recorded analyses live in
`fixtures/replays/analysis_<example_id>.jsonl`, recorded cell replays in
`fixtures/replays/cell_<example_id>_<plan-slug>_<shock_id>.jsonl`.
"""
from __future__ import annotations

import asyncio
import json
import math
import re
import time
from collections.abc import Awaitable, Callable, Iterable
from pathlib import Path
from typing import Any

from backend.config import ROOT

REPLAY_DIR = ROOT / "fixtures" / "replays"

Emit = Callable[[str, dict], Any]


def slug(name: str) -> str:
    """`Stock up 4 weeks now` -> `stock-up-4-weeks-now` (file names of cell recordings)."""
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:60] or "plan"


def analysis_path(example_id: str, directory: Path | None = None) -> Path:
    return (directory or REPLAY_DIR) / f"analysis_{example_id}.jsonl"


def cell_path(example_id: str, plan_name: str, shock_id: str, directory: Path | None = None) -> Path:
    return (directory or REPLAY_DIR) / f"cell_{example_id}_{slug(plan_name)}_{slug(shock_id)}.jsonl"


def backtest_path(case_id: str, directory: Path | None = None) -> Path:
    """`backtest_<id>.jsonl`: the recorded analysis of a backtest case (B1). Its cell replays are
    `cell_backtest_<id>_<plan-slug>_realized.jsonl`, i.e. `cell_path(f"backtest_{id}", plan, "realized")`."""
    return (directory or REPLAY_DIR) / f"backtest_{case_id}.jsonl"


def has_replay(example_id: str, directory: Path | None = None) -> bool:
    return analysis_path(example_id, directory).exists()


def _plain(data: Any) -> Any:
    """A JSON-safe deep copy (numpy scalars and arrays become plain numbers and lists)."""
    def default(o: Any) -> Any:
        if hasattr(o, "tolist"):
            return o.tolist()
        if hasattr(o, "item"):
            return o.item()
        raise TypeError(f"not JSON serialisable: {type(o).__name__}")

    return json.loads(json.dumps(data, default=default, ensure_ascii=False))


class VirtualClock:
    """A clock that only moves when `sleep` is awaited, for recording paced streams instantly."""

    def __init__(self) -> None:
        self.t = 0.0

    def now(self) -> float:
        return self.t

    async def sleep(self, seconds: float) -> None:
        self.t += max(0.0, float(seconds))


class Recorder:
    """Collects events as replay lines. Use it as an `emit(event, data)` callable."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self.t0 = clock()
        self.lines: list[dict] = []

    def __call__(self, event: str, data: dict) -> None:
        self.lines.append({"t": round(self.clock() - self.t0, 3), "event": event, "data": _plain(data)})

    def save(self, path: Path) -> Path:
        return write(path, self.lines)


def write(path: Path, lines: Iterable[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for line in lines:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
    return path


def load(path: Path) -> list[dict]:
    """The lines of a recording, in order. Blank lines are skipped."""
    out = []
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        if raw.strip():
            line = json.loads(raw)
            out.append({"t": float(line.get("t", 0.0)), "event": str(line["event"]), "data": line.get("data") or {}})
    return out


async def play(
    source: Path | Iterable[dict],
    emit: Emit,
    *,
    speed: float = 1.0,
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    transform: Callable[[str, dict], dict | None] | None = None,
) -> int:
    """Re-emit a recording at `speed` x real time (`speed <= 0` or infinite = no waiting). Returns the count sent.

    `transform(event, data)` may rewrite an event's data (e.g. a fresh `analysis_id`) or return None to skip it.
    `emit` may be a plain function or a coroutine function.
    """
    lines = load(source) if isinstance(source, Path | str) else list(source)
    paced = speed > 0 and math.isfinite(speed)
    last_t = lines[0]["t"] if lines else 0.0
    sent = 0
    for line in lines:
        if paced and line["t"] > last_t:
            await sleep((line["t"] - last_t) / speed)
        last_t = max(last_t, line["t"])
        data = dict(line["data"])
        if transform is not None:
            data = transform(line["event"], data)
            if data is None:
                continue
        res = emit(line["event"], data)
        if asyncio.iscoroutine(res):
            await res
        sent += 1
    return sent
