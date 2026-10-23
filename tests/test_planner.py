"""Tests for backend.engine.planner (tasks P2 and P2b, SPEC §15.2-15.5, §15.9). Seeded, no I/O except tmp_path."""
from __future__ import annotations

import itertools
import json
import time
from dataclasses import replace

import numpy as np
import pytest

from backend.engine.planner import (
    DO_NOTHING,
    TEXTBOOK_RULE,
    PlanSpec,
    ShockCase,
    _arch_arrays,
    _choice_probs,
    _simulate,
    _streams,
    calibrate,
    cost_change,
    default_shock_cases,
    evaluate_cell,
    evaluate_grid,
    main,
    run_job,
    simulate_detail,
)
from backend.engine.types import N_ARCHETYPES

# The coffee_hcmc profile from docs/EVENTS.md
COFFEE = {
    "business_name": "Saigon Roasters", "product_unit": "bag of roasted coffee",
    "price": 11.0, "unit_cost": 6.5, "weekly_sales": 280, "lead_time_weeks": 3, "stock_weeks": 2,
    "rival_name": "Highland Supply", "rival_price": 10.5, "supplier_region": "Central Highlands, Vietnam",
    "customers": "independent cafés", "search_terms": ["robusta coffee price Vietnam"],
    "country": "vietnam", "market_terms": ["chuỗi cà phê mới TP.HCM"],
    "exposed_cost_share": 0.85, "cash_available": 8000,
    "guessed_fields": ["lead_time_weeks", "stock_weeks", "exposed_cost_share"],
}
# The other two examples (fixtures/examples/*.json), only the fields the engine reads
PC_PARTS = {
    "product_unit": "graphics card", "price": 420.0, "unit_cost": 330.0, "weekly_sales": 90.0,
    "lead_time_weeks": 4, "stock_weeks": 3.0, "rival_name": "TechNova", "rival_price": 415.0,
    "exposed_cost_share": 0.9, "cash_available": 40000.0,
}
FURNITURE = {
    "product_unit": "solid-wood dining set", "price": 972.0, "unit_cost": 605.0, "weekly_sales": 40.0,
    "lead_time_weeks": 5, "stock_weeks": 2.0, "rival_name": "Baltic Woodworks", "rival_price": 950.0,
    "exposed_cost_share": 0.6, "cash_available": 0.0,
}
EXAMPLES = {"coffee_hcmc": COFFEE, "pc_parts": PC_PARTS, "furniture_eu": FURNITURE}
COFFEE_NEWS = {"delta_c_raw": 0.35, "delta_lead_time": 1, "demand_shock": -0.1}  # its fallback shock
NO_SHOCK = ShockCase(id="none", label="No change")
COST_40 = ShockCase(id="news", label="Beans +40%", delta_c_raw=0.4, onset_week=2, ramp_weeks=1)
STOCK_UP = PlanSpec(name="Stock up 4 weeks now", extra_stock_weeks=4, stock_week=0)
RAISE = PlanSpec(name="Raise price 5% now", price_change_pct=5)
TICK_KEYS = {
    "tick", "universe", "price", "qty", "demand", "sales", "unmet", "spill_in", "lost", "inventory",
    "raw_inv", "rop", "orders", "profit", "cum_profit", "shares", "c_raw", "lead_time", "mc", "atc",
    "bullwhip", "unit_cost", "cover_weeks", "in_transit", "old_cost_share", "spot_cost",
}
N_TEST = 400


@pytest.fixture(scope="module")
def cal():
    return calibrate(COFFEE, seed=0)


def _cell(grid: dict, plan: str, shock: str) -> dict:
    return next(c for c in grid["cells"] if c["plan_name"] == plan and c["shock_id"] == shock)


def _do_nothing_paths(cal, shock: ShockCase, n: int = 1000) -> dict:
    zero = np.zeros((2, N_ARCHETYPES))
    return _simulate(cal, [PlanSpec.do_nothing()], [zero], shock, _streams(0, 0, n, 24), (False,), 24)


# ---------------------------------------------------------------- calibration


def test_calibration_matches_weekly_sales_and_gross_profit(cal):
    sim = _do_nothing_paths(cal, NO_SHOCK)
    weekly_sales = float(sim["sales"].mean() * cal.k_q)
    assert abs(weekly_sales / COFFEE["weekly_sales"] - 1.0) <= 0.10
    weekly_gp = float(
        ((sim["price"] - sim["cost"]) * sim["sales"] - sim["marketing"] - sim["holding"]).mean() * cal.usd
    )
    target = (COFFEE["price"] - COFFEE["unit_cost"]) * COFFEE["weekly_sales"]
    assert abs(weekly_gp / target - 1.0) <= 0.15


