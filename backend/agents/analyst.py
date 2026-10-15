"""Nemotron Ultra as an analyst, with the engine planner as its tool (SPEC §15.6).

Order of a run: step 0b futures (`scenarios`), the seed plans, up to 3 rounds of Ultra proposing plans that the
engine tests in every column, then Ultra's memo. Ultra and the shoppers decide; the engine computes every number.
Engine results are emitted the moment they are computed, never held back for an LLM.

`emit(event, data)` may be a plain function or a coroutine function. Event names and keys follow docs/EVENTS.md v2.1.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from typing import Any

import numpy as np
from pydantic import BaseModel

from backend.agents import wording
from backend.agents.prompts import (
    analyst_messages,
    is_assumption,
    memo_messages,
    plan_crowd_messages,
    scenario_messages,
)
from backend.agents.schemas import (
    AnalystStep,
    ArchetypeSentiment,
    CrowdBatch,
    MemoDraft,
    ScenarioSet,
    crowd_to_sentiment,
)
from backend.config import ROOT
from backend.engine import planner
from backend.engine.planner import DO_NOTHING, PlanSpec, ShockCase
from backend.engine.types import N_ARCHETYPES, CrowdSentiment

log = logging.getLogger(__name__)

HORIZON = 24
NEWS_ID = "news"
ARCHETYPES: list[dict] = json.loads((ROOT / "fixtures" / "archetypes.json").read_text())
SEED_PLANS: tuple[PlanSpec, ...] = (
    PlanSpec(name="Raise price 5% now", price_change_pct=5.0),
    PlanSpec(name="Stock up 4 weeks now", extra_stock_weeks=4.0),
)
SEARCH_PRICES = (-3, 0, 3, 5)      # deterministic fallback grid (SPEC §15.6): price change %...
SEARCH_STOCKS = (0, 2, 4)          # ...times extra stock weeks
NEAR_DUPLICATE = 2.0               # futures whose knobs are all within this many points are the same future
MAX_AI_CASES = 5
ULTRA_TRIES = 2                    # "fails twice in a row" means two calls, each with the router's own retry
GUT_PREFIX = "Your gut call: "
# Ultra may not invent a cheaper supplier (SPEC §15.4, approved 2026-10-15). The profile has no field naming a known
# cheaper one yet, so every Ultra supplier switch costs at least today's price. Owner-entered plans are exempt.
ALT_COST_FLOOR_PCT = 0.0
CROWD_RETRY_TIMEOUT = 10.0         # s; a shopper half that failed at the fast tier's 5 s gets one more try this long


# --------------------------------------------------------------------------------------
# Step 0b rules (pure functions, unit-tested)
# --------------------------------------------------------------------------------------


def _is_zero(c: ShockCase) -> bool:
    return (
        abs(c.delta_c_raw) < 0.005 and c.delta_lead_time == 0 and abs(c.demand_shock) < 0.005
        and abs(c.rival_price_change_pct) < 0.5 and c.share_shift_pct < 0.5
    )


def _close(a: ShockCase, b: ShockCase) -> bool:
    """All knobs within NEAR_DUPLICATE points of each other (percent knobs in points, lead time in weeks)."""
    return (
        abs(a.delta_c_raw - b.delta_c_raw) * 100 <= NEAR_DUPLICATE
        and abs(a.delta_lead_time - b.delta_lead_time) <= NEAR_DUPLICATE
        and abs(a.demand_shock - b.demand_shock) * 100 <= NEAR_DUPLICATE
        and abs(a.rival_price_change_pct - b.rival_price_change_pct) <= NEAR_DUPLICATE
        and abs(a.share_shift_pct - b.share_shift_pct) <= NEAR_DUPLICATE
    )


def _knobs(c: ShockCase) -> dict[str, Any]:
    return {
        "delta_c_raw": c.delta_c_raw, "delta_lead_time": c.delta_lead_time, "demand_shock": c.demand_shock,
        "rival_price_change_pct": c.rival_price_change_pct, "share_shift_pct": c.share_shift_pct,
    }


def default_columns(news_case: ShockCase, profile: Mapping[str, Any]) -> list[ShockCase]:
    """The old four columns, news first (SPEC §15.5): the real news column, then mild / severe / shipping."""
    mild, _news, severe, shipping = planner.default_shock_cases(_knobs(news_case), profile)
    for case, why in (
        (mild, "Half of today's headline"),
        (severe, "A worse version, about 1.6 times the headline"),
        (shipping, "A shipping delay, a common risk for importers"),
    ):
        case.why, case.likelihood, case.source_ids = why, "possible", list(news_case.source_ids)
    return [news_case, mild, severe, shipping]


def build_columns(
    parsed: ScenarioSet, news_case: ShockCase, profile: Mapping[str, Any], news_ids: set[str]
) -> tuple[list[ShockCase], list[str], bool]:
    """Apply the step 0b code rules to Ultra's futures (SPEC §15.6; review additions of 2026-10-15).

    Returns `(columns, notes, fell_back)`: `columns` starts with `news_case`; `notes` has one plain-words line per
    rule that changed something; `fell_back` is True when fewer than 2 futures survived and the standard
    columns replaced them.
    """
    notes: list[str] = []
    cases: list[ShockCase] = []
    rescaled = clamped = 0
    for raw in parsed.cases:
        d = raw.model_dump()
        d["label"] = fit_name(d["label"])
        for k in ("rival_price_change_pct", "share_shift_pct"):
            if 0 < abs(d[k]) < 1:  # a fraction where percent points were asked for
                d[k] *= 100.0
                rescaled += 1
        case = ShockCase.from_dict({**d, "id": "", "origin": "ai"})
        if any(abs(getattr(case, k) - d[k]) > 1e-9 for k in _knobs(case)):
            clamped += 1
        cases.append(case)
    if rescaled:
        notes.append(f"Scaled {rescaled} rival or new-player move{'s' * (rescaled != 1)} from a fraction to percent points.")
    if clamped:
        notes.append(f"Clamped {clamped} future{'s' * (clamped != 1)} to the allowed ranges.")

    nonzero = [c for c in cases if not _is_zero(c)]
    if len(nonzero) < len(cases):
        notes.append(f"Dropped {len(cases) - len(nonzero)} future{'s' * (len(cases) - len(nonzero) != 1)} where nothing changes.")
    kept: list[ShockCase] = []
    for c in nonzero:
        if any(_close(c, k) for k in [news_case, *kept]):
            continue
        kept.append(c)
    if len(kept) < len(nonzero):
        n = len(nonzero) - len(kept)
        notes.append(f"Dropped {n} future{'s' * (n != 1)} too close to another one.")

    bad_ids = cost_only = 0
    for c in kept:
        good = [s for s in c.source_ids if s in news_ids]
        bad_ids += len(c.source_ids) - len(good)
        if c.demand_shock == 0 and c.rival_price_change_pct == 0 and c.share_shift_pct == 0:
            market = [s for s in good if s.startswith("m")]
            if market:
                cost_only += 1
                good = [s for s in good if not s.startswith("m")]
        c.source_ids = good
    if bad_ids:
        notes.append(f"Removed {bad_ids} source id{'s' * (bad_ids != 1)} that are not real news items.")
    if cost_only:
        notes.append(f"Removed market sources from {cost_only} cost-only future{'s' * (cost_only != 1)}.")

    if len(kept) < 2:
        notes.append("Fewer than 2 usable futures from Ultra; using the standard ones.")
        return default_columns(news_case, profile), notes, True

    if news_case.delta_c_raw > 0 and not any(c.delta_c_raw < news_case.delta_c_raw for c in kept):
        mild = planner.default_shock_cases(_knobs(news_case), profile)[0]
        mild.why = "A milder version of today's headline"
        mild.likelihood = "possible"
        mild.source_ids = list(news_case.source_ids)
        kept.insert(0, mild)
        notes.append("Added a milder-than-the-headline future, which Ultra left out.")

    kept = kept[:MAX_AI_CASES]
    n = 0
    for c in kept:
        if c.origin == "ai":
            n += 1
            c.id = f"s{n}"
    return [news_case, *[c.clamp() for c in kept]], notes, False


# --------------------------------------------------------------------------------------
# The analyst
# --------------------------------------------------------------------------------------


NAME_CAP = 40  # schema maxLength for plan names, the pick and future labels; Ultra is asked for 32


def fit_name(text: str, cap: int = NAME_CAP) -> str:
    """A name or label within one character of `cap` was cut there by constrained decoding (FEEDBACK_LOG
    2026-10-15; a cut trailing space is stripped, so 39 counts), e.g. "Highland cuts 8% and chains take 10% sh":
    drop the partial last word and any dangling joiner. Ultra is asked for 32, so a whole name rarely gets here."""
    text = " ".join(text.split())
    if len(text) < cap - 1:
        return text
    words = text[:cap].split(" ")[:-1] or [text[:cap]]
    while len(words) > 1 and (words[-1].lower() in {"and", "&", "+", "with", "or", "then", "in", "at", "of"}
                              or not words[-1].strip(",;:-–—(+&/")):
        words.pop()
    return " ".join(words).rstrip(",;:-–—(+&/ ")


def tidy(text: str, cap: int) -> str:
    """Strict json_schema hard-cuts a string at its maxLength, often mid-word (FEEDBACK_LOG 2026-10-15).
    If `text` hit the cap without ending a sentence, cut back to the last full sentence, else the last word.
    A full stop right after a digit ("(-1.") is a cut number, not a sentence end."""
    text = text.strip()

    def ends_sentence(t: str) -> bool:
        if t.endswith(("!", "?", "”", ")", "\"")):
            return True
        return t.endswith(".") and not (len(t) > 1 and t[-2].isdigit())

    if len(text) < cap - 2 or ends_sentence(text):
        return text
    ends = [m.end() for m in re.finditer(r"(?<!\d)[.!?](?=\s)", text)]
    if ends and ends[-1] >= 20:
        return text[: ends[-1]]
    return text.rsplit(" ", 1)[0].rstrip(",;:-–—( ") + "…"


def _slug_spec(spec: PlanSpec) -> tuple:
    d = spec.to_dict()
    d.pop("name")
    return tuple(sorted(d.items()))


def _unique_name(name: str, taken: set[str]) -> str:
    base = (name.strip() or "Plan")[:40]
    if base.lower() not in taken:
        return base
    for i in range(2, 100):
        suffix = f" ({i})"
        cand = base[: 40 - len(suffix)] + suffix
        if cand.lower() not in taken:
            return cand
    return base


async def ask_crowd(
    router: Any, profile: Mapping[str, Any], spec: PlanSpec
) -> tuple[CrowdSentiment, list[dict], bool]:
    """The 12 shopper groups react to one plan: two parallel Lightning calls of 6 groups (SPEC §15.6).

    Returns (sentiment, `crowd` event rows, any_missing). Groups that never answer count as neutral. A plan that
    changes neither the price nor marketing is invisible to shoppers, so it gets neutral shoppers without a call
    (P4 step 1: Lightning invented a "bulk discount" for a stock-only plan and moved the result by +$1.2k)."""
    if not shoppers_see(spec):
        return neutral_crowd()
    halves = [ARCHETYPES[:6], ARCHETYPES[6:]]
    rival = float(profile.get("rival_price") or 0)

    async def ask(i: int, half: list[dict]) -> list[ArchetypeSentiment]:
        """One half. Lightning sometimes answers 1 of 6 groups and still validates, so ask once more for the rest.
        A call that fails (timeout, invalid JSON) is tried once more with CROWD_RETRY_TIMEOUT: a lost half would
        count as neutral and flatter price rises (P4 step 1)."""
        got: dict[int, ArchetypeSentiment] = {}
        refills = failures = 0
        while refills < 2 and failures < 2:
            todo = [a for a in half if a["id"] not in got]
            if not todo:
                break
            extra = {"timeout": CROWD_RETRY_TIMEOUT} if failures else {}
            try:
                res = await router.call(
                    "fast", plan_crowd_messages(todo, dict(profile), spec.to_dict(), rival, batch=i),
                    CrowdBatch, thinking=False, role="crowd", **extra,
                )
                parsed = res.parsed
            except Exception as e:  # noqa: BLE001  a lost crowd call means neutral shoppers, nothing more
                log.info("crowd call failed: %s", e)
                parsed = None
            if parsed is None:
                failures += 1
                continue
            refills += 1
            asked = {a["id"] for a in todo}
            got.update({a.id: a for a in parsed.archetypes if a.id in asked})
        return list(got.values())

    answers = await asyncio.gather(*(ask(i, half) for i, half in enumerate(halves)))
    batches = [CrowdBatch(archetypes=a) for a in answers if a]
    got = {a.id: a for b in batches for a in b.archetypes}
    missing = len(got) < N_ARCHETYPES
    sentiment = crowd_to_sentiment(batches)
    if not batches:  # neutral, as SPEC §15.6: mu 0, sigma 0.1
        sentiment = CrowdSentiment(mu=sentiment.mu, sigma=sentiment.sigma + 0.1)
    return sentiment, _crowd_rows(got), missing


def visible_key(spec: PlanSpec) -> tuple:
    """What shoppers react to (see `shoppers_see`). Plans with the same key get the same reaction: timing and stock
    are the engine's job, so a 5% rise now and in week 4 share one ask."""
    return (spec.is_textbook, round(spec.price_change_pct, 2), round(spec.marketing_change_pct, 2))


