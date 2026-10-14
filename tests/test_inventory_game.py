"""Unit tests for backend/engine/inventory.py and backend/engine/game.py (Task T02)."""
from __future__ import annotations

import numpy as np
import pytest

from backend.engine.game import (
    action_index,
    best_response,
    classify,
    nash_equilibria,
    payoff_matrix,
)
from backend.engine.inventory import bullwhip_ratio, reorder_point, replenish
from backend.engine.types import MarketParams, MarketState


def test_higher_omega_gives_higher_rop() -> None:
    mu_d = np.array([120.0, 100.0])
    sigma_d = np.array([20.0, 15.0])
    lead_time = 4
    z = 1.65

    rop_low = reorder_point(mu_d, sigma_d, lead_time, z, omega=np.array([-0.2, 0.0]))
    rop_high = reorder_point(mu_d, sigma_d, lead_time, z, omega=np.array([0.8, 1.5]))

    assert rop_low.shape == (2,)
    assert rop_high.shape == (2,)
    assert np.all(rop_high > rop_low)


def test_lead_time_spike_and_omega_produce_bullwhip_gt_one() -> None:
    params = MarketParams()
    rng = np.random.default_rng(2026)

    state = MarketState(
        tick=0,
        beta0=np.array(params.beta_bar, dtype=float),
        inventory=np.array([200.0, 200.0]),
        raw_inv=np.array([350.0, 350.0]),
        omega=np.array([1.0, 1.0]),
    )

    for t in range(40):
        remaining_pipeline: list[tuple[int, int, float]] = []
        for firm_idx, arrival_tick, qty in state.pipeline:
            if arrival_tick <= t:
                state.raw_inv[firm_idx] += qty
            else:
                remaining_pipeline.append((firm_idx, arrival_tick, qty))
        state.pipeline = remaining_pipeline

        lead_time = params.lead_time0 if t < 12 else params.lead_time0 + 5

        demand = np.clip(rng.normal(loc=100.0, scale=15.0, size=2), 20.0, 250.0)
        consumed = np.minimum(state.raw_inv, demand)
        state.raw_inv -= consumed
        state.demand_hist.append(demand)

        orders, _rop = replenish(state, params, lead_time=lead_time)
        state.order_hist.append(orders)

        for firm_idx in (0, 1):
            if orders[firm_idx] > 0.0:
                state.pipeline.append((firm_idx, t + lead_time, float(orders[firm_idx])))

        state.tick = t + 1

    bw = bullwhip_ratio(state.order_hist, state.demand_hist)
    assert bw[0] is not None and bw[0] > 1.0
    assert bw[1] is not None and bw[1] > 1.0


def test_zero_omega_constant_demand_no_phantom_orders() -> None:
    params = MarketParams()
    const_demand = np.array([100.0, 100.0])

    # Keep inventory position just above the deterministic reorder point (mu_d * L = 300).
    state = MarketState(
        tick=8,
        beta0=np.array(params.beta_bar, dtype=float),
        inventory=np.array([200.0, 200.0]),
        raw_inv=np.array([210.0, 210.0]),
        pipeline=[(0, 9, 100.0), (1, 9, 100.0)],
        omega=np.array([0.0, 0.0]),
        demand_hist=[const_demand.copy() for _ in range(8)],
        order_hist=[const_demand.copy() for _ in range(8)],
    )

    orders, rop = replenish(state, params, lead_time=params.lead_time0)
    assert np.allclose(rop, const_demand * params.lead_time0)
    assert np.allclose(orders, np.zeros(2))

    # Constant demand has zero variance, so bullwhip_ratio is guarded and returns None.
    assert bullwhip_ratio(state.order_hist, state.demand_hist) == [None, None]
    assert bullwhip_ratio(state.order_hist[:5], state.demand_hist[:5]) == [None, None]


def test_prisoners_dilemma_pure_ne_and_price_war_label() -> None:
    # Cut (0) strictly dominates Hold (1) and Raise (2), but (0, 0) < (1, 1) in joint profit.
    pa = np.array(
        [
            [3.0, 6.0, 8.0],
            [1.0, 4.0, 7.0],
            [0.0, 2.0, 5.0],
        ]
    )
    pb = pa.T.copy()

    pure, mixed = nash_equilibria(pa, pb)
    assert pure == [(0, 0)]
    assert mixed is None
    assert classify((0, 0), pa, pb, pure) == "price_war"


def test_coordination_game_finds_two_pure_nes() -> None:
    pa = np.array(
        [
            [0.0, 0.0, 0.0],
            [1.0, 4.0, 1.0],
            [1.0, 1.0, 5.0],
        ]
    )
    pb = pa.T.copy()

    pure, mixed = nash_equilibria(pa, pb)
    assert len(pure) == 2
    assert set(pure) == {(1, 1), (2, 2)}
    assert mixed is None
    assert classify((1, 1), pa, pb, pure) == "nash"


def test_matching_pennies_mixed_ne() -> None:
    pa = np.array(
        [
            [1.0, -1.0, -9.0],
            [-1.0, 1.0, -9.0],
            [-10.0, -10.0, -10.0],
        ]
    )
    pb = np.array(
        [
            [-1.0, 1.0, -10.0],
            [1.0, -1.0, -10.0],
            [-9.0, -9.0, -10.0],
        ]
    )

    pure, mixed = nash_equilibria(pa, pb)
    assert pure == []
    assert mixed is not None
    assert np.allclose(mixed["p_A"][:2], [0.5, 0.5], atol=1e-2)
    assert np.allclose(mixed["p_B"][:2], [0.5, 0.5], atol=1e-2)
    assert mixed["p_A"][2] == pytest.approx(0.0, abs=1e-2)
    assert mixed["p_B"][2] == pytest.approx(0.0, abs=1e-2)


def test_collusion_label() -> None:
    pa = np.array(
        [
            [3.0, 6.0, 8.0],
            [1.0, 4.0, 7.0],
            [0.0, 2.0, 5.0],
        ]
    )
    pb = pa.T.copy()
    pure, _ = nash_equilibria(pa, pb)

    assert pure == [(0, 0)]
    assert classify((1, 1), pa, pb, pure) == "collusion"
    assert classify((2, 2), pa, pb, pure) == "collusion"


def test_payoff_matrix_action_index_and_best_response() -> None:
    def profit_fn(p_a: float, p_b: float) -> tuple[float, float]:
        return p_a - 0.5 * p_b, p_b - 0.5 * p_a

    pa, pb = payoff_matrix(np.array([100.0, 100.0]), profit_fn)
    assert pa.shape == (3, 3)
    assert pb.shape == (3, 3)
    assert best_response(pa, rival_action=1) == 2

    assert action_index(100.0, 90.0) == 0
    assert action_index(100.0, 98.0) == 1
    assert action_index(100.0, 103.0) == 1
    assert action_index(100.0, 110.0) == 2

