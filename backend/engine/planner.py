"""Planner: tests a small business's plans against possible futures (SPEC §15.2-15.5, §15.9).

Pure, seeded NumPy. No LLM calls and no I/O, except the job CLI at the bottom
(`python -m backend.engine.planner --job in.json --n 10000 --out out.json`).
Implemented in task P2 (prompts/3_oct15-16_pivot-parallel/P2-engine-planner.md), recalibrated in
P2b (prompts/3b_oct17_one-task/P2b-engine-recalibration.md).

How a cell is computed:
- Every plan and "Do nothing" in a shock column run side by side on the same random
  streams (common random numbers). Rows = variant x plan x path, stacked on one axis;
  the only Python loop is over weeks.
- Demand is the expected MNL demand per archetype (SPEC §4.1) times a per-path weekly
  lognormal noise, as in §4.7's Monte Carlo (realised choice sampling stays out of profit).
- Material is charged on units *sold* at the weighted-average cost of the finished goods
  (which carry the weighted-average cost of the raw stock they were made from). So the
  P&L bridge of §15.5.2 is an exact identity with Q = units sold.
"""
from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field, fields, replace
from pathlib import Path
from typing import Any

import numpy as np

from backend.engine.inventory import bullwhip_ratio
from backend.engine.market import archetype_weights, clear_market, make_archetypes, update_goodwill
from backend.engine.types import N_ARCHETYPES, Archetypes, CrowdSentiment, MarketParams

DO_NOTHING = "Do nothing"
TEXTBOOK_RULE = "Textbook price rule"

# Per-path randomness (SPEC §15.5.2, same sizes as §4.7)
_DEMAND_NOISE_SIGMA = 0.1
_SHOCK_SCALE = (0.8, 1.2)
_RIVAL_STOCK_WEEKS = (1.0, 4.0)
_ALPHA_MULT_SIGMA = 0.25       # per-path price sensitivity x Lognormal(0, 0.25^2) (P2b)
# Calibration (SPEC §15.3)
_ENGINE_PRICE = 100.0
_P_REF = 105.0
_HOLDING_RATE = 0.004          # x c_raw0 per unit per week, about 20% a year
_CAPACITY_MULT = 1.6
_MARKETING_SHARE = 0.05        # starting marketing = 5% of gross margin
_GAMMA_BOUNDS = (0.02, 0.35)
_OUTSIDE_SHARE = 0.15          # share of shoppers who choose "don't buy" at the start (P2b)
# How much the shoppers' mood (Lightning's mu, clipped to [-1, 1]) moves utility. MarketParams.delta is 0.8; the
# held-out backtests (docs/BACKTEST_HELDOUT.md) showed the mood carried ~99% of a pick's claimed gain at 0.8, so it is
# 0.05 since 2026-10-22 (owner's OK). Every cell also reports the engine-only number (weight 0) next to it.
SENTIMENT_WEIGHT: float = 0.05
# Recordings made before that change used 0.8; their `analysis` event has no `sentiment_weight` key.
LEGACY_SENTIMENT_WEIGHT: float = 0.8
_ALPHA_SCALE_BOUNDS = (0.5, 4.0)
_CAL_ITERS = 200
# Plan mechanics (SPEC §15.4)
_PLAN_BUFFER = 1.1             # production plan = 4-week MA of own demand + 10%
_RIVAL_GAP = 1.05              # rival tolerates sitting up to 5% above you...
_RIVAL_PATIENCE = 2            # ...for 2 weeks...
_RIVAL_FOLLOW = 1.02           # ...then moves to your price + 2%
_SD_FLOOR = _DEMAND_NOISE_SIGMA  # ROP demand sd floor, as a share of mean demand
_LEAD_VAR = 2.0 / 3.0          # variance of the +-1 week lead-time jitter (uniform on {-1, 0, 1})
_SOLD_OUT_FRAC = 0.01
_EPS = 1e-9
_TOL_USD = 1e-6                # differences below this are float noise, not a win or a loss
_PIPE_PAD = 40                 # pipeline slots past the horizon (max lead 16 + 12 + jitter)
_CHUNK_PATHS = 2000            # keeps a 10k-path job well under 2 GB

_LIKELIHOODS = ("likely", "possible", "unlikely")
_ORIGINS = ("news", "ai", "default", "realized")
END_OF_HORIZON = 24            # price_end_week default: the price change lasts to the end (B1)
_PATH_BOUNDS = (-0.9, 3.0)     # cost_path values: the input price vs week 0
_PATH_MAX_LEN = 24
_PATH_START = 0.02             # a real cost path "starts rising" once it moves 2% (B1 markers)
_PATH_FALL = 0.10              # a fall of this many points from the peak gets a marker

# product word -> (plural label, adjective) for shock labels and markers
_INPUT_WORDS: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (("egg", "breakfast", "omelet", "omelette"), "Eggs", "Egg"),
    (("kitchen", "utensil", "cookware", "tableware"), "Duties", "Duty"),
    (("coffee", "espresso", "robusta", "arabica"), "Beans", "Bean"),
    (("cocoa", "chocolate", "praline", "truffle"), "Cocoa", "Cocoa"),
    (("fried", "frying", "fish and chips", "crisps", "cooking oil"), "Oil", "Oil"),  # before "chip" (computer chips)
    (("tea",), "Tea", "Tea"),
    (("graphics card", "gpu", "video card"), "GPUs", "GPU"),
    (("chip", "laptop", "computer", "pc ", "phone"), "Parts", "Parts"),
    (("furniture", "chair", "table", "sofa", "cabinet", "wood"), "Timber", "Timber"),
    (("bread", "cake", "pastry", "noodle", "flour", "bakery"), "Flour", "Flour"),
    (("rice",), "Rice", "Rice"),
    (("shirt", "t-shirt", "dress", "garment", "cotton", "apparel"), "Fabric", "Fabric"),
    (("steel", "metal"), "Steel", "Steel"),
    (("beer", "ale"), "Malt", "Malt"),
    (("fuel", "petrol", "diesel"), "Fuel", "Fuel"),
)


# --------------------------------------------------------------------------------------
# Data types
# --------------------------------------------------------------------------------------


def _clip(x: float, lo: float, hi: float) -> float:
    return float(min(max(float(x), lo), hi))


def _clip_int(x: float, lo: int, hi: int) -> int:
    return int(min(max(round(float(x)), lo), hi))


@dataclass
class PlanSpec:
    """One plan (SPEC §15.4). The defaults are "Do nothing"."""

    name: str = DO_NOTHING
    price_change_pct: float = 0.0
    price_change_week: int = 0
    extra_stock_weeks: float = 0.0
    stock_week: int = 0
    marketing_change_pct: float = 0.0
    switch_supplier: bool = False
    alt_cost_change_pct: float = 0.0
    alt_lead_time_weeks: int = 3
    alt_shock_exposure: float = 0.3
    price_end_week: int = END_OF_HORIZON  # the price change lasts while price_change_week <= t < price_end_week

    @classmethod
    def do_nothing(cls) -> PlanSpec:
        return cls()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> PlanSpec:
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known}).clamp()

    def clamp(self) -> PlanSpec:
        """Clip every knob to the SPEC §15.4 bounds."""
        return PlanSpec(
            name=str(self.name)[:40],
            price_change_pct=_clip(self.price_change_pct, -20.0, 20.0),
            price_change_week=_clip_int(self.price_change_week, 0, 23),
            extra_stock_weeks=_clip(self.extra_stock_weeks, 0.0, 8.0),
            stock_week=_clip_int(self.stock_week, 0, 23),
            marketing_change_pct=_clip(self.marketing_change_pct, -50.0, 100.0),
            switch_supplier=bool(self.switch_supplier),
            alt_cost_change_pct=_clip(self.alt_cost_change_pct, -30.0, 50.0),
            alt_lead_time_weeks=_clip_int(self.alt_lead_time_weeks, 1, 16),
            alt_shock_exposure=_clip(self.alt_shock_exposure, 0.0, 1.0),
            price_end_week=self._end_week(),
        )

    def _end_week(self) -> int:
        """1..24; an end at or before the start means "no end" (SPEC §15.4)."""
        end = round(float(self.price_end_week))
        return END_OF_HORIZON if end <= _clip_int(self.price_change_week, 0, 23) else min(end, END_OF_HORIZON)

    @property
    def has_surcharge_end(self) -> bool:
        """A price change that ends before the horizon does (a surcharge)."""
        return self.price_change_pct != 0.0 and self.price_end_week < END_OF_HORIZON

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def is_textbook(self) -> bool:
        return self.name == TEXTBOOK_RULE

    def first_change_week(self) -> int | None:
        """The week the plan first differs from "Do nothing" (shoppers react from here, §15.4)."""
        weeks: list[int] = []
        if self.is_textbook or self.switch_supplier or self.marketing_change_pct != 0.0:
            weeks.append(0)
        if self.price_change_pct != 0.0:
            weeks.append(self.price_change_week)
        if self.extra_stock_weeks > 0.0:
            weeks.append(self.stock_week)
        return min(weeks) if weeks else None


