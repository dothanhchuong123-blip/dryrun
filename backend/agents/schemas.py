"""Pydantic v2 contracts for every LLM output + clamping helpers.

See SPEC §5. Models are flat (no Optional/Union) so the strict json_schema stays simple.
Field bounds are the hard contract; the helpers below clamp to engine-dependent bounds
(price vs MC/ATC, quantity vs capacity) after validation.
"""
from __future__ import annotations

from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from backend.engine.types import N_ARCHETYPES, CrowdSentiment, FirmDecision, Shock


class Evidence(BaseModel):
    quote: str = Field(max_length=300, description="Exact substring copied from the provided article text")
    url: str = Field(max_length=500, description="URL of the article the quote came from")


class ShockVector(BaseModel):
    delta_c_raw: float = Field(ge=-0.5, le=1.0, description="Fractional change in raw-material cost")
    delta_lead_time: int = Field(ge=-2, le=10, description="Change in supplier lead time, in ticks")
    demand_shock: float = Field(ge=-0.5, le=0.5, description="Fractional change in market demand")
    severity: float = Field(ge=0.0, le=1.0)
    evidence: list[Evidence] = Field(min_length=1, max_length=3)


class InventoryDecision(BaseModel):
    omega: float = Field(ge=-0.5, le=2.0, description="Behavioural risk factor on the safety stock")
    rationale: str = Field(max_length=200)


class CEODecision(BaseModel):
    price: float = Field(gt=0)
    production_qty: float = Field(ge=0)
    marketing_budget: float = Field(ge=0)
    expected_rival_action: Literal["cut", "hold", "raise"]
    rationale: str = Field(max_length=400)


class ArchetypeSentiment(BaseModel):
    id: int = Field(ge=1, le=N_ARCHETYPES)
    mu_a: float = Field(ge=-1.0, le=1.0, description="Mean sentiment toward Firm A")
    mu_b: float = Field(ge=-1.0, le=1.0, description="Mean sentiment toward Firm B")
    sigma_a: float = Field(ge=0.0, le=0.5)
    sigma_b: float = Field(ge=0.0, le=0.5)
    bubble: str = Field(max_length=60, description="First-person thought bubble")


class CrowdBatch(BaseModel):
    archetypes: list[ArchetypeSentiment] = Field(min_length=1, max_length=6)


class ScoutQuery(BaseModel):
    query: str = Field(min_length=3, max_length=200)


def _clip(x: float, lo: float, hi: float) -> float:
    return float(min(max(x, lo), hi))


def clamp_ceo(
    d: CEODecision,
    mc: float | None = None,
    atc: float | None = None,
    capacity: float | None = None,
) -> CEODecision:
    """Clamp price to [0.5 MC, 4.0 ATC] and quantity to capacity (SPEC §5). Bounds are optional."""
    price, qty = d.price, d.production_qty
    if mc is not None and atc is not None:
        price = _clip(price, 0.5 * mc, 4.0 * atc)
    if capacity is not None:
        qty = _clip(qty, 0.0, capacity)
    return d.model_copy(update={"price": price, "production_qty": qty})


def ceo_pair_to_decision(
    a: CEODecision,
    b: CEODecision,
    mc: tuple[float, float] | None = None,
    atc: tuple[float, float] | None = None,
    capacity: tuple[float, float] | None = None,
) -> FirmDecision:
    """Combine the two CEOs' decisions into the engine's FirmDecision, clamping when bounds are given."""
    ds = []
    for i, d in enumerate((a, b)):
        ds.append(
            clamp_ceo(
                d,
                mc[i] if mc else None,
                atc[i] if atc else None,
                capacity[i] if capacity else None,
            )
        )
    return FirmDecision(
        price=np.array([x.price for x in ds], dtype=np.float64),
        production_plan=np.array([x.production_qty for x in ds], dtype=np.float64),
        marketing=np.array([x.marketing_budget for x in ds], dtype=np.float64),
    )


def crowd_to_sentiment(batches: list[CrowdBatch]) -> CrowdSentiment:
    """Merge crowd batches into a (12, 2) CrowdSentiment. Missing archetypes stay neutral (0, 0)."""
    mu = np.zeros((N_ARCHETYPES, 2))
    sigma = np.zeros((N_ARCHETYPES, 2))
    for batch in batches:
        for s in batch.archetypes:
            i = s.id - 1
            mu[i] = (_clip(s.mu_a, -1, 1), _clip(s.mu_b, -1, 1))
            sigma[i] = (_clip(s.sigma_a, 0, 0.5), _clip(s.sigma_b, 0, 0.5))
    return CrowdSentiment(mu=mu, sigma=sigma)


def shock_to_engine(s: ShockVector) -> Shock:
    return Shock(
        delta_c_raw=_clip(s.delta_c_raw, -0.5, 1.0),
        delta_lead_time=int(min(max(s.delta_lead_time, -2), 10)),
        demand_shock=_clip(s.demand_shock, -0.5, 0.5),
    )
