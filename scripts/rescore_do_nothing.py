"""Apply the "Do nothing" pick rule (SPEC §15.5.2, 2026-10-23) to recordings made before it existed.

    uv run python scripts/rescore_do_nothing.py            # check only: prints what would change
    uv run python scripts/rescore_do_nothing.py --write    # rewrite fixtures/replays/{analysis,backtest}_*.jsonl

The rule: when no plan the owner can afford beats doing nothing on average in the news column, "Best today" and the
memo's pick are "Do nothing". No model is called and no cell is re-run. Every number comes from the recording:
- `grid_summary.best_today` becomes "Do nothing" when the plan it names had a news mean <= 0 at that point;
- the `memo` is rebuilt for "Do nothing" with the engine's template words, zero numbers and the runner-up plan;
- the `backtest` score is re-read from its own real-path cells: "Do nothing" gains $0, ranks 1 + the number of tested
  plans that beat it, and is `right` when none did.
A recording whose pick doesn't change is left byte-for-byte alone.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.agents import wording
from backend.agents.analyst import Analyst
from backend.config import ROOT
from backend.engine.planner import DO_NOTHING, PlanSpec
from backend.services import replay

NEWS_ID = "news"


def _zero_numbers(cash: float, n: int) -> dict:
    z = {"cost_usd": 0.0, "price_usd": 0.0, "volume_usd": 0.0, "marketing_usd": 0.0, "holding_usd": 0.0}
    return {
        "shock_id": NEWS_ID, "mean_delta_usd": 0.0, "engine_only_delta_usd": 0.0, "p5_delta_usd": 0.0, "p_better": 0.0,
        "n": n, "verified": False, "bridge": z, "steady_rival_delta_usd": 0.0, "peak_cash_usd": 0.0,
        "payback_week": None, "over_cash": False, "cash_available": cash,
    }


def _runner_up(news: dict[str, dict]) -> dict | None:
    """The best plan by news mean, worded like Analyst._runner_up (a recording has no `last_why` for it)."""
    if not news:
        return None
    name, cell = max(news.items(), key=lambda t: t[1]["mean_delta_usd"])
    if cell["over_cash"]:
        why_not = (f"{name} averages {wording.usd_k(cell['mean_delta_usd'])} in today's news case, but it needs "
                   f"{wording.usd_k(cell['peak_cash_usd'], signed=False)} of cash at its peak, more than you have.")
    else:
        why_not = (f"{name} averages {wording.usd_k(cell['mean_delta_usd'])} in today's news case against $0 for "
                   f"doing nothing; in the bad case it is {wording.usd_k(cell['p5_delta_usd'])}.")
    return {"name": name, "mean_delta_usd": cell["mean_delta_usd"], "p5_delta_usd": cell["p5_delta_usd"], "why_not": why_not}


def rescore(lines: list[dict]) -> tuple[list[dict], list[str]]:
    """The recording with the rule applied, and what changed (empty when nothing did)."""
    out, notes = [], []
    news: dict[str, dict] = {}
    profile: dict = {}
    final_best = None
    for ln in lines:
        ev, data = ln["event"], ln["data"]
        if ev == "analysis":
            profile = data["profile"]
        elif ev == "grid_cell" and data.get("shock_id") == NEWS_ID:
            news[data["plan_name"]] = data
        elif ev == "grid_summary":
            best = data["best_today"]
            if best != DO_NOTHING and best in news and news[best]["mean_delta_usd"] <= 0.0:
                notes.append(f"grid_summary: best_today {best!r} ({news[best]['mean_delta_usd']:+.0f}) -> Do nothing")
                ln = {**ln, "data": {**data, "best_today": DO_NOTHING}}
            final_best = ln["data"]["best_today"]
        elif ev == "memo" and final_best == DO_NOTHING and data["plan_name"] != DO_NOTHING:
            old = data["numbers"]
            notes.append(f"memo: pick {data['plan_name']!r} ({old['mean_delta_usd']:+.0f}) -> Do nothing")
            draft = Analyst._template_memo(DO_NOTHING, False)
            zero = _zero_numbers(old.get("cash_available", 0.0), old["n"])
            ln = {**ln, "data": {
                **data, "plan_name": DO_NOTHING, **draft, "numbers": zero,
                "actions": wording.plan_actions(PlanSpec.do_nothing(), profile, zero), "runner_up": _runner_up(news),
            }}
        elif ev == "backtest" and final_best == DO_NOTHING and data["pick"] != DO_NOTHING:
            rank = 1 + sum(1 for c in data["cells"] if c["mean_delta_usd"] > 1e-9)
            regret = round(max(0.0, data["hindsight_best"]["mean_delta_usd"]), 2)
            notes.append(f"backtest: pick {data['pick']!r} ({data['pick_delta_usd']:+.0f}, rank {data['pick_rank']}) "
                         f"-> Do nothing ($0, rank {rank}, regret ${regret:.0f}, right {rank == 1})")
            ln = {**ln, "data": {
                **data, "pick": DO_NOTHING, "pick_rank": rank, "beat_do_nothing": False, "right": rank == 1,
                "pick_delta_usd": 0.0, "pick_engine_only_usd": 0.0, "regret_usd": regret,
            }}
        out.append(ln)
    return out, notes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--write", action="store_true", help="rewrite the recordings that change")
    args = ap.parse_args()
    for path in sorted((ROOT / "fixtures" / "replays").glob("*.jsonl")):
        if not path.name.startswith(("analysis_", "backtest_")):
            continue
        lines, notes = rescore(replay.load(path))
        if not notes:
            continue
        print(path.name)
        for n in notes:
            print("  " + n)
        if args.write:
            replay.write(path, lines)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