@dataclass
class ShockCase:
    """One possible future (SPEC §15.5), engine knobs plus display fields."""

    id: str = "none"
    label: str = "No change"
    delta_c_raw: float = 0.0
    delta_lead_time: int = 0
    demand_shock: float = 0.0
    onset_week: int = 2
    ramp_weeks: int = 3
    rival_price_change_pct: float = 0.0
    share_shift_pct: float = 0.0
    likelihood: str = "likely"
    why: str = ""
    source_ids: list[str] = field(default_factory=list)
    origin: str = "default"
    cost_path: list[float] = field(default_factory=list)  # B1: the news input's real price vs week 0, per week

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ShockCase:
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known}).clamp()

    def clamp(self) -> ShockCase:
        """Clip every knob to the SPEC §15.5 bounds."""
        return ShockCase(
            id=str(self.id)[:12],
            label=str(self.label)[:40],
            delta_c_raw=_clip(self.delta_c_raw, -0.5, 1.0),
            delta_lead_time=_clip_int(self.delta_lead_time, -2, 10),
            demand_shock=_clip(self.demand_shock, -0.5, 0.5),
            onset_week=_clip_int(self.onset_week, 0, 12),
            ramp_weeks=_clip_int(self.ramp_weeks, 1, 8),
            rival_price_change_pct=_clip(self.rival_price_change_pct, -20.0, 20.0),
            share_shift_pct=_clip(self.share_shift_pct, 0.0, 30.0),
            likelihood=self.likelihood if self.likelihood in _LIKELIHOODS else "likely",
            why=str(self.why)[:120],
            source_ids=[str(s) for s in list(self.source_ids)[:3]],
            origin=self.origin if self.origin in _ORIGINS else "default",
            cost_path=[_clip(v, *_PATH_BOUNDS) for v in list(self.cost_path)[:_PATH_MAX_LEN]],
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Calibration:
    """Engine units for one business profile (SPEC §15.3). Dollars out = engine money x k_p x k_q."""

    params: MarketParams
    archetypes: Archetypes
    k_p: float
    k_q: float
    d0: float
    rival_markup: float
    init: dict
    profile: dict
    alpha_scale: float = 1.0       # factor on every archetype's alpha (P2b, "your price is about right")
    outside_share: float = 0.0     # share choosing "don't buy" at the start (P2b)

    @property
    def usd(self) -> float:
        return self.k_p * self.k_q


def _as_plan(plan: PlanSpec | Mapping[str, Any]) -> PlanSpec:
    return plan.clamp() if isinstance(plan, PlanSpec) else PlanSpec.from_dict(plan)


def _as_shock(case: ShockCase | Mapping[str, Any]) -> ShockCase:
    return case.clamp() if isinstance(case, ShockCase) else ShockCase.from_dict(case)


# --------------------------------------------------------------------------------------
# Cost exposure (SPEC §15.5.1)
# --------------------------------------------------------------------------------------


def _exposed_share(profile: Mapping[str, Any]) -> float:
    return _clip(profile.get("exposed_cost_share", 1.0) or 1.0, 0.0, 1.0)


def _cost_factor(exposed: float, delta_c_raw: float | np.ndarray, level: float | np.ndarray) -> Any:
    """1 + exposed share x news-input change x ramp level. The one formula for the cost line."""
    return 1.0 + exposed * delta_c_raw * level


def _path_peak(path: Sequence[float]) -> tuple[int, float]:
    """(week, value) of the largest absolute move in a cost path."""
    week = int(np.argmax(np.abs(np.asarray(path, dtype=np.float64))))
    return week, float(path[week])


def cost_change(profile: Mapping[str, Any], case: ShockCase | Mapping[str, Any]) -> dict[str, float]:
    """Change in the unit cost once the shock is fully in (SPEC §15.5.1).

    With a `cost_path` (a backtest's real price history) the "fully in" value is the path's END value, and
    `peak_pct` / `peak_week` say how far and when it went at the most. `wording.cost_line` builds its sentence
    from this, so the words and the engine agree.
    """
    path = list(case.cost_path if isinstance(case, ShockCase) else case.get("cost_path") or [])
    share = _exposed_share(profile)
    cost = float(profile["unit_cost"])
    if path:
        frac = share * float(path[-1])
        week, peak = _path_peak(path)
        return {
            "pct": 100.0 * frac, "usd_per_unit": cost * frac,
            "peak_pct": 100.0 * share * peak, "peak_week": float(week),
            "input_end_pct": 100.0 * float(path[-1]), "input_peak_pct": 100.0 * peak,
        }
    dc = float(case.delta_c_raw if isinstance(case, ShockCase) else case.get("delta_c_raw", 0.0))
    frac = _cost_factor(share, dc, 1.0) - 1.0
    return {"pct": 100.0 * frac, "usd_per_unit": cost * frac}


def _ramp(t: int, onset: int, ramp_weeks: int) -> float:
    if t < onset:
        return 0.0
    return min(1.0, (t - onset + 1) / max(ramp_weeks, 1))


# --------------------------------------------------------------------------------------
# Calibration (SPEC §15.3)
# --------------------------------------------------------------------------------------


def _arch_arrays(arch: Archetypes) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(alpha (12,), loyalty transposed (2, 12), consumer counts (12,)) at archetype level.

    alpha is the archetype mean E[lognormal] = exp(mu + sigma^2/2), as in montecarlo.run_paths.
    """
    alpha = np.exp(np.asarray(arch.alpha_mu, dtype=np.float64) + 0.5 * np.square(arch.alpha_sigma))
    loyalty_t = np.ascontiguousarray(np.asarray(arch.loyalty, dtype=np.float64).T)
    counts = np.bincount(np.asarray(arch.consumer_archetype, dtype=np.int64), minlength=N_ARCHETYPES)
    return alpha, loyalty_t, counts[:N_ARCHETYPES].astype(np.float64)


def _choice_probs(
    price: np.ndarray,
    marketing: np.ndarray,
    beta0: np.ndarray,
    sent: np.ndarray | float,
    alpha: np.ndarray,
    loyalty_t: np.ndarray,
    gamma: float,
    p_ref: float,
) -> np.ndarray:
    """MNL probabilities for [A, B] per archetype, shape (S, 2, 12). Outside = 1 - sum.

    `alpha` is (S, 12) or (1, 12): per-row price sensitivity, so a path's alpha draw (§15.5.2)
    applies to every plan in the column. Adapted from montecarlo._archetype_choice_probs, laid out (S, 2, 12) so the archetype sum is a
    contiguous reduction. Utilities are taken relative to the outside good (U - U_0), which is the
    log-sum-exp normalisation with the outside good as the pivot: stable because U - U_0 stays small.
    """
    util = (
        beta0[:, :, None]
        - alpha[:, None, :] * (price[:, :, None] - p_ref)
        + gamma * np.log1p(np.maximum(marketing, 0.0))[:, :, None]
        + sent
        + loyalty_t[None, :, :]
    )
    ex = np.exp(np.minimum(util, 50.0))
    denom = 1.0 + ex[:, 0, :] + ex[:, 1, :]
    return ex / denom[:, None, :]


def _mix_weights(profile: Mapping[str, Any]) -> np.ndarray | None:
    """Archetype shares from the profile's customer-mix dials (SPEC §15.3); None (even split) if it has none."""
    keys = ("income_mix", "price_hunter_share", "loyal_share")
    if not any(k in profile for k in keys):
        return None
    return archetype_weights(
        profile.get("income_mix") or (1.0, 1.0, 1.0),
        float(profile.get("price_hunter_share", 0.5)),
        float(profile.get("loyal_share", 0.5)),
    )


def calibrate(profile: Mapping[str, Any], seed: int = 0, sentiment_weight: float | None = None) -> Calibration:
    """Turn a BusinessProfile dict into engine units (SPEC §15.3).

    Engine prices put your price at 100. Three "about right today" assumptions, solved together
    at the starting prices with neutral sentiment and no shock, given the rival's price:
    - **Your price is about right.** Every archetype's alpha is scaled by one factor `s` (clamped to
      [0.5, 4]) so your own-price elasticity meets the Lerner condition E_d = -P / (P - c): today's
      price is profit-maximising at today's cost, so a price change is not a free win.
    - **Some shoppers can walk away.** Both firms' beta_bar move by the same amount so 15% of
      shoppers choose "don't buy" (the rival keeps its relative position).
    - **Your marketing is about right.** The marketing effect gamma is set so the starting level
      (5% of gross margin) is break-even at the margin (Dorfman-Steiner).
    """
    prof = dict(profile)
    price = float(prof["price"])
    unit_cost = min(float(prof["unit_cost"]), 0.95 * price)
    k_p = price / _ENGINE_PRICE
    c0 = unit_cost / k_p
    rival_price = float(prof.get("rival_price") or price)
    p_b = rival_price / k_p
    base = MarketParams()
    params = replace(
        base,
        p_ref=_P_REF,
        c_raw0=c0,
        fc=(0.0, 0.0),
        eta=0.0,
        holding_cost=_HOLDING_RATE * c0,
        lead_time0=int(prof.get("lead_time_weeks", 3)),
        delta=SENTIMENT_WEIGHT if sentiment_weight is None else float(sentiment_weight),
    )
    archetypes = make_archetypes(params.n_consumers, np.random.default_rng(seed), _mix_weights(prof))
    alpha0, loyalty_t, counts = _arch_arrays(archetypes)
    n_cons = float(counts.sum())
    prices = np.array([[_ENGINE_PRICE, p_b]])
    beta_start = np.asarray(params.beta_bar, dtype=np.float64)
    margin = _ENGINE_PRICE - c0
    e_target = -_ENGINE_PRICE / margin
    logit_target = float(np.log(_OUTSIDE_SHARE / (1.0 - _OUTSIDE_SHARE)))

    scale, shift = 1.0, 0.0
    gamma, m0, d = float(params.gamma), 0.0, np.zeros(2)
    for _ in range(_CAL_ITERS):
        alpha = (alpha0 * scale)[None, :]
        beta0 = (beta_start + shift)[None, :]
        probs = _choice_probs(prices, np.array([[m0, m0]]), beta0, 0.0, alpha, loyalty_t, gamma, _P_REF)
        d = (probs[0] * counts).sum(-1)
        p_a = probs[0, 0]
        own = -_ENGINE_PRICE * float((counts * alpha[0] * p_a * (1.0 - p_a)).sum()) / max(float(d[0]), _EPS)
        out = min(max(1.0 - float(d.sum()) / n_cons, 1e-6), 1.0 - 1e-6)
        new_scale = _clip(scale * (e_target / own) ** 0.7, *_ALPHA_SCALE_BOUNDS)
        new_shift = shift + 0.8 * (float(np.log(out / (1.0 - out))) - logit_target)
        new_m0 = _MARKETING_SHARE * margin * float(d[0])
        slope = float((counts * p_a * (1.0 - p_a)).sum())
        new_gamma = _clip((1.0 + new_m0) / max(margin * slope, _EPS), *_GAMMA_BOUNDS)
        done = (
            abs(new_m0 - m0) < 1e-9 * max(new_m0, 1.0)
            and abs(new_gamma - gamma) < 1e-12
            and abs(new_scale - scale) < 1e-10
            and abs(new_shift - shift) < 1e-10
        )
        m0, gamma, scale, shift = new_m0, new_gamma, new_scale, new_shift
        if done:
            break
    archetypes = replace(archetypes, alpha_mu=np.asarray(archetypes.alpha_mu) + np.log(scale))
    probs = _choice_probs(
        prices, np.array([[m0, m0]]), (beta_start + shift)[None, :], 0.0, (alpha0 * scale)[None, :],
        loyalty_t, gamma, _P_REF,
    )
    d = (probs[0] * counts).sum(-1)
    d0, d0_b = float(d[0]), float(d[1])
    beta_bar = (float(beta_start[0] + shift), float(beta_start[1] + shift))
    params = replace(params, gamma=gamma, beta_bar=beta_bar, k_cap=(_CAPACITY_MULT * d0, _CAPACITY_MULT * d0))
    k_q = float(prof["weekly_sales"]) / d0
    init = {
        "price": [_ENGINE_PRICE, p_b],
        "marketing": m0,
        "raw_a": float(prof.get("stock_weeks", 2.0)) * d0,
        "rival_raw_weeks": list(_RIVAL_STOCK_WEEKS),
        "inventory": [d0, d0],
        "demand": [d0, d0_b],
        "own_markup": _ENGINE_PRICE / c0 - 1.0,
        "rival_anchor": max(1.0, p_b / _ENGINE_PRICE),
        "exposed_cost_share": _exposed_share(prof),
    }
    return Calibration(
        params=params,
        archetypes=archetypes,
        k_p=k_p,
        k_q=k_q,
        d0=d0,
        rival_markup=rival_price / unit_cost - 1.0,
        init=init,
        profile=prof,
        alpha_scale=float(scale),
        outside_share=float(1.0 - d.sum() / n_cons),
    )


# --------------------------------------------------------------------------------------
# Shock cases (SPEC §15.5)
# --------------------------------------------------------------------------------------


def _input_word(profile: Mapping[str, Any]) -> tuple[str, str]:
    unit = f" {str(profile.get('product_unit', '')).lower()} "
    for keys, plural, adjective in _INPUT_WORDS:
        if any(k in unit for k in keys):
            return plural, adjective
    return "Costs", "Your"


def _pct(x: float) -> str:
    v = round(100.0 * x)
    return f"+{v}%" if v >= 0 else f"-{abs(v)}%"


def _case_label(case: ShockCase, word: str) -> str:
    if abs(case.delta_c_raw) >= 0.005:
        return f"{word} {_pct(case.delta_c_raw)}"
    if case.delta_lead_time != 0:
        n = case.delta_lead_time
        return f"Shipping {'+' if n > 0 else '-'}{abs(n)} week{'s' if abs(n) != 1 else ''}"
    if abs(case.demand_shock) >= 0.005:
        return f"Demand {_pct(case.demand_shock)}"
    if case.rival_price_change_pct != 0.0:
        return f"Rival price {_pct(case.rival_price_change_pct / 100.0)}"
    if case.share_shift_pct > 0.0:
        return f"New rival takes {round(case.share_shift_pct)}%"
    return "No change"


def default_shock_cases(news_shock: Mapping[str, Any], profile: Mapping[str, Any]) -> list[ShockCase]:
    """The fallback columns mild / news / severe / shipping (SPEC §15.5), origin "default"."""
    word, _ = _input_word(profile)
    base = ShockCase.from_dict({**news_shock, "id": "news", "label": "", "origin": "default"})

    def scaled(case_id: str, k: float) -> ShockCase:
        return replace(
            base,
            id=case_id,
            delta_c_raw=base.delta_c_raw * k,
            delta_lead_time=round(base.delta_lead_time * k),
            demand_shock=base.demand_shock * k,
            rival_price_change_pct=base.rival_price_change_pct * k,
            share_shift_pct=base.share_shift_pct * k,
        ).clamp()

    mild, news, severe = scaled("mild", 0.5), scaled("news", 1.0), scaled("severe", 1.6)
    shipping = replace(
        base,
        id="shipping",
        delta_c_raw=0.05,
        delta_lead_time=3,
        demand_shock=0.0,
        rival_price_change_pct=0.0,
        share_shift_pct=0.0,
    )
    mild.label = _case_label(mild, word)
    severe.label = _case_label(severe, word)
    shipping.label = "Shipping +3 weeks"
    suffix = " (today's news)"
    news.label = _case_label(news, word)[: 40 - len(suffix)] + suffix
    return [c.clamp() for c in (mild, news, severe, shipping)]


# --------------------------------------------------------------------------------------
# Random streams (common random numbers per path)
# --------------------------------------------------------------------------------------


def _streams(seed: int, start: int, n: int, horizon: int) -> dict[str, np.ndarray]:
    """Per-path streams from default_rng([seed, r]) (as montecarlo._pregenerate_crn_streams).

    Path r draws the same numbers whatever the chunking, so a cell run alone equals the grid cell.
    The shock size is one draw per path: one future, one magnitude. So is the price-sensitivity
    multiplier, drawn last so the earlier streams don't shift (P2b).
    """
    noise = np.empty((n, horizon))
    jitter = np.empty((n, horizon), dtype=np.int64)
    scale = np.empty(n)
    rival = np.empty(n)
    alpha_mult = np.empty(n)
    for i in range(n):
        rng = np.random.default_rng([int(seed), start + i])
        noise[i] = rng.lognormal(0.0, _DEMAND_NOISE_SIGMA, size=horizon)
        jitter[i] = rng.integers(-1, 2, size=horizon)
        scale[i] = rng.uniform(*_SHOCK_SCALE)
        rival[i] = rng.uniform(*_RIVAL_STOCK_WEEKS)
        alpha_mult[i] = rng.lognormal(0.0, _ALPHA_MULT_SIGMA)
    return {"noise": noise, "jitter": jitter, "scale": scale, "rival_weeks": rival, "alpha_mult": alpha_mult}


# --------------------------------------------------------------------------------------
# Crowd sentiment
# --------------------------------------------------------------------------------------


def _sent_term(cal: Calibration, crowd: CrowdSentiment | Mapping[str, Any] | None) -> np.ndarray:
    """delta x clip(mu) laid out (2, 12). None = neutral. sigma is ignored, as in montecarlo."""
    if crowd is None:
        return np.zeros((2, N_ARCHETYPES))
    mu = crowd.mu if isinstance(crowd, CrowdSentiment) else crowd.get("mu", 0.0)
    mu_arr = np.broadcast_to(np.asarray(mu, dtype=np.float64), (N_ARCHETYPES, 2))
    return np.ascontiguousarray(float(cal.params.delta) * np.clip(mu_arr, -1.0, 1.0).T)


def _crowd_for(crowd: Mapping[str, Any] | None, name: str) -> Any:
    if not crowd:
        return None
    return crowd.get(name)


# --------------------------------------------------------------------------------------
# Core simulation
# --------------------------------------------------------------------------------------


def _simulate(
    cal: Calibration,
    plans: Sequence[PlanSpec],
    sents: Sequence[np.ndarray],
    shock: ShockCase,
    streams: Mapping[str, np.ndarray],
    variants: Sequence[bool],
    horizon: int,
    record: bool = False,
) -> dict[str, Any]:
    """Run every (variant, plan, path) row for one shock column, looping over weeks only.

    Row layout: row = (v * P + p) * n + r. `variants` holds the steady-rival flag per variant.
    Returns firm-A arrays of shape (T, S) for price, sales, unit cost, marketing, holding and order
    payments; with `record=True`, also every per-week (S, 2) quantity the replay needs.
    Follows SPEC §4.7's tick order with the planner changes of §15.4.
    """
    prm = cal.params
    T = int(horizon)
    P, V, n = len(plans), len(variants), int(streams["noise"].shape[0])
    S = V * P * n
    init = cal.init

    def per_row(values: Sequence[Any], dtype: Any = np.float64) -> np.ndarray:
        return np.tile(np.repeat(np.asarray(values, dtype=dtype), n), V)

    plan_idx = per_row(range(P), np.int64)
    price_mult = per_row([1.0 + p.price_change_pct / 100.0 for p in plans])
    price_week = per_row([p.price_change_week for p in plans], np.int64)
    # 24 means "to the end", whatever the horizon, so a plan without an end behaves exactly as before.
    price_end = per_row([p.price_end_week if p.price_end_week < END_OF_HORIZON else 1 << 30 for p in plans], np.int64)
    extra_qty = per_row([p.extra_stock_weeks * cal.d0 for p in plans])
    stock_week = per_row([p.stock_week if p.extra_stock_weeks > 0 else -1 for p in plans], np.int64)
    mkt_mult = per_row([1.0 + p.marketing_change_pct / 100.0 for p in plans])
    switch = per_row([p.switch_supplier for p in plans], bool)
    textbook = per_row([p.is_textbook for p in plans], bool)
    sent_start = per_row([fw if (fw := p.first_change_week()) is not None else T + 1 for p in plans], np.int64)
    alt_exposure = np.where(switch, per_row([p.alt_shock_exposure for p in plans]), 1.0)
    cost_mult_a = np.where(switch, per_row([1.0 + p.alt_cost_change_pct / 100.0 for p in plans]), 1.0)
    base_lead_a = np.where(switch, per_row([p.alt_lead_time_weeks for p in plans], np.int64), prm.lead_time0)
    sent_rows = np.stack(list(sents))[plan_idx]  # (S, 2, 12)
    steady = np.repeat(np.asarray(variants, dtype=bool), P * n)
    any_steady = bool(steady.any())

    noise = np.tile(streams["noise"], (V * P, 1))
    jitter = np.tile(streams["jitter"], (V * P, 1))
    scale = np.tile(streams["scale"], V * P)
    rival_weeks = np.tile(streams["rival_weeks"], V * P)

    alpha_arch, loyalty_t, counts = _arch_arrays(cal.archetypes)
    alpha = np.tile(streams["alpha_mult"], V * P)[:, None] * alpha_arch[None, :]  # (S, 12)
    c0, d0 = float(prm.c_raw0), cal.d0
    exposed = float(init["exposed_cost_share"])
    k_cap = np.asarray(prm.k_cap, dtype=np.float64)
    m0 = float(init["marketing"])
    own_markup, rival_markup, anchor = float(init["own_markup"]), cal.rival_markup, float(init["rival_anchor"])
    n_cons = float(prm.n_consumers)
    h, z, mult = float(prm.holding_cost), float(prm.z_alpha), float(prm.order_up_to_mult)

    dc, dsh = shock.delta_c_raw, shock.demand_shock
    path = np.asarray(shock.cost_path, dtype=np.float64) if shock.cost_path else None
    dlead_b = np.rint(shock.delta_lead_time * scale).astype(np.int64)
    dlead_a = np.rint(shock.delta_lead_time * scale * alt_exposure).astype(np.int64)
    exp_a = exposed * alt_exposure  # the alternative supplier only feels part of the news (§15.4)

    # state
    beta0 = np.tile(np.asarray(prm.beta_bar, dtype=np.float64), (S, 1))
    inv = np.full((S, 2), d0)
    raw = np.column_stack([np.full(S, float(init["raw_a"])), rival_weeks * d0])
    raw_val = raw * c0
    fg_val = inv * c0
    width = T + _PIPE_PAD
    pipe_q = np.zeros((S, width, 2))
    pipe_v = np.zeros((S, width, 2))
    # Orders already on the way at week 0: a business that orders every week has one week's demand
    # arriving in each of weeks 1 .. L-1, so stock on hand + in transit covers the lead time.
    for j in range(2):
        pipe_q[:, 1 : prm.lead_time0, j] = float(init["demand"][j])
    pipe_v = pipe_q * c0
    pipe_total = pipe_q.sum(axis=1)
    extra_transit = np.zeros(S)
    extra_arrival = np.full(S, -1, dtype=np.int64)
    extra_left = np.zeros(S)  # units of the one-off extra order not yet used in production
    extra_cost = np.zeros(S)  # what each of those units cost when it was ordered
    ring = np.empty((8, S, 2))
    ring[:] = np.asarray(init["demand"], dtype=np.float64)
    above = np.zeros(S, dtype=np.int64)
    rows = np.arange(S)
    mkt = np.column_stack([m0 * mkt_mult, np.full(S, m0)])
    mkt_b_only = np.full(S, m0)
    # Replay only: units bought at the pre-shock cost, followed through raw stock, finished goods and
    # the pipeline in proportion (the pools are weighted-average, so old and new units mix evenly).
    if record:
        raw_old, fg_old, pipe_old = raw.copy(), inv.copy(), pipe_q.copy()

    out = {k: np.empty((T, S)) for k in ("price", "sales", "cost", "marketing", "holding", "paid", "extra_val")}
    trace: dict[str, list[Any]] = {}

    for t in range(T):
        lvl = _ramp(t, shock.onset_week, shock.ramp_weeks)
        on = 1 if t >= shock.onset_week else 0

        # 1. Receive orders arriving this week
        arr_q, arr_v = pipe_q[:, t, :], pipe_v[:, t, :]
        raw = raw + arr_q
        raw_val = raw_val + arr_v
        pipe_total = np.maximum(pipe_total - arr_q, 0.0)
        extra_transit = np.where(extra_arrival == t, 0.0, extra_transit)
        # A real cost path replaces the ramp and the per-path shock size: it really happened, so it is the
        # same on every path (B1). The last value holds for any later week.
        dc_t = None if path is None else float(path[min(t, path.shape[0] - 1)])
        pre_shock = (dc_t == 0.0) if path is not None else (lvl == 0.0 or dc == 0.0)  # orders now are at the old cost
        if record:
            raw_old = raw_old + pipe_old[:, t, :]

        # 2. Active shock: spot order costs, lead times, demand multipliers
        if dc_t is None:
            spot_b = c0 * np.maximum(_cost_factor(exposed, dc * scale, lvl), 0.01)
            spot_a = c0 * cost_mult_a * np.maximum(_cost_factor(exp_a, dc * scale, lvl), 0.01)
        else:
            spot_b = np.full(S, c0 * max(1.0 + exposed * dc_t, 0.01))
            spot_a = c0 * cost_mult_a * np.maximum(1.0 + exp_a * dc_t, 0.01)
        spot = np.column_stack([spot_a, spot_b])
        lead_hat = np.column_stack(
            [np.maximum(1, base_lead_a + on * dlead_a), np.maximum(1, prm.lead_time0 + on * dlead_b)]
        )
        lt_a = np.maximum(1, lead_hat[:, 0] + jitter[:, t])
        lt_b = np.maximum(1, lead_hat[:, 1] + jitter[:, t])
        dem_mult = noise[:, t] * np.maximum(0.0, 1.0 + on * dsh * scale)
        share_mult = 1.0 - shock.share_shift_pct / 100.0 * lvl

        # Prices: yours from the plan; the rival keeps its markup and follows your cuts (§15.4)
        units = raw + inv
        wac = np.where(units > _EPS, (raw_val + fg_val) / np.maximum(units, _EPS), spot)
        p_a = np.where((t >= price_week) & (t < price_end), _ENGINE_PRICE * price_mult, _ENGINE_PRICE)
        p_a = np.where(textbook, wac[:, 0] * (1.0 + own_markup), p_a)
        rule_b = wac[:, 1] * (1.0 + rival_markup)
        # `anchor` keeps a pricier rival at its usual premium; it is 1 when the rival starts cheaper.
        above = np.where(rule_b > _RIVAL_GAP * anchor * p_a, above + 1, 0)
        follow = above > _RIVAL_PATIENCE
        p_b = np.where(follow, np.maximum(_RIVAL_FOLLOW * anchor * p_a, wac[:, 1]), rule_b)
        if on and shock.rival_price_change_pct:
            p_b = p_b * (1.0 + shock.rival_price_change_pct / 100.0)
        price = np.column_stack([p_a, p_b])

        # 3. Produce: plan = 4-week MA of own demand + 10% (§15.4), less finished stock above one week
        #    of cover. Without that deduction finished goods pile up and raw usage runs 10% above
        #    demand, which the §4.5 reorder point (built on demand) does not expect.
        ma4 = (ring[(t - 1) % 8] + ring[(t - 2) % 8] + ring[(t - 3) % 8] + ring[(t - 4) % 8]) / 4.0
        plan_q = np.clip(_PLAN_BUFFER * ma4 - np.maximum(inv - ma4, 0.0), 0.0, k_cap)
        if any_steady:  # a rival who never runs out: top up its raw stock at spot cost
            need = np.where(steady, np.maximum(plan_q[:, 1] - raw[:, 1], 0.0), 0.0)
            raw[:, 1] += need
            raw_val[:, 1] += need * spot_b
            if record and pre_shock:
                raw_old[:, 1] += need
        qty = np.maximum(np.minimum(plan_q, raw), 0.0)
        # Once it has arrived, production draws on the extra stock first (cash tied up, §15.5.2).
        landed = (extra_arrival >= 0) & (t >= extra_arrival)
        extra_left = extra_left - np.where(landed, np.minimum(extra_left, qty[:, 0]), 0.0)
        wac_raw = np.where(raw > _EPS, raw_val / np.maximum(raw, _EPS), spot)
        if record:
            moved = qty * np.where(raw > _EPS, raw_old / np.maximum(raw, _EPS), 0.0)
            raw_old = np.maximum(raw_old - moved, 0.0)
            fg_old = fg_old + moved
        raw = np.maximum(raw - qty, 0.0)
        raw_val = np.where(raw > _EPS, np.maximum(raw_val - qty * wac_raw, 0.0), 0.0)
        fg_val = fg_val + qty * wac_raw
        inv = inv + qty

        # 4. Choice: expected MNL demand per archetype, times this week's noise
        sent = sent_rows * (t >= sent_start)[:, None, None]
        probs = _choice_probs(price, mkt, beta0, sent, alpha, loyalty_t, float(prm.gamma), float(prm.p_ref))
        exp_dem = (probs * counts).sum(-1)
        demand = exp_dem * dem_mult[:, None]
        demand[:, 0] *= share_mult  # customers lost to a new player leave the market
        total = demand.sum(-1)
        demand *= np.where(total > n_cons, n_cons / np.maximum(total, _EPS), 1.0)[:, None]

        # 5. Clear with spillover
        avail = inv
        if any_steady:
            avail = inv.copy()
            avail[:, 1] = np.where(steady, np.inf, inv[:, 1])
        cleared = clear_market(demand, avail, prm.theta)
        sales = np.asarray(cleared["sales"])
        unmet = np.asarray(cleared["unmet"])

        # 6. Profit: material on units sold at the finished goods' weighted-average cost
        unit_cost = np.where(inv > _EPS, fg_val / np.maximum(inv, _EPS), wac_raw)
        sold = np.minimum(sales, inv)
        if record:
            fg_old = np.maximum(fg_old - sold * np.where(inv > _EPS, fg_old / np.maximum(inv, _EPS), 0.0), 0.0)
        inv = np.maximum(inv - sales, 0.0)
        fg_val = np.where(inv > _EPS, np.maximum(fg_val - unit_cost * sold, 0.0), 0.0)
        holding = h * (inv + raw)

        out["price"][t] = p_a
        out["sales"][t] = sales[:, 0]
        out["cost"][t] = unit_cost[:, 0]
        out["marketing"][t] = mkt[:, 0]
        out["holding"][t] = holding[:, 0]

        # 7. Goodwill
        beta0 = update_goodwill(beta0, unmet, demand, prm)

        # 8. Replenish: (s,S) with omega = 0 on the expected lead time, its safety stock also covering
        #    the lead-time jitter (sd of demand over the lead time = sqrt(L sd^2 + mu^2 var_L); it is
        #    §4.5's z sd sqrt(L) when there is no jitter). Plus the one-off extra order, kept outside
        #    the (s,S) position while in transit so it is truly extra; once it arrives it is stock.
        ring[t % 8] = demand
        mu = ring.mean(axis=0)
        sd = np.maximum(ring.std(axis=0, ddof=1), _SD_FLOOR * mu)
        lt = lead_hat.astype(np.float64)
        rop = np.maximum(mu * lt + z * np.sqrt(np.square(sd) * lt + np.square(mu) * _LEAD_VAR), 0.0)
        position = raw + pipe_total
        position[:, 0] -= extra_transit
        orders = np.where(position <= rop, np.maximum(mult * rop - position, 0.0), 0.0)
        extra_now = np.where(stock_week == t, extra_qty, 0.0)
        orders[:, 0] += extra_now
        extra_transit = extra_transit + extra_now
        extra_arrival = np.where(extra_now > 0.0, t + lt_a, extra_arrival)
        extra_cost = np.where(extra_now > 0.0, spot_a, extra_cost)
        extra_left = extra_left + extra_now
        arr_a = np.minimum(t + lt_a, width - 1)
        arr_b = np.minimum(t + lt_b, width - 1)
        pipe_q[rows, arr_a, 0] += orders[:, 0]
        pipe_v[rows, arr_a, 0] += orders[:, 0] * spot_a
        pipe_q[rows, arr_b, 1] += orders[:, 1]
        pipe_v[rows, arr_b, 1] += orders[:, 1] * spot_b
        if record and pre_shock:
            pipe_old[rows, arr_a, 0] += orders[:, 0]
            pipe_old[rows, arr_b, 1] += orders[:, 1]
        pipe_total = pipe_total + orders
        out["paid"][t] = orders[:, 0] * spot_a
        out["extra_val"][t] = extra_left * extra_cost

        if record:
            ma4_now = (ring[t % 8] + ring[(t - 1) % 8] + ring[(t - 2) % 8] + ring[(t - 3) % 8]) / 4.0
            share_ab = (probs * counts).sum(-1) / n_cons
            profit = price * sales - unit_cost * sales - np.column_stack([mkt[:, 0], mkt_b_only]) - holding
            snap = {
                "price": price, "qty": qty, "demand": demand, "sales": sales, "unmet": unmet,
                "spill_in": np.asarray(cleared["spill_in"]), "lost": np.asarray(cleared["lost"]),
                "inventory": inv, "raw_inv": raw, "rop": rop, "orders": orders, "profit": profit,
                "shares": np.column_stack([1.0 - share_ab.sum(-1), share_ab]),
                "c_raw": spot_a, "lead_time": lt_a, "unit_cost": unit_cost,
                "cover_weeks": (raw + inv) / np.maximum(ma4_now, _EPS),
                "in_transit": pipe_total, "probs": probs, "exp_dem": exp_dem, "follow": follow,
                "extra_now": extra_now, "extra_arrival": extra_arrival,
                "old_cost_share": np.clip((raw_old + fg_old) / np.maximum(raw + inv, _EPS), 0.0, 1.0)
                * (raw + inv > _EPS),
                "spot_cost": spot,
            }
            for key, val in snap.items():
                trace.setdefault(key, []).append(np.array(val, copy=True))

    result: dict[str, Any] = {"T": T, "V": V, "P": P, "n": n, **out}
    if record:
        result["trace"] = {k: np.stack(v) for k, v in trace.items()}
    return result


# --------------------------------------------------------------------------------------
# Cell statistics (SPEC §15.5.2)
# --------------------------------------------------------------------------------------


def _block(sim: Mapping[str, Any], key: str, v: int, p: int) -> np.ndarray:
    """Firm-A weekly values for one (variant, plan) block as a contiguous (n, T) array."""
    P, n = sim["P"], sim["n"]
    lo = (v * P + p) * n
    return np.ascontiguousarray(sim[key][:, lo : lo + n].T)


def _path_metrics(sim: Mapping[str, Any], p: int, steady: bool) -> dict[str, np.ndarray]:
    """Per-path pieces of the cell for plan p vs "Do nothing" (plan 0), in engine money."""
    blk = {k: (_block(sim, k, 0, p), _block(sim, k, 0, 0)) for k in ("price", "sales", "cost", "marketing",
                                                                     "holding", "extra_val")}
    (pp, pb), (qp, qb), (cp, cb) = blk["price"], blk["sales"], blk["cost"]
    (mp, mb), (hp, hb), (xp, xb) = blk["marketing"], blk["holding"], blk["extra_val"]
    weekly_p = pp * qp - cp * qp - mp - hp
    weekly_b = pb * qb - cb * qb - mb - hb
    profit_p, profit_b = weekly_p.sum(-1), weekly_b.sum(-1)
    # Cash vs do nothing (§15.5.2): the profit gap so far, less the one-off extra stock still unused.
    # Not raw-order payments: the (s,S) batches are weeks of stock each, so a plan that moves demand
    # a few percent shifts a whole batch by a week and the cash gap swings by that batch.
    res = {
        "delta": profit_p - profit_b,
        "profit_p": profit_p,
        "profit_b": profit_b,
        "cost": ((cb - cp) * qp).sum(-1),
        "price": ((pp - pb) * qp).sum(-1),
        "volume": ((pb - cb) * (qp - qb)).sum(-1),
        "marketing": (mb - mp).sum(-1),
        "holding": (hb - hp).sum(-1),
        "cum_cash": np.cumsum(weekly_p - weekly_b, axis=-1) - (xp - xb),
    }
    if steady:
        sp = (_block(sim, k, 1, p) for k in ("price", "sales", "cost", "marketing", "holding"))
        sb = (_block(sim, k, 1, 0) for k in ("price", "sales", "cost", "marketing", "holding"))
        (spp, sqp, scp, smp, shp), (spb, sqb, scb, smb, shb) = tuple(sp), tuple(sb)
        res["steady_delta"] = (spp * sqp - scp * sqp - smp - shp).sum(-1) - (
            spb * sqb - scb * sqb - smb - shb
        ).sum(-1)
    return res


def _cell_stats(
    cal: Calibration, plan: PlanSpec, shock: ShockCase, parts: Mapping[str, np.ndarray]
) -> dict[str, Any]:
    usd = cal.usd
    delta = parts["delta"] * usd
    mean_cum = parts["cum_cash"].mean(axis=0) * usd
    low = int(np.argmin(mean_cum))
    peak = -float(mean_cum[low]) if mean_cum[low] < -_TOL_USD else 0.0
    payback = next((w for w in range(low, mean_cum.shape[0]) if mean_cum[w] >= -_TOL_USD), None)
    cash_available = float(cal.profile.get("cash_available", 0.0) or 0.0)
    steady = parts.get("steady_delta")
    return {
        "plan_name": plan.name,
        "shock_id": shock.id,
        "n": int(delta.shape[0]),
        "mean_delta_usd": float(delta.mean()),
        # the same plan with neutral shoppers: what the engine alone says (SPEC §15.5, 2026-10-22)
        "engine_only_delta_usd": float(parts.get("engine_delta", parts["delta"]).mean() * usd),
        "p5_delta_usd": float(np.percentile(delta, 5)),
        "p_better": float(np.mean(delta > _TOL_USD)),
        "mean_profit_usd": float(parts["profit_p"].mean() * usd),
        "bridge": {
            "cost_usd": float(parts["cost"].mean() * usd),
            "price_usd": float(parts["price"].mean() * usd),
            "volume_usd": float(parts["volume"].mean() * usd),
            "marketing_usd": float(parts["marketing"].mean() * usd),
            "holding_usd": float(parts["holding"].mean() * usd),
        },
        "steady_rival_delta_usd": float(steady.mean() * usd) if steady is not None else None,
        "peak_cash_usd": peak,
        "payback_week": payback,
        "over_cash": bool(cash_available > 0.0 and peak > cash_available),
    }


def _run_column(
    cal: Calibration,
    plans: Sequence[PlanSpec],
    shock: ShockCase,
    crowd: Mapping[str, Any] | None,
    horizon: int,
    n_paths: int,
    seed: int,
    steady_rival: bool,
) -> list[dict[str, np.ndarray]]:
    """Per-path metrics for plans[1:] vs plans[0] ("Do nothing") in one column, chunked over paths.

    A plan whose shoppers reacted also runs as an "engine only" twin with neutral shoppers, on the same streams;
    its per-path delta comes back as `engine_delta` (for a plan with no reaction it equals `delta`)."""
    sents = [
        np.zeros((2, N_ARCHETYPES)) if i == 0 else _sent_term(cal, _crowd_for(crowd, p.name))
        for i, p in enumerate(plans)
    ]
    twins = [i for i in range(1, len(plans)) if np.any(sents[i])]
    run_plans = [*plans, *(plans[i] for i in twins)]
    run_sents = [*sents, *(np.zeros((2, N_ARCHETYPES)) for _ in twins)]
    variants = (False, True) if steady_rival else (False,)
    chunks: list[list[dict[str, np.ndarray]]] = []
    for start in range(0, n_paths, _CHUNK_PATHS):
        n = min(_CHUNK_PATHS, n_paths - start)
        sim = _simulate(cal, run_plans, run_sents, shock, _streams(seed, start, n, horizon), variants, horizon)
        chunks.append([_path_metrics(sim, p, steady_rival) for p in range(len(run_plans))])
    parts = [
        {k: np.concatenate([c[p][k] for c in chunks], axis=0) for k in chunks[0][p]}
        for p in range(len(run_plans))
    ]
    out = parts[: len(plans)]
    for p in out:
        p["engine_delta"] = p["delta"]
    for j, i in enumerate(twins):
        out[i]["engine_delta"] = parts[len(plans) + j]["delta"]
    return out


def _coerce_crowd_map(crowd: Mapping[str, Any] | None) -> dict[str, Any]:
    return dict(crowd) if crowd else {}


def evaluate_grid(
    cal: Calibration,
    plans: Sequence[PlanSpec | Mapping[str, Any]],
    shocks: Sequence[ShockCase | Mapping[str, Any]],
    crowd: Mapping[str, Any] | None = None,
    horizon: int = 24,
    n_paths: int = 1000,
    seed: int = 0,
    steady_rival: bool = True,
) -> dict[str, Any]:
    """Test every plan against every shock column, scored against "Do nothing" (SPEC §15.5).

    `crowd` maps plan name -> CrowdSentiment (or {mu, sigma}); a missing name is neutral.
    "Do nothing" is always simulated as the reference and is left out of `cells` and the labels
    (they name "Do nothing" only when no other plan was passed).
    """
    others = [p for p in (_as_plan(x) for x in plans) if p.name != DO_NOTHING]
    all_plans = [PlanSpec.do_nothing(), *others]
    cases = [_as_shock(s) for s in shocks]
    crowd_map = _coerce_crowd_map(crowd)
    cells: list[dict[str, Any]] = []
    by_plan: dict[int, dict[str, dict[str, Any]]] = {i: {} for i in range(1, len(all_plans))}
    baseline: dict[str, float] = {}
    for case in cases:
        parts = _run_column(cal, all_plans, case, crowd_map, horizon, n_paths, seed, steady_rival)
        baseline[case.id] = float(parts[0]["profit_b"].mean() * cal.usd)
        for i in range(1, len(all_plans)):
            by_plan[i][case.id] = _cell_stats(cal, all_plans[i], case, parts[i])
    for i in range(1, len(all_plans)):
        cells.extend(by_plan[i][c.id] for c in cases)
    best_today, safest = _labels(all_plans, cases, by_plan)
    return {"cells": cells, "baseline_profit_usd": baseline, "best_today": best_today, "safest": safest}


def _labels(
    plans: Sequence[PlanSpec],
    cases: Sequence[ShockCase],
    by_plan: Mapping[int, Mapping[str, Mapping[str, Any]]],
) -> tuple[str, str]:
    """best_today and safest (SPEC §15.5.2) over plans[1:]. Ties go to the earlier plan."""
    if not cases or len(plans) < 2:
        return DO_NOTHING, DO_NOTHING
    news_id = next((c.id for c in cases if c.id == "news"), cases[0].id)
    safe_ids = [c.id for c in cases if c.likelihood != "unlikely"] or [c.id for c in cases]

    def cell(i: int, cid: str) -> Mapping[str, Any]:
        return by_plan[i][cid]

    idx = range(1, len(plans))
    best_pool = [i for i in idx if not cell(i, news_id)["over_cash"]] or list(idx)
    best = max(best_pool, key=lambda i: (cell(i, news_id)["mean_delta_usd"], -i))
    safe_pool = [i for i in idx if not any(cell(i, c)["over_cash"] for c in safe_ids)] or list(idx)
    safe = max(safe_pool, key=lambda i: (min(cell(i, c)["p5_delta_usd"] for c in safe_ids), -i))
    return plans[best].name, plans[safe].name


def evaluate_cell(
    cal: Calibration,
    plan: PlanSpec | Mapping[str, Any],
    shock: ShockCase | Mapping[str, Any],
    crowd: CrowdSentiment | Mapping[str, Any] | None = None,
    horizon: int = 24,
    n_paths: int = 1000,
    seed: int = 0,
    steady_rival: bool = True,
) -> dict[str, Any]:
    """One cell (for a user-added plan). Same numbers as that cell inside `evaluate_grid`.

    `crowd` is this plan's sentiment, or a plan-name map like `evaluate_grid` takes.
    """
    spec, case = _as_plan(plan), _as_shock(shock)
    if isinstance(crowd, CrowdSentiment) or (isinstance(crowd, Mapping) and "mu" in crowd):
        crowd = {spec.name: crowd}
    parts = _run_column(
        cal, [PlanSpec.do_nothing(), spec], case, _coerce_crowd_map(crowd), horizon, n_paths, seed, steady_rival
    )
    return _cell_stats(cal, spec, case, parts[1])


# --------------------------------------------------------------------------------------
# Replay of one cell (SPEC §15.9)
# --------------------------------------------------------------------------------------


def _words(text: str, limit: int = 14) -> str:
    parts = text.split()
    return " ".join(parts[:limit])


def _synth_choices(cal: Calibration, probs: np.ndarray, exp_dem: np.ndarray, sales: np.ndarray) -> list[int]:
    """Per-consumer choices from archetype counts, in a fixed order (SPEC §15.9).

    Within each archetype the first consumers buy from A, the next from B, the rest buy nothing,
    so a consumer index always keeps its archetype. Buyer counts follow realised sales.
    """
    arch = np.asarray(cal.archetypes.consumer_archetype, dtype=np.int64)
    _, _, counts = _arch_arrays(cal.archetypes)
    ratio = np.where(exp_dem > _EPS, sales / np.maximum(exp_dem, _EPS), 0.0)  # (2,)
    buyers = np.rint(counts[None, :] * probs * ratio[:, None]).astype(np.int64)  # (2, 12)
    buyers = np.clip(buyers, 0, counts.astype(np.int64)[None, :])
    choices = np.zeros(arch.shape[0], dtype=np.int8)
    for k in range(N_ARCHETYPES):
        members = np.flatnonzero(arch == k)
        n_a = int(buyers[0, k])
        n_b = int(min(buyers[1, k], members.shape[0] - n_a))
        choices[members[:n_a]] = 1
        choices[members[n_a : n_a + n_b]] = 2
    return choices.tolist()


def _round(x: Any, nd: int = 2) -> Any:
    if isinstance(x, np.ndarray):
        return [round(float(v), nd) for v in x.ravel()]
    return round(float(x), nd)


def simulate_detail(
    cal: Calibration,
    plan: PlanSpec | Mapping[str, Any],
    shock: ShockCase | Mapping[str, Any],
    crowd: CrowdSentiment | Mapping[str, Any] | None = None,
    horizon: int = 24,
    seed: int = 0,
) -> dict[str, Any]:
    """One path, week by week: U1 = the plan, U2 = "Do nothing", same streams (SPEC §15.9).

    Each week's tick dicts carry every `tick` key of docs/EVENTS.md except `choices_b64` (U1 has
    `choices` instead), in USD and real units, plus the v2.1 keys and the P2b keys `old_cost_share`
    (share of raw + finished stock bought at the pre-shock cost, 0-1) and `spot_cost` (today's
    purchase price per unit, USD) for the two-colour stock bar.
    """
    spec, case = _as_plan(plan), _as_shock(shock)
    if isinstance(crowd, Mapping) and "mu" not in crowd:
        crowd = crowd.get(spec.name)
    sents = [_sent_term(cal, crowd), np.zeros((2, N_ARCHETYPES))]
    sim = _simulate(
        cal, [spec, PlanSpec.do_nothing()], sents, case, _streams(seed, 0, 1, horizon), (False,), horizon,
        record=True,
    )
    tr = sim["trace"]
    k_p, k_q, usd = cal.k_p, cal.k_q, cal.usd
    cum_profit = np.cumsum(tr["profit"], axis=0)
    cum_cash = np.cumsum(tr["profit"][:, 0, 0] - tr["profit"][:, 1, 0]) - (sim["extra_val"][:, 0] - sim["extra_val"][:, 1])
    weeks: list[dict[str, Any]] = []
    for t in range(horizon):
        week: dict[str, Any] = {}
        for row, name in ((0, "U1"), (1, "U2")):
            demand_hist = [tr["demand"][s, row] for s in range(t + 1)]
            order_hist = [tr["orders"][s, row] for s in range(t + 1)]
            bw = bullwhip_ratio(order_hist, demand_hist)
            tick: dict[str, Any] = {
                "tick": t,
                "universe": name,
                "price": _round(tr["price"][t, row] * k_p),
                "qty": _round(tr["qty"][t, row] * k_q),
                "demand": _round(tr["demand"][t, row] * k_q),
                "sales": _round(tr["sales"][t, row] * k_q),
                "unmet": _round(tr["unmet"][t, row] * k_q),
                "spill_in": _round(tr["spill_in"][t, row] * k_q),
                "lost": _round(tr["lost"][t, row] * k_q),
                "inventory": _round(tr["inventory"][t, row] * k_q),
                "raw_inv": _round(tr["raw_inv"][t, row] * k_q),
                "rop": _round(tr["rop"][t, row] * k_q),
                "orders": _round(tr["orders"][t, row] * k_q),
                "profit": _round(tr["profit"][t, row] * usd),
                "cum_profit": _round(cum_profit[t, row] * usd),
                "shares": _round(tr["shares"][t, row], 4),
                "c_raw": _round(tr["c_raw"][t, row] * k_p),
                "lead_time": int(tr["lead_time"][t, row]),
                "mc": _round(tr["unit_cost"][t, row] * k_p),
                "atc": _round(tr["unit_cost"][t, row] * k_p),
                "bullwhip": [None if b is None else round(b, 3) for b in bw],
                "unit_cost": _round(tr["unit_cost"][t, row] * k_p),
                "cover_weeks": _round(tr["cover_weeks"][t, row]),
                "in_transit": _round(tr["in_transit"][t, row] * k_q),
                "old_cost_share": _round(tr["old_cost_share"][t, row], 4),
                "spot_cost": _round(tr["spot_cost"][t, row] * k_p),
            }
            if row == 0:
                tick["cum_cash_delta"] = _round(cum_cash[t] * usd)
                tick["choices"] = _synth_choices(
                    cal, tr["probs"][t, 0], tr["exp_dem"][t, 0], tr["sales"][t, 0]
                )
            week[name] = tick
        weeks.append(week)
    return {
        "weeks": weeks,
        "markers": _markers(cal, spec, case, tr, horizon),
        "n_consumers": int(cal.params.n_consumers),
    }


def _path_markers(path: Sequence[float], adjective: str, add: Any) -> None:
    """Markers for a real cost path (B1): costs start moving, the peak, and a fall of 10+ points from it."""
    vals = np.asarray(path, dtype=np.float64)
    name = "Input" if adjective == "Your" else adjective
    start = next((t for t, v in enumerate(vals) if abs(v) >= _PATH_START), None)
    if start is None:
        return
    add(start, "shock", None, f"{name} costs start {'rising' if vals[start] > 0 else 'falling'}")
    peak_week, peak = _path_peak(vals)
    if peak > 0 and peak_week < len(vals) - 1:  # a path still climbing at the end has no peak to show
        add(peak_week, "shock", None, f"{name} price peaks: {_pct(peak)}")
        fall = next((t for t in range(peak_week + 1, len(vals)) if vals[t] <= peak - _PATH_FALL), None)
        if fall is not None:
            add(fall, "shock", None, f"{name} price falls back to {_pct(float(vals[fall]))}")


def _markers(
    cal: Calibration, plan: PlanSpec, case: ShockCase, tr: Mapping[str, np.ndarray], horizon: int
) -> list[dict[str, Any]]:
    """Timeline pins for the replay, from the plan universe (row 0). Texts are <= 14 words."""
    prof = cal.profile
    rival = str(prof.get("rival_name") or "Your rival")
    _, adjective = _input_word(prof)
    marks: list[dict[str, Any]] = []

    def add(week: int, kind: str, firm: str | None, text: str) -> None:
        if 0 <= week < horizon:
            marks.append({"week": int(week), "kind": kind, "firm": firm, "text": _words(text)})

    onset = case.onset_week
    if case.cost_path:
        _path_markers(case.cost_path, adjective, add)
    elif case.delta_c_raw:
        add(onset, "shock", None, f"{adjective} costs start {'rising' if case.delta_c_raw > 0 else 'falling'}")
    if case.delta_lead_time:
        n = abs(case.delta_lead_time)
        verb = "slow down" if case.delta_lead_time > 0 else "speed up"
        add(onset, "shock", None, f"Deliveries {verb} by {n} week{'s' if n != 1 else ''}")
    if case.demand_shock:
        add(onset, "shock", None, f"Market demand {'rises' if case.demand_shock > 0 else 'falls'} "
                                  f"{abs(round(case.demand_shock * 100))}%")
    if case.rival_price_change_pct:
        pct = abs(round(case.rival_price_change_pct))
        verb = "cuts" if case.rival_price_change_pct < 0 else "raises"
        add(onset, "rival_price", "B", f"{rival} {verb} its prices {pct}%")
    if case.share_shift_pct > 0:
        add(onset, "new_player", None, f"A new player starts winning {round(case.share_shift_pct)}% "
                                       "of your customers")
    if plan.is_textbook:
        add(0, "price_change", "A", "Your price now follows your cost plus your usual markup")
    elif plan.price_change_pct:
        verb = "raise" if plan.price_change_pct > 0 else "cut"
        add(plan.price_change_week, "price_change", "A",
            f"You {verb} your price {abs(round(plan.price_change_pct, 1)):g}%")
    if plan.extra_stock_weeks > 0:
        worth = f"{plan.extra_stock_weeks:g} week{'s' if plan.extra_stock_weeks != 1 else ''}' worth"
        add(plan.stock_week, "stock_ordered", "A", f"Extra stock ordered ({worth})")
        arrival = int(tr["extra_arrival"][-1, 0])
        if arrival >= 0:
            add(arrival, "stock_arrives", "A", f"Extra stock arrives ({worth})")
    if plan.has_surcharge_end and not plan.is_textbook:
        what = "Surcharge" if plan.price_change_pct > 0 else "Discount"
        add(plan.price_end_week, "price_change", "A",
            f"{what} ends, price back to ${float(prof['price']):.2f}")
    sold_out = tr["unmet"][:, 0, :] > _SOLD_OUT_FRAC * np.maximum(tr["demand"][:, 0, :], _EPS)
    follow = tr["follow"][:, 0]
    for t in range(horizon):
        for j, firm in enumerate(("A", "B")):
            if sold_out[t, j] and (t == 0 or not sold_out[t - 1, j]):
                add(t, "sold_out", firm, "You sold out" if j == 0 else f"{rival} sold out")
        if follow[t] and (t == 0 or not follow[t - 1]):
            add(t, "rival_move", "B", f"{rival} moves its price to follow yours")
    marks.sort(key=lambda m: m["week"])
    return marks


# --------------------------------------------------------------------------------------
# Serverless Job entry point
# --------------------------------------------------------------------------------------


def run_job(job: Mapping[str, Any], n_paths: int) -> dict[str, Any]:
    """Run a grid from a JSON job: {profile, plans, shocks, crowd: {name: {mu, sigma}}, seed}."""
    seed = int(job.get("seed", 0))
    cal = calibrate(job["profile"], seed=seed)
    return evaluate_grid(
        cal,
        [PlanSpec.from_dict(p) for p in job.get("plans", [])],
        [ShockCase.from_dict(s) for s in job.get("shocks", [])],
        crowd=job.get("crowd") or {},
        horizon=int(job.get("horizon", 24)),
        n_paths=int(n_paths),
        seed=seed,
    )


def main(argv: list[str] | None = None) -> int:
    """CLI: python -m backend.engine.planner --job in.json --n 10000 --out out.json."""
    parser = argparse.ArgumentParser(description="Test plans x shocks for one business (SPEC §15.5).")
    parser.add_argument("--job", required=True, type=Path, help="Input job JSON")
    parser.add_argument("--n", type=int, default=10000, help="Paths per cell")
    parser.add_argument("--out", required=True, type=Path, help="Output JSON")
    args = parser.parse_args(argv)
    job = json.loads(args.job.read_text(encoding="utf-8"))
    result = run_job(job, args.n)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
