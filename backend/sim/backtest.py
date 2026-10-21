"""Backtest: "would Dry Run have helped?" on a real shock (B1, SPEC §15.12; docs/EVENTS.md v2.2).

A case (`fixtures/backtests/<id>.json`) fixes a date in the past. The analysis runs as if it were that date, with
only the news from before it (see `Analysis(as_of=...)`). This module then scores the advice against what really
happened to the input's price. The engine does the scoring, so the number is checkable even when the advice lost
money. Everything here is pure: no LLM, no network, seeded.

- Series -> weekly path: each monthly value is the month's mid-point (the 15th), straight lines between them, then
  `path[t] = P(as_of + 7t days) / P(as_of) - 1`. A policy case (a tariff) is a step function by date; with
  `path_index: "order_week"` the duty is the one in force when the goods ARRIVE, so the path is shifted earlier by the
  profile's lead time (an order placed in week t pays the rate at week t + lead).
- Scoring: the `realized` ShockCase (`cost_path`, everything else 0) is run for every plan the analysis tested and for
  a hindsight sweep, 1,000 paths, the analysis's seed, common random numbers.
- Leak check: LLM text is scanned for the case's spoiler terms, for dates after `as_of`, and for percent claims that
  match the real path. A flagged run is shown, never hidden.
"""
from __future__ import annotations

import csv
import itertools
import json
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np

from backend.agents import wording
from backend.config import ROOT
from backend.engine import planner
from backend.engine.planner import DO_NOTHING, TEXTBOOK_RULE, PlanSpec, ShockCase
from backend.engine.types import CrowdSentiment
from backend.services import asof, replay

CASES_DIR = ROOT / "fixtures" / "backtests"
PRICES_DIR = ROOT / "fixtures" / "prices"
HORIZON = 24
N_PATHS = 1000
SWEEP_PATHS = 300
SWEEP_TOP = 3
REALIZED_ID = "realized"
CASE_ID = re.compile(r"^bt_[a-z0-9_]{1,40}$")
# The hindsight sweep (SPEC §15.12): price change % x start week x end week x extra stock weeks (placed in week 0).
SWEEP_PRICES = (-5.0, 0.0, 3.0, 5.0, 8.0, 12.0)
SWEEP_STARTS = (0, 2, 4)
SWEEP_ENDS = (12, 16, 24)
SWEEP_STOCKS = (0.0, 2.0, 4.0, 6.0, 8.0)
CLAIM_MATCH_POINTS = 5.0   # a percent claim this close to the real peak or end value is flagged
CLAIM_MIN_PCT = 10.0       # smaller percentages are too common to mean anything
MODEL_CUTOFF_CAVEAT = (
    "The model has seen this period. Nemotron Ultra's model card gives a pre-training cutoff of September 2025 "
    "and a post-training cutoff of May 2026, so a date in the prompt cannot make it forget. The run only gives it "
    "news from before the date, and the leak check looks for hindsight in what it wrote."
)
SWEEP_CAVEAT = (
    "“Best plan in hindsight” is the best of about 230 plans on a fixed grid (price, start, end, extra stock), run "
    "on the real path. Shoppers react to a sweep plan like they did to the nearest price plan the analysis tested; "
    "with none tested, they are neutral."
)
SUPPLIER_CAVEAT = (
    "A plan that switches supplier is scored with the share of the price rise that Ultra assumed the alternative "
    "supplier would feel (`alt_shock_exposure`). The real price path says nothing about whether another supplier "
    "would really have been shielded, so those plans' results rest on that assumption."
)
NEWS_CAVEAT = (
    "News pages are read as they are today. Any article that names a date after the as-of date is dropped, but a "
    "page edited later could still carry hindsight."
)


# --------------------------------------------------------------------------------------
# Cases and series
# --------------------------------------------------------------------------------------


def _safe_id(case_id: str) -> str:
    if not CASE_ID.match(case_id):
        raise KeyError(f"no backtest {case_id!r}")
    return case_id


def case_path(case_id: str, directory: Path | None = None) -> Path:
    return (directory or CASES_DIR) / f"{_safe_id(case_id)}.json"


def load_case(case_id: str, directory: Path | None = None) -> dict:
    """A case file as a dict, with `as_of` turned into a date under the key `as_of_date`. KeyError if unknown."""
    path = case_path(case_id, directory)
    if not path.exists():
        raise KeyError(f"no backtest {case_id!r}")
    case = json.loads(path.read_text(encoding="utf-8"))
    case["as_of_date"] = date.fromisoformat(case["as_of"])
    return case


