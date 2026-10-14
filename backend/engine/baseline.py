"""Cost-plus baseline firm policy for counterfactual universe U2.

See SPEC §4.7. Implemented in task T01 (prompts/1_oct15_all-parallel/T01-engine-market.md).
"""
from __future__ import annotations

import numpy as np

from backend.engine.market import costs
from backend.engine.types import MarketParams, MarketState, TickResult


def clamp_decision(
    price: float | np.ndarray,
    plan: float | np.ndarray,
    marketing: float | np.ndarray,
    mc: float | np.ndarray,
    atc: float | np.ndarray,
    k_cap: float | np.ndarray,
) -> tuple[float, float, float] | tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Clamp decision to price in [0.5*MC, 4*ATC], plan in [0, k_cap], marketing >= 0."""
    is_scalar = (
        np.ndim(price) == 0
        and np.ndim(plan) == 0
        and np.ndim(marketing) == 0
    )
    p_low = 0.5 * np.asarray(mc, dtype=np.float64)
    p_high = np.maximum(4.0 * np.asarray(atc, dtype=np.float64), p_low)

    p_clamped = np.clip(np.asarray(price, dtype=np.float64), p_low, p_high)
    q_clamped = np.clip(
        np.asarray(plan, dtype=np.float64),
        0.0,
        np.asarray(k_cap, dtype=np.float64),
    )
    m_clamped = np.maximum(np.asarray(marketing, dtype=np.float64), 0.0)

    if is_scalar:
        return float(p_clamped), float(q_clamped), float(m_clamped)
    return p_clamped, q_clamped, m_clamped


def cost_plus_decision(
    state: MarketState,
    last_result: TickResult | None,
    params: MarketParams,
    marketing: float | np.ndarray = 0.0,
) -> tuple[float, float, float]:
    """Compute cost-plus baseline (price, plan, marketing) for firm A (index 0).

    - price = ATC(Q_{t-1}) * (1 + markup)
    - plan = 4-tick moving average of A's demand
    - marketing stays constant
    """
    if last_result is not None:
        mc_a = float(last_result.mc[0])
        atc_a = float(last_result.atc[0])
    else:
        _, mc_arr, atc_arr = costs(state.last_qty, params.c_raw0, params)
        mc_a = float(mc_arr[0])
        atc_a = float(atc_arr[0])

    raw_price = atc_a * (1.0 + float(params.cost_plus_markup))

    if state.demand_hist:
        recent_a = [float(d[0]) for d in state.demand_hist[-4:]]
        raw_plan = float(np.mean(recent_a))
    elif last_result is not None:
        raw_plan = float(last_result.demand[0])
    elif state.last_qty[0] > 0.0:
        raw_plan = float(state.last_qty[0])
    else:
        raw_plan = float(params.k_cap[0]) * 0.5

    mkt_a = float(np.asarray(marketing, dtype=np.float64).flat[0])
    clamped = clamp_decision(raw_price, raw_plan, mkt_a, mc_a, atc_a, float(params.k_cap[0]))
    return float(clamped[0]), float(clamped[1]), float(clamped[2])

