"""Write the frontend mock data for one example from the real planner (F0).

    uv run python scripts/make_mock_stream.py                 # coffee_austin (the US demo, default)
    uv run python scripts/make_mock_stream.py coffee_hcmc     # the Ho Chi Minh City alternative
    uv run python scripts/make_mock_stream.py --all

Outputs (read by frontend/mock/index.ts), where <id> is the example id:
- frontend/mock/<id>.json          profile, news, shocks, plans, cells, labels, memo numbers, scripted wording
- frontend/mock/<id>_replays.json  one replay per (plan, shock), loaded lazily
- frontend/mock/labels_fixture.json  (coffee_hcmc only; frontend/lib/labels.test.ts reads it)

Every dollar figure comes from `planner.evaluate_grid` / `simulate_detail`. The wording (headlines,
crowd sentiment, agent_step text) is scripted in scripts/mock_wording.py. Re-run after any engine change.
Engine-only: no network, no Token Factory, no Tavily.
"""
# ruff: noqa: C408
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # run as a plain script
from mock_wording import CONFIGS, EXAMPLE_ORDER, MOCKED

from backend.engine.planner import (
    PlanSpec,
    ShockCase,
    _labels,
    calibrate,
    cost_change,
    evaluate_cell,
    evaluate_grid,
    simulate_detail,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "mock"
N_PATHS = 1000
N_SHOPPERS = 200
ARCHETYPES = json.loads((ROOT / "fixtures/archetypes.json").read_text())

# (kind, order in the `bubbles` tuples of mock_wording)
KINDS = ("up", "stock", "plain")


def usd(x: float) -> str:
    return f"{'+' if x >= 0 else '−'}${abs(x):,.0f}"


def crowd_for(cfg: dict, spec: PlanSpec) -> dict:
    """Illustrative mood of all 12 shopper groups toward each firm after a plan (wording only).

    mu = [toward you, toward the rival]; sigma = how much the group varies."""
    up = spec.price_change_pct > 0
    stock = spec.extra_stock_weeks > 0 and not up
    kind = 0 if up else 1 if stock else 2
    arch = []
    for a in ARCHETYPES:
        hunter = a["sensitivity"] == "hunter"
        mine = a["loyalty"] == "A"
        income = {"low": 1.3, "mid": 1.0, "high": 0.6}[a["income"]]
        if up:
            mu_a = -(0.35 if hunter else 0.1) * income * (0.6 if mine else 1.2)
            mu_b = 0.15 if hunter else 0.03
        else:
            mu_a = (0.04 if hunter else 0.1) if spec.extra_stock_weeks else 0.0
            mu_b = 0.0
            if spec.switch_supplier:
                mu_a = 0.03
        if spec.marketing_change_pct > 0:
            mu_a += 0.05
        arch.append({"id": a["id"], "label": a["label"],
                     "mu": [round(max(-1.0, min(1.0, mu_a)), 2), round(mu_b, 2)],
                     "sigma": [0.18, 0.12],
                     "bubble": cfg["bubbles"][a["id"]][kind]})
    return {"plan_name": spec.name, "archetypes": arch}


def build(ex_id: str) -> None:
    cfg = CONFIGS[ex_id]
    ex_file = json.loads((ROOT / f"fixtures/examples/{ex_id}.json").read_text())
    profile = ex_file["profile"]
    if cfg.get("business_name"):
        profile["business_name"] = cfg["business_name"]
    cal = calibrate(profile)

    # ---- the futures (columns) ---------------------------------------------------------------
    SHOCKS = [dict(s) for s in cfg["shocks"]]
    cases = [ShockCase.from_dict(s) for s in SHOCKS]
    share = profile["exposed_cost_share"] * 100
    word, noun = cfg["input_word"], cfg["input_noun"]
    for s, c in zip(SHOCKS, cases):
        cc = cost_change(profile, c)
        if abs(c.delta_c_raw) < 1e-9:
            line = None
        else:
            line = (f"{word} {c.delta_c_raw*100:+.0f}% × {share:.0f}% of your cost is {noun}"
                    f" = your cost {cc['pct']:+.0f}% ({'+' if cc['usd_per_unit'] >= 0 else '−'}"
                    f"${abs(cc['usd_per_unit']):.2f} a {cfg['unit']})")
        s["cost_line"] = line
        s["delta_lead_time"] = c.delta_lead_time
        for k in ("demand_shock", "rival_price_change_pct", "share_shift_pct"):
            s.setdefault(k, 0.0)
        s["label"] = c.label

    # ---- plans -------------------------------------------------------------------------------
    PLANS = cfg["plans"]
    specs = [PlanSpec.from_dict(p[2]) for p in PLANS]

    grid = evaluate_grid(cal, specs, [*cases], n_paths=N_PATHS)
    none_case = ShockCase.from_dict(dict(id="none", label="No change"))
    base_none = evaluate_grid(cal, specs[:1], [none_case], n_paths=N_PATHS)["baseline_profit_usd"]["none"]
    cells = grid["cells"]
    for c in cells:
        for k in ("mean_delta_usd", "p5_delta_usd", "mean_profit_usd", "steady_rival_delta_usd", "peak_cash_usd"):
            c[k] = round(c[k], 2)
        c["p_better"] = round(c["p_better"], 3)
        c["bridge"] = {k: round(v, 2) for k, v in c["bridge"].items()}
        c["source"] = "local"
        # bridge lines are rounded individually; mean_delta is their exact sum
        c["mean_delta_usd"] = round(sum(c["bridge"].values()), 2)
    baseline = {k: round(v, 2) for k, v in grid["baseline_profit_usd"].items()}
    best, safest = grid["best_today"], grid["safest"]

    # ---- news (impact of "Do nothing" vs no change, same engine) ------------------------------
    news_impact = baseline["news"] - base_none
    NEWS = [dict(n) for n in cfg["news"]]
    NEWS[0].update(cost_line=SHOCKS[0]["cost_line"], impact_usd=round(news_impact))
    # n2 gets its own impact so the "Your numbers" panel has two supply cards with real figures
    d2 = NEWS[1]["shock"]["delta_c_raw"]
    n2_case = ShockCase.from_dict(dict(id="n2", label="x", delta_c_raw=d2, delta_lead_time=0, onset_week=2,
                                       ramp_weeks=3))
    n2_base = evaluate_grid(cal, specs[:1], [n2_case], n_paths=N_PATHS)["baseline_profit_usd"]["n2"]
    NEWS[1]["impact_usd"] = round(n2_base - base_none)
    cc2 = cost_change(profile, n2_case)
    NEWS[1]["cost_line"] = (f"{word} {d2*100:+.0f}% × {share:.0f}% of your cost is {noun} = your cost "
                            f"{cc2['pct']:+.0f}% (+${cc2['usd_per_unit']:.2f} a {cfg['unit']})")

    # ---- user-plan library (mock addPlan snaps to the nearest) --------------------------------
    LIB = []
    for stock in (0, 2, 4, 6, 8):
        for pct in (-5, 0, 3, 6):
            if stock == 0 and pct == 0:
                continue
            sp = PlanSpec.from_dict(dict(name="lib", extra_stock_weeks=stock, stock_week=0, price_change_pct=pct,
                                         price_change_week=3 if pct else 0))
            row = []
            for c in cases:
                r = evaluate_cell(cal, sp, c, n_paths=N_PATHS)
                r["bridge"] = {k: round(v, 2) for k, v in r["bridge"].items()}
                r["mean_delta_usd"] = round(sum(r["bridge"].values()), 2)
                for k in ("p5_delta_usd", "mean_profit_usd", "steady_rival_delta_usd", "peak_cash_usd"):
                    r[k] = round(r[k], 2)
                r["p_better"] = round(r["p_better"], 3)
                r["source"] = "local"
                row.append({k: v for k, v in r.items() if k not in ("plan_name",)})
            LIB.append({"extra_stock_weeks": stock, "price_change_pct": pct, "cells": row})

    # ---- memo ---------------------------------------------------------------------------------
    memo_cell = next(c for c in cells if c["plan_name"] == best and c["shock_id"] == "news")
    memo = {
        "plan_name": best,
        "numbers": {"shock_id": "news", **{k: memo_cell[k] for k in (
            "mean_delta_usd", "p5_delta_usd", "p_better", "n", "bridge", "steady_rival_delta_usd", "peak_cash_usd",
            "payback_week", "over_cash")}, "verified": False, "cash_available": profile["cash_available"]},
        "cost_line": SHOCKS[0]["cost_line"],
    }

    # ---- replays ------------------------------------------------------------------------------
    idx = np.linspace(0, 499, N_SHOPPERS).astype(int)

    def replay(spec: PlanSpec, case: ShockCase) -> dict:
        d = simulate_detail(cal, spec, case)
        ticks = []
        for w in d["weeks"]:
            u1 = dict(w["U1"])
            ch = np.asarray(u1.pop("choices"), dtype=np.int8)[idx]
            u1["choices_b64"] = base64.b64encode(ch.tobytes()).decode()
            ticks.append({"U1": u1, "U2": dict(w["U2"])})
        return {"plan_name": spec.name, "shock_id": case.id, "shock_label": case.label, "weeks": ticks,
                "markers": d["markers"], "cum_profit_usd": {"U1": ticks[-1]["U1"]["cum_profit"][0],
                                                           "U2": ticks[-1]["U2"]["cum_profit"][0]}}

    replays = {f"{s.name}|{c.id}": replay(s, c) for s in specs for c in cases}

    examples = []
    for eid in EXAMPLE_ORDER:  # the US example first, then the alternative, then the rest
        e = json.loads((ROOT / f"fixtures/examples/{eid}.json").read_text())
        examples.append({"id": eid, "title": e["title"], "subtitle": e["subtitle"], "text": e["text"],
                         "has_replay": eid in MOCKED, "profile": e["profile"]})

    data = {
        "example_id": ex_id,
        "examples": examples,
        "note": "Generated by scripts/make_mock_stream.py from backend.engine.planner. Do not hand-edit.",
        "profile": profile, "news": NEWS, "shocks": SHOCKS,
        "plans": [{"name": s.name, "source": p[0], "round": p[1], "spec": s.to_dict()} for s, p in zip(specs, PLANS)],
        "crowd": [crowd_for(cfg, s) for s in specs], "cells": cells, "baseline_profit_usd": baseline,
        "baseline_no_change_usd": round(base_none, 2), "best_today": best, "safest": safest,
        "memo": memo, "library": LIB, "n_shoppers": N_SHOPPERS, "script": cfg["script"],
    }
    (OUT / f"{ex_id}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    (OUT / f"{ex_id}_replays.json").write_text(json.dumps(replays, ensure_ascii=False, separators=(",", ":")))
    print(f"[{ex_id}] best", best, "safest", safest, "news impact", usd(news_impact), "cells", len(cells))
    for c in cells:
        print(f"{c['plan_name']:32s} {c['shock_id']:5s} {c['mean_delta_usd']:9.0f} p5 {c['p5_delta_usd']:8.0f} "
              f"cash {c['peak_cash_usd']:7.0f} over {c['over_cash']} wk {c['payback_week']}")

    # ---- fixture for frontend/lib/labels.test.ts: planner._labels at several cash levels ---------
    if ex_id != "coffee_hcmc":
        return
    all_plans = [PlanSpec.do_nothing(), *specs]
    by_plan: dict[int, dict[str, dict]] = {i: {} for i in range(1, len(all_plans))}
    for c in cells:
        by_plan[[s.name for s in all_plans].index(c["plan_name"])][c["shock_id"]] = c
    cases_out = []
    for cash in (0, 2000, 5000, 8000, 11000, 20000):
        for row in by_plan.values():
            for sid, c in list(row.items()):
                c = dict(c)
                c["over_cash"] = bool(cash > 0 and c["peak_cash_usd"] > cash)
                row[sid] = c
        b, s_ = _labels(all_plans, cases, by_plan)
        cases_out.append({"cash_available": cash, "best_today": b, "safest": s_})
    (OUT / "labels_fixture.json").write_text(json.dumps(
        {"shocks": [{"id": s["id"], "likelihood": s["likelihood"]} for s in SHOCKS],
         "cells": cells, "expected": cases_out}, separators=(",", ":")))
    print("labels fixture:", [(c["cash_available"], c["best_today"], c["safest"]) for c in cases_out])


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    ids = list(MOCKED) if "--all" in sys.argv else args or [MOCKED[0]]
    for i in ids:
        build(i)