def list_cases(directory: Path | None = None, replays: Path | None = None) -> list[dict]:
    """`GET /api/backtests`: `[{id, title, subtitle, as_of, has_replay}]`, oldest as-of date first."""
    out = []
    for path in sorted((directory or CASES_DIR).glob("bt_*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        out.append({
            "id": case["id"], "title": case["title"], "subtitle": case.get("subtitle", ""), "as_of": case["as_of"],
            "has_replay": replay.backtest_path(case["id"], replays).exists(),
        })
    return sorted(out, key=lambda c: (c["as_of"], c["id"]))


def load_series(file: str, directory: Path | None = None) -> list[tuple[date, float]]:
    """A `fixtures/prices` CSV (`#` comment lines, then `month,value`) as (mid-month date, value) pairs, by date."""
    path = (directory or PRICES_DIR) / file
    rows = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]
    out = []
    for rec in csv.DictReader(rows):
        month = date.fromisoformat(rec["month"])
        out.append((month.replace(day=15), float(rec["value"])))
    return sorted(out)


def interpolate(points: Sequence[tuple[date, float]], when: date) -> float:
    """Straight lines between the mid-month values. ValueError outside the data."""
    if not points or when < points[0][0] or when > points[-1][0]:
        raise ValueError(f"{when} is outside the series")
    for (d0, v0), (d1, v1) in itertools.pairwise(points):
        if d0 <= when <= d1:
            return v0 + (v1 - v0) * (when - d0).days / max((d1 - d0).days, 1)
    return points[-1][1]


def price_path(points: Sequence[tuple[date, float]], as_of: date, weeks: int = HORIZON) -> list[float]:
    """`path[t] = P(as_of + 7t days) / P(as_of) - 1`, for t = 0 .. weeks-1."""
    base = interpolate(points, as_of)
    return [interpolate(points, as_of + timedelta(days=7 * t)) / base - 1.0 for t in range(weeks)]


def series_points(points: Sequence[tuple[date, float]], as_of: date, weeks: int = HORIZON) -> list[dict]:
    """The chart line for the reveal: weeks 0 .. `weeks` (one more than the path), value and change vs week 0."""
    base = interpolate(points, as_of)
    out = []
    for w in range(weeks + 1):
        d = as_of + timedelta(days=7 * w)
        v = interpolate(points, d)
        out.append({"week": w, "date": d.isoformat(), "value": round(v, 4), "change": round(v / base - 1.0, 4)})
    return out


def duty_on(steps: Sequence[Mapping[str, Any]], when: date) -> float:
    """The extra duty (a fraction, 1.45 = 145%) in force on `when`: the last step on or before it, else 0."""
    rate = 0.0
    for step in sorted(steps, key=lambda s: s["date"]):
        if date.fromisoformat(step["date"]) <= when:
            rate = float(step["duty"])
    return rate


def policy_delta(steps: Sequence[Mapping[str, Any]], base_duty: float, as_of: date, when: date) -> float:
    """Change in the dutiable cost vs the as-of date: (1 + base + duty_t) / (1 + base + duty_asof) - 1."""
    now = 1.0 + base_duty + duty_on(steps, as_of)
    return (1.0 + base_duty + duty_on(steps, when)) / now - 1.0


def policy_path(
    steps: Sequence[Mapping[str, Any]], base_duty: float, as_of: date, weeks: int = HORIZON, lead_weeks: int = 0
) -> list[float]:
    """The step-function path by week. `lead_weeks` > 0 shifts it earlier: week t pays the rate at week t + lead."""
    return [
        policy_delta(steps, base_duty, as_of, as_of + timedelta(days=7 * (t + lead_weeks))) for t in range(weeks)
    ]


def _is_policy(case: Mapping[str, Any]) -> bool:
    return bool(case["series"].get("steps"))


def cost_path_for(case: Mapping[str, Any], profile: Mapping[str, Any] | None = None) -> list[float]:
    """The realised cost path of a case, in the engine's terms (one value per week, week 0 = as_of)."""
    as_of = case.get("as_of_date") or date.fromisoformat(case["as_of"])
    series = case["series"]
    if _is_policy(case):
        lead = _arrival_shift(case, profile or case["profile"])
        return policy_path(series["steps"], float(series.get("base_duty", 0.0)), as_of, HORIZON, lead)
    return price_path(load_series(series["file"]), as_of, HORIZON)


