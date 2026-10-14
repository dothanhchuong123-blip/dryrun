"""Deterministic unit tests for backend/engine/market.py and backend/engine/baseline.py."""
from __future__ import annotations

import time

import numpy as np
import pytest

from backend.engine.baseline import clamp_decision, cost_plus_decision
from backend.engine.market import (
    choice_probabilities,
    clear_market,
    costs,
    elasticities,
    make_archetypes,
    sample_alpha,
    sample_sentiment,
    step,
    update_goodwill,
)
from backend.engine.types import (
    N_ARCHETYPES,
    CrowdSentiment,
    FirmDecision,
    MarketParams,
    MarketState,
    Shock,
)


def _setup_fixture(seed: int = 42, n_consumers: int = 500):
    rng = np.random.default_rng(seed)
    params = MarketParams(n_consumers=n_consumers)
    arch = make_archetypes(n_consumers, rng)
    alpha = sample_alpha(arch, rng)
    crowd = CrowdSentiment(
        mu=np.zeros((N_ARCHETYPES, 2), dtype=np.float64),
        sigma=np.full((N_ARCHETYPES, 2), 0.2, dtype=np.float64),
    )
    sentiment = sample_sentiment(crowd, arch, rng)
    loyalty_per_consumer = arch.loyalty[arch.consumer_archetype]
    return rng, params, arch, alpha, crowd, sentiment, loyalty_per_consumer


def test_archetypes_and_sampling() -> None:
    rng, _params, arch, alpha, _crowd, _sentiment, _loyalty = _setup_fixture(seed=7, n_consumers=600)
    assert len(arch.labels) == 12
    assert arch.alpha_mu.shape == (12,)
    assert arch.alpha_sigma.shape == (12,)
    assert arch.loyalty.shape == (12, 2)
    assert arch.consumer_archetype.shape == (600,)

    # Even distribution across 12 archetypes
    counts = np.bincount(arch.consumer_archetype, minlength=12)
    assert np.all(counts == 50)

    # Loyalty bias is +0.3 toward A on even indices and B on odd indices
    assert np.allclose(arch.loyalty[0::2], np.array([0.3, 0.0]))
    assert np.allclose(arch.loyalty[1::2], np.array([0.0, 0.3]))

    # Hunters (indices 0,1, 4,5, 8,9) have higher alpha_mu than moderates (2,3, 6,7, 10,11)
    hunter_idx = [0, 1, 4, 5, 8, 9]
    moderate_idx = [2, 3, 6, 7, 10, 11]
    assert np.min(arch.alpha_mu[hunter_idx]) > np.max(arch.alpha_mu[moderate_idx])
    assert 0.02 <= float(np.mean(alpha)) <= 0.06

    # Sentiment is clipped to [-1, 1]
    extreme_crowd = CrowdSentiment(
        mu=np.full((12, 2), 0.95, dtype=np.float64),
        sigma=np.full((12, 2), 0.5, dtype=np.float64),
    )
    extreme_sent = sample_sentiment(extreme_crowd, arch, rng)
    assert extreme_sent.shape == (600, 2)
    assert np.all(extreme_sent >= -1.0) and np.all(extreme_sent <= 1.0)


