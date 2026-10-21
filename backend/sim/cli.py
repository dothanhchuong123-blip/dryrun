"""Headless analysis (Milestone A): `uv run python -m backend.sim.cli --example coffee_hcmc`.

    --example ID | --text "..."   the business (an example, or plain words parsed by Super)
    --cheap                       Ultra's calls go to Super (SPEC §7.1 dev rule)
    --offline                     cached Tavily only and a scripted router: no network, $0
    --record                      write fixtures/replays/analysis_<ID>.jsonl and the memo plan's `news` cell replay
                                  (the `news` column is the example's labelled assumption, as with --assumption-news)
    --fresh-news                  re-run the Tavily searches (about 4 credits) instead of reading the cache
    --gut NAME | none             the owner's gut call, from the example's `gut_plans` (default: the first one)
    --replay-cell PLAN SHOCK      replay one cell of the last analysis week by week
    --backtest ID                 a real case (fixtures/backtests/<ID>.json): run as of its date with only the news
                                  before it, then score the advice against the real prices. With --record it writes
                                  backtest_<ID>.jsonl and the pick's cell in the `realized` column. About $0.33 live.

Every run saves its stream to telemetry/last_analysis.jsonl (for --replay-cell) and its memo to
telemetry/last_memo.md. LIVE runs spend real money: about $0.02 with --cheap, $0.08-0.12 at full cost.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from backend.agents import wording
from backend.config import ROOT, get_settings
from backend.services import replay
from backend.sim import backtest as bt
from backend.sim.analysis import Analysis, gut_preset, load_example, parse_profile
from backend.sim.replay_cell import play_cell

LAST_RUN = ROOT / "telemetry" / "last_analysis.jsonl"
LAST_MEMO = ROOT / "telemetry" / "last_memo.md"
RECORD_WEEK_SECONDS = 0.75


def _printer(verbose: bool = True):
    def emit(event: str, data: dict) -> None:
        if event == "analysis":
            print(f"Analysis {data['analysis_id']} ({data['mode']}): {data['profile'].get('business_name')}")
        elif event == "news" and data.get("used_for_grid") is not None:
            print(f"\nNews: {len(data['items'])} items, `news` column from {data['used_for_grid']}")
            for it in data["items"]:
                extra = f" | {it['cost_line']} | impact {wording.usd_k(it['impact_usd'])}" if it.get("cost_line") else ""
                print(f"  [{it['id']}] {it['kind']:<6} {it['title'][:70]}{extra}")
        elif event == "scenarios":
            print(f"\nFutures: {data['thought']}" + ("  [fallback]" if data["fallback_used"] else ""))
            for u in data["unmodelled"]:
                print(f"  not modelled: {u['text']}")
        elif event == "shocks":
            print(wording.futures_block(data["cases"]))
            print()
        elif event == "plan" and data["source"] == "user":
            print(f"[round {data['round']}] owner    (user)   “{data['name']}”")
        elif event == "agent_step" and verbose:
            print(f"[round {data['round']}] {data['kind']:<8} ({data['tier']:<6}) {data['text']}")
        elif event == "backtest":
            _print_backtest(data)
        elif event == "error":
            print(f"ERROR: {data['message']}", file=sys.stderr)
    return emit


def _print_backtest(d: dict) -> None:
    print(f"\n=== Backtest {d['backtest_id']} (as of {d['as_of']}, to {d['horizon_end']}) ===")
    print(f"Real path: {d['realized_case']['label']} | {d['realized_case']['cost_line']}")
    verdict = "beat" if d["beat_do_nothing"] else "did not beat"
    print(f"Pick “{d['pick']}” {verdict} Do nothing: {wording.usd_k(d['pick_delta_usd'])} "
          f"(rank {d['pick_rank']} of {d['n_plans']})")
    hb = d["hindsight_best"]
    print(f"Best in hindsight: “{hb['name']}” {wording.usd_k(hb['mean_delta_usd'])}; regret {wording.usd_k(d['regret_usd'], signed=False)}")
    for b in d["baselines"]:
        print(f"  baseline {b['name']:<22} {wording.usd_k(b['mean_delta_usd'])}")
    fc = d["futures_cover"]
    print(f"Futures covered input {fc['min']:+.0%} to {fc['max']:+.0%}; real peak {fc['realized_peak']:+.0%} "
          f"({'inside' if fc['peak_inside'] else 'outside'}), real end {fc['realized_end']:+.0%} "
          f"({'inside' if fc['end_inside'] else 'outside'})")
    lk = d["leak_check"]
    print(f"Leak check: {'clean' if lk['clean'] else str(len(lk['flags'])) + ' flag(s)'}; dropped news: {d['dropped_news']}")
    for f in lk["flags"]:
        print(f"  - {f['where']}: {f['text']}")


def _print_result(a: Analysis) -> None:
    print("\n=== Grid ($k vs Do nothing: mean / bad case / % better) ===")
    print(wording.results_table(list(a.cells.values()), a.shock_events or [c.to_dict() for c in a.shocks]))
    s = a.summary
    print(f"\nbest today: {s.get('best_today')} · safest: {s.get('safest')}")
    if a.memo:
        print(f"\n=== Memo ===\n{a.memo['headline']}\nPick: {a.memo['plan_name']}")
    snap = a.telemetry_snapshot()
    calls = {t: v["calls"] for t, v in snap["tiers"].items()}
    credits = getattr(a.scout, "credits_used", 0)
    print(f"\nSpend: ${snap['cost_usd']:.4f} on Token Factory (all-Ultra would be ${snap['cost_all_ultra_usd']:.4f}), "
          f"{credits} Tavily credits, calls {json.dumps(calls)}")


async def record_files(a: Analysis, directory: Path | None = None) -> list[Path]:
    """The analysis stream plus the memo plan's `news` cell, in the EVENTS.md replay format."""
    if not a.example_id or a.memo is None:
        raise ValueError("only a finished example analysis can be recorded")
    if a.case is not None:  # a backtest: the stream, and the pick on the real path
        if a.backtest_result is None:
            raise ValueError("the backtest was not scored")
        first = replay.backtest_path(a.case["id"], directory)
        shock = bt.REALIZED_ID
    else:
        first, shock = replay.analysis_path(a.example_id, directory), "news"
    paths = [replay.write(first, a.run_events)]
    plan = a.memo["plan_name"]
    clock = replay.VirtualClock()
    rec = replay.Recorder(clock=clock.now)
    await play_cell(a, plan, shock, rec, week_seconds=RECORD_WEEK_SECONDS, sleep=clock.sleep, use_recording=False)
    paths.append(rec.save(replay.cell_path(a.example_id, plan, shock, directory)))
    return paths


