"""Vectorised Monte Carlo with frozen decision schedules and common random numbers.

See SPEC §4.6, §4.7. Implemented in task T03 (prompts/2_oct16-17_all-parallel/T03-stats-montecarlo.md).
"""
from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from backend.engine.market import clear_market, costs, make_archetypes, update_goodwill
from backend.engine.stats import paired_alpha_test
from backend.engine.types import (
    N_ARCHETYPES,
    Archetypes,
    CrowdSentiment,
    FirmDecision,
    MarketParams,
    Shock,
)

_DEMAND_NOISE_SIGMA: float = 0.1
_SHOCK_SCALE_LOW: float = 0.8
_SHOCK_SCALE_HIGH: float = 1.2
_FAN_PERCENTILES: tuple[int, ...] = (5, 25, 50, 75, 95)
_FAN_KEYS: tuple[str, ...] = ("p5", "p25", "p50", "p75", "p95")


def _coerce_decision(dec: FirmDecision | Mapping[str, Any]) -> FirmDecision:
    if isinstance(dec, FirmDecision):
        return FirmDecision(
            price=np.asarray(dec.price, dtype=np.float64).copy(),
            production_plan=np.asarray(dec.production_plan, dtype=np.float64).copy(),
            marketing=np.asarray(dec.marketing, dtype=np.float64).copy(),
        )
    return FirmDecision(
        price=np.asarray(dec["price"], dtype=np.float64),
        production_plan=np.asarray(dec["production_plan"], dtype=np.float64),
        marketing=np.asarray(dec["marketing"], dtype=np.float64),
    )


def _coerce_shock(sh: Shock | Mapping[str, Any]) -> Shock:
    if isinstance(sh, Shock):
        return Shock(
            delta_c_raw=float(sh.delta_c_raw),
            delta_lead_time=int(sh.delta_lead_time),
            demand_shock=float(sh.demand_shock),
        )
    return Shock(
        delta_c_raw=float(sh.get("delta_c_raw", 0.0)),
        delta_lead_time=int(sh.get("delta_lead_time", 0)),
        demand_shock=float(sh.get("demand_shock", 0.0)),
    )


def _coerce_crowd(cr: CrowdSentiment | Mapping[str, Any]) -> CrowdSentiment:
    if isinstance(cr, CrowdSentiment):
        return CrowdSentiment(
            mu=np.asarray(cr.mu, dtype=np.float64).copy(),
            sigma=np.asarray(cr.sigma, dtype=np.float64).copy(),
        )
    return CrowdSentiment(
        mu=np.asarray(cr["mu"], dtype=np.float64),
        sigma=np.asarray(cr["sigma"], dtype=np.float64),
    )