def test_choice_probabilities_properties() -> None:
    _rng, params, _arch, alpha, _crowd, sentiment, loyalty = _setup_fixture(seed=11)
    beta0 = np.array(params.beta_bar, dtype=np.float64)
    price = np.array([100.0, 100.0])
    marketing = np.array([50.0, 50.0])

    probs = choice_probabilities(price, marketing, beta0, alpha, sentiment, loyalty, params)
    assert probs.shape == (params.n_consumers, 3)

    # 1. Probability rows sum to 1
    assert np.allclose(np.sum(probs, axis=1), 1.0, atol=1e-12)
    assert np.all(probs >= 0.0) and np.all(probs <= 1.0)

    # 2. Raising P_A lowers A's share and raises both the outside and B shares
    probs_pa_high = choice_probabilities(
        np.array([120.0, 100.0]), marketing, beta0, alpha, sentiment, loyalty, params
    )
    shares_base = np.mean(probs, axis=0)
    shares_pa_high = np.mean(probs_pa_high, axis=0)
    assert shares_pa_high[1] < shares_base[1]  # A's share drops
    assert shares_pa_high[0] > shares_base[0]  # Outside share rises
    assert shares_pa_high[2] > shares_base[2]  # B's share rises

    # 3. Raising both prices by 20% raises the outside share
    probs_both_high = choice_probabilities(
        price * 1.2, marketing, beta0, alpha, sentiment, loyalty, params
    )
    assert float(np.mean(probs_both_high[:, 0])) > float(shares_base[0])

    # 4. Marketing has diminishing returns
    probs_m0 = choice_probabilities(
        price, np.array([0.0, 50.0]), beta0, alpha, sentiment, loyalty, params
    )
    probs_m100 = choice_probabilities(
        price, np.array([100.0, 50.0]), beta0, alpha, sentiment, loyalty, params
    )
    probs_m200 = choice_probabilities(
        price, np.array([200.0, 50.0]), beta0, alpha, sentiment, loyalty, params
    )
    gain_first_100 = float(np.sum(probs_m100[:, 1]) - np.sum(probs_m0[:, 1]))
    gain_second_100 = float(np.sum(probs_m200[:, 1]) - np.sum(probs_m100[:, 1]))
    assert gain_first_100 > gain_second_100 > 0.0

    # Elasticities check: own < 0, cross > 0
    own_e, cross_e = elasticities(price, marketing, beta0, alpha, sentiment, loyalty, params)
    assert own_e < 0.0
    assert cross_e > 0.0


def test_spillover_and_conservation() -> None:
    theta = 0.5

    # A stockout with slack at B sends B min(theta * unmet_A, spare_B)
    demand_a_short = np.array([200.0, 100.0])
    inv_a_short = np.array([120.0, 130.0])  # unmet_A = 80, spare_B = 30, theta*unmet_A = 40 -> capped at 30
    res_a = clear_market(demand_a_short, inv_a_short, theta)
    assert np.allclose(res_a["own_sales"], np.array([120.0, 100.0]))
    assert np.allclose(res_a["unmet"], np.array([80.0, 0.0]))
    assert np.allclose(res_a["spill_in"], np.array([0.0, 30.0]))
    assert np.allclose(res_a["sales"], np.array([120.0, 130.0]))
    assert pytest.approx(res_a["lost"]) == 50.0

    # Uncapped when spare_B > theta * unmet_A
    inv_a_short_ample_b = np.array([120.0, 200.0])  # spare_B = 100, theta*unmet_A = 40 -> 40
    res_a2 = clear_market(demand_a_short, inv_a_short_ample_b, theta)
    assert np.allclose(res_a2["spill_in"], np.array([0.0, 40.0]))
    assert pytest.approx(res_a2["lost"]) == 40.0

    # Symmetric case: B stockout with slack at A sends A min(theta * unmet_B, spare_A)
    demand_b_short = np.array([100.0, 200.0])
    inv_b_short = np.array([130.0, 120.0])
    res_b = clear_market(demand_b_short, inv_b_short, theta)
    assert np.allclose(res_b["own_sales"], np.array([100.0, 120.0]))
    assert np.allclose(res_b["unmet"], np.array([0.0, 80.0]))
    assert np.allclose(res_b["spill_in"], np.array([30.0, 0.0]))
    assert np.allclose(res_b["sales"], np.array([130.0, 120.0]))
    assert pytest.approx(res_b["lost"]) == 50.0

    # Randomised batch test: no value is ever negative and conservation holds
    rng = np.random.default_rng(123)
    batch_demand = rng.uniform(0.0, 300.0, size=(100, 2))
    batch_inv = rng.uniform(0.0, 300.0, size=(100, 2))
    batch_res = clear_market(batch_demand, batch_inv, theta)
    for key in ("own_sales", "spill_in", "sales", "unmet", "lost"):
        assert np.all(np.asarray(batch_res[key]) >= 0.0)

    for i in range(100):
        single = clear_market(batch_demand[i], batch_inv[i], theta)
        for key in ("own_sales", "spill_in", "sales", "unmet"):
            assert np.all(single[key] >= 0.0)
        assert single["lost"] >= 0.0
        assert pytest.approx(
            np.sum(single["own_sales"]) + np.sum(single["spill_in"]) + single["lost"]
        ) == float(np.sum(batch_demand[i]))


