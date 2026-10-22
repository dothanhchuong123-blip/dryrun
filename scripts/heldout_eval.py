"""Test general fixes on the HELD-OUT backtests (fixtures/backtests/ho_*.json), offline and free.

    uv run python scripts/heldout_eval.py               # held-out cases only (where fixes are chosen)
    uv run python scripts/heldout_eval.py --frozen      # also the 4 frozen bt_* cases: run once, AFTER choosing

Each recorded run is replayed with its own plans, shopper rows and futures (Ultra's columns). A "variant" changes
how the shoppers' scores become engine sentiment and/or drops a stale-quote headline; the grid is re-run, the "Best today" label is the pick, and the
pick is scored on the real cost path two ways:
- app:     the realized column with the variant's own shopper sentiment (how the app scores itself);
- neutral: the realized column with NO shopper sentiment, the calibrated engine alone ("today's price is about right").
           This is the fixed yardstick: it doesn't change with the variant, so variants can be compared on it.
Plans stay as recorded: Ultra might have proposed other plans had it seen other numbers, so this is a lower bound
on what a fix changes. Nothing here edits a recording.
"""
from __future__ import annotations

import argparse
import sys
from collections.abc import Callable
from dataclasses import replace
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.engine import planner
from backend.engine.planner import DO_NOTHING, PlanSpec, ShockCase
from backend.engine.types import CrowdSentiment
from backend.services import asof, replay
from backend.sim import backtest as bt
from backend.sim.analysis import _sentiment

N = 1000
SEED = 0

Variant = Callable[[CrowdSentiment, PlanSpec], CrowdSentiment | None]


def as_recorded(s: CrowdSentiment, spec: PlanSpec) -> CrowdSentiment:
    return s


def rival_side_off(s: CrowdSentiment, spec: PlanSpec) -> CrowdSentiment:
    """The plan changes only Firm A, so the rival's side stays neutral (standing loyalty is already in the engine)."""
    mu = s.mu.copy()
    mu[:, 1] = 0.0
    return CrowdSentiment(mu=mu, sigma=s.sigma)


def plan_relative(s: CrowdSentiment, spec: PlanSpec) -> CrowdSentiment:
    """rival_side_off, and A's side may only move the way the plan points: a dearer price with no extra marketing
    can't make a group like you more than doing nothing; a cheaper one can't make it like you less."""
    mu = rival_side_off(s, spec).mu
    if spec.price_change_pct > 0 and spec.marketing_change_pct <= 0:
        mu[:, 0] = np.minimum(mu[:, 0], 0.0)
    elif spec.price_change_pct < 0 and spec.marketing_change_pct >= 0:
        mu[:, 0] = np.maximum(mu[:, 0], 0.0)
    return CrowdSentiment(mu=mu, sigma=s.sigma)


def no_shoppers(s: CrowdSentiment, spec: PlanSpec) -> None:
    return None


# name -> (shopper transform, drop stale-quote headline news, add the mirror-fall column)
VARIANTS: dict[str, tuple[Variant, bool, bool]] = {
    "as recorded": (as_recorded, False, False),
    "mirror fall column": (as_recorded, False, True),
    "rival side off": (rival_side_off, False, False),
    "plan-relative": (plan_relative, False, False),
    "stale news off": (as_recorded, True, False),
    "plan-relative + stale news off": (plan_relative, True, False),
    "no shoppers (yardstick)": (no_shoppers, False, False),
}


def add_mirror_fall(columns: list[ShockCase]) -> list[ShockCase]:
    """A general downside future: the input price falls as far as the worst rise in the grid (capped at -50%).
    Ultra's floors sit near -5% in 9 of 10 recorded cases, so a real fall is never tested."""
    up = max((c.delta_c_raw for c in columns), default=0.0)
    if up <= 0.05:
        return columns
    fall = ShockCase(id="mirror", label="Input price falls back", delta_c_raw=-min(0.5, up), onset_week=2, ramp_weeks=6,
                     likelihood="possible", origin="default")
    return [*columns, fall]