def test_calibration_engine_units(cal):
    assert cal.k_p == pytest.approx(0.11)
    assert cal.params.c_raw0 == pytest.approx(6.5 / 0.11)
    assert cal.params.fc == (0.0, 0.0) and cal.params.eta == 0.0
    assert cal.params.k_cap[0] == pytest.approx(1.6 * cal.d0)
    assert cal.k_q * cal.d0 == pytest.approx(280.0)
    assert cal.rival_markup == pytest.approx(10.5 / 6.5 - 1.0)


def _start_demand(c, p_a: float) -> np.ndarray:
    """Expected engine demand [A, B, outside] at the starting state, with your price at p_a."""
    alpha, loyalty_t, counts = _arch_arrays(c.archetypes)
    m0 = c.init["marketing"]
    probs = _choice_probs(
        np.array([[p_a, c.init["price"][1]]]), np.array([[m0, m0]]), np.asarray([c.params.beta_bar]), 0.0,
        alpha[None, :], loyalty_t, c.params.gamma, c.params.p_ref,
    )
    d = (probs[0] * counts).sum(-1)
    return np.array([d[0], d[1], counts.sum() - d.sum()])


@pytest.mark.parametrize("name", list(EXAMPLES))
def test_calibration_lerner_and_outside_share(name):
    """P2b: today's price is profit-maximising (Lerner) and 15% of shoppers choose "don't buy"."""
    prof = EXAMPLES[name]
    c = calibrate(prof)
    lo, hi = _start_demand(c, 99.0), _start_demand(c, 101.0)  # +-1% around engine price 100 (SPEC §4.1)
    elasticity = (hi[0] - lo[0]) / (hi[0] + lo[0]) / 0.01
    assert elasticity == pytest.approx(-prof["price"] / (prof["price"] - prof["unit_cost"]), abs=0.05)
    start = _start_demand(c, 100.0)
    assert start[2] / start.sum() == pytest.approx(0.15, abs=0.01)
    assert c.outside_share == pytest.approx(0.15, abs=0.01)
    assert 0.5 <= c.alpha_scale <= 4.0
    assert c.params.beta_bar[0] == pytest.approx(c.params.beta_bar[1])  # both firms move together


@pytest.mark.parametrize("name", list(EXAMPLES))
def test_no_free_lunch_from_a_price_rise(name):
    """P2b: with no shock, raising the price 5% is not a free win."""
    c = calibrate(EXAMPLES[name])
    cell = evaluate_cell(c, RAISE, NO_SHOCK, n_paths=1000)
    assert cell["mean_delta_usd"] <= 0.0


def test_staged_plan_beats_cost_plus_on_the_news():
    c = calibrate(COFFEE)
    news = default_shock_cases(COFFEE_NEWS, COFFEE)[1]
    staged = PlanSpec(name="Stock 4 + raise 10% wk 5", extra_stock_weeks=4, price_change_pct=10,
                      price_change_week=5)
    grid = evaluate_grid(c, [staged, PlanSpec(name=TEXTBOOK_RULE)], [news], n_paths=1000)
    assert _cell(grid, staged.name, "news")["mean_delta_usd"] > _cell(grid, TEXTBOOK_RULE, "news")["mean_delta_usd"]


def test_seed_plans_have_a_real_downside():
    c = calibrate(COFFEE)
    shipping = default_shock_cases(COFFEE_NEWS, COFFEE)[3]
    grid = evaluate_grid(c, [RAISE, STOCK_UP], [shipping, NO_SHOCK], n_paths=1000)
    assert min(cell["p5_delta_usd"] for cell in grid["cells"]) < 0.0


def test_alpha_draw_is_last_and_lognormal():
    """The per-path alpha multiplier is drawn after the P2 streams, so those don't shift."""
    st = _streams(7, 3, 400, 24)
    rng = np.random.default_rng([7, 3])
    assert np.array_equal(st["noise"][0], rng.lognormal(0.0, 0.1, size=24))
    assert np.array_equal(st["jitter"][0], rng.integers(-1, 2, size=24))
    assert st["scale"][0] == rng.uniform(0.8, 1.2) and st["rival_weeks"][0] == rng.uniform(1.0, 4.0)
    assert st["alpha_mult"][0] == rng.lognormal(0.0, 0.25)
    assert np.std(np.log(st["alpha_mult"])) == pytest.approx(0.25, abs=0.03)