def series_for_event(case: Mapping[str, Any]) -> dict:
    """The `series` block of the `backtest` event. A policy case shows the duty by date (not shifted by lead time)."""
    as_of = case.get("as_of_date") or date.fromisoformat(case["as_of"])
    s = case["series"]
    if _is_policy(case):
        steps, base = s["steps"], float(s.get("base_duty", 0.0))
        pts = []
        for w in range(HORIZON + 1):
            d = as_of + timedelta(days=7 * w)
            pts.append({"week": w, "date": d.isoformat(), "value": round(100.0 * duty_on(steps, d), 2),
                        "change": round(policy_delta(steps, base, as_of, d), 4)})
        return {"label": s["label"], "unit": s["unit"], "source_url": s.get("source_url", ""),
                "as_of_value": round(100.0 * duty_on(steps, as_of), 2), "points": pts}
    points = load_series(s["file"])
    return {"label": s["label"], "unit": s["unit"], "source_url": s.get("source_url", ""),
            "as_of_value": round(interpolate(points, as_of), 4), "points": series_points(points, as_of, HORIZON)}


# --------------------------------------------------------------------------------------
# The realised case
# --------------------------------------------------------------------------------------


def _pct(x: float) -> str:
    v = round(100.0 * x)
    return f"+{v}%" if v >= 0 else f"−{abs(v)}%"


def realized_label(profile: Mapping[str, Any], path: Sequence[float]) -> str:
    """"What happened: Cocoa +121%, then +75%" (a ShockCase label is 40 characters at most)."""
    word, _ = wording._input_words(profile)
    week, peak = planner._path_peak(path)
    end = float(path[-1])
    spiked = week < len(path) - 1 and abs(peak - end) >= 0.05
    for head in ("What happened: ", "Real path: ", ""):
        label = f"{head}{word} {_pct(peak)}, then {_pct(end)}" if spiked else f"{head}{word} {_pct(end)}"
        if len(label) <= 40:
            return label
    return label[:40]


def realized_case(case: Mapping[str, Any], profile: Mapping[str, Any] | None = None) -> ShockCase:
    """The `realized` column: the real cost path, every other knob 0, unless the case file documents one.

    A documented demand or lead-time change goes in the case's `realized_extra` with its `source` (SPEC §15.12);
    none of the four first cases has one."""
    prof = profile or case["profile"]
    path = cost_path_for(case, prof)
    extra = dict(case.get("realized_extra") or {})
    extra.pop("source", None)
    return ShockCase.from_dict({
        "id": REALIZED_ID, "label": realized_label(prof, path), "onset_week": 0, "ramp_weeks": 1,
        "likelihood": "likely", "origin": "realized", "cost_path": path,
        "why": "What the input's price really did next", **extra,
    })


def _arrival_shift(case: Mapping[str, Any], profile: Mapping[str, Any]) -> int:
    """Weeks between an order and the rate it pays (a duty paid on arrival), else 0: for naming months."""
    return int(profile.get("lead_time_weeks", 0)) if case.get("path_index") == "order_week" else 0


def realized_event(case: Mapping[str, Any], profile: Mapping[str, Any]) -> dict:
    """The `realized_case` block of the `backtest` event: the ShockCase plus its cost line (months, not weeks)."""
    sc = realized_case(case, profile)
    as_of = case.get("as_of_date") or date.fromisoformat(case["as_of"])
    line = wording.cost_line(profile, sc, as_of=as_of, shift_weeks=_arrival_shift(case, profile))
    return {**sc.to_dict(), "cost_line": line}


def futures_cover(columns: Iterable[ShockCase | Mapping[str, Any]], path: Sequence[float]) -> dict:
    """Did Ultra's futures reach the real input price? Range of `delta_c_raw` over the grid's columns (the news
    column included) against the real peak and end value (both as a change vs the as-of date)."""
    deltas = [float(c.delta_c_raw if isinstance(c, ShockCase) else c["delta_c_raw"]) for c in columns]
    lo, hi = (min(deltas), max(deltas)) if deltas else (0.0, 0.0)
    _, peak = planner._path_peak(path)
    end = float(path[-1])
    return {
        "min": round(lo, 4), "max": round(hi, 4), "realized_peak": round(peak, 4), "realized_end": round(end, 4),
        "peak_inside": bool(lo - 1e-9 <= peak <= hi + 1e-9), "end_inside": bool(lo - 1e-9 <= end <= hi + 1e-9),
    }


