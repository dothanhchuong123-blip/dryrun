"""Write the frontend mock data for coffee_hcmc from the real planner (F0).

    uv run python scripts/make_mock_stream.py

Outputs (both read by frontend/mock/index.ts):
- frontend/mock/coffee_hcmc.json         profile, news, shocks, plans, cells, labels, memo numbers
- frontend/mock/coffee_hcmc_replays.json one replay per (plan, shock), loaded lazily

Every dollar figure comes from `planner.evaluate_grid` / `simulate_detail`. The wording (headlines,
crowd sentiment, agent_step text) is scripted. Re-run after any engine change (P2b changed numbers).
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np

from backend.engine.planner import (
    DO_NOTHING,
    PlanSpec,
    ShockCase,
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

profile = json.loads((ROOT / "fixtures/examples/coffee_hcmc.json").read_text())["profile"]
profile["business_name"] = "Saigon Roasters"
cal = calibrate(profile)


def usd(x: float) -> str:
    return f"{'+' if x >= 0 else '−'}${abs(x):,.0f}"


# ---- the five futures (columns) -------------------------------------------------------------
SHOCKS = [
    dict(id="news", label="Beans +31% (today's news)", delta_c_raw=0.31, delta_lead_time=1, onset_week=2,
         ramp_weeks=3, likelihood="likely", why="Robusta futures hit a record and exporters are holding back stock",
         source_ids=["n1"], origin="news"),
    dict(id="s1", label="Beans +45%, shipping +2 wk", delta_c_raw=0.45, delta_lead_time=2, onset_week=2,
         ramp_weeks=4, likelihood="possible", why="If the dry spell in the Highlands lasts, prices could keep climbing",
         source_ids=["n1", "n2"], origin="ai"),
    dict(id="s2", label="Beans +31%, Highland cuts 5%", delta_c_raw=0.31, delta_lead_time=1, onset_week=2,
         ramp_weeks=3, rival_price_change_pct=-5, likelihood="possible",
         why="Highland is bigger and may defend its cafés", source_ids=["n1", "m1"], origin="ai"),
    dict(id="s3", label="New chain takes 8% of cafés", delta_c_raw=0.31, delta_lead_time=1, onset_week=2,
         ramp_weeks=3, share_shift_pct=8, likelihood="possible",
         why="Today's beans news, plus a chain that roasts its own taking cafés", source_ids=["m1"], origin="ai"),
    dict(id="s4", label="Beans ease back −12%", delta_c_raw=-0.12, delta_lead_time=0, onset_week=3,
         ramp_weeks=3, likelihood="unlikely", why="A good harvest could pull prices down again",
         source_ids=["n2"], origin="ai"),
]
cases = [ShockCase.from_dict(s) for s in SHOCKS]
for s, c in zip(SHOCKS, cases):
    cc = cost_change(profile, c)
    if abs(c.delta_c_raw) < 1e-9:
        line = None
    else:
        word = "Beans"
        line = (f"{word} {c.delta_c_raw*100:+.0f}% × {profile['exposed_cost_share']*100:.0f}% of your cost is beans"
                f" = your cost {cc['pct']:+.0f}% ({'+' if cc['usd_per_unit'] >= 0 else '−'}"
                f"${abs(cc['usd_per_unit']):.2f} a bag)")
    s["cost_line"] = line
    s["delta_lead_time"] = c.delta_lead_time
    for k in ("demand_shock", "rival_price_change_pct", "share_shift_pct"):
        s.setdefault(k, 0.0)
    s["label"] = c.label

# ---- plans ------------------------------------------------------------------------------------
PLANS = [
    ("seed", 0, dict(name="Stock up 4 weeks", extra_stock_weeks=4, stock_week=0)),
    ("seed", 0, dict(name="Raise price 4% from week 2", price_change_pct=4, price_change_week=2)),
    ("seed", 0, dict(name="Backup supplier", switch_supplier=True, alt_cost_change_pct=8, alt_lead_time_weeks=2,
                     alt_shock_exposure=0.3)),
    ("ai", 1, dict(name="Stock up 6 weeks", extra_stock_weeks=6, stock_week=0)),
    ("ai", 1, dict(name="Stock 3 wk + raise 3% wk 3", extra_stock_weeks=3, stock_week=0, price_change_pct=3,
                   price_change_week=3)),
    ("ai", 2, dict(name="Stock 4 wk + raise 3% wk 3", extra_stock_weeks=4, stock_week=0, price_change_pct=3,
                   price_change_week=3)),
    ("ai", 2, dict(name="Raise 3% + more marketing", price_change_pct=3, price_change_week=3,
                   marketing_change_pct=20)),
]
specs = [PlanSpec.from_dict(p[2]) for p in PLANS]

# Crowd sentiment is illustrative (wording only): the groups' mood toward you after each plan.
GROUPS = [("Price-hunting cafés", "hunter"), ("Loyal regulars", "loyal"), ("Quality-first cafés", "quality"),
          ("Occasional buyers", "casual")]


def crowd_for(spec: PlanSpec) -> dict:
    up = spec.price_change_pct > 0
    arch = []
    for i, (label, kind) in enumerate(GROUPS):
        mu_a = {"hunter": -0.25 if up else 0.05, "loyal": 0.1, "quality": 0.08 if spec.extra_stock_weeks else 0.0,
                "casual": -0.1 if up else 0.0}[kind] + 0.05 * (spec.marketing_change_pct > 0)
        arch.append({"id": i + 1, "label": label, "mu": [round(mu_a, 2), 0.0], "sigma": [0.18, 0.12],
                     "bubble": {"hunter": "Cheaper next door?", "loyal": "Still our roaster",
                                "quality": "Fresh beans matter", "casual": "Maybe skip a week"}[kind]})
    return {"plan_name": spec.name, "archetypes": arch}


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

# ---- news (impact of "Do nothing" vs no change, same engine) --------------------------------
news_impact = baseline["news"] - base_none
NEWS = [
    dict(id="n1", kind="supply", title="Robusta prices hit a record high as Vietnamese exporters hold back stock",
         url="https://example.com/news/robusta-record", source="Reuters", published="2026-10-12",
         quote="robusta futures rose 31% in four weeks to a record as exporters held back supply",
         shock=dict(delta_c_raw=0.31, delta_lead_time=1, demand_shock=0.0), cost_line=SHOCKS[0]["cost_line"],
         impact_usd=round(news_impact), impact_p5_usd=None, live=False, applied=True),
    dict(id="n2", kind="supply", title="Dry spell in the Central Highlands threatens the next harvest",
         url="https://example.com/news/highlands-dry", source="VnExpress", published="2026-10-09",
         quote="traders expect beans to climb another 25% if the dry spell holds",
         shock=dict(delta_c_raw=0.25, delta_lead_time=0, demand_shock=0.0),
         cost_line=None, impact_usd=None, impact_p5_usd=None, live=False, applied=False),
    dict(id="m1", kind="market", title="New café chain plans 40 outlets in Ho Chi Minh City by next year",
         url="https://example.com/news/new-chain", source="Tuoi Tre", published="2026-10-10",
         quote="the chain will roast its own beans and sell below established brands", shock=None,
         cost_line=None, impact_usd=None, impact_p5_usd=None, live=False, applied=False),
    dict(id="m2", kind="market", title="Highland Supply says it will protect its café accounts this quarter",
         url="https://example.com/news/highland", source="Saigon Times", published="2026-10-08",
         quote="we will not pass the whole increase on to our cafés", shock=None, cost_line=None,
         impact_usd=None, impact_p5_usd=None, live=False, applied=False),
]
# n2 gets its own impact so the "Your numbers" panel has two supply cards with real figures
n2_case = ShockCase.from_dict(dict(id="n2", label="x", delta_c_raw=0.25, delta_lead_time=0, onset_week=2, ramp_weeks=3))
n2_base = evaluate_grid(cal, specs[:1], [n2_case], n_paths=N_PATHS)["baseline_profit_usd"]["n2"]
NEWS[1]["impact_usd"] = round(n2_base - base_none)
cc2 = cost_change(profile, n2_case)
NEWS[1]["cost_line"] = (f"Beans +25% × 85% of your cost is beans = your cost {cc2['pct']:+.0f}% "
                        f"(+${cc2['usd_per_unit']:.2f} a bag)")

# ---- user-plan library (mock addPlan snaps to the nearest) ------------------------------------
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
memo_spec = next(s for s in specs if s.name == best)
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
# the library plans reuse the nearest seeded replay in the mock (replays for them are not recorded)

examples = []
for ex_id in ("coffee_hcmc", "pc_parts", "furniture_eu"):
    ex = json.loads((ROOT / f"fixtures/examples/{ex_id}.json").read_text())
    examples.append({"id": ex_id, "title": ex["title"], "subtitle": ex["subtitle"], "text": ex["text"],
                     "has_replay": ex_id == "coffee_hcmc", "profile": ex["profile"]})

data = {
    "examples": examples, "note": "Generated by scripts/make_mock_stream.py from backend.engine.planner. Do not hand-edit.",
    "profile": profile, "news": NEWS, "shocks": SHOCKS,
    "plans": [{"name": s.name, "source": p[0], "round": p[1], "spec": s.to_dict()} for s, p in zip(specs, PLANS)],
    "crowd": [crowd_for(s) for s in specs], "cells": cells, "baseline_profit_usd": baseline,
    "baseline_no_change_usd": round(base_none, 2), "best_today": best, "safest": safest,
    "memo": memo, "library": LIB, "n_shoppers": N_SHOPPERS,
}
(OUT / "coffee_hcmc.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
(OUT / "coffee_hcmc_replays.json").write_text(json.dumps(replays, ensure_ascii=False, separators=(",", ":")))
print("best", best, "safest", safest, "news impact", usd(news_impact), "cells", len(cells))
for c in cells:
    print(f"{c['plan_name']:32s} {c['shock_id']:5s} {c['mean_delta_usd']:9.0f} p5 {c['p5_delta_usd']:8.0f} "
          f"cash {c['peak_cash_usd']:7.0f} over {c['over_cash']} wk {c['payback_week']}")

# ---- fixture for frontend/lib/labels.test.ts: planner._labels at several cash levels -------------
from backend.engine.planner import _labels  # noqa: E402

all_plans = [PlanSpec.do_nothing(), *specs]
by_plan: dict[int, dict[str, dict]] = {i: {} for i in range(1, len(all_plans))}
for c in cells:
    by_plan[[s.name for s in all_plans].index(c["plan_name"])][c["shock_id"]] = c
cases_out = []
for cash in (0, 2000, 5000, 8000, 11000, 20000):
    for i in by_plan:
        for sid, c in by_plan[i].items():
            c = dict(c)
            c["over_cash"] = bool(cash > 0 and c["peak_cash_usd"] > cash)
            by_plan[i][sid] = c
    b, s_ = _labels(all_plans, cases, by_plan)
    cases_out.append({"cash_available": cash, "best_today": b, "safest": s_})
(OUT / "labels_fixture.json").write_text(json.dumps(
    {"shocks": [{"id": s["id"], "likelihood": s["likelihood"]} for s in SHOCKS],
     "cells": cells, "expected": cases_out}, separators=(",", ":")))
print("labels fixture:", [(c["cash_available"], c["best_today"], c["safest"]) for c in cases_out])