def test_goodwill_erosion_and_mean_reversion() -> None:
    params = MarketParams()
    beta0 = np.array(params.beta_bar, dtype=np.float64)
    demand = np.array([200.0, 200.0])

    # Stockout at A drops A's goodwill while B stays at beta_bar
    unmet_stockout = np.array([50.0, 0.0])
    beta_after_stockout = update_goodwill(beta0, unmet_stockout, demand, params)
    assert beta_after_stockout[0] < beta0[0]
    assert pytest.approx(beta_after_stockout[1]) == beta0[1]

    # Subsequent tick with zero unmet demand mean-reverts A's goodwill upward toward beta_bar
    beta_reverted = update_goodwill(beta_after_stockout, np.zeros(2), demand, params)
    assert beta_after_stockout[0] < beta_reverted[0] < beta0[0]

    # Broadcasts over (100, 2)
    batch_beta = np.broadcast_to(beta0, (100, 2)).copy()
    batch_unmet = np.zeros((100, 2))
    batch_demand = np.full((100, 2), 150.0)
    batch_out = update_goodwill(batch_beta, batch_unmet, batch_demand, params)
    assert batch_out.shape == (100, 2)


def test_costs_formulas_zero_guard_and_broadcasting() -> None:
    params = MarketParams()
    q = np.array([100.0, 200.0])
    c_raw = 50.0

    tc, mc, atc = costs(q, c_raw, params)
    expected_tc = np.asarray(params.fc) + c_raw * q + params.eta * (q**2)
    expected_mc = c_raw + 2.0 * params.eta * q
    expected_atc = np.asarray(params.fc) / q + c_raw + params.eta * q
    assert np.allclose(tc, expected_tc)
    assert np.allclose(mc, expected_mc)
    assert np.allclose(atc, expected_atc)

    # ATC is finite at Q = 0 (max(Q, 1) guard)
    tc0, mc0, atc0 = costs(np.zeros(2), c_raw, params)
    assert np.all(np.isfinite(atc0))
    assert np.allclose(atc0, np.asarray(params.fc) + c_raw)
    assert np.allclose(tc0, np.asarray(params.fc))
    assert np.allclose(mc0, np.full(2, c_raw))

    # Broadcasts over a (100, 2) batch
    rng = np.random.default_rng(99)
    q_batch = rng.uniform(0.0, 300.0, size=(100, 2))
    tc_b, mc_b, atc_b = costs(q_batch, c_raw, params)
    assert tc_b.shape == (100, 2)
    assert mc_b.shape == (100, 2)
    assert atc_b.shape == (100, 2)
    assert np.all(np.isfinite(atc_b))


