"""(s,S) replenishment with behavioural omega, lead-time pipeline, bullwhip ratio.

See SPEC §4.5, §4.7. Implemented in task T02 (prompts/1_oct15_all-parallel/T02-engine-inventory-game.md).
"""
from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from backend.engine.types import MarketParams, MarketState


def reorder_point(
    mu_d: np.ndarray | Sequence[float] | float,
    sigma_d: np.ndarray | Sequence[float] | float,
    lead_time: float | np.ndarray,
    z: float,
    omega: np.ndarray | Sequence[float] | float,
) -> np.ndarray:
    """Compute per-firm reorder point ROP_j (SPEC §4.5).

    ROP_j = mu_d * L + z * sigma_d * sqrt(L) * (1 + omega)
    """
    mu = np.broadcast_to(np.asarray(mu_d, dtype=float), (2,))
    sigma = np.broadcast_to(np.asarray(sigma_d, dtype=float), (2,))
    lt = np.maximum(np.asarray(lead_time, dtype=float), 0.0)
    w = np.clip(np.broadcast_to(np.asarray(omega, dtype=float), (2,)), -0.5, 2.0)
    rop = mu * lt + float(z) * sigma * np.sqrt(lt) * (1.0 + w)
    return np.maximum(rop, 0.0)


def replenish(
    state: MarketState,
    params: MarketParams,
    lead_time: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute raw-material orders and ROP using an (s,S) policy with behavioural omega.

    Pure function: does not mutate `state`. `market.step` appends positive orders to `state.pipeline`.
    """
    n_hist = len(state.demand_hist)
    if n_hist == 0:
        mu_d = np.asarray(params.k_cap, dtype=float) / 2.0
        sigma_d = 0.2 * mu_d
    elif n_hist == 1:
        mu_d = np.asarray(state.demand_hist[-1], dtype=float).copy()
        sigma_d = 0.2 * mu_d
    else:
        window = np.asarray(state.demand_hist[-8:], dtype=float)
        mu_d = np.mean(window, axis=0)
        sigma_d = np.std(window, axis=0, ddof=1)

    rop = reorder_point(
        mu_d=mu_d,
        sigma_d=sigma_d,
        lead_time=lead_time,
        z=params.z_alpha,
        omega=state.omega,
    )

    pipe_qty = np.zeros(2, dtype=float)
    for firm_idx, _arrival_tick, qty in state.pipeline:
        pipe_qty[int(firm_idx)] += float(qty)

    position = np.asarray(state.raw_inv, dtype=float) + pipe_qty
    s_level = rop * float(params.order_up_to_mult)

    orders = np.where(position <= rop, np.maximum(s_level - position, 0.0), 0.0)
    return orders.astype(float), rop.astype(float)


def bullwhip_ratio(
    order_hist: Sequence[np.ndarray],
    demand_hist: Sequence[np.ndarray],
) -> list[float | None]:
    """Compute Var(Orders_j) / Var(Demand_j) per firm (SPEC §4.5).

    Returns `None` for a firm when fewer than 8 ticks of history are available
    or when Var(Demand_j) == 0. Uses sample variance (ddof=1).
    """
    n = min(len(order_hist), len(demand_hist))
    if n < 8:
        return [None, None]

    orders = np.asarray(order_hist[-n:], dtype=float)
    demands = np.asarray(demand_hist[-n:], dtype=float)

    result: list[float | None] = []
    for j in range(2):
        var_d = float(np.var(demands[:, j], ddof=1))
        if var_d <= 1e-15:
            result.append(None)
        else:
            var_o = float(np.var(orders[:, j], ddof=1))
            result.append(float(var_o / var_d))
    return result

