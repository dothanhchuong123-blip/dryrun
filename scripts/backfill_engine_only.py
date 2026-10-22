"""Add the engine-only number (`engine_only_delta_usd`, `pick_engine_only_usd`) to recordings made before it existed.

    uv run python scripts/backfill_engine_only.py            # check only: prints what it would add
    uv run python scripts/backfill_engine_only.py --write    # rewrite fixtures/replays/{analysis,backtest}_*.jsonl

Every number comes from the engine, re-run on the recording's own profile, plans, shopper rows and futures with the
analysis's seed and path count. A cell is only touched when the re-run reproduces its recorded `mean_delta_usd`
(to $1), so a recording that can't be replayed exactly is left alone and reported. Nothing else in a line changes:
no plan, shopper row, memo text, pick or score is edited, so the freeze rule (B1) holds.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import ROOT
from backend.engine import planner
from backend.engine.planner import DO_NOTHING, TEXTBOOK_RULE, PlanSpec, ShockCase
from backend.engine.types import CrowdSentiment
from backend.services import replay
from backend.sim import backtest as bt
from backend.sim.analysis import _sentiment

TOL_USD = 1.0
SEED = 0


def _inputs(lines: list[dict]) -> tuple[dict, dict[str, PlanSpec], dict[str, CrowdSentiment], dict[str, ShockCase]]:
    plans: dict[str, PlanSpec] = {}
    crowd: dict[str, CrowdSentiment] = {}
    shocks: dict[str, ShockCase] = {}
    for line in lines:
        ev, d = line["event"], line["data"]
        if ev == "plan":
            plans[d["name"]] = PlanSpec.from_dict(d["spec"])
        elif ev == "crowd":
            crowd[d["plan_name"]] = _sentiment(d["archetypes"])
        elif ev == "shocks":
            shocks |= {c["id"]: ShockCase.from_dict(c) for c in d["cases"]}
    return lines[0]["data"]["profile"], plans, crowd, shocks


def _spec(name: str, plans: dict[str, PlanSpec]) -> PlanSpec | None:
    if name in plans:
        return plans[name]
    return PlanSpec(name=TEXTBOOK_RULE) if name == TEXTBOOK_RULE else None


def backfill(path: Path) -> tuple[list[dict], int, list[str]]:
    lines = replay.load(path)
    profile, plans, crowd, shocks = _inputs(lines)
    weight = lines[0]["data"].get("sentiment_weight", planner.LEGACY_SENTIMENT_WEIGHT)
    cal = planner.calibrate(profile, sentiment_weight=weight)
    n_default = int(lines[0]["data"].get("n_paths", 1000))
    cache: dict[tuple[str, str, int, bool], dict] = {}

    def cell(plan: str, shock: ShockCase, n: int, steady: bool) -> dict | None:
        spec = _spec(plan, plans)
        if spec is None:
            return None
        key = (plan, shock.id, n, steady)
        if key not in cache:
            sent = {plan: crowd[plan]} if plan in crowd else None
            cache[key] = planner.evaluate_grid(cal, [spec], [shock], sent, bt.HORIZON, n, SEED, steady)["cells"][0]
        return cache[key]

    added, misses = 0, []

    def fill(target: dict, plan: str, shock: ShockCase | None, n: int, steady: bool, where: str) -> None:
        nonlocal added
        if plan == DO_NOTHING:
            target["engine_only_delta_usd"] = 0.0
            added += 1
            return
        c = cell(plan, shock, n, steady) if shock is not None else None
        if c is None or abs(c["mean_delta_usd"] - float(target["mean_delta_usd"])) > TOL_USD:
            misses.append(f"{where} {plan!r}: recorded {target['mean_delta_usd']}, re-run "
                          f"{None if c is None else round(c['mean_delta_usd'], 2)}")
            return
        target["engine_only_delta_usd"] = round(c["engine_only_delta_usd"], 2)
        added += 1

    pick = None
    for line in lines:
        ev, d = line["event"], line["data"]
        if ev == "grid_cell":
            n = 10000 if d.get("source") == "cloud" else n_default
            fill(d, d["plan_name"], shocks.get(d["shock_id"]), n, True, "grid_cell")
        elif ev == "memo":
            pick = d["plan_name"]
            fill(d["numbers"], pick, shocks.get(d["numbers"]["shock_id"]), n_default, True, "memo")
        elif ev == "backtest":
            realized = ShockCase.from_dict(d["realized_case"])
            for c in d["cells"]:
                fill(c, c["plan_name"], realized, bt.N_PATHS, False, "backtest")
            by_name = {c["plan_name"]: c for c in d["cells"]}
            if d["pick"] == DO_NOTHING:
                d["pick_engine_only_usd"] = 0.0
            elif "engine_only_delta_usd" in by_name.get(d["pick"], {}):
                d["pick_engine_only_usd"] = by_name[d["pick"]]["engine_only_delta_usd"]
    return lines, added, misses


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    folder = ROOT / "fixtures" / "replays"
    bad = 0
    for path in sorted([*folder.glob("analysis_*.jsonl"), *folder.glob("backtest_*.jsonl")]):
        lines, added, misses = backfill(path)
        bad += len(misses)
        print(f"{path.name:40s} +{added} engine-only numbers, {len(misses)} not reproduced")
        for m in misses[:5]:
            print(f"    {m}")
        if args.write and added:
            replay.write(path, lines)
    return 1 if bad and args.write else 0


if __name__ == "__main__":
    raise SystemExit(main())