def drop_stale_headline(columns: list[ShockCase], news: dict | None, as_of: date) -> list[ShockCase]:
    """If the `news` column came from a quote that only dates a long-finished move (asof.stale_quote), rebuild it
    from the next-biggest fresh item, as news_watch now does. Ultra's other columns stay as it chose them."""
    if not news:
        return columns
    items = [it for it in news["items"] if it.get("kind") != "market" and it.get("shock")]
    head = next((it for it in items if it["id"] == news["used_for_grid"]), None)
    if head is None or not asof.stale_quote(head.get("quote") or "", as_of):
        return columns
    fresh = [it for it in items if not asof.stale_quote(it.get("quote") or "", as_of)]
    if not fresh:
        return columns
    new = max(fresh, key=lambda it: abs(it.get("impact_usd") or 0.0))["shock"]
    return [replace(c, delta_c_raw=float(new.get("delta_c_raw", 0.0)), delta_lead_time=int(new.get("delta_lead_time", 0)),
                    demand_shock=float(new.get("demand_shock", 0.0))) if c.id == "news" else c for c in columns]


def load_run(case_id: str) -> dict:
    lines = replay.load(replay.backtest_path(case_id))
    plans: dict[str, PlanSpec] = {}
    crowd: dict[str, CrowdSentiment] = {}
    columns: list[ShockCase] = []
    memo = backtest = news = None
    for line in lines:
        ev, d = line["event"], line["data"]
        if ev == "plan":
            plans[d["name"]] = PlanSpec.from_dict(d["spec"])
        elif ev == "crowd":
            crowd[d["plan_name"]] = _sentiment(d["archetypes"])
        elif ev == "shocks":
            columns = [ShockCase.from_dict(c) for c in d["cases"]]
        elif ev == "news":
            news = d
        elif ev == "memo":
            memo = d
        elif ev == "backtest":
            backtest = d
    return {"profile": lines[0]["data"]["profile"], "plans": plans,
            "weight": lines[0]["data"].get("sentiment_weight", planner.LEGACY_SENTIMENT_WEIGHT), "crowd": crowd, "columns": columns,
            "memo": memo, "backtest": backtest, "news": news}


def evaluate(case_id: str, variant: Variant, stale_off: bool = False, mirror: bool = False,
             weight: float | None = None) -> dict:
    case = bt.load_case(case_id)
    run = load_run(case_id)
    cal = planner.calibrate(run["profile"], sentiment_weight=run["weight"])
    if weight is not None:  # the shoppers' sentiment weight (MarketParams.delta) for this run only
        cal = replace(cal, params=replace(cal.params, delta=weight))
    specs = [s for n, s in run["plans"].items() if n != DO_NOTHING]
    crowd = {s.name: c for s in specs if s.name in run["crowd"] and (c := variant(run["crowd"][s.name], s)) is not None}
    columns = drop_stale_headline(run["columns"], run["news"], case["as_of_date"]) if stale_off else run["columns"]
    columns = add_mirror_fall(columns) if mirror else columns
    grid = planner.evaluate_grid(cal, specs, columns, crowd, bt.HORIZON, N, SEED)
    pick = grid["best_today"]
    realized = bt.realized_case(case, cal.profile)

    def on_real(sent: dict) -> dict[str, float]:
        res = planner.evaluate_grid(cal, specs, [realized], sent, bt.HORIZON, N, SEED, steady_rival=False)
        return {c["plan_name"]: float(c["mean_delta_usd"]) for c in res["cells"]} | {DO_NOTHING: 0.0}

    app, neutral = on_real(crowd), on_real({})
    pick_cell = next((c for c in grid["cells"] if c["plan_name"] == pick and c["shock_id"] == "news"), None)
    best_neutral = max(neutral.values())
    cover = bt.futures_cover(columns, realized.cost_path)
    return {
        "pick": pick, "ultra_pick": run["memo"]["plan_name"] if run["memo"] else None,
        "app_usd": app.get(pick, 0.0), "neutral_usd": neutral.get(pick, 0.0),
        "neutral_regret": best_neutral - neutral.get(pick, 0.0),
        "beats_nothing_neutral": neutral.get(pick, 0.0) > 0.0, "covered": cover,
        # the pick's forecast in today's news column, with shoppers and with the engine alone
        "forecast_usd": pick_cell["mean_delta_usd"] if pick_cell else 0.0,
        "forecast_engine_usd": pick_cell["engine_only_delta_usd"] if pick_cell else 0.0,
    }


