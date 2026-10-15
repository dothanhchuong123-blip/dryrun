"""Plain-words helpers shared by the analyst prompts, the agent steps and the memo (SPEC §15.5.1, §15.11).

Money follows docs/DESIGN.md §6: `$94.00` for prices, `$15.5k` / `$1.2M` for profit, deltas always signed with a
real minus sign (`+$114k`, `−$8.2k`). The frontend copy uses the same rules, so keep them in step.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from backend.engine import planner

MINUS = "−"  # real minus sign, never a hyphen

# SPEC §15.11: always shown in the memo's "Not in these numbers" box.
NOT_MODELLED_FIXED: list[str] = [
    "Fixed costs such as rent and salaries (profit here is gross profit)",
    "Taxes",
    "Payment terms (we assume you pay suppliers when you order, and customers pay when they buy)",
    "Seasonality",
    "Your other products",
    "Warehouse space limits",
    "How other rivals react (we model one main rival)",
]

# P&L bridge labels (docs/DESIGN.md §12.3a), in the order the five lines sum to the total.
BRIDGE_LABELS: list[tuple[str, str]] = [
    ("cost_usd", "Cheaper stock"),
    ("price_usd", "Your price change"),
    ("volume_usd", "Customers won/lost"),
    ("marketing_usd", "Marketing"),
    ("holding_usd", "Storage & money tied up"),
]


def _signed(x: float, text: str) -> str:
    return (MINUS if x < 0 else "+") + text


def usd_k(x: float, *, signed: bool = True) -> str:
    """`+$5.0k` / `−$1.8k` / `+$850` / `+$1.2M`, real minus sign. `signed=False` drops the plus sign."""
    v = float(x)
    a = abs(v)
    if round(a) == 0:
        return "$0"
    if a >= 999_950:
        body = f"${a / 1e6:.1f}M"
    elif a >= 99_950:
        body = f"${a / 1e3:.0f}k"
    elif round(a) >= 1000:
        body = f"${a / 1e3:.1f}k"
    else:
        body = f"${round(a)}"
    if not signed:
        return (MINUS if v < 0 else "") + body
    return _signed(v, body)


def _k(x: float) -> str:
    """Compact $k number for the analyst's results table (no `$`, one decimal, real minus)."""
    v = round(float(x) / 1000.0, 1)
    if v == 0:
        return "0.0"
    return (MINUS if v < 0 else "+") + f"{abs(v):.1f}"


def result_line(cell: Mapping[str, Any]) -> str:
    """`+$5.0k on average · bad case +$1.2k` for an `agent_step` of kind `result`."""
    return f"{usd_k(cell['mean_delta_usd'])} on average · bad case {usd_k(cell['p5_delta_usd'])}"


def results_table(cells: Sequence[Mapping[str, Any]], shocks: Sequence[Mapping[str, Any]]) -> str:
    """Compact text table for `analyst_messages`: one row per plan, one column per future, in $k vs Do nothing.

    Each cell reads `mean / bad case / % better`. The `news` column adds `steady` (rival never runs out),
    `cash` (most extra cash tied up, $k) and `OVER CASH` when the plan needs more than the owner has.
    """
    cols = [dict(s) for s in shocks]
    if not cells or not cols:
        return "(nothing tested yet)"
    by_key = {(c["plan_name"], c["shock_id"]): c for c in cells}
    names = list(dict.fromkeys(c["plan_name"] for c in cells))
    head = ["plan"] + [f'{c["id"]} "{c.get("label", c["id"])}"' for c in cols]
    lines = [" | ".join(head)]
    for name in names:
        row = [name]
        for col in cols:
            cell = by_key.get((name, col["id"]))
            if cell is None:
                row.append("-")
                continue
            txt = f'{_k(cell["mean_delta_usd"])} / {_k(cell["p5_delta_usd"])} / {round(100 * cell["p_better"])}%'
            if col["id"] == "news":
                steady = cell.get("steady_rival_delta_usd")
                if steady is not None:
                    txt += f" · steady {_k(steady)}"
                txt += f' · cash {float(cell.get("peak_cash_usd", 0.0)) / 1000:.1f}'
                if cell.get("over_cash"):
                    txt += " OVER CASH"
            row.append(txt)
        lines.append(" | ".join(row))
    lines.extend(_weak_spots(names, cols, by_key))
    return "\n".join(lines)


