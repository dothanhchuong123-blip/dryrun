"""Shared engine contract (SPEC §4.7). Every engine/service module builds on these types.

Firm index: 0 = A, 1 = B. Per-firm fields are np.ndarray of shape (2,).
Change this file only with care: parallel tasks depend on it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

FIRMS = ("A", "B")
N_ARCHETYPES = 12


@dataclass(frozen=True)
class MarketParams:
    """Static calibration. Defaults are a plausible starting point; tune in fixtures/scenarios/*.json."""

    n_consumers: int = 500
    # consumer choice (§4.1)
    gamma: float = 0.35          # marketing effect, on ln(1+M)
    delta: float = 0.8           # sentiment effect
    p_ref: float = 100.0         # outside-good reference price
    beta_bar: tuple[float, float] = (2.0, 2.0)  # long-run brand equity per firm
    # stockout / goodwill (§4.3)
    theta: float = 0.5           # share of unmet buyers who switch to rival
    lam: float = 0.5             # goodwill erosion per unit stockout rate
    kappa: float = 0.1           # mean reversion of brand equity
    # costs & capacity (§4.2)
    fc: tuple[float, float] = (2000.0, 2000.0)
    eta: float = 0.02
    c_raw0: float = 50.0
    k_cap: tuple[float, float] = (300.0, 300.0)
    raw_per_unit: float = 1.0    # r
    holding_cost: float = 0.5    # h, per unit per tick
    # supply chain (§4.5)
    lead_time0: int = 3          # L0, ticks
    z_alpha: float = 1.65
    order_up_to_mult: float = 2.0  # S = ROP * mult
    # baseline firm (U2)
    cost_plus_markup: float = 0.25


@dataclass
class Archetypes:
    """12 consumer archetypes (income tier x price sensitivity x loyalty)."""

    alpha_mu: np.ndarray        # (12,) log-mean of price sensitivity
    alpha_sigma: np.ndarray     # (12,) log-sd
    loyalty: np.ndarray         # (12, 2) brand bias added to utility for A, B
    labels: list[str]           # (12,) human-readable names
    consumer_archetype: np.ndarray  # (N,) int archetype index per consumer


@dataclass
class FirmDecision:
    """What an agent (LLM or baseline) controls. Clamped before use."""

    price: np.ndarray            # (2,)
    production_plan: np.ndarray  # (2,)
    marketing: np.ndarray        # (2,)


@dataclass
class Shock:
    delta_c_raw: float = 0.0     # fractional change to c_raw
    delta_lead_time: int = 0     # ticks
    demand_shock: float = 0.0    # fractional change to market demand


@dataclass
class CrowdSentiment:
    mu: np.ndarray               # (12, 2) mean sentiment per archetype toward A, B in [-1, 1]
    sigma: np.ndarray            # (12, 2) sd in [0, 0.5]


@dataclass
class MarketState:
    tick: int
    beta0: np.ndarray            # (2,) current brand equity
    inventory: np.ndarray        # (2,) finished goods
    raw_inv: np.ndarray          # (2,) raw materials on hand
    pipeline: list[tuple[int, int, float]] = field(default_factory=list)  # (firm, arrival_tick, qty)
    omega: np.ndarray = field(default_factory=lambda: np.zeros(2))       # Super's risk factor, [-0.5, 2]
    last_qty: np.ndarray = field(default_factory=lambda: np.zeros(2))
    demand_hist: list[np.ndarray] = field(default_factory=list)  # per tick (2,) effective demand
    order_hist: list[np.ndarray] = field(default_factory=list)   # per tick (2,) raw orders placed
    cum_profit: np.ndarray = field(default_factory=lambda: np.zeros(2))


@dataclass
class TickResult:
    tick: int
    probs_mean: np.ndarray       # (3,) mean choice share [outside, A, B]
    demand: np.ndarray           # (2,) expected demand D_j
    own_sales: np.ndarray        # (2,)
    spill_in: np.ndarray         # (2,)
    sales: np.ndarray            # (2,)
    unmet: np.ndarray            # (2,)
    lost: float                  # buyers lost to outside good due to stockouts
    qty: np.ndarray              # (2,) produced
    revenue: np.ndarray          # (2,)
    total_cost: np.ndarray       # (2,)
    profit: np.ndarray           # (2,)
    mc: np.ndarray               # (2,)
    atc: np.ndarray              # (2,)
    rop: np.ndarray              # (2,)
    orders: np.ndarray           # (2,)
    c_raw: float
    lead_time: int
    choices: np.ndarray          # (N,) int8 realised choice 0=outside 1=A 2=B