WEIGHTS = (0.8, 0.4, 0.2, 0.1, 0.05, 0.03, 0.02, 0.01, 0.0)
MOOD_SHARE_MAX = 0.5  # rule fixed before the sweep: shopper mood may explain at most half of a pick's claimed gain


def mood_share(r: dict) -> float:
    """How much of the pick's forecast gain comes from the shoppers' mood rather than the engine, 0-1."""
    f, e = r["forecast_usd"], r["forecast_engine_usd"]
    return 0.0 if abs(f) < 1.0 else min(1.0, abs(f - e) / abs(f))


def sweep(case_ids: list[str], title: str) -> None:
    print(f"\n######## SENTIMENT WEIGHT SWEEP, {title}: rule = largest weight with median mood share <= {MOOD_SHARE_MAX:.0%}")
    for w in WEIGHTS:
        rows = [(cid, evaluate(cid, as_recorded, weight=w)) for cid in case_ids]
        shares = sorted(mood_share(r) for _, r in rows)
        median = float(np.median(shares))
        regret = sum(r["neutral_regret"] for _, r in rows)
        claimed = sum(r["forecast_usd"] for _, r in rows)
        engine = sum(r["forecast_engine_usd"] for _, r in rows)
        print(f"  weight {w:.2f}: median mood share {median:4.0%} · forecasts claim ${claimed / 1000:+.1f}k vs engine "
              f"${engine / 1000:+.1f}k · neutral regret ${regret / 1000:.1f}k · picks: "
              + "; ".join(f"{cid[3:]}={r['pick'][:22]}" for cid, r in rows))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frozen", action="store_true", help="also report the 4 frozen bt_* cases (final test only)")
    ap.add_argument("--sweep", action="store_true", help="only the sentiment-weight sweep")
    args = ap.parse_args()
    if args.sweep:
        held = sorted(p.stem for p in bt.CASES_DIR.glob("ho_*.json") if replay.backtest_path(p.stem).exists())
        sweep(held, "HELD-OUT")
        if args.frozen:
            sweep(sorted(c["id"] for c in bt.list_cases()), "FROZEN (test only)")
        return 0
    ids = sorted(p.stem for p in bt.CASES_DIR.glob("ho_*.json") if replay.backtest_path(p.stem).exists())
    sets = [("HELD-OUT", ids)]
    if args.frozen:
        sets.append(("FROZEN (test only)", sorted(c["id"] for c in bt.list_cases())))
    for title, case_ids in sets:
        print(f"\n######## {title}: {', '.join(case_ids)}")
        for name, (variant, stale_off, mirror) in VARIANTS.items():
            rows = [(cid, evaluate(cid, variant, stale_off, mirror)) for cid in case_ids]
            regret = sum(r["neutral_regret"] for _, r in rows)
            wins = sum(r["beats_nothing_neutral"] for _, r in rows)
            print(f"\n== {name}: total neutral regret ${regret / 1000:,.1f}k · pick beats Do nothing (neutral) {wins}/{len(rows)}")
            for cid, r in rows:
                print(f"   {cid:18s} pick {r['pick'][:30]:30s} app {r['app_usd'] / 1000:+7.1f}k  "
                      f"neutral {r['neutral_usd'] / 1000:+7.1f}k  regret {r['neutral_regret'] / 1000:6.1f}k")
        print("\nFutures vs the real path (Ultra's columns; after the stale-news fix):")
        for cid in case_ids:
            c = evaluate(cid, no_shoppers, True)["covered"]
            print(f"   {cid:18s} futures {c['min']:+.0%}..{c['max']:+.0%}  real peak {c['realized_peak']:+.0%} "
                  f"end {c['realized_end']:+.0%}  peak inside: {c['peak_inside']}  end inside: {c['end_inside']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