# ---------------------------------------------------------------- data types


def test_planspec_defaults_and_clamp():
    dn = PlanSpec.do_nothing()
    assert dn.name == DO_NOTHING and dn.first_change_week() is None
    wild = PlanSpec(name="x" * 60, price_change_pct=50, price_change_week=40, extra_stock_weeks=-1,
                    marketing_change_pct=500, alt_cost_change_pct=-90, alt_lead_time_weeks=0,
                    alt_shock_exposure=3).clamp()
    assert len(wild.name) == 40
    assert (wild.price_change_pct, wild.price_change_week, wild.extra_stock_weeks) == (20.0, 23, 0.0)
    assert (wild.marketing_change_pct, wild.alt_cost_change_pct) == (100.0, -30.0)
    assert (wild.alt_lead_time_weeks, wild.alt_shock_exposure) == (1, 1.0)
    assert PlanSpec.from_dict({**RAISE.to_dict(), "unknown": 1}) == RAISE


def test_shockcase_clamp_and_defaults():
    case = ShockCase.from_dict({"id": "s1", "label": "x", "delta_c_raw": 3, "share_shift_pct": 99,
                                "likelihood": "maybe", "origin": "?", "source_ids": ["a", "b", "c", "d"]})
    assert (case.delta_c_raw, case.share_shift_pct) == (1.0, 30.0)
    assert (case.likelihood, case.origin, case.source_ids) == ("likely", "default", ["a", "b", "c"])
    assert ShockCase().rival_price_change_pct == 0 and ShockCase().why == ""


def test_default_shock_cases():
    cases = default_shock_cases({"delta_c_raw": 0.31, "delta_lead_time": 1, "demand_shock": -0.1}, COFFEE)
    assert [c.id for c in cases] == ["mild", "news", "severe", "shipping"]
    assert all(c.origin == "default" for c in cases)
    mild, news, severe, shipping = cases
    assert news.label == "Beans +31% (today's news)"
    assert mild.delta_c_raw == pytest.approx(0.155) and mild.label.startswith("Beans +")
    assert severe.delta_c_raw == pytest.approx(0.496) and severe.demand_shock == pytest.approx(-0.16)
    assert (shipping.delta_lead_time, shipping.delta_c_raw, shipping.demand_shock) == (3, 0.05, 0.0)
    assert shipping.label == "Shipping +3 weeks"
    other = default_shock_cases({"delta_c_raw": 0.9}, {**COFFEE, "product_unit": "widget"})
    assert other[1].label == "Costs +90% (today's news)"
    assert other[2].delta_c_raw == 1.0  # clamped
    assert all(len(c.label) <= 40 for c in cases + other)


# ---------------------------------------------------------------- common random numbers, bridge


def test_identical_plan_has_zero_delta_and_zero_bridge(cal):
    twin = replace(PlanSpec.do_nothing(), name="Same as doing nothing")
    grid = evaluate_grid(cal, [twin], [NO_SHOCK, COST_40], n_paths=N_TEST)
    for shock in ("none", "news"):
        cell = _cell(grid, twin.name, shock)
        assert cell["mean_delta_usd"] == 0.0
        assert cell["p5_delta_usd"] == 0.0
        assert cell["p_better"] == 0.0
        assert cell["steady_rival_delta_usd"] == 0.0
        assert all(v == 0.0 for v in cell["bridge"].values())
        assert cell["peak_cash_usd"] == 0.0


def test_bridge_sums_to_mean_delta(cal):
    plans = [RAISE, STOCK_UP, PlanSpec(name="Cut 5% wk 3, market +30%", price_change_pct=-5,
                                       price_change_week=3, marketing_change_pct=30)]
    grid = evaluate_grid(cal, plans, [COST_40], n_paths=N_TEST)
    for plan in plans:
        cell = _cell(grid, plan.name, "news")
        assert sum(cell["bridge"].values()) == pytest.approx(cell["mean_delta_usd"], abs=1.0)
        assert set(cell["bridge"]) == {"cost_usd", "price_usd", "volume_usd", "marketing_usd", "holding_usd"}