def _weak_spots(names: Sequence[str], cols: Sequence[Mapping[str, Any]], by_key: Mapping[tuple[str, str], Mapping[str, Any]]) -> list[str]:
    """One line per plan under the table: its worst bad-case column and the P&L line that drags most there."""
    out = []
    labels = dict(BRIDGE_LABELS)
    for name in names:
        have = [(c, by_key[(name, c["id"])]) for c in cols if (name, c["id"]) in by_key]
        if not have:
            continue
        col, cell = min(have, key=lambda t: t[1]["p5_delta_usd"])
        key, val = min(cell["bridge"].items(), key=lambda kv: kv[1]) if cell.get("bridge") else ("", 0.0)
        drag = f"; biggest drag on the average there: {labels[key].lower()} {_k(val)}" if val < 0 and key in labels else ""
        out.append(f'weak spot, {name}: worst bad case in {col["id"]} ({_k(cell["p5_delta_usd"])}){drag}')
    return ["Weak spots ($k):", *out] if out else []


def _input_words(profile: Mapping[str, Any]) -> tuple[str, str]:
    """(sentence-start word, mid-sentence word) for the news input: ("Beans", "beans"). Falls back to
    ("Input price", "the main input") when the product isn't one we have a short word for."""
    plural, _ = planner._input_word(profile)
    if plural == "Costs":
        return "Input price", "the main input"
    mid = plural if plural[1:2].isupper() else plural.lower()  # keep "GPUs"
    return plural, mid


def _pct(x: float) -> str:
    v = round(x)
    return _signed(v, f"{abs(v)}%") if v else "0%"


def _per_unit(profile: Mapping[str, Any]) -> str:
    unit = str(profile.get("product_unit", "")).strip() or "unit"
    return unit.split(" of ")[0].strip() or "unit"


def cost_line(profile: Mapping[str, Any], case: Mapping[str, Any] | planner.ShockCase) -> str:
    """"Beans +31% × 85% of your cost is beans = your cost +26% (+$1.71 a bag)". Same formula as the engine."""
    change = planner.cost_change(profile, case)
    dc = float(case.delta_c_raw if isinstance(case, planner.ShockCase) else case.get("delta_c_raw", 0.0))
    lead, mid = _input_words(profile)
    share = round(100 * float(profile.get("exposed_cost_share", 1.0) or 1.0))
    per_unit = change["usd_per_unit"]
    dollars = _signed(per_unit, f"${abs(per_unit):.2f}") if round(per_unit, 2) else "$0.00"
    return (
        f"{lead} {_pct(100 * dc)} × {share}% of your cost is {mid} = your cost {_pct(change['pct'])} "
        f"({dollars} a {_per_unit(profile)})"
    )


def bridge_lines(bridge: Mapping[str, float]) -> list[dict[str, Any]]:
    """The five plain-label P&L lines (DESIGN §12.3a) plus the total: `[{label, usd, text}]`."""
    rows = [{"label": label, "usd": float(bridge[key])} for key, label in BRIDGE_LABELS]
    rows.append({"label": "Total", "usd": sum(r["usd"] for r in rows)})
    for r in rows:
        r["text"] = f'{r["label"]}: {usd_k(r["usd"])}'
    return rows


def _case_knobs(case: Mapping[str, Any]) -> str:
    parts = []
    if abs(case.get("delta_c_raw", 0.0)) >= 0.005:
        parts.append(f"input price {_pct(100 * case['delta_c_raw'])}")
    if case.get("delta_lead_time"):
        n = int(case["delta_lead_time"])
        parts.append(f"delays {'+' if n > 0 else MINUS}{abs(n)} wk")
    if abs(case.get("demand_shock", 0.0)) >= 0.005:
        parts.append(f"market demand {_pct(100 * case['demand_shock'])}")
    if case.get("rival_price_change_pct"):
        parts.append(f"rival price {_pct(case['rival_price_change_pct'])}")
    if case.get("share_shift_pct"):
        parts.append(f"{round(case['share_shift_pct'])}% of your customers go to a new player")
    return ", ".join(parts) or "no change"