# --------------------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------------------


def plan_name(spec: PlanSpec) -> str:
    """Plain short name of a sweep plan: "Stock up 8 wk, +5% wk 2-16"."""
    bits: list[str] = []
    if spec.extra_stock_weeks > 0:
        at = "" if spec.stock_week == 0 else f" wk {spec.stock_week}"
        bits.append(f"Stock up {spec.extra_stock_weeks:g} wk{at}")
    if spec.price_change_pct:
        sign = "+" if spec.price_change_pct > 0 else "−"
        when = f" wk {spec.price_change_week}" if spec.price_change_week else ""
        if spec.has_surcharge_end:
            when = f" wk {spec.price_change_week}-{spec.price_end_week}"
        bits.append(f"{sign}{abs(spec.price_change_pct):g}% price{when}")
    return ", ".join(bits)[:40] or DO_NOTHING


def plain_words(spec: PlanSpec, profile: Mapping[str, Any]) -> str:
    """The plan as one sentence from `wording.plan_actions`: "Week 0: Order 8 extra weeks ... Week 2: Raise ..."."""
    return "; ".join(f"week {s['week']}: {s['text']}" for s in wording.plan_actions(spec, profile))


def sweep_plans() -> list[PlanSpec]:
    """The hindsight sweep, deduplicated: with no price change the start and end week mean nothing."""
    out: list[PlanSpec] = []
    for price in SWEEP_PRICES:
        starts, ends = (SWEEP_STARTS, SWEEP_ENDS) if price else ((0,), (24,))
        for start in starts:
            for end in ends:
                for stock in SWEEP_STOCKS:
                    if price == 0 and stock == 0:
                        continue  # that is "Do nothing"
                    spec = PlanSpec(price_change_pct=price, price_change_week=start, price_end_week=end,
                                    extra_stock_weeks=stock, stock_week=0).clamp()
                    out.append(PlanSpec(**{**spec.to_dict(), "name": f"sw{len(out):03d}"}))
    return out


def _sweep_reaction(
    spec: PlanSpec, tested: Sequence[tuple[PlanSpec, CrowdSentiment]]
) -> CrowdSentiment | None:
    """Shoppers' reaction to a sweep plan: the nearest tested plan with a price move the same way (and no marketing
    change), its mood toward us scaled by the ratio of the price moves. None (neutral) when there is none."""
    x = spec.price_change_pct
    if x == 0:
        return None
    near = [(abs(t.price_change_pct - x), t, c) for t, c in tested
            if t.price_change_pct * x > 0 and t.marketing_change_pct == 0 and not t.is_textbook]
    if not near:
        return None
    _, t, c = min(near, key=lambda z: z[0])
    mu = np.array(c.mu, dtype=np.float64, copy=True)
    mu[:, 0] = np.clip(mu[:, 0] * (x / t.price_change_pct), -1.0, 1.0)
    return CrowdSentiment(mu=mu, sigma=c.sigma)


def _row(cell: Mapping[str, Any]) -> dict:
    return {
        "plan_name": cell["plan_name"], "mean_delta_usd": round(float(cell["mean_delta_usd"]), 2),
        "p5_delta_usd": round(float(cell["p5_delta_usd"]), 2), "p_better": round(float(cell["p_better"]), 4),
        "bridge": {k: round(float(v), 2) for k, v in cell["bridge"].items()},
    }