def test_grid_shape_and_labels(cal):
    grid = evaluate_grid(cal, [PlanSpec.do_nothing(), RAISE, STOCK_UP], [NO_SHOCK, COST_40], n_paths=200)
    assert len(grid["cells"]) == 4  # "Do nothing" is the reference, not a cell
    assert {c["plan_name"] for c in grid["cells"]} == {RAISE.name, STOCK_UP.name}
    assert set(grid["baseline_profit_usd"]) == {"none", "news"}
    assert grid["best_today"] in {RAISE.name, STOCK_UP.name}
    assert evaluate_grid(cal, [], [NO_SHOCK], n_paths=50)["best_today"] == DO_NOTHING
    cell = grid["cells"][0]
    for key in ("n", "mean_delta_usd", "p5_delta_usd", "p_better", "mean_profit_usd", "bridge",
                "steady_rival_delta_usd", "peak_cash_usd", "payback_week", "over_cash"):
        assert key in cell
    assert cell["n"] == 200


# ---------------------------------------------------------------- mechanics


def test_purchase_cost_accounting_stock_up(cal):
    grid = evaluate_grid(cal, [STOCK_UP], [NO_SHOCK, COST_40], n_paths=N_TEST)
    assert _cell(grid, STOCK_UP.name, "news")["mean_delta_usd"] > 0.0
    assert _cell(grid, STOCK_UP.name, "news")["bridge"]["cost_usd"] > 0.0  # cheaper stock
    calm = _cell(grid, STOCK_UP.name, "none")
    assert calm["mean_delta_usd"] < 0.0
    assert calm["bridge"]["holding_usd"] < 0.0


def test_supplier_switch_avoids_the_shock(cal):
    switch = PlanSpec(name="Switch supplier", switch_supplier=True, alt_shock_exposure=0.0)
    big = replace(COST_40, delta_c_raw=0.8)
    cell = evaluate_cell(cal, switch, big, n_paths=N_TEST)
    assert cell["mean_delta_usd"] > 0.0 and cell["p_better"] > 0.9


def test_rival_follows_price_cut(cal):
    cut = PlanSpec(name="Cut 10% wk 4", price_change_pct=-10, price_change_week=4)
    detail = simulate_detail(cal, cut, NO_SHOCK)
    weeks = detail["weeks"]
    assert weeks[4]["U1"]["price"][0] == pytest.approx(9.9)
    assert weeks[4]["U1"]["price"][1] > 1.05 * 9.9  # still on its usual markup
    followed = [w for w in (6, 7) if weeks[w]["U1"]["price"][1] <= 1.02 * 9.9 + 0.01]
    assert followed, [weeks[w]["U1"]["price"] for w in range(4, 8)]
    assert any(m["kind"] == "rival_move" for m in detail["markers"])


def test_textbook_price_rule_follows_cost(cal):
    detail = simulate_detail(cal, PlanSpec(name=TEXTBOOK_RULE), COST_40)
    first, last = detail["weeks"][0]["U1"], detail["weeks"][-1]["U1"]
    assert first["price"][0] == pytest.approx(11.0, abs=0.01)
    assert last["price"][0] > 11.5
    assert last["price"][0] == pytest.approx(last["unit_cost"][0] * 11.0 / 6.5, rel=0.05)


# ---------------------------------------------------------------- v3.1 realism


def test_cost_exposure_half_share_gives_half_rise(cal):
    half = calibrate({**COFFEE, "exposed_cost_share": 0.5})
    full = calibrate({**COFFEE, "exposed_cost_share": 1.0})
    assert cost_change({**COFFEE, "exposed_cost_share": 0.5}, COST_40)["pct"] == pytest.approx(20.0)
    assert cost_change({**COFFEE, "exposed_cost_share": 1.0}, COST_40)["usd_per_unit"] == pytest.approx(2.6)
    assert cost_change({k: v for k, v in COFFEE.items() if k != "exposed_cost_share"}, COST_40)["pct"] == (
        pytest.approx(40.0)
    )
    rise = {}
    for name, c in (("half", half), ("full", full)):
        tick = simulate_detail(c, PlanSpec.do_nothing(), COST_40)["weeks"][-1]["U2"]
        rise[name] = tick["c_raw"] - 6.5
    assert rise["half"] == pytest.approx(rise["full"] / 2.0, abs=0.011)  # c_raw is rounded to cents