def test_step_determinism_invariants_and_performance() -> None:
    _, params, arch, alpha, _crowd, sentiment, _loyalty = _setup_fixture(seed=2026, n_consumers=500)
    init_state = MarketState(
        tick=0,
        beta0=np.array(params.beta_bar, dtype=np.float64),
        inventory=np.array([150.0, 150.0]),
        raw_inv=np.array([250.0, 250.0]),
        pipeline=[(0, 0, 50.0), (1, 2, 100.0)],
    )
    decision = FirmDecision(
        price=np.array([95.0, 100.0]),
        production_plan=np.array([200.0, 200.0]),
        marketing=np.array([100.0, 100.0]),
    )
    shock = Shock(delta_c_raw=0.1, delta_lead_time=1, demand_shock=0.05)

    # 1. Same seed gives the exact same result, and input state is not mutated
    state_a, res_a = step(
        init_state, decision, shock, sentiment, arch, alpha, params, np.random.default_rng(555)
    )
    state_b, res_b = step(
        init_state, decision, shock, sentiment, arch, alpha, params, np.random.default_rng(555)
    )
    assert init_state.tick == 0
    assert len(init_state.demand_hist) == 0
    assert state_a.tick == 1
    assert np.allclose(state_a.beta0, state_b.beta0)
    assert np.allclose(state_a.inventory, state_b.inventory)
    assert np.allclose(state_a.raw_inv, state_b.raw_inv)
    assert np.allclose(res_a.demand, res_b.demand)
    assert np.allclose(res_a.sales, res_b.sales)
    assert np.allclose(res_a.profit, res_b.profit)
    assert np.array_equal(res_a.choices, res_b.choices)

    # 2. Inventory and raw inventory are never negative across multi-tick stress run
    curr_state = init_state
    sim_rng = np.random.default_rng(777)
    for _ in range(15):
        curr_state, tick_res = step(
            curr_state, decision, shock, sentiment, arch, alpha, params, sim_rng
        )
        assert np.all(curr_state.inventory >= 0.0)
        assert np.all(curr_state.raw_inv >= 0.0)
        # 3. Profit equals revenue minus all cost terms
        expected_profit = (
            tick_res.revenue
            - tick_res.total_cost
            - decision.marketing
            - params.holding_cost * (curr_state.inventory + curr_state.raw_inv)
        )
        assert np.allclose(tick_res.profit, expected_profit)

    # 4. 500 consumers run in < 20 ms per step
    n_bench = 20
    t0 = time.perf_counter()
    s_bench = init_state
    for _ in range(n_bench):
        s_bench, _ = step(s_bench, decision, shock, sentiment, arch, alpha, params, sim_rng)
    elapsed_per_step_ms = ((time.perf_counter() - t0) / n_bench) * 1000.0
    assert elapsed_per_step_ms < 20.0


def test_baseline_cost_plus_and_clamp() -> None:
    params = MarketParams()
    state = MarketState(
        tick=4,
        beta0=np.array(params.beta_bar, dtype=np.float64),
        inventory=np.array([100.0, 100.0]),
        raw_inv=np.array([200.0, 200.0]),
        last_qty=np.array([160.0, 160.0]),
        demand_hist=[
            np.array([120.0, 140.0]),
            np.array([140.0, 140.0]),
            np.array([160.0, 140.0]),
            np.array([180.0, 140.0]),
        ],
    )
    price, plan, mkt = cost_plus_decision(state, None, params, marketing=75.0)
    _, _mc, atc = costs(state.last_qty, params.c_raw0, params)
    assert pytest.approx(price) == float(atc[0]) * (1.0 + params.cost_plus_markup)
    assert pytest.approx(plan) == 150.0  # mean of [120, 140, 160, 180]
    assert pytest.approx(mkt) == 75.0

    # Clamping bounds check
    p_c, q_c, m_c = clamp_decision(10.0, 500.0, -20.0, mc=60.0, atc=80.0, k_cap=300.0)
    assert pytest.approx(p_c) == 30.0   # 0.5 * MC
    assert pytest.approx(q_c) == 300.0  # k_cap
    assert pytest.approx(m_c) == 0.0    # >= 0

    p_hi, _, _ = clamp_decision(999.0, 100.0, 10.0, mc=60.0, atc=80.0, k_cap=300.0)
    assert pytest.approx(p_hi) == 320.0  # 4.0 * ATC



def test_cost_plus_cold_start_is_not_priced_out():
    from backend.engine.baseline import cost_plus_decision
    from backend.engine.types import MarketParams, MarketState

    params = MarketParams()
    state = MarketState(tick=0, beta0=np.array(params.beta_bar), inventory=np.zeros(2), raw_inv=np.zeros(2))
    price, plan, _ = cost_plus_decision(state, None, params)
    assert price < 3 * params.p_ref
    assert plan > 0
