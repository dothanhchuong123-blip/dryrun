"""B1 Part A: `PlanSpec.price_end_week` and `ShockCase.cost_path` in the planner (SPEC §15.4, §15.5, §15.12)."""
from __future__ import annotations

import json
from dataclasses import replace
from datetime import date
from pathlib import Path

import numpy as np
import pytest

from backend.agents import wording
from backend.engine.planner import (
    PlanSpec,
    ShockCase,
    _simulate,
    _streams,
    calibrate,
    cost_change,
    evaluate_grid,
    simulate_detail,
)
from backend.engine.types import N_ARCHETYPES
from tests.test_planner import COFFEE

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = json.loads((Path(__file__).parent / "data" / "planner_golden_b1.json").read_text())
ZERO = np.zeros((2, N_ARCHETYPES))


@pytest.fixture(scope="module")
def cal():
    return calibrate(COFFEE, seed=0)


# ---------------------------------------------------------------- price_end_week


@pytest.mark.parametrize("example_id", ["coffee_austin", "coffee_hcmc", "furniture_eu", "pc_parts"])
def test_price_end_week_24_matches_the_engine_before_b1(example_id):
    """Same seed, same plans, same news column as the run taken from the engine before B1: identical to the bit."""
    ex = json.loads((ROOT / "fixtures" / "examples" / f"{example_id}.json").read_text())
    fb = ex["fallback_shock"]
    shock = ShockCase(id="news", label="n", delta_c_raw=fb["delta_c_raw"], delta_lead_time=fb["delta_lead_time"],
                      demand_shock=fb["demand_shock"])
    plans = [
        PlanSpec(name="Raise price 5% now", price_change_pct=5.0, price_end_week=24),
        PlanSpec(name="Stock up 4 weeks now", extra_stock_weeks=4.0),
        PlanSpec(name="Mix", price_change_pct=3.0, price_change_week=4, extra_stock_weeks=2.0, marketing_change_pct=10.0),
    ]
    got = evaluate_grid(calibrate(ex["profile"], seed=0), plans, [shock], None, 24, 200, 0)
    rows = [[c["plan_name"], c["mean_delta_usd"], c["p5_delta_usd"], c["steady_rival_delta_usd"]] for c in got["cells"]]
    assert rows == GOLDEN[example_id]


def test_surcharge_ends_and_the_price_goes_back(cal):
    plan = PlanSpec(name="Surcharge 10% to wk 12", price_change_pct=10.0, price_change_week=0, price_end_week=12)
    shock = ShockCase(id="x", label="x")
    weeks = simulate_detail(cal, plan, shock)["weeks"]
    p_plan = [w["U1"]["price"][0] for w in weeks]
    p_base = [w["U2"]["price"][0] for w in weeks]
    assert p_plan[:12] == [pytest.approx(12.1)] * 12
    assert p_plan[12:] == p_base[12:] == [pytest.approx(11.0)] * 12


def test_surcharge_ends_marker_and_wording(cal):
    plan = PlanSpec(name="Surcharge", price_change_pct=10.0, price_end_week=12)
    marks = simulate_detail(cal, plan, ShockCase(id="x", label="x"))["markers"]
    ends = [m for m in marks if m["kind"] == "price_change" and m["week"] == 12]
    assert ends and ends[0]["text"] == "Surcharge ends, price back to $11.00"
    steps = wording.plan_actions(plan, COFFEE)
    assert "until week 12" in steps[0]["text"]
    assert steps[-1] == {"week": 12, "text": "Price goes back to $11.00"}
    assert wording.plan_label_suffix(plan) == " until wk 12"
    assert wording.plan_label_suffix(replace(plan, price_end_week=24)) == ""
    assert "until" not in wording.plan_actions(replace(plan, price_end_week=24), COFFEE)[0]["text"]


def test_a_surcharge_is_a_different_plan_from_a_permanent_rise(cal):
    shock = ShockCase(id="x", label="x")
    res = evaluate_grid(
        cal,
        [PlanSpec(name="Permanent 8%", price_change_pct=8.0),
         PlanSpec(name="Surcharge 8% to wk 12", price_change_pct=8.0, price_end_week=12)],
        [shock], None, 24, 300, 0,
    )
    a, b = (c["mean_delta_usd"] for c in res["cells"])
    assert a != b


def test_price_end_week_clamps():
    assert PlanSpec(price_end_week=99).clamp().price_end_week == 24
    assert PlanSpec(price_end_week=-3, price_change_week=0, price_change_pct=5).clamp().price_end_week == 24  # <= start
    assert PlanSpec(price_end_week=4, price_change_week=4, price_change_pct=5).clamp().price_end_week == 24
    assert PlanSpec(price_end_week=5, price_change_week=4, price_change_pct=5).clamp().price_end_week == 5
    assert PlanSpec(price_end_week=12, price_change_pct=5).clamp().has_surcharge_end
    assert not PlanSpec(price_end_week=12, price_change_pct=0).clamp().has_surcharge_end  # no price change, no end
    assert PlanSpec.from_dict({"name": "old recording", "price_change_pct": 5}).price_end_week == 24
    # the start is still the first change
    assert PlanSpec(price_change_pct=5, price_change_week=3, price_end_week=9).first_change_week() == 3


# ---------------------------------------------------------------- cost_path


def _pinned_streams(n: int = 60) -> dict:
    """Streams with the per-path shock size pinned to 1, so the knob version and the path version can match."""
    s = _streams(0, 0, n, 24)
    s["scale"] = np.ones(n)
    return s


