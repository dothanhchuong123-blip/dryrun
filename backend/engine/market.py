"""Consumer choice (MNL + outside good), costs, market clearing with spillover, goodwill, step().

See SPEC §4.1-4.3, §4.7. Implemented in task T01 (prompts/1_oct15_all-parallel/T01-engine-market.md).
"""
from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np

from backend.engine.types import (
    N_ARCHETYPES,
    Archetypes,
    CrowdSentiment,
    FirmDecision,
    MarketParams,
    MarketState,
    Shock,
    TickResult,
)

InventoryPolicyFn = Callable[[MarketState, MarketParams, int], tuple[np.ndarray, np.ndarray]]

# Calibrated target median alphas in ~0.02-0.06 so alpha * P at P ~= 100 is comparable to beta_bar (2.0).
# Order: (income in {low, mid, high}) x (sensitivity in {hunter, moderate}).
_ALPHA_MEDIAN_BY_TIER: dict[tuple[str, str], float] = {
    ("Low-income", "price-hunter"): 0.056,
    ("Low-income", "moderate"): 0.034,
    ("Mid-income", "price-hunter"): 0.046,
    ("Mid-income", "moderate"): 0.028,
    ("High-income", "price-hunter"): 0.038,
    ("High-income", "moderate"): 0.021,
}
_ALPHA_LOG_SD: float = 0.12
_LOYALTY_BIAS: float = 0.3
_GOODWILL_EPS: float = 1e-6


def archetype_weights(
    income_mix: Sequence[float], price_hunter_share: float, loyal_share: float
) -> np.ndarray:
    """(12,) share of shoppers per archetype from the three customer-mix dials (SPEC §15.3).

    income_mix is (low, mid, high), normalised here; price_hunter_share and loyal_share (loyal to A,
    the user's firm) are clipped to [0.05, 0.95] so no whole side of the market disappears.
    Order matches make_archetypes: income x (hunter, moderate) x (A, B).
    """
    inc = np.clip(np.asarray(income_mix, dtype=np.float64)[:3], 0.0, None)
    inc = inc / inc.sum() if inc.shape == (3,) and inc.sum() > 0 else np.full(3, 1.0 / 3.0)
    h = float(np.clip(price_hunter_share, 0.05, 0.95))
    a = float(np.clip(loyal_share, 0.05, 0.95))
    w = inc[:, None, None] * np.array([h, 1.0 - h])[None, :, None] * np.array([a, 1.0 - a])[None, None, :]
    return w.reshape(N_ARCHETYPES)


def _counts_from_weights(n_consumers: int, weights: np.ndarray) -> np.ndarray:
    """Largest-remainder split of n_consumers by weights (ties go to the lower index)."""
    w = np.clip(np.asarray(weights, dtype=np.float64), 0.0, None)
    w = w / w.sum() if w.sum() > 0 else np.full(N_ARCHETYPES, 1.0 / N_ARCHETYPES)
    raw = w * n_consumers
    counts = np.floor(raw).astype(np.int64)
    rest = n_consumers - int(counts.sum())
    counts[np.argsort(-(raw - counts), kind="stable")[:rest]] += 1
    return counts


def make_archetypes(
    n_consumers: int, rng: np.random.Generator, weights: np.ndarray | None = None
) -> Archetypes:
    """Build the 12 consumer archetypes and assign consumers to them.

    Nested order (IDs 1..12, indices 0..11):
    income in {low, mid, high} x sensitivity in {hunter, moderate} x loyalty in {A, B}.
    `weights` (12,) sets each archetype's share of consumers (see archetype_weights); None = even split.
    """
    incomes = ("Low-income", "Mid-income", "High-income")
    sensitivities = ("price-hunter", "moderate")
    loyalties = ("A", "B")

    alpha_mu = np.empty(N_ARCHETYPES, dtype=np.float64)
    alpha_sigma = np.full(N_ARCHETYPES, _ALPHA_LOG_SD, dtype=np.float64)
    loyalty = np.zeros((N_ARCHETYPES, 2), dtype=np.float64)
    labels: list[str] = []

    idx = 0
    for inc in incomes:
        for sens in sensitivities:
            median_alpha = _ALPHA_MEDIAN_BY_TIER[(inc, sens)]
            for brand_idx, brand in enumerate(loyalties):
                alpha_mu[idx] = np.log(median_alpha)
                loyalty[idx, brand_idx] = _LOYALTY_BIAS
                labels.append(f"{inc} · {sens} · {brand}-loyal")
                idx += 1

    if weights is None:
        consumer_archetype = np.arange(n_consumers, dtype=np.int64) % N_ARCHETYPES
    else:
        counts = _counts_from_weights(n_consumers, weights)
        consumer_archetype = np.repeat(np.arange(N_ARCHETYPES, dtype=np.int64), counts)
    rng.shuffle(consumer_archetype)

    return Archetypes(
        alpha_mu=alpha_mu,
        alpha_sigma=alpha_sigma,
        loyalty=loyalty,
        labels=labels,
        consumer_archetype=consumer_archetype,
    )