async def _replay_cell(plan: str, shock: str) -> int:
    if not LAST_RUN.exists():
        print("No last analysis yet: run one first.", file=sys.stderr)
        return 2
    a = Analysis.from_events(replay.load(LAST_RUN))
    rows: list[str] = []

    def emit(event: str, data: dict) -> None:
        if event == "replay_start":
            print(f"Replay: “{data['plan_name']}” in {data['shock_id']} ({data['shock_label']}), {data['weeks']} weeks")
            print(f"{'wk':>3} {'price':>8} {'sales':>7} {'stock':>7} {'profit':>9} {'do-nothing':>11}  markers")
        elif event == "tick":
            rows.append(data)
        elif event == "marker":
            print(f"      week {data['week']}: {data['text']}")
        if event == "tick" and data["universe"] == "U2":
            u1 = rows[-2]
            print(f"{u1['tick']:>3} {u1['price'][0]:>8.2f} {u1['sales'][0]:>7.0f} {u1['raw_inv'][0] + u1['inventory'][0]:>7.0f} "
                  f"{u1['profit'][0]:>9.0f} {data['profit'][0]:>11.0f}")
        elif event == "replay_done":
            c = data["cum_profit_usd"]
            print(f"24-week gross profit: plan {wording.usd_k(c['U1'], signed=False)} vs do nothing {wording.usd_k(c['U2'], signed=False)}")

    try:
        await play_cell(a, plan, shock, emit, week_seconds=0)
    except KeyError as e:
        print(f"{e.args[0]}. Plans: {', '.join(a.plans)}. Columns: {', '.join(c.id for c in a.shocks)}", file=sys.stderr)
        return 2
    return 0