def keep_price_order(mu_a: np.ndarray, price_pct: float, rated: Sequence[tuple[float, np.ndarray]]) -> np.ndarray:
    """Clamp each group's sentiment toward us so a higher price is never liked more than a lower one.

    `rated` holds (price_change_pct, mu_a) of plans already rated at the same marketing change. Each group's new
    mu_a is kept at or below what it gave any cheaper plan and at or above what it gave any dearer one. The groups
    rated each plan separately and without anchors, so a 8% rise once scored milder than a 5% one (2026-10-15).
    `rated` is itself in order (each entry was clamped on arrival), so the bounds never cross."""
    lo = np.full_like(mu_a, -1.0)
    hi = np.full_like(mu_a, 1.0)
    for p, m in rated:
        if p <= price_pct:
            hi = np.minimum(hi, m)
        if p >= price_pct:
            lo = np.maximum(lo, m)
    return np.clip(mu_a, lo, np.maximum(lo, hi))


def shoppers_see(spec: PlanSpec) -> bool:
    """Shoppers react only to what they can see: a price change (incl. the textbook rule) or marketing."""
    return spec.is_textbook or spec.price_change_pct != 0 or spec.marketing_change_pct != 0


def _crowd_rows(got: Mapping[int, ArchetypeSentiment]) -> list[dict]:
    rows = []
    for a in ARCHETYPES:
        s = got.get(a["id"])
        rows.append(
            {"id": a["id"], "label": a["label"],
             "mu": [s.mu_a, s.mu_b] if s else [0.0, 0.0],
             "sigma": [s.sigma_a, s.sigma_b] if s else [0.1, 0.1],
             "bubble": s.bubble if s else ""}
        )
    return rows