def test_cash_tied_up_ignores_reorder_timing():
    # Furniture reorders in batches of many weeks' stock. A plan that only moves demand shifts when a
    # batch is placed; that is not cash the plan ties up (it used to read $88.7k for marketing +30%).
    c = calibrate(FURNITURE)
    timber = ShockCase(id="news", label="Timber +12%", delta_c_raw=0.12, delta_lead_time=4, onset_week=2,
                       ramp_weeks=3)
    market = PlanSpec(name="Marketing +30%", marketing_change_pct=30)
    stock = PlanSpec(name="Stock up 4 weeks now", extra_stock_weeks=4, stock_week=0)
    grid = evaluate_grid(c, [market, RAISE, stock], [timber], n_paths=N_TEST)
    m, r, s = (_cell(grid, p.name, "news") for p in (market, RAISE, stock))
    assert m["peak_cash_usd"] <= -m["bridge"]["marketing_usd"] + 1.0  # at most the extra marketing
    assert r["peak_cash_usd"] >= -r["mean_delta_usd"] - 1.0  # no extra stock: cash ends where profit ends
    assert s["peak_cash_usd"] == pytest.approx(4 * 40 * 605, rel=0.05)  # the extra stock itself


def test_steady_rival_split(cal):
    # Deliveries slip 8 weeks: the rival, with less stock, runs short; extra stock serves its customers.
    late = ShockCase(id="late", label="Shipping +8 weeks", delta_lead_time=8, onset_week=1, ramp_weeks=1)
    cell = evaluate_cell(cal, STOCK_UP, late, n_paths=N_TEST)
    assert cell["steady_rival_delta_usd"] < cell["mean_delta_usd"] - 100.0
    off = evaluate_cell(cal, STOCK_UP, late, n_paths=50, steady_rival=False)
    assert off["steady_rival_delta_usd"] is None


def test_cash_tied_up_by_stock_up(cal):
    expected = 4 * 280 * 6.5
    cell = evaluate_cell(cal, STOCK_UP, COST_40, n_paths=N_TEST)
    assert cell["peak_cash_usd"] == pytest.approx(expected, rel=0.15)
    assert cell["over_cash"] is False
    assert cell["payback_week"] is not None
    poorer = calibrate({**COFFEE, "cash_available": 5000})
    assert evaluate_cell(poorer, STOCK_UP, COST_40, n_paths=N_TEST)["over_cash"] is True
    unknown = calibrate({**COFFEE, "cash_available": 0})
    assert evaluate_cell(unknown, STOCK_UP, COST_40, n_paths=100)["over_cash"] is False


def test_labels_skip_over_cash_and_unlikely(cal):
    poorer = calibrate({**COFFEE, "cash_available": 1000})
    severe = replace(COST_40, id="severe", delta_c_raw=1.0, likelihood="unlikely")
    grid = evaluate_grid(poorer, [STOCK_UP, RAISE], [COST_40, severe], n_paths=200)
    assert _cell(grid, STOCK_UP.name, "news")["over_cash"] is True
    assert grid["best_today"] != STOCK_UP.name
    assert grid["safest"] != STOCK_UP.name
    # if every plan is over cash, the flag is ignored
    broke = calibrate({**COFFEE, "cash_available": 1})
    only = evaluate_grid(broke, [STOCK_UP], [COST_40], n_paths=200)
    assert only["best_today"] == STOCK_UP.name


def test_best_today_is_do_nothing_when_no_affordable_plan_gains():
    from backend.engine.planner import _labels
    plans = [PlanSpec.do_nothing(), PlanSpec(name="A"), PlanSpec(name="B")]
    cases = [ShockCase(id="news", label="News")]

    def row(mean, over=False):
        return {"news": {"mean_delta_usd": mean, "p5_delta_usd": mean - 100, "over_cash": over}}
    assert _labels(plans, cases, {1: row(-59), 2: row(19, over=True)}) == ("Do nothing", "A")
    assert _labels(plans, cases, {1: row(-59), 2: row(0)})[0] == "Do nothing"
    assert _labels(plans, cases, {1: row(-59), 2: row(6)})[0] == "B"


def test_share_shift_cuts_sales(cal):
    lost = ShockCase(id="chain", label="New chain opens", share_shift_pct=20, onset_week=2, ramp_weeks=3)
    base = _do_nothing_paths(cal, NO_SHOCK, n=300)["sales"]
    hit = _do_nothing_paths(cal, lost, n=300)["sales"]
    after = slice(2 + 3 + 4, 24)  # after the ramp, plus a few weeks for production to adjust
    ratio = float(hit[after].mean() / base[after].mean())
    assert ratio == pytest.approx(0.8, abs=0.04)