def sample_alpha(arch: Archetypes, rng: np.random.Generator) -> np.ndarray:
    """Sample lognormal price sensitivity alpha_i of shape (N,) for each consumer."""
    mu = arch.alpha_mu[arch.consumer_archetype]
    sigma = arch.alpha_sigma[arch.consumer_archetype]
    return rng.lognormal(mean=mu, sigma=sigma).astype(np.float64)


def sample_sentiment(
    crowd: CrowdSentiment,
    arch: Archetypes,
    rng: np.random.Generator,
) -> np.ndarray:
    """Sample consumer sentiment of shape (N, 2) from archetype Gaussians, clipped to [-1, 1]."""
    mu = np.asarray(crowd.mu, dtype=np.float64)[arch.consumer_archetype]
    sigma = np.maximum(np.asarray(crowd.sigma, dtype=np.float64)[arch.consumer_archetype], 0.0)
    draws = rng.normal(loc=mu, scale=sigma)
    return np.clip(draws, -1.0, 1.0).astype(np.float64)


def choice_probabilities(
    price: np.ndarray,
    marketing: np.ndarray,
    beta0: np.ndarray,
    alpha: np.ndarray,
    sentiment: np.ndarray,
    loyalty_per_consumer: np.ndarray | Archetypes,
    params: MarketParams,
) -> np.ndarray:
    """Compute MNL choice probabilities of shape (N, 3) with columns [outside, A, B]."""
    price_arr = np.asarray(price, dtype=np.float64)
    mkt_arr = np.maximum(np.asarray(marketing, dtype=np.float64), 0.0)
    beta0_arr = np.asarray(beta0, dtype=np.float64)
    alpha_arr = np.asarray(alpha, dtype=np.float64)
    sent_arr = np.asarray(sentiment, dtype=np.float64)

    if isinstance(loyalty_per_consumer, Archetypes):
        loyalty_arr = loyalty_per_consumer.loyalty[loyalty_per_consumer.consumer_archetype]
    else:
        loyalty_arr = np.asarray(loyalty_per_consumer, dtype=np.float64)

    u_outside = (-alpha_arr * float(params.p_ref))[:, np.newaxis]
    u_firms = (
        beta0_arr[np.newaxis, :]
        - alpha_arr[:, np.newaxis] * price_arr[np.newaxis, :]
        + float(params.gamma) * np.log1p(mkt_arr)[np.newaxis, :]
        + float(params.delta) * sent_arr
        + loyalty_arr
    )
    utilities = np.concatenate([u_outside, u_firms], axis=-1)

    # Log-sum-exp trick for numerical stability
    u_max = np.max(utilities, axis=-1, keepdims=True)
    exp_u = np.exp(utilities - u_max)
    probs = exp_u / np.sum(exp_u, axis=-1, keepdims=True)
    return probs