async def _run(args: argparse.Namespace) -> int:
    from backend.services.router import NemotronRouter
    from backend.services.tavily_scout import TavilyScout
    from backend.services.telemetry import SpendGuard
    from backend.sim.offline import ScriptedRouter

    router: Any
    if args.offline:
        router = ScriptedRouter()
    else:
        router = NemotronRouter(spend_guard=SpendGuard(get_settings().daily_spend_cap_usd))
    scout = TavilyScout(ROOT / "fixtures" / "tavily_cache", offline=args.offline, router=router)

    case = bt.load_case(args.backtest) if args.backtest else None
    example = load_example(args.example) if args.example else None
    if case is not None:
        profile = case["profile"]
    elif example is not None:
        profile = example["profile"]
    else:
        if args.offline:
            print("--text needs the live profile parser; drop --offline.", file=sys.stderr)
            return 2
        profile, _ = await parse_profile(router, args.text)
        print("Profile:", json.dumps(profile, ensure_ascii=False))
    gut = None
    if example is not None and (args.gut or "").lower() != "none":
        gut = gut_preset(example, args.gut)

    a = Analysis(
        profile=profile, example=example, mode="live", router=router, scout=scout, seed=args.seed,
        gut_plan=gut, n_paths=args.n_paths, cheap=args.cheap, fresh_news=args.fresh_news,
        assumption_news=(args.record or args.assumption_news) and case is None, backtest=case,
    )
    await a.run(_printer())
    _print_result(a)
    replay.write(LAST_RUN, a.run_events)
    LAST_MEMO.write_text(a.memo_markdown(), encoding="utf-8")
    print(f"\nMemo: {LAST_MEMO.relative_to(ROOT)} · stream: {LAST_RUN.relative_to(ROOT)}")
    if args.record:
        for p in await record_files(a):
            print(f"Recorded {p.relative_to(ROOT)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run one analysis headless (profile -> news -> analyst -> memo).")
    who = ap.add_mutually_exclusive_group()
    who.add_argument("--example", help="fixtures/examples/<id>.json, e.g. coffee_hcmc")
    who.add_argument("--backtest", help="fixtures/backtests/<id>.json, e.g. bt_cocoa_2024")
    who.add_argument("--text", help="describe the business in plain words (one Super call to parse it)")
    ap.add_argument("--cheap", action="store_true", help="send Ultra's calls to Super")
    ap.add_argument("--offline", action="store_true", help="cached Tavily and a scripted router, no network")
    ap.add_argument("--fresh-news", action="store_true", help="re-run the Tavily searches instead of the cache (~4 credits)")
    ap.add_argument("--record", action="store_true", help="write the example's replay recordings (implies --assumption-news)")
    ap.add_argument("--assumption-news", action="store_true",
                    help="use the example's labelled assumption for the news column; articles are still shown as cards")
    ap.add_argument("--gut", help="the owner's gut call by name from the example's gut_plans, or 'none'")
    ap.add_argument("--replay-cell", nargs=2, metavar=("PLAN", "SHOCK"), help="replay one cell of the last analysis")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--n-paths", type=int, default=1000)
    args = ap.parse_args(argv)
    if args.replay_cell:
        return asyncio.run(_replay_cell(*args.replay_cell))
    if not (args.example or args.text or args.backtest):
        ap.error("give --example, --backtest or --text (or --replay-cell)")
    if args.fresh_news and args.offline:
        ap.error("--fresh-news needs the network; drop --offline")
    if args.record and (args.offline or args.cheap or not (args.example or args.backtest)):
        ap.error("--record needs a full-cost live run of an --example or --backtest (no --offline, no --cheap)")
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