def futures_block(shocks: Sequence[Mapping[str, Any]]) -> str:
    """The grid's columns as text for `analyst_messages(futures_block=...)`."""
    lines = []
    for c in shocks:
        why = f" — {c['why']}" if c.get("why") else ""
        lines.append(f'- {c["id"]} "{c.get("label", c["id"])}" ({c.get("likelihood", "likely")}): {_case_knobs(c)}{why}')
    return "\n".join(lines) or "(only today's news)"


def input_changes_line(profile: Mapping[str, Any], case: Mapping[str, Any]) -> str:
    """The two named numbers for the scenario prompt (the input's change vs your cost change)."""
    change = planner.cost_change(profile, case)
    dc = float(case.get("delta_c_raw", 0.0))
    return (
        f"input price {_pct(100 * dc)} (use this for delta_c_raw); "
        f"your cost {_pct(change['pct'])} after the {round(100 * float(profile.get('exposed_cost_share', 1.0) or 1.0))}% "
        "share (do not use this)"
    )


def plan_actions(
    plan: planner.PlanSpec | Mapping[str, Any], profile: Mapping[str, Any], cell: Mapping[str, Any] | None = None
) -> list[dict[str, Any]]:
    """The plan as week-by-week steps, `[{week, text}]`, built from the knobs and the profile (never by an LLM)."""
    spec = plan if isinstance(plan, planner.PlanSpec) else planner.PlanSpec.from_dict(plan)
    price = float(profile["price"])
    steps: list[dict[str, Any]] = []
    _, mid = _input_words(profile)
    if spec.is_textbook:
        steps.append({"week": 0, "text": "Set your price each week at your average cost plus your usual markup"})
    if spec.switch_supplier:
        change = spec.alt_cost_change_pct
        cost_txt = "at the same unit cost" if round(change) == 0 else f"at a unit cost {_pct(change)} vs now"
        steps.append(
            {"week": 0, "text": f"Send new orders to the alternative supplier {cost_txt}, "
                                f"{spec.alt_lead_time_weeks} weeks to arrive"}
        )
    if spec.marketing_change_pct:
        verb = "Spend" if spec.marketing_change_pct > 0 else "Cut marketing spend by"
        amount = f"{abs(round(spec.marketing_change_pct))}% more on marketing" if spec.marketing_change_pct > 0 else (
            f"{abs(round(spec.marketing_change_pct))}%"
        )
        steps.append({"week": 0, "text": f"{verb} {amount}"})
    if spec.extra_stock_weeks > 0:
        spend = spec.extra_stock_weeks * float(profile["weekly_sales"]) * float(profile["unit_cost"])
        weeks = f"{spec.extra_stock_weeks:g}"
        what = mid if mid != "the main input" else "stock"
        steps.append(
            {"week": spec.stock_week,
             "text": f"Order {weeks} extra week{'s' if spec.extra_stock_weeks != 1 else ''} of {what} (about {usd_k(spend, signed=False)})"}
        )
        payback = None if cell is None else cell.get("payback_week")
        if payback is not None and payback > spec.stock_week:
            steps.append({"week": int(payback), "text": "The cash tied up in that stock is back"})
    if spec.price_change_pct:
        new_price = price * (1 + spec.price_change_pct / 100)
        verb = "Raise" if spec.price_change_pct > 0 else "Cut"
        steps.append(
            {"week": spec.price_change_week,
             "text": f"{verb} price {abs(spec.price_change_pct):g}% (${price:.2f} → ${new_price:.2f})"}
        )
    steps.sort(key=lambda s: s["week"])  # stable: same-week steps keep the order above
    return steps or [{"week": 0, "text": "Change nothing"}]