def costs(
    q: np.ndarray,
    c_raw: float | np.ndarray,
    params: MarketParams,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute (tc, mc, atc) for production quantity q, broadcasting over (..., 2)."""
    q_arr = np.asarray(q, dtype=np.float64)
    c_raw_arr = np.asarray(c_raw, dtype=np.float64)
    if c_raw_arr.ndim > 0 and q_arr.ndim > 1 and c_raw_arr.shape == q_arr.shape[:-1]:
        c_raw_arr = c_raw_arr[..., np.newaxis]

    fc = np.asarray(params.fc, dtype=np.float64)
    eta = float(params.eta)

    tc = fc + c_raw_arr * q_arr + eta * np.square(q_arr)
    mc = c_raw_arr + 2.0 * eta * q_arr
    q_safe = np.maximum(q_arr, 1.0)
    atc = (fc / q_safe) + c_raw_arr + eta * q_arr
    return tc, mc, atc


def clear_market(
    demand: np.ndarray,
    inventory: np.ndarray,
    theta: float | np.ndarray,
) -> dict[str, np.ndarray | float]:
    """Clear the market with symmetric, stock-capped spillover (SPEC §4.3 steps 1-4).

    Broadcasts over leading batch dimensions of shape (..., 2).
    """
    d_arr = np.maximum(np.asarray(demand, dtype=np.float64), 0.0)
    inv_arr = np.maximum(np.asarray(inventory, dtype=np.float64), 0.0)
    theta_arr = np.asarray(theta, dtype=np.float64)

    own_sales = np.minimum(d_arr, inv_arr)
    unmet = np.maximum(d_arr - own_sales, 0.0)
    spare = np.maximum(inv_arr - own_sales, 0.0)

    unmet_rival = unmet[..., ::-1]
    spill_in = np.minimum(theta_arr * unmet_rival, spare)
    sales = own_sales + spill_in

    lost_arr = np.maximum(np.sum(d_arr - sales, axis=-1), 0.0)
    lost: np.ndarray | float = float(lost_arr) if d_arr.ndim == 1 else lost_arr

    return {
        "own_sales": own_sales,
        "spill_in": spill_in,
        "sales": sales,
        "unmet": unmet,
        "lost": lost,
    }


def update_goodwill(
    beta0: np.ndarray,
    unmet: np.ndarray,
    demand: np.ndarray,
    params: MarketParams,
) -> np.ndarray:
    """Update brand goodwill with stockout erosion and mean reversion (SPEC §4.3 step 5).

    Broadcasts over leading batch dimensions of shape (..., 2).
    """
    beta0_arr = np.asarray(beta0, dtype=np.float64)
    unmet_arr = np.maximum(np.asarray(unmet, dtype=np.float64), 0.0)
    demand_arr = np.asarray(demand, dtype=np.float64)
    beta_bar = np.asarray(params.beta_bar, dtype=np.float64)

    stockout_rate = unmet_arr / np.maximum(demand_arr, _GOODWILL_EPS)
    beta0_new = (
        beta0_arr
        - float(params.lam) * stockout_rate
        + float(params.kappa) * (beta_bar - beta0_arr)
    )
    return beta0_new


def elasticities(
    price: np.ndarray,
    marketing: np.ndarray,
    beta0: np.ndarray,
    alpha: np.ndarray,
    sentiment: np.ndarray,
    loyalty_per_consumer: np.ndarray | Archetypes,
    params: MarketParams,
) -> tuple[float, float]:
    """Compute (own, cross) price elasticities for firm A via ±1% price perturbation."""
    price_arr = np.asarray(price, dtype=np.float64)
    base_probs = choice_probabilities(
        price_arr, marketing, beta0, alpha, sentiment, loyalty_per_consumer, params
    )
    q_a_base = float(np.sum(base_probs[:, 1]))
    denom = max(q_a_base, 1e-12)

    eps = 0.01

    # Perturb P_A by ±1%
    p_a_up = price_arr.copy()
    p_a_dn = price_arr.copy()
    p_a_up[0] *= 1.0 + eps
    p_a_dn[0] *= 1.0 - eps
    q_a_up = float(
        np.sum(
            choice_probabilities(
                p_a_up, marketing, beta0, alpha, sentiment, loyalty_per_consumer, params
            )[:, 1]
        )
    )
    q_a_dn = float(
        np.sum(
            choice_probabilities(
                p_a_dn, marketing, beta0, alpha, sentiment, loyalty_per_consumer, params
            )[:, 1]
        )
    )
    own_elasticity = ((q_a_up - q_a_dn) / denom) / (2.0 * eps)

    # Perturb P_B by ±1%
    p_b_up = price_arr.copy()
    p_b_dn = price_arr.copy()
    p_b_up[1] *= 1.0 + eps
    p_b_dn[1] *= 1.0 - eps
    q_ab_up = float(
        np.sum(
            choice_probabilities(
                p_b_up, marketing, beta0, alpha, sentiment, loyalty_per_consumer, params
            )[:, 1]
        )
    )
    q_ab_dn = float(
        np.sum(
            choice_probabilities(
                p_b_dn, marketing, beta0, alpha, sentiment, loyalty_per_consumer, params
            )[:, 1]
        )
    )
    cross_elasticity = ((q_ab_up - q_ab_dn) / denom) / (2.0 * eps)

    return float(own_elasticity), float(cross_elasticity)


def _default_inventory_policy(
    state: MarketState,
    params: MarketParams,
    lead_time: int,
) -> tuple[np.ndarray, np.ndarray]:
    # replaced by inventory.replenish (T02)
    del params, lead_time
    if state.demand_hist:
        recent = state.demand_hist[-8:]
        mean_demand = np.mean(np.stack(recent, axis=0), axis=0)
    else:
        mean_demand = np.zeros(2, dtype=np.float64)
    rop = mean_demand.copy()
    target = 2.0 * mean_demand
    orders = np.where(state.raw_inv < rop, np.maximum(target - state.raw_inv, 0.0), 0.0)
    return orders.astype(np.float64), rop.astype(np.float64)


def step(
    state: MarketState,
    decision: FirmDecision,
    shock: Shock,
    sentiment: np.ndarray | CrowdSentiment,
    arch: Archetypes,
    alpha: np.ndarray,
    params: MarketParams,
    rng: np.random.Generator,
    inventory_policy: InventoryPolicyFn | None = None,
) -> tuple[MarketState, TickResult]:
    """Run one canonical market tick (SPEC §4.7) without mutating input state."""
    t = int(state.tick)

    # 1. Receive raw-material orders whose arrival_tick == t (or earlier if lead time shifted)
    raw_inv = np.array(state.raw_inv, dtype=np.float64, copy=True)
    active_pipeline: list[tuple[int, int, float]] = []
    for firm_idx, arrival_tick, order_qty in state.pipeline:
        if arrival_tick <= t:
            raw_inv[int(firm_idx)] += float(order_qty)
        else:
            active_pipeline.append((int(firm_idx), int(arrival_tick), float(order_qty)))

    # 2. Apply active shock
    c_raw = float(params.c_raw0) * (1.0 + float(shock.delta_c_raw))
    lead_time = max(1, int(params.lead_time0) + int(shock.delta_lead_time))
    demand_multiplier = max(0.0, 1.0 + float(shock.demand_shock))

    # 3. Produce: Q_j = min(plan_j, K_cap_j, raw_inv_j / r)
    price = np.asarray(decision.price, dtype=np.float64)
    plan = np.maximum(np.asarray(decision.production_plan, dtype=np.float64), 0.0)
    marketing = np.maximum(np.asarray(decision.marketing, dtype=np.float64), 0.0)
    k_cap = np.asarray(params.k_cap, dtype=np.float64)
    r = float(params.raw_per_unit)

    qty = np.minimum(np.minimum(plan, k_cap), raw_inv / r)
    qty = np.maximum(qty, 0.0)
    raw_inv = np.maximum(raw_inv - r * qty, 0.0)
    inventory = np.maximum(
        np.array(state.inventory, dtype=np.float64, copy=True) + qty,
        0.0,
    )

    # 4. Choice probabilities and expected demand
    if isinstance(sentiment, CrowdSentiment):
        sent_arr = sample_sentiment(sentiment, arch, rng)
    else:
        sent_arr = np.asarray(sentiment, dtype=np.float64)
        if sent_arr.shape[0] == N_ARCHETYPES and arch.consumer_archetype.shape[0] != N_ARCHETYPES:
            sent_arr = sent_arr[arch.consumer_archetype]

    loyalty_per_consumer = arch.loyalty[arch.consumer_archetype]
    beta0 = np.array(state.beta0, dtype=np.float64, copy=True)
    probs = choice_probabilities(
        price, marketing, beta0, alpha, sent_arr, loyalty_per_consumer, params
    )
    probs_mean = np.mean(probs, axis=0)
    demand = demand_multiplier * np.sum(probs[:, 1:], axis=0)
    # Each consumer buys at most one unit per tick, so a positive demand shock cannot push total demand past N.
    total_demand = float(np.sum(demand))
    if total_demand > probs.shape[0]:
        demand = demand * (probs.shape[0] / total_demand)

    # 5. Clear market with spillover
    cleared = clear_market(demand, inventory, params.theta)
    own_sales = np.asarray(cleared["own_sales"], dtype=np.float64)
    spill_in = np.asarray(cleared["spill_in"], dtype=np.float64)
    sales = np.asarray(cleared["sales"], dtype=np.float64)
    unmet = np.asarray(cleared["unmet"], dtype=np.float64)
    lost = float(cleared["lost"])
    inventory = np.maximum(inventory - sales, 0.0)

    # 6. Profit: pi_j = P_j * S_j - TC_j(Q_j) - M_j - h * (inventory_j + raw_inv_j)
    tc, mc, atc = costs(qty, c_raw, params)
    revenue = price * sales
    holding = float(params.holding_cost) * (inventory + raw_inv)
    profit = revenue - tc - marketing - holding

    # 7. Goodwill update
    beta0_new = update_goodwill(beta0, unmet, demand, params)

    # 8. Replenish raw materials
    new_demand_hist = [*state.demand_hist, demand.copy()]
    policy_fn = inventory_policy if inventory_policy is not None else _default_inventory_policy  # replaced by inventory.replenish (T02)
    pre_replenish_state = MarketState(
        tick=t,
        beta0=beta0_new,
        inventory=inventory,
        raw_inv=raw_inv,
        pipeline=list(active_pipeline),
        omega=np.array(state.omega, dtype=np.float64, copy=True),
        last_qty=qty.copy(),
        demand_hist=new_demand_hist,
        order_hist=list(state.order_hist),
        cum_profit=np.asarray(state.cum_profit, dtype=np.float64) + profit,
    )
    orders_raw, rop_raw = policy_fn(pre_replenish_state, params, lead_time)
    orders = np.maximum(np.asarray(orders_raw, dtype=np.float64), 0.0)
    rop = np.asarray(rop_raw, dtype=np.float64)

    new_pipeline = list(active_pipeline)
    for firm_idx in range(2):
        if orders[firm_idx] > 0.0:
            new_pipeline.append((firm_idx, t + lead_time, float(orders[firm_idx])))
    new_order_hist = [*state.order_hist, orders.copy()]

    # 9. Sample realised choices (0=outside, 1=A, 2=B)
    cum_probs = np.cumsum(probs, axis=1)
    u_draw = rng.random(probs.shape[0])[:, np.newaxis]
    choices = np.sum(u_draw >= cum_probs[:, :-1], axis=1, dtype=np.int8)

    # 10. Emit new MarketState and TickResult
    next_state = MarketState(
        tick=t + 1,
        beta0=beta0_new,
        inventory=inventory,
        raw_inv=raw_inv,
        pipeline=new_pipeline,
        omega=np.array(state.omega, dtype=np.float64, copy=True),
        last_qty=qty.copy(),
        demand_hist=new_demand_hist,
        order_hist=new_order_hist,
        cum_profit=np.asarray(state.cum_profit, dtype=np.float64) + profit,
    )
    result = TickResult(
        tick=t,
        probs_mean=probs_mean,
        demand=demand,
        own_sales=own_sales,
        spill_in=spill_in,
        sales=sales,
        unmet=unmet,
        lost=lost,
        qty=qty,
        revenue=revenue,
        total_cost=tc,
        profit=profit,
        mc=mc,
        atc=atc,
        rop=rop,
        orders=orders,
        c_raw=c_raw,
        lead_time=lead_time,
        choices=choices,
    )
    return next_state, result