def neutral_crowd() -> tuple[CrowdSentiment, list[dict], bool]:
    """Neutral shoppers (mu 0, sigma 0.1) without asking anyone."""
    zeros = np.zeros((N_ARCHETYPES, 2))
    return CrowdSentiment(mu=zeros, sigma=zeros + 0.1), _crowd_rows({}), False


def gut_name(name: str) -> str:
    """Row label of the owner's gut-call plan (review 2026-10-15, wave-3 verdict §C 8.1)."""
    return fit_name(GUT_PREFIX + (name.strip() or "my plan"))


class Analyst:
    def __init__(
        self,
        router: Any,
        cal: planner.Calibration,
        profile: Mapping[str, Any],
        news: Mapping[str, Any] | Sequence[Mapping[str, Any]],
        shocks: Sequence[ShockCase | Mapping[str, Any]] | None,
        emit: Callable[[str, dict], Any],
        *,
        max_rounds: int = 3,
        max_plans: int = 8,
        n_paths: int = 1000,
        seed: int = 0,
        gut_plan: PlanSpec | Mapping[str, Any] | None = None,
    ) -> None:
        """`news` is `NewsWatch.find`'s result (or just its items). `shocks` is the grid's columns so far: leave it
        empty (or pass only the `news` column) and `scenarios()` builds the rest with Ultra; pass 2 or more and
        they are used as given (the caller has already emitted them). `gut_plan` is the owner's own idea: it is
        tested with the seed plans as "Your gut call: {name}" (source `user`), and Ultra is told whose idea it is."""
        self.router, self.cal, self.profile, self._emit_fn = router, cal, dict(profile), emit
        self.max_rounds, self.max_plans, self.n_paths, self.seed = max_rounds, max_plans, n_paths, seed
        if isinstance(news, Mapping):
            self.news_items = [dict(i) for i in news.get("items", [])]
            self.used_for_grid = news.get("used_for_grid")
            news_shock = news.get("news_shock")
        else:
            self.news_items = [dict(i) for i in news]
            self.used_for_grid, news_shock = None, None
        cols = [s if isinstance(s, ShockCase) else ShockCase.from_dict(s) for s in (shocks or [])]
        if not cols:
            cols = [self._news_case(news_shock)]
        self.shocks: list[ShockCase] = cols
        self._scenarios_done = len(cols) > 1
        self.unmodelled: list[dict] = []
        self.fallback_used = False
        self.specs: list[PlanSpec] = []
        self.sources: dict[str, str] = {}
        self.rounds_of: dict[str, int] = {}
        self.cells: list[dict] = []
        self.baseline: dict[str, float] = {}
        self.crowd_rows: dict[str, list[dict]] = {}
        self._sent: dict[str, CrowdSentiment] = {}
        self._reactions: dict[tuple, asyncio.Task] = {}         # visible_key -> one shopper ask, shared
        self._rated: dict[float, list[tuple[float, np.ndarray]]] = {}  # marketing % -> (price %, mu_a) in order
        self._notes: dict[str, str] = {}
        self.summary: dict[str, Any] = {}
        self.last_why = ""
        self.ultra_pick: str | None = None
        self._stale = False            # plans were tested after Ultra last picked, so it has not seen their results
        self.search_fallback = False   # Ultra failed in a round: the fixed search ran, so the memo is a template
        self.gut: PlanSpec | None = None
        self.gut_is_do_nothing = False
        if gut_plan is not None:
            g = gut_plan if isinstance(gut_plan, PlanSpec) else PlanSpec.from_dict(gut_plan)
            g = g.clamp()
            if _slug_spec(g) == _slug_spec(PlanSpec.do_nothing()):
                self.gut_is_do_nothing = True
            else:
                self.gut = replace(g, name=gut_name(g.name))

    # --- plumbing ----------------------------------------------------------------------------
    async def _emit(self, event: str, data: dict) -> None:
        res = self._emit_fn(event, data)
        if asyncio.iscoroutine(res):
            await res

    async def _step(
        self, rnd: int, kind: str, text: str, plan_name: str | None = None, tier: str = "engine", latency_ms: float | None = None
    ) -> None:
        await self._emit(
            "agent_step",
            {"round": rnd, "kind": kind, "text": text[:300], "plan_name": plan_name, "tier": tier,
             "latency_ms": None if latency_ms is None else round(latency_ms)},
        )

    async def _fallback(self, rnd: int, text: str, *, counts: bool = True) -> None:
        if counts:
            self.fallback_used = True
        await self._step(rnd, "fallback", text)

    def _news_case(self, news_shock: Mapping[str, Any] | None) -> ShockCase:
        item = next((i for i in self.news_items if i.get("id") == self.used_for_grid), None)
        knobs = dict(news_shock or (item or {}).get("shock") or {})
        base = {"delta_c_raw": 0.0, "delta_lead_time": 0, "demand_shock": 0.0, **knobs}
        case = planner.default_shock_cases(base, self.profile)[1]  # label "Beans +31% (today's news)"
        if item is not None and is_assumption(item):
            case = replace(case, label=case.label.replace(" (today's news)", " (assumed)"))
        return replace(
            case, id=NEWS_ID, origin="news", likelihood="likely",
            source_ids=[self.used_for_grid] if self.used_for_grid else [],
        ).clamp()

    @property
    def supply_items(self) -> list[dict]:
        return [i for i in self.news_items if i.get("kind", "supply") == "supply"]

    @property
    def market_items(self) -> list[dict]:
        return [i for i in self.news_items if i.get("kind") == "market"]

    def _case_event(self, case: ShockCase) -> dict:
        return {**case.to_dict(), "cost_line": wording.cost_line(self.profile, case)}

    def _shock_dicts(self) -> list[dict]:
        return [c.to_dict() for c in self.shocks]

    async def _ultra(
        self, messages: list[dict], schema: type[BaseModel], *, role: str, rnd: int, thinking: bool
    ) -> tuple[BaseModel | None, float | None]:
        """Up to ULTRA_TRIES calls. Reasoning is streamed out as `reasoning` events when thinking is on."""
        async def on_reasoning(delta: str) -> None:
            await self._emit("reasoning", {"role": role, "round": rnd, "delta": delta})

        latency: float | None = None
        for _ in range(ULTRA_TRIES):
            try:
                res = await self.router.call(
                    "ultra", messages, schema, thinking=thinking, role=role,
                    on_reasoning=on_reasoning if thinking else None,
                )
            except Exception as e:  # noqa: BLE001  a transport bug must not end the analysis
                log.warning("ultra call failed (%s): %s", role, e)
                continue
            latency = res.record.total_ms if getattr(res, "record", None) is not None else None
            if res.parsed is not None:
                if thinking:
                    await self._emit("reasoning_done", {"role": role, "round": rnd})
                return res.parsed, latency
        if thinking:
            await self._emit("reasoning_done", {"role": role, "round": rnd})
        return None, latency

    # --- step 0b: futures --------------------------------------------------------------------
    async def scenarios(self) -> list[ShockCase]:
        """Ultra picks the grid's other futures; code applies the rules. Emits `scenarios`, then `shocks`."""
        news_case = self.shocks[0]
        ids = {str(i.get("id")) for i in self.news_items if not is_assumption(i)}  # the assumption isn't a source
        msgs = scenario_messages(
            self.profile, news_case.to_dict(), wording.cost_line(self.profile, news_case),
            self.supply_items, self.market_items,
        )
        parsed, _ = await self._ultra(msgs, ScenarioSet, role="scenarios", rnd=0, thinking=True)
        fell_back = False
        if parsed is None:
            columns = default_columns(news_case, self.profile)
            thought = "Ultra did not answer, so I am testing the standard futures: half the headline, worse, and a shipping delay."
            self.unmodelled = []
            fell_back = True
            await self._fallback(0, "Ultra could not propose futures; using the standard columns.")
        else:
            assert isinstance(parsed, ScenarioSet)
            columns, notes, fell_back = build_columns(parsed, news_case, self.profile, ids)
            for note in notes:
                await self._fallback(0, note, counts=False)
            if fell_back:
                self.fallback_used = True
            thought = tidy(parsed.thought, 300)
            self.unmodelled = [
                {"text": u.text, "source_id": u.source_id if u.source_id in ids else None} for u in parsed.unmodelled
            ]
        self.shocks = columns
        self._scenarios_done = True
        await self._emit("scenarios", {"thought": thought, "unmodelled": self.unmodelled, "fallback_used": fell_back})
        await self._emit("shocks", {"cases": [self._case_event(c) for c in columns]})
        return columns

    # --- shoppers ----------------------------------------------------------------------------
    async def _crowd(self, spec: PlanSpec) -> tuple[CrowdSentiment, list[dict], bool]:
        """One ask per visible setting (`visible_key`): a plan shoppers can't tell from one already rated reuses
        that reaction instead of a second, possibly contradicting, call."""
        key = visible_key(spec)
        if key not in self._reactions:
            self._reactions[key] = asyncio.ensure_future(ask_crowd(self.router, self.profile, spec))
        return await asyncio.shield(self._reactions[key])

    def _in_price_order(
        self, spec: PlanSpec, crowd: tuple[CrowdSentiment, list[dict], bool]
    ) -> tuple[tuple[CrowdSentiment, list[dict], bool], int]:
        """Apply `keep_price_order` against plans already announced; returns the crowd and how many groups moved."""
        sentiment, rows, missing = crowd
        if spec.is_textbook or not shoppers_see(spec):
            return crowd, 0  # the textbook price is set by the engine; an unseen plan is neutral by rule
        rated = self._rated.setdefault(round(spec.marketing_change_pct, 2), [])
        mu_a = keep_price_order(sentiment.mu[:, 0], spec.price_change_pct, rated)
        rated.append((spec.price_change_pct, mu_a))
        moved = int(np.sum(np.abs(mu_a - sentiment.mu[:, 0]) > 1e-9))
        if not moved:
            return crowd, 0
        mu = sentiment.mu.copy()
        mu[:, 0] = mu_a
        rows = [{**r, "mu": [float(mu_a[i]), r["mu"][1]]} for i, r in enumerate(rows)]
        return (CrowdSentiment(mu=mu, sigma=sentiment.sigma), rows, missing), moved

    async def _announce_crowd(self, rnd: int, spec: PlanSpec, crowd: tuple[CrowdSentiment, list[dict], bool]) -> None:
        crowd, moved = self._in_price_order(spec, crowd)
        sentiment, rows, missing = crowd
        self._sent[spec.name] = sentiment
        self.crowd_rows[spec.name] = rows
        await self._emit("crowd", {"plan_name": spec.name, "archetypes": rows})
        spoken = [r for r in rows if r["bubble"]]
        if not shoppers_see(spec):
            await self._step(rnd, "shoppers", "No price or marketing change, so shoppers see nothing new: counted as neutral.", spec.name, "engine")
            return
        if missing:
            await self._fallback(rnd, f"Some shoppers did not answer for “{spec.name}”; counted as neutral.")
        if moved:
            await self._step(
                rnd, "shoppers",
                f"Kept {moved} shopper group{'s' if moved > 1 else ''} in price order: none likes “{spec.name}” more than "
                "a cheaper plan or less than a dearer one.", spec.name, "engine",
            )
        if spoken:
            top = max(spoken, key=lambda r: abs(r["mu"][0]))
            self._notes[spec.name] = f'{top["label"]}: "{top["bubble"]}"'
            await self._step(rnd, "shoppers", f'{top["label"]}: “{top["bubble"]}”', spec.name, "fast")

    # --- engine ------------------------------------------------------------------------------
    def _register(self, spec: PlanSpec, source: str, rnd: int) -> None:
        self.specs.append(spec)
        self.sources[spec.name] = source
        self.rounds_of[spec.name] = rnd

    async def _evaluate(self, spec: PlanSpec, rnd: int, *, emit_result: bool = True) -> list[dict]:
        """Test one plan in every column on the shared seed (common random numbers); emit the cells at once."""
        crowd = {spec.name: self._sent[spec.name]} if spec.name in self._sent else None
        res = await asyncio.to_thread(
            planner.evaluate_grid, self.cal, [spec], self.shocks, crowd, HORIZON, self.n_paths, self.seed
        )
        self.baseline.update(res["baseline_profit_usd"])
        cells = [{**c, "source": "local"} for c in res["cells"]]
        await self._announce_cells(spec, cells, rnd, emit_result=emit_result)
        return cells

    async def _announce_cells(self, spec: PlanSpec, cells: list[dict], rnd: int, *, emit_result: bool = True) -> None:
        for c in cells:
            self.cells.append(c)
            await self._emit("grid_cell", c)
        news = next((c for c in cells if c["shock_id"] == NEWS_ID), cells[0] if cells else None)
        if emit_result and news is not None:
            await self._step(rnd, "result", f"“{spec.name}”: {wording.result_line(news)}", spec.name, "engine")

    def _cell(self, plan: str, shock_id: str = NEWS_ID) -> dict | None:
        return next((c for c in self.cells if c["plan_name"] == plan and c["shock_id"] == shock_id), None)

    def _labels(self) -> tuple[str, str]:
        specs = [PlanSpec.do_nothing(), *self.specs]
        by_plan = {
            i: {c["shock_id"]: c for c in self.cells if c["plan_name"] == s.name} for i, s in enumerate(specs) if i > 0
        }
        return planner._labels(specs, self.shocks, by_plan)

    async def _emit_summary(self) -> None:
        best, safest = self._labels()
        self.summary = {"baseline_profit_usd": dict(self.baseline), "best_today": best, "safest": safest, "verified": False}
        await self._emit("grid_summary", self.summary)

    def _news_means(self) -> dict[str, float]:
        return {s.name: self._cell(s.name)["mean_delta_usd"] for s in self.specs if self._cell(s.name)}

    # --- rounds ------------------------------------------------------------------------------
    def _crowd_notes(self) -> str:
        return "\n".join(f'- {name}: {note}' for name, note in self._notes.items())

    async def _seed(self) -> None:
        seeds = list(SEED_PLANS)
        if self.gut is not None:  # a gut call equal to a seed plan takes that seed's row
            seeds = [s for s in seeds if _slug_spec(s) != _slug_spec(self.gut)]
        plans = [(s, "seed") for s in seeds] + ([(self.gut, "user")] if self.gut is not None else [])
        for spec, source in plans:
            self._register(spec, source, 0)
            await self._emit("plan", {"name": spec.name, "source": source, "round": 0, "spec": spec.to_dict()})
        if self.gut_is_do_nothing:
            await self._step(0, "result", "Your gut call is to wait and see. That is the “Do nothing” line every plan is scored against.")
        crowds = await asyncio.gather(*(self._crowd(s) for s, _ in plans))
        for (spec, _), crowd in zip(plans, crowds, strict=True):
            await self._announce_crowd(0, spec, crowd)
        for spec, _ in plans:
            await self._evaluate(spec, 0)
        await self._emit_summary()

    def _accept_plans(self, step: AnalystStep) -> tuple[list[PlanSpec], list[str]]:
        """Clamp Ultra's plans, rename duplicate names, skip a plan identical to one already tested, and skip a
        supplier switch to a cheaper supplier nobody knows of (SPEC §15.4). Returns the plans and notes."""
        taken = {DO_NOTHING.lower(), *(s.name.lower() for s in self.specs)}
        seen_specs = {_slug_spec(s) for s in self.specs}
        out: list[PlanSpec] = []
        notes: list[str] = []
        for model in step.plans:
            if len(self.specs) + len(out) >= self.max_plans:
                break
            spec = PlanSpec.from_dict(model.to_engine())
            spec = replace(spec, name=fit_name(spec.name))
            if spec.switch_supplier and spec.alt_cost_change_pct < ALT_COST_FLOOR_PCT:
                notes.append(
                    f"Skipped “{spec.name}”: it assumes a supplier {-spec.alt_cost_change_pct:.0f}% cheaper than today's, "
                    "and none is known."
                )
                continue
            if _slug_spec(spec) in seen_specs:
                continue  # same settings under another name: never re-tested
            spec = replace(spec, name=_unique_name(spec.name, taken))
            taken.add(spec.name.lower())
            seen_specs.add(_slug_spec(spec))
            out.append(spec)
        return out, notes

    async def _round(self, rnd: int) -> bool:
        """One Ultra round. Returns False to stop (finish, nothing new, or Ultra failed twice)."""
        msgs = analyst_messages(
            self.profile, self.supply_items, wording.results_table(self.cells, self._shock_dicts()),
            self._crowd_notes(), rnd, self.max_rounds, [DO_NOTHING, *(s.name for s in self.specs)],
            futures_block=wording.futures_block(self._shock_dicts()),
            owner_idea=self.gut.name if self.gut is not None else None,
        )
        step, latency = await self._ultra(msgs, AnalystStep, role="analyst", rnd=rnd, thinking=True)
        if step is None:
            await self._fallback(rnd, "Ultra did not answer twice; running a fixed search over price and stock instead.")
            self.search_fallback = True
            await self._deterministic_search(rnd)
            return False
        assert isinstance(step, AnalystStep)
        self.ultra_pick, self._stale = fit_name(step.pick), False
        step = step.model_copy(update={"thought": tidy(step.thought, 300), "why": tidy(step.why, 300)})
        self.last_why = step.why
        await self._step(rnd, "think", step.thought, None, "ultra", latency)
        new, notes = self._accept_plans(step) if step.action == "test" else ([], [])
        for note in notes:
            await self._fallback(rnd, note, counts=False)
        if not new:
            await self._step(rnd, "finish", step.why or "No new idea worth testing.", None, "ultra")
            return False
        self._stale = True
        for spec in new:
            self._register(spec, "ai", rnd)
            await self._emit("plan", {"name": spec.name, "source": "ai", "round": rnd, "spec": spec.to_dict()})
            await self._step(rnd, "test", f"Testing “{spec.name}” in every future.", spec.name, "ultra")
        crowds = await asyncio.gather(*(self._crowd(s) for s in new))
        for spec, crowd in zip(new, crowds, strict=True):
            await self._announce_crowd(rnd, spec, crowd)
            await self._evaluate(spec, rnd)
        await self._emit_summary()
        return len(self.specs) < self.max_plans

    async def _deterministic_search(self, rnd: int) -> None:
        """Ultra is down: try price x stock combinations with neutral shoppers; keep the best 2 by safest, then best_today."""
        tested = {_slug_spec(s) for s in self.specs}
        pool: list[PlanSpec] = []
        for price in SEARCH_PRICES:
            for stock in SEARCH_STOCKS:
                if price == 0 and stock == 0:
                    continue
                bits = ([f"price {price:+d}%".replace("-", wording.MINUS)] if price else []) + ([f"stock +{stock} wk"] if stock else [])
                spec = PlanSpec(name=("Search: " + ", ".join(bits))[:40], price_change_pct=float(price), extra_stock_weeks=float(stock))
                if _slug_spec(spec) not in tested:
                    pool.append(spec)
        results = []
        for spec in pool:
            res = await asyncio.to_thread(planner.evaluate_grid, self.cal, [spec], self.shocks, None, HORIZON, self.n_paths, self.seed)
            results.append((spec, [{**c, "source": "local"} for c in res["cells"]], res["baseline_profit_usd"]))
        if not results:
            return
        specs = [PlanSpec.do_nothing(), *(r[0] for r in results)]
        by_plan = {i + 1: {c["shock_id"]: c for c in r[1]} for i, r in enumerate(results)}
        best, safest = planner._labels(specs, self.shocks, by_plan)
        order = sorted(range(len(results)), key=lambda i: -by_plan[i + 1][NEWS_ID]["mean_delta_usd"])
        chosen = [safest, best]
        for i in order:  # best_today equals safest: take the next best average instead
            if len(set(chosen)) >= 2:
                break
            chosen.append(results[i][0].name)
        picks = list(dict.fromkeys(chosen))[:2]
        for spec, cells, baseline in results:
            if spec.name not in picks or len(self.specs) >= self.max_plans:
                continue
            self._register(spec, "ai", rnd)
            self.baseline.update(baseline)
            await self._emit("plan", {"name": spec.name, "source": "ai", "round": rnd, "spec": spec.to_dict()})
            await self._announce_cells(spec, cells, rnd)
        await self._emit_summary()

    # --- memo --------------------------------------------------------------------------------
    def _final_pick(self, ultra_pick: str | None) -> str:
        best = self.summary.get("best_today") or (self.specs[0].name if self.specs else DO_NOTHING)
        if self.fallback_used and ultra_pick is None:
            return best
        names = {s.name.lower(): s.name for s in self.specs}
        if ultra_pick and ultra_pick.strip().lower() in names:
            picked = names[ultra_pick.strip().lower()]
            return self._better_than(picked) if self._stale else picked
        means = self._news_means()
        if ultra_pick and ultra_pick.strip().lower() == DO_NOTHING.lower() and means and max(means.values()) <= 0:
            return DO_NOTHING
        return best

    def _worst_p5(self, name: str) -> float:
        safe = [c.id for c in self.shocks if c.likelihood != "unlikely"] or [c.id for c in self.shocks]
        return min(self._cell(name, sid)["p5_delta_usd"] for sid in safe)

    def _better_than(self, picked: str) -> str:
        """Ultra's pick predates the last tests. Switch only to a plan that beats it on the average, the bad case and
        the worst safe column, and doesn't need more cash than the owner has; otherwise Ultra's pick stands."""
        base = self._cell(picked)
        if base is None:
            return picked
        better = [
            s.name for s in self.specs
            if s.name != picked and not self._cell(s.name)["over_cash"]
            and self._cell(s.name)["mean_delta_usd"] > base["mean_delta_usd"]
            and self._cell(s.name)["p5_delta_usd"] >= base["p5_delta_usd"]
            and self._worst_p5(s.name) >= self._worst_p5(picked)
        ]
        return max(better, key=lambda n: self._cell(n)["mean_delta_usd"]) if better else picked

    def _numbers(self, cell: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "shock_id": NEWS_ID,
            "mean_delta_usd": round(cell["mean_delta_usd"], 2),
            "p5_delta_usd": round(cell["p5_delta_usd"], 2),
            "p_better": round(cell["p_better"], 4),
            "n": cell["n"],
            "verified": False,
            "bridge": {k: round(v, 2) for k, v in cell["bridge"].items()},
            "steady_rival_delta_usd": None if cell.get("steady_rival_delta_usd") is None else round(cell["steady_rival_delta_usd"], 2),
            "peak_cash_usd": round(cell["peak_cash_usd"], 2),
            "payback_week": cell["payback_week"],
            "over_cash": cell["over_cash"],
            "cash_available": float(self.profile.get("cash_available", 0.0) or 0.0),
        }

    @staticmethod
    def _template_memo(pick: str, over_cash: bool) -> dict[str, str]:
        if pick == DO_NOTHING:
            headline = "Hold steady: no plan beat doing nothing"
            why = "Every plan tested did worse than doing nothing on average in today's news case."
        else:
            headline = f"Go with “{pick}”"[:90]
            why = "It had the best average result in today's news case among the plans tested, and it held up in the bad case. See the figures above."
        watch = "If the news turns out milder than the headline, the extra spend may not pay back. Check the bad case."
        if over_cash:
            watch = "This plan needs more cash than you said you have. " + watch
        return {
            "headline": headline, "why": why, "watch_out": watch[:300],
            "recheck_when": "When the next price or shipping news changes the picture, or in a few weeks.",
        }

    def _zero_cell(self) -> dict:
        z = {"cost_usd": 0.0, "price_usd": 0.0, "volume_usd": 0.0, "marketing_usd": 0.0, "holding_usd": 0.0}
        return {
            "n": self.n_paths, "mean_delta_usd": 0.0, "p5_delta_usd": 0.0, "p_better": 0.0, "bridge": z,
            "steady_rival_delta_usd": 0.0, "peak_cash_usd": 0.0, "payback_week": None, "over_cash": False,
        }

    def _runner_up(self, pick: str, pick_cell: Mapping[str, Any]) -> dict | None:
        rivals = [(n, m) for n, m in self._news_means().items() if n != pick]
        if not rivals:
            return None
        name = max(rivals, key=lambda t: t[1])[0]
        cell = self._cell(name)
        assert cell is not None
        if self.last_why and name.lower() in self.last_why.lower():
            why_not = self.last_why
        else:
            why_not = (
                f"{name} averages {wording.usd_k(cell['mean_delta_usd'])} in today's news case against "
                f"{wording.usd_k(pick_cell['mean_delta_usd'])} for the pick; in the bad case it is "
                f"{wording.usd_k(cell['p5_delta_usd'])} against {wording.usd_k(pick_cell['p5_delta_usd'])}."
            )
        return {
            "name": name, "mean_delta_usd": cell["mean_delta_usd"], "p5_delta_usd": cell["p5_delta_usd"],
            "why_not": why_not,
        }

    async def _memo(self, pick: str, *, template_only: bool) -> dict:
        spec = next((s for s in self.specs if s.name == pick), PlanSpec.do_nothing())
        cell = self._cell(pick) or self._zero_cell()
        numbers = self._numbers(cell)
        draft: dict[str, str] | None = None
        if not template_only:
            msgs = memo_messages(self.profile, pick, spec.to_dict(), numbers, self.news_items)
            parsed, _ = await self._ultra(msgs, MemoDraft, role="memo", rnd=self.max_rounds + 1, thinking=False)
            if parsed is not None:
                assert isinstance(parsed, MemoDraft)
                draft = {k: tidy(v, cap) for (k, v), cap in zip(parsed.model_dump().items(), (90, 400, 300, 150), strict=True)}
        if draft is None:
            await self._fallback(self.max_rounds + 1, "Writing the memo from a template.")
            draft = self._template_memo(pick, numbers["over_cash"])
        news_case = self.shocks[0]
        sources = [
            {"title": i.get("title", ""), "url": i["url"], "quote": i.get("quote", "")}
            for i in [*self.supply_items, *self.market_items] if i.get("url")
        ]
        memo = {
            "plan_name": pick, **draft, "numbers": numbers, "cost_line": wording.cost_line(self.profile, news_case),
            "sources": sources,
            "not_modelled": {"fixed": list(wording.NOT_MODELLED_FIXED), "found": self.unmodelled},
            "fallback_used": self.fallback_used,
            "actions": wording.plan_actions(spec, self.profile, cell),
            "runner_up": self._runner_up(pick, cell),
        }
        await self._emit("memo", memo)
        return memo

    # --- run ---------------------------------------------------------------------------------
    async def run(self) -> dict:
        if not self._scenarios_done:
            await self.scenarios()
        await self._seed()
        for rnd in range(1, self.max_rounds + 1):
            if len(self.specs) >= self.max_plans or not await self._round(rnd):
                break
        pick = self._final_pick(self.ultra_pick)
        memo = await self._memo(pick, template_only=self.search_fallback)
        return {
            "plans": [
                {"name": s.name, "source": self.sources[s.name], "round": self.rounds_of[s.name], "spec": s.to_dict()}
                for s in self.specs
            ],
            "cells": self.cells,
            "summary": self.summary,
            "memo": memo,
            "crowd": self.crowd_rows,
        }