def test_rival_price_change_moves_rival(cal):
    war = ShockCase(id="war", label="Highland cuts 10%", rival_price_change_pct=-10, onset_week=2)
    calm = simulate_detail(cal, PlanSpec.do_nothing(), NO_SHOCK)["weeks"]
    hit = simulate_detail(cal, PlanSpec.do_nothing(), war)
    assert hit["weeks"][1]["U2"]["price"][1] == calm[1]["U2"]["price"][1]
    for t in (2, 10, 20):
        assert hit["weeks"][t]["U2"]["price"][1] == pytest.approx(0.9 * calm[t]["U2"]["price"][1], abs=0.011)
    assert any(m["kind"] == "rival_price" and m["week"] == 2 for m in hit["markers"])
    newcomer = simulate_detail(cal, PlanSpec.do_nothing(), replace(war, rival_price_change_pct=0,
                                                                     share_shift_pct=15))
    assert any(m["kind"] == "new_player" for m in newcomer["markers"])


# ---------------------------------------------------------------- cell, detail, job


def test_evaluate_cell_matches_grid(cal):
    crowd = {RAISE.name: {"mu": np.full((N_ARCHETYPES, 2), [0.2, 0.0]).tolist(), "sigma": 0.1}}
    grid = evaluate_grid(cal, [STOCK_UP, RAISE], [NO_SHOCK, COST_40], crowd=crowd, n_paths=300, seed=5)
    for plan in (STOCK_UP, RAISE):
        for shock in (NO_SHOCK, COST_40):
            assert evaluate_cell(cal, plan, shock, crowd=crowd, n_paths=300, seed=5) == _cell(
                grid, plan.name, shock.id
            )
    # sentiment matters: a plan with positive sentiment toward A sells more than the neutral twin
    neutral = evaluate_cell(cal, RAISE, NO_SHOCK, n_paths=300, seed=5)
    assert _cell(grid, RAISE.name, "none")["mean_delta_usd"] > neutral["mean_delta_usd"]


def test_simulate_detail_payload(cal):
    plan = PlanSpec(name="Stock + raise", price_change_pct=3, price_change_week=3, extra_stock_weeks=4)
    detail = simulate_detail(cal, plan, COST_40)
    assert len(detail["weeks"]) == 24
    assert detail["n_consumers"] == cal.params.n_consumers
    for week in detail["weeks"]:
        assert TICK_KEYS <= set(week["U1"]) and TICK_KEYS <= set(week["U2"])
        assert "choices_b64" not in week["U1"]
        assert len(week["U1"]["choices"]) == detail["n_consumers"]
        assert set(week["U1"]["choices"]) <= {0, 1, 2}
        assert "choices" not in week["U2"] and "cum_cash_delta" not in week["U2"]
        assert "cum_cash_delta" in week["U1"]
    kinds = {m["kind"] for m in detail["markers"]}
    assert {"shock", "price_change", "stock_ordered", "stock_arrives"} <= kinds
    assert any(m["kind"] == "shock" and m["week"] == COST_40.onset_week for m in detail["markers"])
    assert all(len(m["text"].split()) <= 14 for m in detail["markers"])
    # the same consumer index keeps the same archetype: A buyers come first within each archetype
    arch = np.asarray(cal.archetypes.consumer_archetype)
    choices = np.asarray(detail["weeks"][10]["U1"]["choices"])
    for k in range(N_ARCHETYPES):
        c = choices[arch == k]
        assert list(c) == sorted(c, key=lambda x: {1: 0, 2: 1, 0: 2}[x])
    # extra stock is bought at the old price, so its weighted-average cost lags do nothing's
    gap = [w["U2"]["unit_cost"][0] - w["U1"]["unit_cost"][0] for w in detail["weeks"]]
    assert min(gap) >= -0.01 and max(gap) > 0.1
    assert detail["weeks"][-1]["U2"]["unit_cost"][0] <= detail["weeks"][-1]["U2"]["c_raw"] + 0.01
    json.dumps(detail)