@dataclass
class Schedule:
    """Frozen per-tick decision and environment schedule for Monte Carlo rollouts (SPEC §4.6, §4.7).

    Per tick holds:
    - u1_decisions: U1 decisions for firms A and B
    - u2_decisions: U2 decisions (A = baseline, B = U1's B replayed)
    - omega: behavioural inventory risk factor for each firm in U1, shape (2,)
    - u2_omega: omega used in U2; defaults to [0, omega_B] (baseline A has omega = 0, B replays U1)
    - shocks: active Shock per tick
    - crowd: CrowdSentiment(mu, sigma) per tick, each of shape (12, 2)
    """

    u1_decisions: list[FirmDecision] = field(default_factory=list)
    u2_decisions: list[FirmDecision] = field(default_factory=list)
    omega: list[np.ndarray] = field(default_factory=list)
    shocks: list[Shock] = field(default_factory=list)
    crowd: list[CrowdSentiment] = field(default_factory=list)
    u2_omega: list[np.ndarray] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.u1_decisions = [_coerce_decision(d) for d in self.u1_decisions]
        t_len = len(self.u1_decisions)

        if not self.u2_decisions and t_len > 0:
            self.u2_decisions = [_coerce_decision(d) for d in self.u1_decisions]
        else:
            self.u2_decisions = [_coerce_decision(d) for d in self.u2_decisions]

        if not self.omega and t_len > 0:
            self.omega = [np.zeros(2, dtype=np.float64) for _ in range(t_len)]
        else:
            self.omega = [np.asarray(w, dtype=np.float64).copy() for w in self.omega]

        if not self.shocks and t_len > 0:
            self.shocks = [Shock() for _ in range(t_len)]
        else:
            self.shocks = [_coerce_shock(s) for s in self.shocks]

        if not self.crowd and t_len > 0:
            self.crowd = [
                CrowdSentiment(
                    mu=np.zeros((N_ARCHETYPES, 2), dtype=np.float64),
                    sigma=np.full((N_ARCHETYPES, 2), 0.1, dtype=np.float64),
                )
                for _ in range(t_len)
            ]
        else:
            self.crowd = [_coerce_crowd(c) for c in self.crowd]

        if not self.u2_omega:
            self.u2_omega = [np.array([0.0, float(w[1])], dtype=np.float64) for w in self.omega]
        else:
            self.u2_omega = [np.asarray(w, dtype=np.float64).copy() for w in self.u2_omega]

    def __len__(self) -> int:
        return len(self.u1_decisions)

    def to_dict(self) -> dict[str, Any]:
        """Serialise schedule to a JSON-compatible dictionary."""
        return {
            "u1_decisions": [
                {
                    "price": np.asarray(d.price, dtype=np.float64).tolist(),
                    "production_plan": np.asarray(d.production_plan, dtype=np.float64).tolist(),
                    "marketing": np.asarray(d.marketing, dtype=np.float64).tolist(),
                }
                for d in self.u1_decisions
            ],
            "u2_decisions": [
                {
                    "price": np.asarray(d.price, dtype=np.float64).tolist(),
                    "production_plan": np.asarray(d.production_plan, dtype=np.float64).tolist(),
                    "marketing": np.asarray(d.marketing, dtype=np.float64).tolist(),
                }
                for d in self.u2_decisions
            ],
            "omega": [np.asarray(w, dtype=np.float64).tolist() for w in self.omega],
            "u2_omega": [np.asarray(w, dtype=np.float64).tolist() for w in self.u2_omega],
            "shocks": [asdict(_coerce_shock(s)) for s in self.shocks],
            "crowd": [
                {
                    "mu": np.asarray(c.mu, dtype=np.float64).tolist(),
                    "sigma": np.asarray(c.sigma, dtype=np.float64).tolist(),
                }
                for c in self.crowd
            ],
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Schedule:
        """Deserialise a Schedule from a dictionary (e.g. parsed JSON payload)."""
        payload = data.get("schedule", data) if "u1_decisions" not in data and "schedule" in data else data
        u1 = [_coerce_decision(d) for d in payload.get("u1_decisions", [])]
        u2_raw = payload.get("u2_decisions")
        u2 = [_coerce_decision(d) for d in u2_raw] if u2_raw is not None else []
        omega = [np.asarray(w, dtype=np.float64) for w in payload.get("omega", [])]
        shocks = [_coerce_shock(s) for s in payload.get("shocks", [])]
        crowd = [_coerce_crowd(c) for c in payload.get("crowd", [])]
        u2_omega = [np.asarray(w, dtype=np.float64) for w in payload.get("u2_omega", [])]
        return cls(
            u1_decisions=u1,
            u2_decisions=u2,
            omega=omega,
            shocks=shocks,
            crowd=crowd,
            u2_omega=u2_omega,
        )


def _archetype_choice_probs(
    price: np.ndarray,
    marketing: np.ndarray,
    beta0: np.ndarray,
    alpha_arch: np.ndarray,
    sent_arch: np.ndarray,
    loyalty_arch: np.ndarray,
    params: MarketParams,
) -> np.ndarray:
    """Compute vectorised MNL choice probabilities of shape (n_paths, 12, 3) for [outside, A, B]."""
    n_paths = beta0.shape[0]
    u_outside = (-alpha_arch * float(params.p_ref))[np.newaxis, :, np.newaxis]
    u_outside = np.broadcast_to(u_outside, (n_paths, N_ARCHETYPES, 1))

    mkt_term = float(params.gamma) * np.log1p(np.maximum(marketing, 0.0))
    sent_term = float(params.delta) * np.clip(sent_arch, -1.0, 1.0)
    static_firm_u = (
        -alpha_arch[:, np.newaxis] * price[np.newaxis, :]
        + mkt_term[np.newaxis, :]
        + sent_term
        + loyalty_arch
    )
    u_firms = beta0[:, np.newaxis, :] + static_firm_u[np.newaxis, :, :]
    utilities = np.concatenate([u_outside, u_firms], axis=-1)

    u_max = np.max(utilities, axis=-1, keepdims=True)
    exp_u = np.exp(utilities - u_max)
    probs = exp_u / np.sum(exp_u, axis=-1, keepdims=True)
    return probs


def _sample_multinomial_crn(
    counts_per_arch: np.ndarray,
    probs: np.ndarray,
    uniforms: np.ndarray,
) -> np.ndarray:
    """Sample multinomial buyer counts of shape (n_paths, 12, 2) for [A, B] from CRN uniforms.

    Decomposes Multinomial(n_k, [p_0, p_A, p_B]) into two exact Binomial inverse-CDF draws
    driven by path-specific uniform random numbers `uniforms` of shape (n_paths, 12, 2),
    fully vectorised over (n_paths, 12) without looping over paths.
    """
    n_k = counts_per_arch[np.newaxis, :]  # (1, 12)
    p_a = np.clip(probs[:, :, 1], 0.0, 1.0)
    rem_prob = np.maximum(1.0 - p_a, 1e-12)
    p_b_cond = np.clip(probs[:, :, 2] / rem_prob, 0.0, 1.0)

    count_a = _binomial_icdf_vectorised(n_k, p_a, uniforms[:, :, 0])
    n_rem = np.maximum(n_k - count_a, 0)
    count_b = _binomial_icdf_vectorised(n_rem, p_b_cond, uniforms[:, :, 1])
    return np.stack([count_a, count_b], axis=-1)


def _binomial_icdf_vectorised(
    n: np.ndarray,
    p: np.ndarray,
    u: np.ndarray,
) -> np.ndarray:
    """Exact vectorised Binomial(n, p) inverse-CDF transform over (n_paths, 12)."""
    max_n = int(np.max(n)) if n.size > 0 else 0
    if max_n <= 0:
        return np.zeros_like(p, dtype=np.int64)

    # Normal approximation for large n_k (> 100), exact recursive Poisson-binomial CDF for typical n_k (~42)
    if max_n > 120:
        mean = n * p
        sd = np.sqrt(np.maximum(n * p * (1.0 - p), 0.0))
        # Rational approximation to normal inverse CDF via erfinv-free logistic/probit or Box-Muller
        u_clip = np.clip(u, 1e-12, 1.0 - 1e-12)
        # Winitzki / Acklam-style fast probit approximation
        t = np.sqrt(-2.0 * np.log(np.minimum(u_clip, 1.0 - u_clip)))
        z_abs = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (
            1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t
        )
        z = np.where(u_clip >= 0.5, z_abs, -z_abs)
        draws = np.rint(mean + sd * z).astype(np.int64)
        return np.clip(draws, 0, n)

    p_safe = np.clip(p, 0.0, 1.0)
    q_safe = 1.0 - p_safe

    # Handle boundary p == 1 cleanly
    pmf = np.power(q_safe, n)
    cdf = pmf.copy()
    counts = np.zeros(p.shape, dtype=np.int64)
    odds = np.where(q_safe > 1e-12, p_safe / np.maximum(q_safe, 1e-12), 0.0)

    for k in range(1, max_n + 1):
        exceed = (u > cdf) & (k <= n)
        counts += exceed.astype(np.int64)
        pmf = pmf * ((n - k + 1) / float(k)) * odds
        cdf = np.minimum(cdf + pmf, 1.0)

    counts = np.where(p_safe >= 1.0 - 1e-12, n, counts)
    counts = np.where(p_safe <= 1e-12, 0, counts)
    return counts


def _pregenerate_crn_streams(
    n_paths: int,
    n_ticks: int,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Pre-generate paired random streams per path r using np.random.default_rng([seed, r])."""
    demand_noise = np.empty((n_paths, n_ticks), dtype=np.float64)
    lead_jitter = np.empty((n_paths, n_ticks), dtype=np.int64)
    shock_scale = np.empty((n_paths, n_ticks), dtype=np.float64)
    choice_uniforms = np.empty((n_paths, n_ticks, N_ARCHETYPES, 2), dtype=np.float64)

    for r in range(n_paths):
        rng_r = np.random.default_rng([seed, r])
        demand_noise[r] = rng_r.lognormal(mean=0.0, sigma=_DEMAND_NOISE_SIGMA, size=n_ticks)
        lead_jitter[r] = rng_r.integers(-1, 2, size=n_ticks)
        shock_scale[r] = rng_r.uniform(_SHOCK_SCALE_LOW, _SHOCK_SCALE_HIGH, size=n_ticks)
        choice_uniforms[r] = rng_r.random((n_ticks, N_ARCHETYPES, 2))

    return demand_noise, lead_jitter, shock_scale, choice_uniforms


def _simulate_universe(
    decisions: list[FirmDecision],
    omega_seq: list[np.ndarray],
    shocks: list[Shock],
    crowd_seq: list[CrowdSentiment],
    params: MarketParams,
    alpha_arch: np.ndarray,
    loyalty_arch: np.ndarray,
    counts_per_arch: np.ndarray,
    demand_noise: np.ndarray,
    lead_jitter: np.ndarray,
    shock_scale: np.ndarray,
    choice_uniforms: np.ndarray,
) -> np.ndarray:
    """Run vectorised tick loop across all n_paths for one universe.

    Returns cumulative profit of firm A of shape (n_paths, n_ticks).
    """
    n_paths, n_ticks = demand_noise.shape
    if n_ticks == 0:
        return np.zeros((n_paths, 0), dtype=np.float64)

    k_cap = np.asarray(params.k_cap, dtype=np.float64)
    beta0 = np.broadcast_to(np.asarray(params.beta_bar, dtype=np.float64), (n_paths, 2)).copy()
    inventory = np.broadcast_to(k_cap, (n_paths, 2)).copy()
    raw_inv = np.broadcast_to(2.0 * k_cap * float(params.raw_per_unit), (n_paths, 2)).copy()

    max_lead_offset = int(params.lead_time0) + 25
    pipeline_arr = np.zeros((n_paths, n_ticks + max_lead_offset + 2, 2), dtype=np.float64)
    pipeline_total = np.zeros((n_paths, 2), dtype=np.float64)

    demand_ring = np.zeros((8, n_paths, 2), dtype=np.float64)
    cum_profit = np.zeros((n_paths, 2), dtype=np.float64)
    cum_profit_a_ticks = np.empty((n_paths, n_ticks), dtype=np.float64)

    r_per_unit = float(params.raw_per_unit)
    holding_cost = float(params.holding_cost)
    n_consumers = float(params.n_consumers)
    z_alpha = float(params.z_alpha)
    order_mult = float(params.order_up_to_mult)
    path_idx = np.arange(n_paths, dtype=np.int64)

    for t in range(n_ticks):
        # 1. Receive raw-material orders arriving at tick t
        arriving = pipeline_arr[:, t, :]
        raw_inv = raw_inv + arriving
        pipeline_total = np.maximum(pipeline_total - arriving, 0.0)

        # 2. Apply active shock with per-path magnitude multiplier and lead-time jitter
        shock = shocks[t]
        scale_t = shock_scale[:, t]
        c_raw_t = float(params.c_raw0) * np.maximum(0.0, 1.0 + float(shock.delta_c_raw) * scale_t)

        lt_t = np.maximum(
            1,
            int(params.lead_time0)
            + np.rint(float(shock.delta_lead_time) * scale_t).astype(np.int64)
            + lead_jitter[:, t],
        )
        demand_mult_t = np.maximum(0.0, 1.0 + float(shock.demand_shock) * scale_t) * demand_noise[:, t]

        # 3. Produce: Q_j = min(plan_j, K_cap_j, raw_inv_j / r)
        dec = decisions[t]
        price = np.asarray(dec.price, dtype=np.float64)
        plan = np.maximum(np.asarray(dec.production_plan, dtype=np.float64), 0.0)
        marketing = np.maximum(np.asarray(dec.marketing, dtype=np.float64), 0.0)

        max_prod = np.minimum(plan, k_cap)[np.newaxis, :]
        qty = np.minimum(max_prod, raw_inv / r_per_unit)
        qty = np.maximum(qty, 0.0)
        raw_inv = np.maximum(raw_inv - r_per_unit * qty, 0.0)
        inventory = np.maximum(inventory + qty, 0.0)

        # 4. Archetype-level MNL choice probabilities and multinomial counts
        probs = _archetype_choice_probs(
            price=price,
            marketing=marketing,
            beta0=beta0,
            alpha_arch=alpha_arch,
            sent_arch=crowd_seq[t].mu,
            loyalty_arch=loyalty_arch,
            params=params,
        )
        arch_draws = _sample_multinomial_crn(
            counts_per_arch=counts_per_arch,
            probs=probs,
            uniforms=choice_uniforms[:, t, :, :],
        )
        raw_demand = np.sum(arch_draws, axis=1).astype(np.float64)
        demand = demand_mult_t[:, np.newaxis] * raw_demand

        total_demand = np.sum(demand, axis=1, keepdims=True)
        scale_cap = np.where(
            total_demand > n_consumers,
            n_consumers / np.maximum(total_demand, 1e-12),
            1.0,
        )
        demand = demand * scale_cap

        # 5. Clear market with spillover (broadcasts over (n_paths, 2))
        cleared = clear_market(demand, inventory, params.theta)
        sales = np.asarray(cleared["sales"], dtype=np.float64)
        unmet = np.asarray(cleared["unmet"], dtype=np.float64)
        inventory = np.maximum(inventory - sales, 0.0)

        # 6. Profit (broadcasts over (n_paths, 2))
        tc, _mc, _atc = costs(qty, c_raw_t, params)
        revenue = sales * price[np.newaxis, :]
        holding = holding_cost * (inventory + raw_inv)
        profit = revenue - tc - marketing[np.newaxis, :] - holding
        cum_profit = cum_profit + profit
        cum_profit_a_ticks[:, t] = cum_profit[:, 0]

        # 7. Goodwill update (broadcasts over (n_paths, 2))
        beta0 = update_goodwill(beta0, unmet, demand, params)

        # 8. Replenish using (s,S) with behavioural omega
        demand_ring[t % 8] = demand
        n_hist = t + 1
        if n_hist == 1:
            mu_d = demand
            sigma_d = 0.2 * mu_d
        else:
            w_len = min(n_hist, 8)
            window = demand_ring[:w_len]
            mu_d = np.mean(window, axis=0)
            sigma_d = np.std(window, axis=0, ddof=1)

        omega_t = np.clip(np.asarray(omega_seq[t], dtype=np.float64), -0.5, 2.0)[np.newaxis, :]
        lt_float = lt_t[:, np.newaxis].astype(np.float64)
        rop = np.maximum(
            mu_d * lt_float + z_alpha * sigma_d * np.sqrt(lt_float) * (1.0 + omega_t),
            0.0,
        )

        position = raw_inv + pipeline_total
        s_level = rop * order_mult
        orders = np.where(position <= rop, np.maximum(s_level - position, 0.0), 0.0)

        arrival_ticks = np.minimum(t + lt_t, pipeline_arr.shape[1] - 1)
        pipeline_arr[path_idx, arrival_ticks, 0] += orders[:, 0]
        pipeline_arr[path_idx, arrival_ticks, 1] += orders[:, 1]
        pipeline_total = pipeline_total + orders

    return cum_profit_a_ticks


def _compute_fan(cum_profit_a_ticks: np.ndarray) -> dict[str, list[float]]:
    """Compute p5/p25/p50/p75/p95 of Firm A's cumulative profit per tick."""
    if cum_profit_a_ticks.shape[1] == 0 or cum_profit_a_ticks.shape[0] == 0:
        return {k: [] for k in _FAN_KEYS}

    pcts = np.percentile(cum_profit_a_ticks, _FAN_PERCENTILES, axis=0)
    return {
        key: np.asarray(pcts[idx], dtype=np.float64).tolist()
        for idx, key in enumerate(_FAN_KEYS)
    }


def run_paths(
    schedule: Schedule,
    params: MarketParams | None = None,
    archetypes: Archetypes | None = None,
    n_paths: int = 100,
    seed: int = 0,
) -> dict[str, Any]:
    """Run vectorised Monte Carlo paths for U1 (AI) and U2 (baseline) with common random numbers.

    Returns dict with:
    - pi_ai: np.ndarray of shape (n_paths,)
    - pi_base: np.ndarray of shape (n_paths,)
    - fan: dict with "ai" and "base" percentile fans (p5/p25/p50/p75/p95 per tick)
    """
    resolved_params = params if params is not None else MarketParams()
    if archetypes is None:
        archetypes = make_archetypes(
            resolved_params.n_consumers,
            np.random.default_rng(seed),
        )

    n_ticks = len(schedule.u1_decisions)
    n_paths_int = int(n_paths)
    if n_paths_int <= 0 or n_ticks == 0:
        empty = np.zeros(max(n_paths_int, 0), dtype=np.float64)
        empty_fan = {k: [] for k in _FAN_KEYS}
        return {
            "pi_ai": empty,
            "pi_base": empty.copy(),
            "fan": {"ai": empty_fan, "base": dict(empty_fan)},
        }

    # Archetype-level mean alpha: E[exp(N(mu, sigma^2))] = exp(mu + 0.5 * sigma^2)
    alpha_arch = np.exp(
        np.asarray(archetypes.alpha_mu, dtype=np.float64)
        + 0.5 * np.square(np.asarray(archetypes.alpha_sigma, dtype=np.float64))
    )
    loyalty_arch = np.asarray(archetypes.loyalty, dtype=np.float64)
    counts_per_arch = np.bincount(
        np.asarray(archetypes.consumer_archetype, dtype=np.int64),
        minlength=N_ARCHETYPES,
    )[:N_ARCHETYPES].astype(np.int64)

    demand_noise, lead_jitter, shock_scale, choice_uniforms = _pregenerate_crn_streams(
        n_paths=n_paths_int,
        n_ticks=n_ticks,
        seed=int(seed),
    )

    cum_ai = _simulate_universe(
        decisions=schedule.u1_decisions,
        omega_seq=schedule.omega,
        shocks=schedule.shocks,
        crowd_seq=schedule.crowd,
        params=resolved_params,
        alpha_arch=alpha_arch,
        loyalty_arch=loyalty_arch,
        counts_per_arch=counts_per_arch,
        demand_noise=demand_noise,
        lead_jitter=lead_jitter,
        shock_scale=shock_scale,
        choice_uniforms=choice_uniforms,
    )
    cum_base = _simulate_universe(
        decisions=schedule.u2_decisions,
        omega_seq=schedule.u2_omega,
        shocks=schedule.shocks,
        crowd_seq=schedule.crowd,
        params=resolved_params,
        alpha_arch=alpha_arch,
        loyalty_arch=loyalty_arch,
        counts_per_arch=counts_per_arch,
        demand_noise=demand_noise,
        lead_jitter=lead_jitter,
        shock_scale=shock_scale,
        choice_uniforms=choice_uniforms,
    )

    pi_ai = cum_ai[:, -1].copy()
    pi_base = cum_base[:, -1].copy()
    fan = {
        "ai": _compute_fan(cum_ai),
        "base": _compute_fan(cum_base),
    }
    return {
        "pi_ai": pi_ai,
        "pi_base": pi_base,
        "fan": fan,
    }


def preview(
    schedule_so_far: Schedule,
    last_decision: FirmDecision | tuple[FirmDecision, FirmDecision] | Mapping[str, Any] | None,
    horizon: int,
    n: int = 100,
    seed: int = 0,
    params: MarketParams | None = None,
    archetypes: Archetypes | None = None,
) -> dict[str, Any]:
    """Project `horizon` future ticks holding `last_decision` constant, then run `n` MC paths."""
    resolved_params = params if params is not None else MarketParams()
    h = max(int(horizon), 0)

    if isinstance(last_decision, tuple) and len(last_decision) == 2:
        u1_last = _coerce_decision(last_decision[0])
        u2_last = _coerce_decision(last_decision[1])
    elif isinstance(last_decision, Mapping) and ("u1" in last_decision or "u1_decision" in last_decision):
        u1_raw = last_decision.get("u1", last_decision.get("u1_decision"))
        u2_raw = last_decision.get("u2", last_decision.get("u2_decision", u1_raw))
        u1_last = _coerce_decision(u1_raw)
        u2_last = _coerce_decision(u2_raw)
    elif last_decision is not None:
        u1_last = _coerce_decision(last_decision)
        if schedule_so_far.u2_decisions:
            prev_u2 = schedule_so_far.u2_decisions[-1]
            u2_last = FirmDecision(
                price=np.array([float(prev_u2.price[0]), float(u1_last.price[1])], dtype=np.float64),
                production_plan=np.array(
                    [float(prev_u2.production_plan[0]), float(u1_last.production_plan[1])],
                    dtype=np.float64,
                ),
                marketing=np.array(
                    [float(prev_u2.marketing[0]), float(u1_last.marketing[1])],
                    dtype=np.float64,
                ),
            )
        else:
            q_ref = 0.5 * np.asarray(resolved_params.k_cap, dtype=np.float64)
            _tc, _mc, atc = costs(q_ref, resolved_params.c_raw0, resolved_params)
            base_price_a = float(atc[0]) * (1.0 + float(resolved_params.cost_plus_markup))
            u2_last = FirmDecision(
                price=np.array([base_price_a, float(u1_last.price[1])], dtype=np.float64),
                production_plan=np.array([float(q_ref[0]), float(u1_last.production_plan[1])], dtype=np.float64),
                marketing=np.array([float(u1_last.marketing[0]), float(u1_last.marketing[1])], dtype=np.float64),
            )
    elif schedule_so_far.u1_decisions:
        u1_last = _coerce_decision(schedule_so_far.u1_decisions[-1])
        u2_last = _coerce_decision(schedule_so_far.u2_decisions[-1])
    else:
        default_p = np.full(2, resolved_params.p_ref, dtype=np.float64)
        default_q = 0.5 * np.asarray(resolved_params.k_cap, dtype=np.float64)
        default_m = np.zeros(2, dtype=np.float64)
        u1_last = FirmDecision(price=default_p, production_plan=default_q, marketing=default_m)
        u2_last = _coerce_decision(u1_last)

    last_omega = (
        np.asarray(schedule_so_far.omega[-1], dtype=np.float64).copy()
        if schedule_so_far.omega
        else np.zeros(2, dtype=np.float64)
    )
    last_u2_omega = (
        np.asarray(schedule_so_far.u2_omega[-1], dtype=np.float64).copy()
        if schedule_so_far.u2_omega
        else np.array([0.0, float(last_omega[1])], dtype=np.float64)
    )
    last_shock = _coerce_shock(schedule_so_far.shocks[-1]) if schedule_so_far.shocks else Shock()
    last_crowd = (
        _coerce_crowd(schedule_so_far.crowd[-1])
        if schedule_so_far.crowd
        else CrowdSentiment(
            mu=np.zeros((N_ARCHETYPES, 2), dtype=np.float64),
            sigma=np.full((N_ARCHETYPES, 2), 0.1, dtype=np.float64),
        )
    )

    ext_schedule = Schedule(
        u1_decisions=[*(_coerce_decision(d) for d in schedule_so_far.u1_decisions), *(_coerce_decision(u1_last) for _ in range(h))],
        u2_decisions=[*(_coerce_decision(d) for d in schedule_so_far.u2_decisions), *(_coerce_decision(u2_last) for _ in range(h))],
        omega=[*(np.asarray(w, dtype=np.float64).copy() for w in schedule_so_far.omega), *(last_omega.copy() for _ in range(h))],
        shocks=[*(_coerce_shock(s) for s in schedule_so_far.shocks), *(_coerce_shock(last_shock) for _ in range(h))],
        crowd=[*(_coerce_crowd(c) for c in schedule_so_far.crowd), *(_coerce_crowd(last_crowd) for _ in range(h))],
        u2_omega=[
            *(np.asarray(w, dtype=np.float64).copy() for w in schedule_so_far.u2_omega),
            *(last_u2_omega.copy() for _ in range(h)),
        ],
    )
    return run_paths(
        schedule=ext_schedule,
        params=resolved_params,
        archetypes=archetypes,
        n_paths=n,
        seed=seed,
    )


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint: python -m backend.engine.montecarlo --schedule in.json --n 10000 --seed 7 --out out.json."""
    parser = argparse.ArgumentParser(description="Run vectorised Monte Carlo rollout on a frozen Schedule.")
    parser.add_argument("--schedule", required=True, type=Path, help="Input schedule JSON path")
    parser.add_argument("--n", type=int, default=10000, help="Number of Monte Carlo paths")
    parser.add_argument("--seed", type=int, default=7, help="Base RNG seed")
    parser.add_argument("--out", required=True, type=Path, help="Output result JSON path")
    args = parser.parse_args(argv)

    raw_data = json.loads(args.schedule.read_text(encoding="utf-8"))
    schedule = Schedule.from_dict(raw_data)

    params_dict = raw_data.get("params") if isinstance(raw_data, Mapping) else None
    params = MarketParams(**params_dict) if isinstance(params_dict, Mapping) else MarketParams()
    archetypes = make_archetypes(params.n_consumers, np.random.default_rng(args.seed))

    mc_res = run_paths(
        schedule=schedule,
        params=params,
        archetypes=archetypes,
        n_paths=args.n,
        seed=args.seed,
    )
    alpha_stats = paired_alpha_test(mc_res["pi_ai"], mc_res["pi_base"])
    serialisable_stats = {
        **alpha_stats,
        "ci95": list(alpha_stats["ci95"]),
    }

    output_payload = {
        "n": int(args.n),
        "seed": int(args.seed),
        "stats": {"paired_alpha_test": serialisable_stats},
        "paired_alpha_test": serialisable_stats,
        "fan": mc_res["fan"],
        "pi_ai": np.asarray(mc_res["pi_ai"], dtype=np.float64).tolist(),
        "pi_base": np.asarray(mc_res["pi_base"], dtype=np.float64).tolist(),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output_payload, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

