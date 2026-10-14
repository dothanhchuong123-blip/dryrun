"""System/user prompt builders for CEO (Ultra), shock parser + inventory (Super), crowd (fast tier).

Pure functions returning OpenAI-style `messages` lists. See SPEC §5, §3.3.

state_summary keys (all optional, rendered defensively):
  tick, horizon, capacity, mc, atc, c_raw, lead_time, own_price, own_inventory,
  shock: {headline, quotes: [str]}, history: [{tick, p_self, p_rival, s_self, s_rival,
  inv_self, inv_rival, pi_self, pi_rival}]  (only the last 8 rows are shown)
"""
from __future__ import annotations

import json

HISTORY_ROWS = 8

_CEO_SYSTEM = """You are the CEO of Firm {firm} in a two-firm market (Firm A vs Firm B), run over a finite horizon of ticks.
Objective: maximise YOUR cumulative profit over the whole horizon and survive supply shocks.

How to think (repeated game):
- Anticipate your rival's best response to your price before you set it.
- Avoid ruinous price wars: a cut is only worth it if it wins share the rival cannot cheaply match. Do not be naive: if the rival undercuts, ignoring it also loses profit.
- Prices below marginal cost destroy value. Stockouts lose sales and goodwill, and unsold stock costs holding fees.

Hard constraints:
- price in [0.5 x MC, 4.0 x ATC]; production_qty in [0, capacity]; marketing_budget >= 0.
- Outputs are decisions only. Revenue, demand and profit are computed by the simulator, never by you.

Keep your reasoning SHORT: at most about 8 steps, then answer. Do not re-check yourself repeatedly.
Reply with JSON only, matching the schema: price, production_qty, marketing_budget, expected_rival_action ("cut"|"hold"|"raise"), rationale (<=400 chars)."""


def _fmt(x, nd: int = 1) -> str:
    if isinstance(x, (int, float)):
        return f"{x:.{nd}f}"
    return str(x)


def _history_table(history: list[dict]) -> str:
    rows = history[-HISTORY_ROWS:]
    if not rows:
        return "(no history yet)"
    lines = ["tick | P_you | P_rival | sales_you | sales_rival | inv_you | inv_rival | profit_you | profit_rival"]
    for r in rows:
        lines.append(
            " | ".join(
                _fmt(r.get(k, "-"))
                for k in ("tick", "p_self", "p_rival", "s_self", "s_rival", "inv_self", "inv_rival", "pi_self", "pi_rival")
            )
        )
    return "\n".join(lines)


def ceo_messages(
    firm: str,
    state_summary: dict,
    rival_history: list[dict],
    nash_hint: dict | None = None,
) -> list[dict]:
    s = state_summary
    parts = [
        f"Tick {s.get('tick', '?')} of {s.get('horizon', '?')}. You are Firm {firm}.",
        (
            f"Your costs: MC={_fmt(s.get('mc', '?'))} ATC={_fmt(s.get('atc', '?'))} "
            f"c_raw={_fmt(s.get('c_raw', '?'))} lead_time={s.get('lead_time', '?')} ticks; "
            f"capacity={_fmt(s.get('capacity', '?'), 0)}."
        ),
        f"Your current price={_fmt(s.get('own_price', '?'))}, inventory={_fmt(s.get('own_inventory', '?'), 0)}.",
        "Last ticks:\n" + _history_table(s.get("history", [])),
    ]
    shock = s.get("shock")
    if shock:
        quotes = "; ".join(f'"{q}"' for q in shock.get("quotes", [])[:3])
        parts.append(f"Active shock: {shock.get('headline', '')} Evidence: {quotes}")
    if rival_history:
        last = rival_history[-1]
        parts.append(f"Rival's last action: {json.dumps(last, separators=(',', ':'))}")
        if len(rival_history) > 1:
            acts = [str(r.get("action", "?")) for r in rival_history[-5:]]
            parts.append("Rival's recent actions (oldest to newest): " + ", ".join(acts))
    if nash_hint:
        parts.append(
            "Game-theory hint from the simulator (one-period payoffs; advisory only): "
            + json.dumps(nash_hint, separators=(",", ":"))
        )
    parts.append("Decide now.")
    return [
        {"role": "system", "content": _CEO_SYSTEM.format(firm=firm)},
        {"role": "user", "content": "\n".join(parts)},
    ]