@pytest.mark.parametrize("plan", [
    PlanSpec.do_nothing(),
    PlanSpec(name="stock", extra_stock_weeks=4.0),
    PlanSpec(name="switch", switch_supplier=True, alt_cost_change_pct=5.0, alt_lead_time_weeks=2),
])
def test_flat_cost_path_matches_the_knob_version(cal, plan):
    knob = ShockCase(id="k", label="k", delta_c_raw=0.3, onset_week=0, ramp_weeks=1)
    path = ShockCase(id="p", label="p", cost_path=[0.3] * 24)
    plans = [PlanSpec.do_nothing(), plan] if plan.name != "Do nothing" else [PlanSpec.do_nothing()]
    sents = [ZERO] * len(plans)
    a = _simulate(cal, plans, sents, knob, _pinned_streams(), (False,), 24)
    b = _simulate(cal, plans, sents, path, _pinned_streams(), (False,), 24)
    for key in ("price", "sales", "cost", "marketing", "holding", "paid", "extra_val"):
        assert np.array_equal(a[key], b[key]), key


def test_cost_path_ignores_the_per_path_shock_size(cal):
    """The path really happened: every path sees the same cost, whatever its random shock size."""
    case = ShockCase(id="p", label="p", cost_path=[0.0, 0.2, 0.5, 0.5] + [0.5] * 20)
    base = _simulate(cal, [PlanSpec.do_nothing()], [ZERO], case, _streams(0, 0, 40, 24), (False,), 24)
    big = _streams(0, 0, 40, 24)
    big["scale"] = big["scale"] * 1.5
    other = _simulate(cal, [PlanSpec.do_nothing()], [ZERO], case, big, (False,), 24)
    assert np.array_equal(base["cost"], other["cost"])


def test_cost_path_last_value_holds_past_its_end(cal):
    short = ShockCase(id="s", label="s", cost_path=[0.0, 0.4])
    full = ShockCase(id="f", label="f", cost_path=[0.0] + [0.4] * 23)
    a = _simulate(cal, [PlanSpec.do_nothing()], [ZERO], short, _pinned_streams(), (False,), 24)
    b = _simulate(cal, [PlanSpec.do_nothing()], [ZERO], full, _pinned_streams(), (False,), 24)
    assert np.array_equal(a["cost"], b["cost"]) and np.array_equal(a["sales"], b["sales"])


def test_a_rise_then_a_fall_rewards_buying_before_the_peak(cal):
    """Cocoa-style spike: costs double by week 5 and are back to normal by week 12."""
    path = [0.0, 0.2, 0.5, 0.8, 1.0, 1.0, 1.0, 0.9, 0.7, 0.5, 0.3, 0.1] + [0.0] * 12
    shock = ShockCase(id="realized", label="spike", origin="realized", cost_path=path, onset_week=0, ramp_weeks=1)
    res = evaluate_grid(
        cal,
        [PlanSpec(name="Stock up now", extra_stock_weeks=6.0, stock_week=0),
         PlanSpec(name="Stock up wk 10", extra_stock_weeks=6.0, stock_week=10)],
        [shock], None, 24, 400, 0,
    )
    now, late = (c["mean_delta_usd"] for c in res["cells"])
    assert now > late


def test_cost_path_clamps_and_origin():
    c = ShockCase.from_dict({"id": "r", "origin": "realized", "cost_path": [5.0, -3.0, 0.5] + [0.1] * 40})
    assert c.origin == "realized" and len(c.cost_path) == 24
    assert c.cost_path[:3] == [3.0, -0.9, 0.5]
    assert ShockCase().cost_path == [] and ShockCase.from_dict({"origin": "made up"}).origin == "default"
    assert ShockCase.from_dict(c.to_dict()) == c


def test_cost_change_uses_the_end_value_and_names_the_peak():
    path = [0.0, 0.5, 1.21, 1.0, 0.75]
    change = cost_change(COFFEE, ShockCase(cost_path=path))
    assert change["pct"] == pytest.approx(100 * 0.85 * 0.75)
    assert change["peak_pct"] == pytest.approx(100 * 0.85 * 1.21) and change["peak_week"] == 2
    assert change["input_end_pct"] == pytest.approx(75.0) and change["input_peak_pct"] == pytest.approx(121.0)
    # no path: unchanged
    assert cost_change(COFFEE, ShockCase(delta_c_raw=0.4)) == {"pct": pytest.approx(34.0), "usd_per_unit": pytest.approx(2.21)}


def test_cost_line_with_a_path_mentions_the_peak():
    path = [0.0, 0.5, 1.21] + [1.0] * 10 + [0.75]
    line = wording.cost_line(COFFEE, ShockCase(cost_path=path), as_of=date(2024, 1, 15))
    assert "+75% by" in line and "+121% at the peak in" in line and "85% of your cost" in line
    assert "week" in wording.cost_line(COFFEE, ShockCase(cost_path=path))
    # a path still climbing at the end has no peak to name
    climbing = wording.cost_line(COFFEE, ShockCase(cost_path=[0.0, 0.2, 0.4]))
    assert "peak" not in climbing
    assert wording.cost_line(COFFEE, ShockCase(delta_c_raw=0.31)).startswith("Beans +31% × 85%")


def test_cost_path_markers(cal):
    path = [0.0, 0.01, 0.1, 0.6, 1.21, 1.15, 0.9, 0.75] + [0.75] * 16
    shock = ShockCase(id="realized", label="x", origin="realized", cost_path=path, onset_week=0, ramp_weeks=1)
    marks = simulate_detail(cal, PlanSpec.do_nothing(), shock)["markers"]
    texts = {(m["week"], m["text"]) for m in marks if m["kind"] == "shock"}
    assert (2, "Bean costs start rising") in texts      # first week at or above 2%
    assert (4, "Bean price peaks: +121%") in texts
    assert (6, "Bean price falls back to +90%") in texts  # first week 10+ points under the peak