# --------------------------------------------------------------------------------------
# Live run: python -m backend.agents.analyst --example coffee_hcmc --live
# --------------------------------------------------------------------------------------


def _print_grid(result: dict, shocks: Sequence[ShockCase]) -> None:
    print("\n=== Grid ($k vs Do nothing: mean / bad case / % better) ===")
    print(wording.results_table(result["cells"], [c.to_dict() for c in shocks]))


async def _live(example_id: str) -> None:
    from backend.services.news_watch import NewsWatch
    from backend.services.router import NemotronRouter
    from backend.services.tavily_scout import TavilyScout

    ex = json.loads((ROOT / "fixtures" / "examples" / f"{example_id}.json").read_text())
    profile = ex["profile"]
    router = NemotronRouter()
    scout = TavilyScout(router=router)
    news = await NewsWatch(scout, router).find(profile, fallback_shock=ex["fallback_shock"], live=True)
    print(f"News: {len(news['items'])} items, used {news['used_for_grid']}, {news['credits']} Tavily credits")
    for it in news["items"]:
        print(f'  [{it["id"]}] {it["kind"]} {it["title"][:70]} | {it.get("cost_line") or ""} | impact {it.get("impact_usd")}')

    def emit(event: str, data: dict) -> None:
        if event == "agent_step":
            print(f'[round {data["round"]}] {data["kind"]:<8} ({data["tier"]}) {data["text"]}')
        elif event == "scenarios":
            print(f'\nFutures thought: {data["thought"]}\nUnmodelled: {json.dumps(data["unmodelled"], ensure_ascii=False)}')
        elif event == "shocks":
            print("Futures picked:\n" + wording.futures_block(data["cases"]) + "\n")

    analyst = Analyst(router, planner.calibrate(profile), profile, news, None, emit)
    result = await analyst.run()
    _print_grid(result, analyst.shocks)
    memo = result["memo"]
    print("\n=== Summary ===", json.dumps({k: v for k, v in result["summary"].items() if k != "baseline_profit_usd"}))
    print("\n=== Memo ===")
    print(json.dumps({k: memo[k] for k in ("plan_name", "headline", "why", "watch_out", "recheck_when", "fallback_used")}, indent=2, ensure_ascii=False))
    print("cost line:", memo["cost_line"])
    print("numbers:", json.dumps(memo["numbers"]))
    for line in wording.bridge_lines(memo["numbers"]["bridge"]):
        print("  ", line["text"])
    print("actions:", memo["actions"])
    print("runner-up:", memo["runner_up"])
    print("not modelled (found):", memo["not_modelled"]["found"])
    snap = router.store.snapshot()
    print(f'\nSpend: ${snap["cost_usd"]:.4f} on Token Factory, {scout.credits_used} Tavily credits, '
          f'calls {json.dumps({t: v["calls"] for t, v in snap["tiers"].items()})}')


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run the analyst on an example business with the real models.")
    ap.add_argument("--example", required=True, help="fixtures/examples/<id>.json, e.g. coffee_hcmc")
    ap.add_argument("--live", action="store_true", help="call Token Factory and Tavily (costs about $0.06-0.12)")
    args = ap.parse_args(argv)
    if not args.live:
        print("Pass --live to run with the real models (this spends money).", file=sys.stderr)
        return 2
    asyncio.run(_live(args.example))
    return 0


if __name__ == "__main__":
    sys.exit(main())