_SHOCK_SYSTEM = """You turn news articles into a conservative market shock for a supply-chain simulator.
Return JSON: delta_c_raw (fractional change in raw-material cost, -0.5..1.0), delta_lead_time (ticks, -2..10),
demand_shock (fractional change in demand, -0.5..0.5), severity (0..1) and evidence (1-3 items).
Rules:
- Be conservative: prefer smaller magnitudes unless the article states a large, concrete figure (e.g. a 25% tariff -> about +0.25 on cost if it applies to inputs).
- Every evidence quote MUST be an exact, verbatim substring of the provided article text (copy it character for character, <=300 chars), with the url of the article it came from.
- Use only what the articles say. If nothing is relevant, return small values and low severity, still with a real quote.
Reply with JSON only."""


def shock_parser_messages(articles: list[dict], scenario_hint: str = "") -> list[dict]:
    blocks = []
    for i, a in enumerate(articles, 1):
        blocks.append(f"[{i}] url: {a.get('url', '')}\ntitle: {a.get('title', '')}\ntext:\n{str(a.get('content', ''))[:6000]}")
    user = (f"Scenario: {scenario_hint}\n\n" if scenario_hint else "") + "Articles:\n\n" + "\n\n".join(blocks)
    return [{"role": "system", "content": _SHOCK_SYSTEM}, {"role": "user", "content": user}]


_INV_SYSTEM = """You are the inventory manager of Firm {firm}. You set omega, a behavioural risk factor in [-0.5, 2.0] that scales safety stock:
reorder point = expected demand over lead time + z * demand_sd * sqrt(lead time) * (1 + omega).
- omega = 0: neutral, textbook (s,S) policy.
- omega > 0: precautionary. You over-order against disruption. Combined with long lead times this causes phantom ordering and the bullwhip effect, so only use high values when the threat is real.
- omega < 0: lean. You hold less buffer, saving holding cost but risking stockouts.
A longer lead time or a supply threat argues for higher omega; ample stock and a calm supply chain argue for lower.\nChoose omega given the shock and inventory position, plus a one-line rationale (<=200 chars). Reply with JSON only: omega, rationale."""


def inventory_messages(firm: str, inventory_summary: dict, shock: dict | None = None) -> list[dict]:
    parts = ["Inventory position: " + json.dumps(inventory_summary, separators=(",", ":"))]
    parts.append("Active shock: " + (json.dumps(shock, separators=(",", ":")) if shock else "none"))
    return [
        {"role": "system", "content": _INV_SYSTEM.format(firm=firm)},
        {"role": "user", "content": "\n".join(parts)},
    ]


_CROWD_SYSTEM = """You simulate groups of consumers choosing between two brands, Firm A and Firm B.
For EACH archetype given, output its mood toward each brand right now:
mu_a, mu_b in [-1, 1] (mean sentiment: -1 hostile, 0 neutral, 1 enthusiastic), sigma_a, sigma_b in [0, 0.5] (how divided the group is),
and bubble: a fun first-person thought (<=60 chars) in that persona's voice.
React to prices, stockouts, news and each persona's price sensitivity and brand loyalty. Moods should move moderately, not swing wildly.
Reply with JSON only: {"archetypes":[{id, mu_a, mu_b, sigma_a, sigma_b, bubble}, ...]} with one entry per archetype, using the given ids."""


def crowd_messages(archetypes: list[dict], market_view: dict) -> list[dict]:
    lines = [
        f'id={a["id"]} {a["label"]}: {a["persona"]} (sensitivity={a.get("sensitivity")}, loyalty={a.get("loyalty")})'
        for a in archetypes
    ]
    user = (
        "Market view: " + json.dumps(market_view, separators=(",", ":")) + "\n\nArchetypes:\n" + "\n".join(lines)
    )
    return [{"role": "system", "content": _CROWD_SYSTEM}, {"role": "user", "content": user}]


def scout_query_messages(symptom: str) -> list[dict]:
    return [
        {
            "role": "system",
            "content": "You write one concise news-search query (<=12 words) that would explain an unexplained "
            "supply-chain or market symptom. Prefer concrete entities (commodity, route, country, policy) and "
            'recency. Reply with JSON only: {"query": "..."}',
        },
        {"role": "user", "content": f"Symptom: {symptom}"},
    ]
