"""A fake router for `--offline` runs and tests: scripted decisions, no network, $0 (SPEC §7.1 dev rules).

It answers each schema the analysis asks for with a fixed, plausible decision. It never parses news into shock
numbers (that would put made-up numbers next to real headlines), so offline runs use the example's fallback
shock for the `news` column. Offline output is for development only and is never recorded as a replay.
"""
from __future__ import annotations

import asyncio
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from backend.agents.schemas import (
    AnalystStep,
    ArchetypeSentiment,
    BusinessProfile,
    CrowdBatch,
    InputCheck,
    MemoDraft,
    ProfileParse,
    ScenarioSet,
)
from backend.services.telemetry import CallRecord, TelemetryStore

FAIL = object()  # a script entry that makes the call fail (parsed = None)


def _plan(name: str, **kw: Any) -> dict:
    base = {"name": name, "price_change_pct": 0, "price_change_week": 0, "extra_stock_weeks": 0, "stock_week": 0,
            "marketing_change_pct": 0, "switch_supplier": False, "alt_cost_change_pct": 0, "alt_lead_time_weeks": 3,
            "alt_shock_exposure": 0.3, "price_end_week": 24}
    return {**base, **kw}


def _case(label: str, **kw: Any) -> dict:
    base = {"label": label, "delta_c_raw": 0.0, "delta_lead_time": 0, "demand_shock": 0.0, "rival_price_change_pct": 0,
            "share_shift_pct": 0, "onset_week": 2, "ramp_weeks": 3, "likelihood": "possible",
            "why": "A standard stress test for a small importer", "source_ids": []}
    return {**base, **kw}


SCENARIOS = ScenarioSet.model_validate({
    "thought": "Offline run: testing a milder and a worse cost rise, a rival price cut and a new player.",
    "cases": [
        _case("Input +12%", delta_c_raw=0.12),
        _case("Input +50%, delays +2 wk", delta_c_raw=0.5, delta_lead_time=2, likelihood="unlikely"),
        _case("Rival cuts 5%", delta_c_raw=0.25, rival_price_change_pct=-5),
        _case("A new player takes 8%", delta_c_raw=0.2, share_shift_pct=8),
    ],
    "unmodelled": [{"text": "Offline run: no real risks were read from the news", "source_id": ""}],
})

STEPS = [
    AnalystStep.model_validate({
        "thought": "Offline run: lock in today's cost with stock, then a small price rise later.",
        "action": "test",
        "plans": [
            _plan("Stock 3 wk + raise 3% wk 4", extra_stock_weeks=3, price_change_pct=3, price_change_week=4),
            _plan("Stock 2 wk + marketing +20%", extra_stock_weeks=2, marketing_change_pct=20),
        ],
        "pick": "Stock 3 wk + raise 3% wk 4",
        "why": "Offline run: scripted pick.",
    }),
    AnalystStep.model_validate({
        "thought": "Offline run: that is enough to compare.", "action": "finish", "plans": [],
        "pick": "Stock 3 wk + raise 3% wk 4", "why": "Offline run: scripted pick.",
    }),
]

MEMO = MemoDraft(
    headline="Offline run: scripted memo",
    why="This memo was written by a script, not by Nemotron. The numbers above come from the engine.",
    watch_out="Run without --offline for a real analysis.",
    recheck_when="When you run it live.",
)


def neutral_crowd(messages: list[dict]) -> CrowdBatch:
    """Neutral shoppers for exactly the groups the prompt asks about (`id=<n> ` lines)."""
    ids = [int(i) for i in re.findall(r"^id=(\d+) ", messages[-1]["content"], flags=re.MULTILINE)] or [1]
    return CrowdBatch(archetypes=[
        ArchetypeSentiment(id=i, mu_a=0.0, mu_b=0.0, sigma_a=0.1, sigma_b=0.1, bubble="Offline: no real reaction")
        for i in ids
    ])


@dataclass
class ScriptedResult:
    parsed: BaseModel | None
    raw_text: str
    reasoning_text: str
    record: CallRecord
    fallback_needed: bool


class ScriptedRouter:
    """Same `call` signature as `NemotronRouter`. `script` maps a schema to a list of replies, used in order; a reply
    is a model, a callable(messages) -> model, or FAIL. When a list runs out the default reply for that schema is
    used (FAIL for schemas without one, e.g. the news parser's ShockVector)."""

    def __init__(self, script: dict[type[BaseModel], list[Any]] | None = None, *, defaults: bool = True) -> None:
        self.script = {k: list(v) for k, v in (script or {}).items()}
        self.defaults: dict[type[BaseModel], Any] = (
            {ScenarioSet: SCENARIOS, MemoDraft: MEMO, CrowdBatch: neutral_crowd} if defaults else {}
        )
        self._steps = list(STEPS) if defaults else []
        self.store = TelemetryStore(persist=False)
        self.calls: list[tuple[str, str, str, bool]] = []

    def _next(self, schema: type[BaseModel]) -> Any:
        queue = self.script.get(schema)
        if queue:
            return queue.pop(0)
        if schema is ProfileParse and not self.script.get(ProfileParse) and self.script.get(BusinessProfile):
            # tests that script a plain profile get it back as an "ok" parse
            return ProfileParse(check=InputCheck(verdict="ok", missing=[], reason=""), profile=self.script[BusinessProfile].pop(0))
        if schema is AnalystStep:
            return self._steps.pop(0) if self._steps else FAIL
        return self.defaults.get(schema, FAIL)

    async def call(
        self, tier: str, messages: list[dict], schema: type[BaseModel], *, thinking: bool,
        on_reasoning: Callable[[str], Any] | None = None, role: str = "", **_: Any,
    ) -> ScriptedResult:
        self.calls.append((tier, schema.__name__, role, thinking))
        await asyncio.sleep(0)
        if thinking and on_reasoning:
            res = on_reasoning("(scripted reasoning) ")
            if asyncio.iscoroutine(res):
                await res
        item = self._next(schema)
        if callable(item) and item is not FAIL and not isinstance(item, BaseModel):
            item = item(messages)
        parsed = None if item is FAIL else item
        rec = CallRecord(tier=tier, model="scripted", role=role, total_ms=1.0, json_valid=parsed is not None,
                         status="ok", fallback_used=parsed is None)
        self.store.add(rec)
        return ScriptedResult(parsed, "", "", rec, parsed is None)