def test_old_cost_share_and_spot_cost(cal):
    """P2b replay fields for the two-colour stock bar."""
    weeks = simulate_detail(cal, STOCK_UP, COST_40)["weeks"]
    for t in range(COST_40.onset_week):
        assert weeks[t]["U2"]["old_cost_share"] == [1.0, 1.0]
        assert weeks[t]["U2"]["spot_cost"] == [pytest.approx(6.5), pytest.approx(6.5)]
    assert weeks[-1]["U2"]["spot_cost"][0] == pytest.approx(weeks[-1]["U2"]["c_raw"], abs=0.011)
    assert weeks[-1]["U2"]["spot_cost"][0] > 6.5
    shares = [w["U2"]["old_cost_share"][0] for w in weeks]
    assert all(0.0 <= x <= 1.0 for x in shares) and shares[-1] < 0.1
    assert all(b <= a + 1e-9 for a, b in itertools.pairwise(shares))  # old stock only runs down
    # the extra stock is bought before the shock, so the plan keeps old-cost stock for longer
    plan_old = sum(w["U1"]["old_cost_share"][0] for w in weeks)
    assert plan_old > sum(shares)
    calm = simulate_detail(cal, PlanSpec.do_nothing(), NO_SHOCK)["weeks"]
    assert all(w["U2"]["old_cost_share"] == [1.0, 1.0] for w in calm)  # no cost change: all "old"


def test_run_job_round_trips_through_json(tmp_path):
    job = {
        "profile": COFFEE,
        "plans": [STOCK_UP.to_dict(), RAISE.to_dict()],
        "shocks": [NO_SHOCK.to_dict(), COST_40.to_dict()],
        "crowd": {RAISE.name: {"mu": [[0.1, 0.0]] * N_ARCHETYPES, "sigma": [[0.1, 0.1]] * N_ARCHETYPES}},
        "seed": 3,
    }
    job = json.loads(json.dumps(job))
    result = run_job(job, n_paths=100)
    assert json.loads(json.dumps(result)) == result
    direct = evaluate_grid(calibrate(COFFEE, seed=3), [STOCK_UP, RAISE], [NO_SHOCK, COST_40],
                           crowd=job["crowd"], n_paths=100, seed=3)
    assert result == direct
    src, out = tmp_path / "in.json", tmp_path / "out.json"
    src.write_text(json.dumps(job), encoding="utf-8")
    assert main(["--job", str(src), "--n", "100", "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8")) == result


def test_chunking_does_not_change_results(cal, monkeypatch):
    from backend.engine import planner

    whole = evaluate_cell(cal, STOCK_UP, COST_40, n_paths=250, seed=2)
    monkeypatch.setattr(planner, "_CHUNK_PATHS", 64)
    chunked = evaluate_cell(cal, STOCK_UP, COST_40, n_paths=250, seed=2)
    assert chunked["mean_delta_usd"] == pytest.approx(whole["mean_delta_usd"], rel=1e-12)
    assert chunked["p5_delta_usd"] == pytest.approx(whole["p5_delta_usd"], rel=1e-12)


# ---------------------------------------------------------------- performance


def test_performance(cal):
    plans = [
        RAISE, STOCK_UP, PlanSpec(name=TEXTBOOK_RULE),
        PlanSpec(name="Switch", switch_supplier=True, alt_lead_time_weeks=5, alt_cost_change_pct=8),
        PlanSpec(name="Cut 3%", price_change_pct=-3),
        PlanSpec(name="Market +40%", marketing_change_pct=40),
        PlanSpec(name="Stock 2 wk 3 + raise 3%", extra_stock_weeks=2, stock_week=3, price_change_pct=3),
    ]
    shocks = [*default_shock_cases({"delta_c_raw": 0.31, "delta_lead_time": 1}, COFFEE), NO_SHOCK,
              replace(COST_40, id="s1", rival_price_change_pct=-5, share_shift_pct=10)]
    evaluate_cell(cal, RAISE, COST_40, n_paths=50)  # warm-up
    t0 = time.perf_counter()
    grid = evaluate_grid(cal, [PlanSpec.do_nothing(), *plans], shocks, n_paths=1000)
    grid_s = time.perf_counter() - t0
    assert len(grid["cells"]) == 7 * 6 and grid["cells"][0]["n"] == 1000
    t0 = time.perf_counter()
    evaluate_cell(cal, STOCK_UP, COST_40, n_paths=1000)
    cell_s = time.perf_counter() - t0
    print(f"evaluate_grid 8 plans x 6 shocks x 1000 paths, both rivals: {grid_s:.2f} s; cell {cell_s:.3f} s")
    assert grid_s < 6.0
    assert cell_s < 0.5
