"""Customer mix (SPEC §15.3, v3.2): three profile dials set each shopper type's share of the market."""
from __future__ import annotations

import numpy as np
import pytest

from backend.agents.prompts import customer_mix_line
from backend.agents.schemas import BusinessProfile
from backend.engine.market import archetype_weights, make_archetypes
from backend.engine.planner import PlanSpec, ShockCase, _arch_arrays, calibrate, evaluate_grid
from backend.engine.types import N_ARCHETYPES, CrowdSentiment
from tests.test_pivot_agents import _profile
from tests.test_planner import COFFEE, COFFEE_NEWS


def test_even_dials_give_even_weights():
    w = archetype_weights([1, 1, 1], 0.5, 0.5)
    assert w.shape == (N_ARCHETYPES,)
    np.testing.assert_allclose(w, np.full(N_ARCHETYPES, 1 / 12))


def test_weights_follow_archetype_order():
    w = archetype_weights([0.6, 0.3, 0.1], 0.8, 0.25)
    assert w.sum() == pytest.approx(1.0)
    labels = make_archetypes(12, np.random.default_rng(0)).labels
    # index 0 = Low-income · price-hunter · A-loyal; index 11 = High-income · moderate · B-loyal
    assert "Low-income" in labels[0] and "price-hunter" in labels[0] and "A-loyal" in labels[0]
    assert w[0] == pytest.approx(0.6 * 0.8 * 0.25)
    assert w[11] == pytest.approx(0.1 * 0.2 * 0.75)


def test_dials_are_clipped_and_income_normalised():
    w = archetype_weights([0, 0, 5], 1.0, 0.0)  # extremes clip to 0.05/0.95; income -> all high
    assert w[:8].sum() == 0.0
    assert w[8] == pytest.approx(0.95 * 0.05)


def test_counts_match_weights():
    w = archetype_weights([0.5, 0.3, 0.2], 0.7, 0.4)
    arch = make_archetypes(500, np.random.default_rng(3), w)
    counts = np.bincount(arch.consumer_archetype, minlength=N_ARCHETYPES)
    assert counts.sum() == 500
    assert np.abs(counts - w * 500).max() < 1.0


def test_no_dials_keeps_the_old_even_split():
    old = calibrate(COFFEE)
    even = calibrate({**COFFEE, "income_mix": [1, 1, 1], "price_hunter_share": 0.5, "loyal_share": 0.5})
    np.testing.assert_array_equal(_arch_arrays(old.archetypes)[2], _arch_arrays(even.archetypes)[2])
    assert old.d0 == pytest.approx(even.d0)


def test_mix_weights_the_crowd():
    """Deal hunters who hate a price rise hurt it more when they are most of the market."""
    mu = np.zeros((N_ARCHETYPES, 2))
    mu[[0, 1, 4, 5, 8, 9], 0] = -0.8  # every price-hunter archetype turns against you
    crowd = {"Raise 5%": CrowdSentiment(mu=mu, sigma=np.zeros((N_ARCHETYPES, 2)))}
    plans = [PlanSpec(name="Raise 5%", price_change_pct=5)]
    shocks = [ShockCase(id="news", label="news", **COFFEE_NEWS)]

    def gain(hunters: float) -> float:
        cal = calibrate({**COFFEE, "income_mix": [1, 1, 1], "price_hunter_share": hunters, "loyal_share": 0.5})
        return evaluate_grid(cal, plans, shocks, crowd=crowd, n_paths=300)["cells"][0]["mean_delta_usd"]

    assert gain(0.85) < gain(0.15)


def test_profile_clamps_mix_and_defaults_to_even():
    base = {k: v for k, v in _profile().items() if k not in ("income_mix", "price_hunter_share", "loyal_share")}
    p = BusinessProfile(**base)
    assert p.income_mix == pytest.approx([1 / 3] * 3, abs=1e-3) and p.price_hunter_share == 0.5 and p.loyal_share == 0.5
    p = BusinessProfile(**{**base, "income_mix": [2, 1, 1], "price_hunter_share": 1.0, "loyal_share": 0.0,
                           "guessed_fields": ["customer_mix"]})
    assert p.income_mix == pytest.approx([0.5, 0.25, 0.25])
    assert (p.price_hunter_share, p.loyal_share) == (0.95, 0.05)


def test_analyst_sees_the_mix_in_words():
    line = customer_mix_line({"income_mix": [0.2, 0.5, 0.3], "price_hunter_share": 0.7, "loyal_share": 0.4})
    assert line == "income low 20% / mid 50% / high 30%, 70% shop on price, 40% lean to you over the rival"
    assert "low 33%" in customer_mix_line({})


# --- engine-only number next to every gain (2026-10-22) -----------------------------------------------------------

def test_engine_only_is_the_same_plan_with_neutral_shoppers():
    mu = np.zeros((N_ARCHETYPES, 2))
    mu[:, 0], mu[:, 1] = 0.4, -0.6  # shoppers like you and dislike the rival after the plan
    plan = PlanSpec(name="Raise 5%", price_change_pct=5)
    shocks = [ShockCase(id="news", label="news", **COFFEE_NEWS)]
    crowd = {"Raise 5%": CrowdSentiment(mu=mu, sigma=np.zeros_like(mu))}
    lift = {}
    for w in (0.8, None):  # the old weight, then today's SENTIMENT_WEIGHT (0.05)
        cal = calibrate(COFFEE, sentiment_weight=w)
        with_mood = evaluate_grid(cal, [plan], shocks, crowd=crowd, n_paths=300)["cells"][0]
        neutral = evaluate_grid(cal, [plan], shocks, n_paths=300)["cells"][0]
        assert with_mood["engine_only_delta_usd"] == pytest.approx(neutral["mean_delta_usd"])
        assert neutral["engine_only_delta_usd"] == neutral["mean_delta_usd"]  # no mood: the same number
        lift[w] = with_mood["mean_delta_usd"] - with_mood["engine_only_delta_usd"]
    assert lift[0.8] > 1000 and 0 < lift[None] < lift[0.8] / 5  # the mood still counts, but no longer dominates


def test_backfilled_recordings_reproduce_their_engine_only_numbers():
    """Every recorded grid cell carries engine_only_delta_usd, and the engine re-derives it (scripts/backfill)."""
    from backend.config import ROOT
    from scripts.backfill_engine_only import backfill
    path = ROOT / "fixtures" / "replays" / "backtest_ho_wheat_2025.jsonl"
    lines, added, misses = backfill(path)
    assert added > 0 and not misses
    recorded = [ln["data"] for ln in replay_load(path) if ln["event"] == "grid_cell"]
    redone = [ln["data"] for ln in lines if ln["event"] == "grid_cell"]
    assert [c["engine_only_delta_usd"] for c in recorded] == [c["engine_only_delta_usd"] for c in redone]


def replay_load(path):
    from backend.services import replay
    return replay.load(path)
