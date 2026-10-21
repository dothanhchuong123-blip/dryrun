"""Pydantic v2 contracts for every LLM output + clamping helpers.

See SPEC §5. Models are flat (no Optional/Union) so the strict json_schema stays simple.
Field bounds are the hard contract; the helpers below clamp to engine-dependent bounds
(price vs MC/ATC, quantity vs capacity) after validation.
"""
from __future__ import annotations

from typing import Literal

import numpy as np
from pydantic import BaseModel, Field, model_validator

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


# --- Pivot v3 contracts (SPEC §15.3-15.6) ---------------------------------------------------

ProfileNumericField = Literal[
    "price", "unit_cost", "weekly_sales", "lead_time_weeks", "stock_weeks", "rival_price", "exposed_cost_share"
]


class BusinessProfile(BaseModel):
    business_name: str = Field(max_length=60)
    product_unit: str = Field(max_length=40, description='e.g. "bag of roasted coffee"')
    price: float = Field(gt=0, description="Your price per unit, USD")
    unit_cost: float = Field(gt=0, description="Raw/variable cost per unit, USD; below the price")
    weekly_sales: float = Field(gt=0, description="Units sold per week")
    lead_time_weeks: int = Field(ge=1, le=16, description="Supplier lead time in weeks")
    stock_weeks: float = Field(ge=0, le=16, description="Stock on hand, in weeks of sales")
    rival_name: str = Field(max_length=60)
    rival_price: float = Field(gt=0, description="Rival's price, USD; equal to price if unknown")
    supplier_region: str = Field(max_length=60)
    customers: str = Field(max_length=80, description='Who buys, e.g. "independent cafés"')
    search_terms: list[str] = Field(min_length=1, max_length=3, description="News queries, each <= 80 chars")
    # v3.1 realism fields (SPEC §15.3)
    country: str = Field(max_length=40, description='Where the business sells, lowercase English name ("vietnam"); "" if unknown')
    market_terms: list[str] = Field(
        max_length=2, description="0-2 local-market news queries (competitors, demand), may be in the local language"
    )
    exposed_cost_share: float = Field(
        ge=0.05, le=1.0, description="Share of unit_cost that moves with the news input; 1.0 if all of it"
    )
    cash_available: float = Field(ge=0, description="Cash the owner could put into extra stock, USD; 0 = not given")
    guessed_fields: list[ProfileNumericField] = Field(max_length=7, description="Numeric fields that were guessed")

    @model_validator(mode="after")
    def _clamp(self) -> BusinessProfile:
        # unit_cost must stay below the price (SPEC §15.3); clamp rather than reject.
        cap = round(0.95 * self.price, 6)
        self.unit_cost = min(cap, self.unit_cost)
        self.search_terms = [t[:80] for t in self.search_terms]
        self.market_terms = [t[:80] for t in self.market_terms]
        self.country = self.country.strip().lower()
        # A rival price copied from our own price is a guess; make sure the UI marks it.
        if self.rival_price == self.price and "rival_price" not in self.guessed_fields:
            self.guessed_fields = [*self.guessed_fields, "rival_price"]
        return self


class PlanSpecModel(BaseModel):
    name: str = Field(max_length=40)
    price_change_pct: float = Field(ge=-20, le=20)
    price_change_week: int = Field(ge=0, le=23)
    extra_stock_weeks: float = Field(ge=0, le=8)
    stock_week: int = Field(ge=0, le=23)
    marketing_change_pct: float = Field(ge=-50, le=100)
    switch_supplier: bool
    alt_cost_change_pct: float = Field(ge=-30, le=50)
    alt_lead_time_weeks: int = Field(ge=1, le=16)
    alt_shock_exposure: float = Field(ge=0, le=1)
    # Default 24 so older plans and recordings validate; the strict schema still lists it as required (the router
    # makes every property required) and drops the "default" keyword, which strict mode may not accept.
    price_end_week: int = Field(
        default=24, ge=1, le=24, description="The price change lasts until this week; 24 = to the end",
        json_schema_extra=lambda schema: schema.pop("default", None),
    )

    def to_engine(self) -> dict:
        """Plain dict for the engine's `PlanSpec(**d)` (P2)."""
        return self.model_dump()


class AnalystStep(BaseModel):
    thought: str = Field(max_length=300, description="Short plain-words note shown to the user")
    action: Literal["test", "finish"]
    plans: list[PlanSpecModel] = Field(max_length=3, description="0-3 new plans to test")
    pick: str = Field(max_length=40, description="Name of the plan you currently prefer")
    why: str = Field(max_length=300)


class MemoDraft(BaseModel):
    headline: str = Field(max_length=90)
    why: str = Field(max_length=400)
    watch_out: str = Field(max_length=300)
    recheck_when: str = Field(max_length=150)


class ScenarioCaseModel(BaseModel):
    """One future Ultra proposes in step 0b (SPEC §15.5, §15.6). Code assigns id and origin."""

    label: str = Field(max_length=40, description='Plain words, e.g. "Beans +31% and Highland cuts 5%"')
    delta_c_raw: float = Field(ge=-0.5, le=1.0, description="Change in the news input's price (not your whole cost)")
    delta_lead_time: int = Field(ge=-2, le=10, description="Supplier lead-time change, weeks")
    demand_shock: float = Field(ge=-0.5, le=0.5, description="Change in the whole market's demand")
    rival_price_change_pct: float = Field(ge=-20, le=20, description="Rival's price move on top of its normal rule")
    share_shift_pct: float = Field(ge=0, le=30, description="Percent of your demand lost to a new or bigger player")
    onset_week: int = Field(ge=0, le=12)
    ramp_weeks: int = Field(ge=1, le=8)
    likelihood: Literal["likely", "possible", "unlikely"]
    why: str = Field(max_length=120)
    source_ids: list[str] = Field(max_length=3, description="ids of the news items this case is based on")


class UnmodelledRisk(BaseModel):
    text: str = Field(max_length=100)
    source_id: str = Field(max_length=12, description='News item id, or "" if none')


class ScenarioSet(BaseModel):
    thought: str = Field(max_length=300, description="Short plain-words note shown to the user")
    cases: list[ScenarioCaseModel] = Field(min_length=2, max_length=5)
    unmodelled: list[UnmodelledRisk] = Field(max_length=4, description="Real risks the knobs cannot express")