def score(
    *,
    case: Mapping[str, Any],
    cal: planner.Calibration,
    plans: Mapping[str, PlanSpec],
    crowd_for: Callable[[str], CrowdSentiment | None],
    pick: str,
    seed: int = 0,
    n_paths: int = N_PATHS,
    sweep_paths: int = SWEEP_PATHS,
) -> dict:
    """Score the analysis against the real path (SPEC §15.12 Part C). Engine only, free.

    `plans` maps name -> spec for every plan the analysis tested (not "Do nothing"); `crowd_for(name)` gives each
    plan's recorded shoppers. Returns `cells`, `pick`, `pick_rank`, `n_plans`, `beat_do_nothing`, `pick_delta_usd`,
    `hindsight_best`, `regret_usd`, `baselines` and the `realized_case` (a ShockCase, not yet an event dict)."""
    realized = realized_case(case, cal.profile)
    crowd = {n: s for n in plans if (s := crowd_for(n)) is not None}
    names = list(plans)
    res = planner.evaluate_grid(cal, [plans[n] for n in names], [realized], crowd, HORIZON, n_paths, seed,
                                steady_rival=False)
    cells = {c["plan_name"]: _row(c) for c in res["cells"]}

    # Baselines on the real path: the seed plans the analysis tested, and the textbook rule (never tested there).
    textbook = planner.evaluate_cell(cal, PlanSpec(name=TEXTBOOK_RULE), realized, None, HORIZON, n_paths, seed,
                                     steady_rival=False)
    baselines = [{"name": DO_NOTHING, "mean_delta_usd": 0.0}]
    baselines += [{"name": n, "mean_delta_usd": cells[n]["mean_delta_usd"]}
                  for n in ("Raise price 5% now", "Stock up 4 weeks now") if n in cells]
    baselines.append({"name": TEXTBOOK_RULE, "mean_delta_usd": round(float(textbook["mean_delta_usd"]), 2)})

    # The hindsight sweep: 300 paths each, then the top 3 again at the full path count.
    tested = [(plans[n], s) for n, s in crowd.items()]
    sweep = sweep_plans()
    sweep_crowd = {}
    for spec in sweep:
        react = _sweep_reaction(spec, tested)
        if react is not None:
            sweep_crowd[spec.name] = react
    sw = planner.evaluate_grid(cal, sweep, [realized], sweep_crowd, HORIZON, sweep_paths, seed, steady_rival=False)
    top = sorted(sw["cells"], key=lambda c: -c["mean_delta_usd"])[:SWEEP_TOP]
    by_name = {s.name: s for s in sweep}
    top_specs = [by_name[c["plan_name"]] for c in top]
    again = planner.evaluate_grid(cal, top_specs, [realized], sweep_crowd, HORIZON, n_paths, seed, steady_rival=False)
    candidates = [(by_name[c["plan_name"]], float(c["mean_delta_usd"])) for c in again["cells"]]
    candidates += [(plans[n], cells[n]["mean_delta_usd"]) for n in names]  # a tested plan may be the best one
    best_spec, best_mean = max(candidates, key=lambda t: t[1])
    if best_mean <= 0:  # nothing beats waiting
        best_spec, best_mean = PlanSpec.do_nothing(), 0.0
    best_name = plans[best_spec.name].name if best_spec.name in plans else plan_name(best_spec)
    best_spec = PlanSpec.from_dict({**best_spec.to_dict(), "name": best_name})

    if pick == DO_NOTHING or pick not in cells:
        pick_delta, pick_cell = 0.0, None
    else:
        pick_cell = cells[pick]
        pick_delta = pick_cell["mean_delta_usd"]
    ranking = sorted([cells[n]["mean_delta_usd"] for n in names] + [0.0], reverse=True)
    rank = 1 + sum(1 for v in ranking if v > pick_delta + 1e-9)
    return {
        "realized": realized,
        "cells": list(cells.values()),
        "pick": pick, "pick_rank": rank, "n_plans": len(ranking),
        "beat_do_nothing": bool(pick_delta > 0.0),
        "pick_delta_usd": round(pick_delta, 2),
        "hindsight_best": {
            "name": best_name, "spec": best_spec.to_dict(), "mean_delta_usd": round(best_mean, 2),
            "plain": plain_words(best_spec, cal.profile),
        },
        "regret_usd": round(max(0.0, best_mean - pick_delta), 2),
        "baselines": baselines,
        "pick_cell": pick_cell,
    }


# --------------------------------------------------------------------------------------
# Leak check
# --------------------------------------------------------------------------------------

_PCT = re.compile(r"([+−\-–]?)\s?(\d{1,3}(?:\.\d+)?)\s?%")


def _snippet(text: str, start: int, end: int, pad: int = 60) -> str:
    a, b = max(0, start - pad), min(len(text), end + pad)
    return ("…" if a else "") + text[a:b].strip().replace("\n", " ") + ("…" if b < len(text) else "")


def _numbers_in(items: Iterable[Mapping[str, Any]]) -> set[float]:
    """Percent figures that appear in the news the run was given (so they are not hindsight)."""
    found: set[float] = set()
    for it in items:
        blob = " ".join(str(it.get(k) or "") for k in ("title", "quote", "cost_line"))
        found.update(abs(float(m.group(2))) for m in _PCT.finditer(blob))
    return found


def leak_check(
    texts: Iterable[tuple[str, str]],
    case: Mapping[str, Any],
    path: Sequence[float],
    news_items: Iterable[Mapping[str, Any]] = (),
    claim_texts: Iterable[tuple[str, str]] | None = None,
) -> dict:
    """`{clean, flags: [{where, text}]}` over the text the models wrote (SPEC §15.12 Part B).

    `texts` are scanned for the case's `spoiler_terms` and for any date after `as_of` (month and year, an ISO date,
    or a bare later year). `claim_texts` (default: `texts`) are also scanned for a percent claim in a sentence about
    prices that lands within 5 points of the real peak or end value, unless the same figure is in the news the
    run was given. The futures' own numbers are not claims, so the caller leaves them out of `claim_texts`."""
    as_of = case.get("as_of_date") or date.fromisoformat(case["as_of"])
    texts = list(texts)
    flags: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def flag(where: str, text: str) -> None:
        if (where, text) not in seen:
            seen.add((where, text))
            flags.append({"where": where, "text": text})

    terms = [t for t in case.get("spoiler_terms", []) if t.strip()]
    for where, text in texts:
        low = text.lower()
        for term in terms:
            at = low.find(term.lower())
            if at >= 0:
                flag(where, _snippet(text, at, at + len(term)))
        for hit in asof.later_dated(text, as_of, bare_years=True):
            at = text.find(hit)
            flag(where, _snippet(text, at, at + len(hit)))
    if path:
        _, peak = planner._path_peak(path)
        targets = [100.0 * peak, 100.0 * float(path[-1])]
        allowed = _numbers_in(news_items)
        words = [w.lower() for w in case.get("claim_words", [])] + ["price", "cost"]
        for where, text in (texts if claim_texts is None else list(claim_texts)):
            for sentence in re.split(r"(?<=[.;!?])\s+|\n", text):
                if not any(w in sentence.lower() for w in words):
                    continue
                for m in _PCT.finditer(sentence):
                    v = float(m.group(2))
                    sign = -1.0 if m.group(1) in ("−", "-", "–") else 1.0
                    if v < CLAIM_MIN_PCT or v in allowed:
                        continue
                    if any(abs(sign * v - t) <= CLAIM_MATCH_POINTS for t in targets):
                        flag(where, _snippet(sentence, m.start(), m.end(), 80))
    return {"clean": not flags, "flags": flags}


def horizon_end(case: Mapping[str, Any]) -> str:
    as_of = case.get("as_of_date") or date.fromisoformat(case["as_of"])
    return (as_of + timedelta(days=7 * HORIZON)).isoformat()


def caveats(case: Mapping[str, Any], plans: Iterable[PlanSpec] = ()) -> list[str]:
    """The case's own caveats, then the ones that hold for every backtest, then the supplier one when a tested
    plan switches supplier."""
    extra = [SUPPLIER_CAVEAT] if any(p.switch_supplier for p in plans) else []
    return [*case.get("caveats", []), MODEL_CUTOFF_CAVEAT, SWEEP_CAVEAT, NEWS_CAVEAT, *extra]


def event(
    *,
    case: Mapping[str, Any],
    scored: Mapping[str, Any],
    columns: Sequence[ShockCase | Mapping[str, Any]],
    leak: Mapping[str, Any],
    dropped_news: int,
    profile: Mapping[str, Any],
    plans: Iterable[PlanSpec] = (),
) -> dict:
    """The `backtest` stream event (docs/EVENTS.md v2.2), sent after `memo` and before `done`."""
    realized: ShockCase = scored["realized"]
    return {
        "backtest_id": case["id"], "as_of": case["as_of"], "horizon_end": horizon_end(case),
        "series": series_for_event(case),
        "realized_case": {**realized.to_dict(),
                          "cost_line": wording.cost_line(profile, realized, as_of=case["as_of_date"],
                                                         shift_weeks=_arrival_shift(case, profile))},
        "cells": list(scored["cells"]),
        "pick": scored["pick"], "pick_rank": scored["pick_rank"], "n_plans": scored["n_plans"],
        "beat_do_nothing": scored["beat_do_nothing"], "pick_delta_usd": scored["pick_delta_usd"],
        "hindsight_best": dict(scored["hindsight_best"]), "regret_usd": scored["regret_usd"],
        "baselines": list(scored["baselines"]),
        "futures_cover": futures_cover(columns, realized.cost_path),
        "leak_check": dict(leak), "dropped_news": int(dropped_news),
        "what_happened": [dict(w) for w in case.get("what_happened", [])],
        "caveats": caveats(case, plans),
    }
