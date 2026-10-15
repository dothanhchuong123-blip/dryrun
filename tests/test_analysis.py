"""P4 tests: analysis orchestrator, cell replay, replay player, CLI recording. Scripted router, fake Tavily, no network."""
import base64
import json
from pathlib import Path

import numpy as np
import pytest

from backend.agents.schemas import AnalystStep, Evidence, ShockVector
from backend.engine import planner
from backend.engine.planner import PlanSpec
from backend.services import replay
from backend.services.tavily_scout import TavilyScout
from backend.sim import cli
from backend.sim.analysis import MAX_USER_PLANS, Analysis, _RouterProxy, gut_preset, load_example
from backend.sim.offline import STEPS, ScriptedRouter
from backend.sim.replay_cell import play_cell

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = load_example("coffee_hcmc")
N = 200

ARTICLE = ("Robusta futures rose 31% in a month as Vietnam's harvest fell short, traders said on Tuesday. "
           "Exporters expect prices to stay high through the year.")
SNIPPET = ARTICLE * 2


class FakeClient:
    async def search(self, **kw):
        if kw.get("topic") == "general":
            return {"results": [{"url": "https://vnexpress.net/chain-opens", "title": "Chuỗi mới khai trương",
                                 "content": "Một chuỗi cà phê mới " * 20, "score": 0.6}]}
        return {"results": [{"url": "https://reuters.com/world/robusta-record", "title": "Robusta hits record",
                             "content": SNIPPET, "score": 0.9, "published_date": "Wed, 14 Oct 2026 08:00:00 GMT"}]}

    async def extract(self, **kw):
        return {"results": [{"url": u, "raw_content": ARTICLE} for u in kw["urls"]]}


SHOCK = ShockVector(delta_c_raw=0.31, delta_lead_time=1, demand_shock=-0.05, severity=0.6,
                    evidence=[Evidence(quote="Robusta futures rose 31% in a month", url="https://reuters.com/world/robusta-record")])


def make_router(script=None):
    return ScriptedRouter({ShockVector: [SHOCK] * 3, **(script or {})})


def make_analysis(tmp_path, router=None, **kw):
    kw.setdefault("gut_plan", gut_preset(EXAMPLE))
    return Analysis(
        example=EXAMPLE, mode="live", router=router or make_router(),
        scout=TavilyScout(tmp_path / "cache", client=FakeClient()), n_paths=N, **kw,
    )


class Rec:
    def __init__(self):
        self.events = []

    def __call__(self, event, data):
        self.events.append((event, json.loads(json.dumps(data))))

    def names(self):
        return [e for e, _ in self.events]

    def of(self, name):
        return [d for e, d in self.events if e == name]


async def run(tmp_path, **kw):
    a = make_analysis(tmp_path, **kw)
    rec = Rec()
    await a.run(rec)
    return a, rec


# Keys per docs/EVENTS.md v2.1
SHOCK_KEYS = {"id", "label", "delta_c_raw", "delta_lead_time", "demand_shock", "onset_week", "ramp_weeks",
              "rival_price_change_pct", "share_shift_pct", "likelihood", "why", "source_ids", "origin", "cost_line"}
KEYS = {
    "analysis": {"analysis_id", "mode", "example_id", "profile", "horizon_weeks", "n_paths"},
    "news": {"items", "used_for_grid"},
    "scenarios": {"thought", "unmodelled", "fallback_used"},
    "shocks": {"cases"},
    "plan": {"name", "source", "round", "spec"},
    "crowd": {"plan_name", "archetypes"},
    "grid_cell": {"plan_name", "shock_id", "n", "mean_delta_usd", "p5_delta_usd", "p_better", "mean_profit_usd", "source",
                  "bridge", "steady_rival_delta_usd", "peak_cash_usd", "payback_week", "over_cash"},
    "grid_summary": {"baseline_profit_usd", "best_today", "safest", "verified"},
    "agent_step": {"round", "kind", "text", "plan_name", "tier", "latency_ms"},
    "reasoning": {"role", "round", "delta"},
    "reasoning_done": {"role", "round"},
    "memo": {"plan_name", "headline", "why", "watch_out", "recheck_when", "numbers", "cost_line", "sources",
             "not_modelled", "fallback_used", "actions", "runner_up"},
    "telemetry": {"tiers", "call_share", "token_share", "cost_usd", "cost_all_ultra_usd", "savings_pct", "job"},
    "done": {"analysis_id", "cost_usd"},
    "error": {"message", "recoverable"},
}
NEWS_ITEM_KEYS = {"id", "kind", "title", "url", "source", "published", "quote", "shock", "cost_line", "impact_usd",
                  "impact_p5_usd", "live", "applied"}
CROWD_KEYS = {"id", "label", "mu", "sigma", "bubble"}
BRIDGE_KEYS = {"cost_usd", "price_usd", "volume_usd", "marketing_usd", "holding_usd"}
MEMO_NUMBER_KEYS = {"shock_id", "mean_delta_usd", "p5_delta_usd", "p_better", "n", "verified", "bridge",
                    "steady_rival_delta_usd", "peak_cash_usd", "payback_week", "over_cash", "cash_available"}
TICK_KEYS = {"tick", "universe", "price", "qty", "demand", "sales", "unmet", "spill_in", "lost", "inventory", "raw_inv",
             "rop", "orders", "profit", "cum_profit", "shares", "c_raw", "lead_time", "mc", "atc", "bullwhip",
             "unit_cost", "cover_weeks", "in_transit", "old_cost_share", "spot_cost"}


async def test_full_analysis_emits_every_event_in_order_with_contract_keys(tmp_path):
    a, rec = await run(tmp_path)
    names = rec.names()
    expected = set(KEYS) - {"error"}
    assert expected <= set(names), expected - set(names)
    assert "error" not in names
    assert names[-2:] == ["telemetry", "done"]
    names = [n for n in names if n != "telemetry"]  # telemetry follows LLM calls, so it can come anywhere
    assert names[:2] == ["analysis", "news"]
    assert names.index("scenarios") < names.index("shocks") < names.index("plan")
    assert names.index("memo") == len(names) - 2
    seen_plans: set[str] = set()
    for event, data in rec.events:
        assert set(data) == KEYS[event], (event, set(data) ^ KEYS[event])
        if event == "plan":
            seen_plans.add(data["name"])
        if event in ("grid_cell", "crowd"):
            assert data["plan_name"] in seen_plans  # a row is announced before its numbers
        if event == "grid_cell":
            assert set(data["bridge"]) == BRIDGE_KEYS and data["source"] == "local" and data["n"] == N
            assert abs(sum(data["bridge"].values()) - data["mean_delta_usd"]) < 1.0
        if event == "agent_step":
            assert len(data["text"]) <= 300
    news = rec.of("news")[0]
    assert all(set(i) == NEWS_ITEM_KEYS for i in news["items"]) and news["used_for_grid"] == "n1"
    assert {i["kind"] for i in news["items"]} == {"supply", "market"}
    cases = rec.of("shocks")[0]["cases"]
    assert 2 <= len(cases) <= 6 and cases[0]["id"] == "news" and all(set(c) == SHOCK_KEYS for c in cases)
    assert all(set(r) == CROWD_KEYS for c in rec.of("crowd") for r in c["archetypes"])
    memo = rec.of("memo")[0]
    assert set(memo["numbers"]) == MEMO_NUMBER_KEYS
    # the owner's gut call is a user row tested with the seed plans, and Ultra was told about it
    gut = [p for p in rec.of("plan") if p["source"] == "user"]
    assert [p["name"] for p in gut] == ["Your gut call: Raise price 10% now"] and gut[0]["round"] == 0
    assert rec.of("analysis")[0]["example_id"] == "coffee_hcmc"
    assert rec.of("done")[0]["analysis_id"] == a.analysis_id
    # every grid cell landed in the state, and the summary is the engine's
    assert len(a.cells) == len(a.plans) * len(cases) == len(rec.of("grid_cell"))
    assert a.memo == memo and a.summary == rec.of("grid_summary")[-1]


async def test_gut_call_is_named_in_the_analyst_prompt(tmp_path):
    router = make_router()
    seen = []
    orig = router.call

    async def spy(tier, messages, schema, **kw):
        if schema is AnalystStep:
            seen.append(messages[-1]["content"])
        return await orig(tier, messages, schema, **kw)

    router.call = spy
    await run(tmp_path, router=router)
    assert seen
    assert '"Your gut call: Raise price 10% now" is the owner\'s own idea' in seen[0]


async def test_gut_call_equal_to_a_seed_takes_its_row_and_wait_and_see_is_a_note(tmp_path):
    _, rec = await run(tmp_path, gut_plan=gut_preset(EXAMPLE, "Stock up 4 weeks now"))
    names = [p["name"] for p in rec.of("plan") if p["round"] == 0]
    assert names == ["Raise price 5% now", "Your gut call: Stock up 4 weeks now"]
    _, rec = await run(tmp_path, gut_plan=gut_preset(EXAMPLE, "Wait and see"))
    assert not [p for p in rec.of("plan") if p["source"] == "user"]
    assert any("wait and see" in s["text"] for s in rec.of("agent_step"))


async def test_telemetry_is_throttled_to_one_a_second(tmp_path):
    _, rec = await run(tmp_path, clock=lambda: 100.0)  # a clock that never moves: one mid-run event, then the final one
    tel = rec.of("telemetry")
    assert len(tel) == 2
    calls = tel[-1]["tiers"]
    assert calls["ultra"]["calls"] == 4 and calls["super"]["calls"] >= 1 and calls["fast"]["calls"] >= 8
    assert rec.of("done")[0]["cost_usd"] == 0.0


async def test_add_user_plan_in_replay_is_engine_only_and_matches_evaluate_cell(tmp_path):
    a, _ = await run(tmp_path)
    router = make_router()
    b = Analysis.from_events(a.run_events, router=router, mode="replay")
    rec = Rec()
    spec = PlanSpec(name="Raise 2% wk 6 + stock 1 wk", price_change_pct=2, price_change_week=6, extra_stock_weeks=1)
    res = await b.add_user_plan(spec.to_dict(), rec)
    assert res == {"accepted": True, "plan_name": spec.name}
    assert router.calls == []  # no LLM call in REPLAY
    assert rec.names() == ["plan"] + ["grid_cell"] * len(b.shocks) + ["grid_summary"]
    assert rec.of("plan")[0]["source"] == "user"
    for cell, case in zip(rec.of("grid_cell"), b.shocks, strict=True):
        want = planner.evaluate_cell(b.cal, spec, case, None, 24, N, b.seed)
        assert cell == json.loads(json.dumps({**want, "source": "local"}))
    assert set(rec.of("grid_summary")[0]) == KEYS["grid_summary"]


async def test_add_user_plan_limits(tmp_path):
    a, _ = await run(tmp_path)
    b = Analysis.from_events(a.run_events, mode="replay")
    rec = Rec()
    assert not (await b.add_user_plan(PlanSpec(name="Nothing at all"), rec))["accepted"]
    assert not (await b.add_user_plan(PlanSpec(name="Same as seed", price_change_pct=5), rec))["accepted"]
    for i in range(MAX_USER_PLANS):
        assert (await b.add_user_plan(PlanSpec(name="Raise price 5% now", price_change_pct=i + 1.5), rec))["accepted"]
    assert not (await b.add_user_plan(PlanSpec(name="One too many", price_change_pct=-7), rec))["accepted"]
    names = [p["name"] for p in rec.of("plan")]
    assert len(set(names)) == MAX_USER_PLANS and "Raise price 5% now (2)" in names  # a taken name is renamed


async def test_add_user_plan_in_live_asks_the_shoppers_once(tmp_path):
    a, _ = await run(tmp_path)
    router = make_router()
    b = Analysis.from_events(a.run_events, router=router, mode="live")
    rec = Rec()
    await b.add_user_plan(PlanSpec(name="Cut 3%", price_change_pct=-3), rec)
    assert [c[0] for c in router.calls] == ["fast", "fast"]
    assert [n for n in rec.names() if n != "telemetry"][:2] == ["plan", "crowd"] and "telemetry" in rec.names()


async def test_play_cell_streams_24_weeks_of_ticks_and_markers(tmp_path):
    a, _ = await run(tmp_path)
    rec = Rec()
    plan = a.memo["plan_name"]
    out = await play_cell(a, plan, "news", rec, week_seconds=0)
    names = rec.names()
    assert names[0] == "replay_start" and names[-1] == "replay_done"
    start = rec.of("replay_start")[0]
    assert set(start) == {"replay_id", "plan_name", "shock_id", "shock_label", "weeks", "n_consumers", "week_seconds"}
    ticks = rec.of("tick")
    assert len(ticks) == 24 * 2
    for t, (u1, u2) in enumerate(zip(ticks[::2], ticks[1::2], strict=True)):
        assert (u1["tick"], u1["universe"], u2["tick"], u2["universe"]) == (t, "U1", t, "U2")
        assert set(u1) == TICK_KEYS | {"choices_b64", "cum_cash_delta"} and set(u2) == TICK_KEYS
        choices = np.frombuffer(base64.b64decode(u1["choices_b64"]), dtype=np.int8)
        assert choices.shape == (start["n_consumers"],) and set(np.unique(choices)) <= {0, 1, 2}
        if t < 7:
            assert u1["bullwhip"] == [None, None]
    assert any(b is not None for b in ticks[-2]["bullwhip"])
    for m in rec.of("marker"):
        assert set(m) == {"week", "kind", "firm", "text"} and len(m["text"].split()) <= 14
    # markers come right after their week's two ticks
    for i, (event, data) in enumerate(rec.events):
        if event == "marker":
            prev = next(d for e, d in reversed(rec.events[:i]) if e == "tick")
            assert prev["tick"] == data["week"] and prev["universe"] == "U2"
    done = rec.of("replay_done")[0]
    assert done["cum_profit_usd"] == {"U1": ticks[-2]["cum_profit"][0], "U2": ticks[-1]["cum_profit"][0]} == out["cum_profit_usd"]
    with pytest.raises(KeyError):
        await play_cell(a, "No such plan", "news", rec, week_seconds=0)


async def test_play_cell_paces_by_week_seconds(tmp_path):
    a, _ = await run(tmp_path)
    clock = replay.VirtualClock()
    await play_cell(a, "Raise price 5% now", "news", Rec(), week_seconds=0.5, sleep=clock.sleep)
    assert clock.now() == pytest.approx(12.0)


async def test_job_payload_round_trips_through_run_job(tmp_path):
    a, _ = await run(tmp_path)
    payload = json.loads(json.dumps(a.job_payload()))
    assert set(payload) == {"profile", "plans", "shocks", "crowd", "seed", "horizon"}
    assert [p["name"] for p in payload["plans"]] == list(a.plans) and set(payload["crowd"]) <= set(a.plans)
    out = planner.run_job(payload, N)
    assert len(out["cells"]) == len(a.cells)
    for cell in out["cells"]:
        mine = a.cell(cell["plan_name"], cell["shock_id"])
        for k in ("mean_delta_usd", "p5_delta_usd", "p_better", "mean_profit_usd", "peak_cash_usd"):
            assert cell[k] == pytest.approx(mine[k], abs=1e-6), (cell["plan_name"], cell["shock_id"], k)
    assert (out["best_today"], out["safest"]) == (a.summary["best_today"], a.summary["safest"])


async def test_recorded_analysis_replays_the_same_events_and_state(tmp_path):
    a, rec = await run(tmp_path)
    path = replay.write(tmp_path / "analysis_coffee_hcmc.jsonl", a.run_events)
    assert [line["event"] for line in replay.load(path)] == rec.names()
    b = Analysis(example="coffee_hcmc", mode="replay", recording=path, speed=0)
    rec2 = Rec()
    await b.run(rec2)
    assert rec2.names() == rec.names()
    for (e1, d1), (e2, d2) in zip(rec.events, rec2.events, strict=True):
        if e1 in ("analysis", "done"):
            d1 = {k: v for k, v in d1.items() if k not in ("analysis_id", "mode")}
            d2 = {k: v for k, v in d2.items() if k not in ("analysis_id", "mode")}
        assert (e1, d1) == (e2, d2)
    assert rec2.of("analysis")[0]["mode"] == "replay" and rec2.of("done")[0]["analysis_id"] == b.analysis_id
    assert b.from_recording and b.cells == a.cells and b.memo == a.memo and b.plans == a.plans
    assert b.job_payload() == json.loads(json.dumps(a.job_payload()))
    assert b.memo_markdown() == a.memo_markdown()


async def test_replay_adds_a_gut_call_the_recording_lacks(tmp_path):
    a, _ = await run(tmp_path)
    path = replay.write(tmp_path / "rec.jsonl", a.run_events)
    b = Analysis(example="coffee_hcmc", mode="replay", recording=path, speed=0,
                 gut_plan=gut_preset(EXAMPLE, "Stock up 4 weeks now").to_dict() | {"extra_stock_weeks": 6})
    rec = Rec()
    await b.run(rec)
    names = rec.names()
    assert names[-1] == "done" and names[-2] == "grid_summary"
    added = rec.of("plan")[-1]
    assert added["name"] == "Your gut call: Stock up 4 weeks now" and added["source"] == "user"
    last_plan = len(names) - 1 - names[::-1].index("plan")
    assert "crowd" not in names[last_plan:]  # engine only: Ultra and the shoppers never saw it


async def test_player_waits_recorded_gaps_divided_by_speed():
    lines = [{"t": 0.0, "event": "a", "data": {}}, {"t": 1.0, "event": "b", "data": {"x": 1}},
             {"t": 3.0, "event": "c", "data": {}}]
    waits, got = [], []

    async def sleep(s):
        waits.append(s)

    n = await replay.play(lines, lambda e, d: got.append(e), speed=2.0, sleep=sleep,
                          transform=lambda e, d: None if e == "b" else d)
    assert waits == [0.5, 1.0] and got == ["a", "c"] and n == 2
    waits.clear()
    await replay.play(lines, lambda e, d: None, speed=0, sleep=sleep)
    assert waits == []


async def test_cli_records_the_analysis_and_the_memo_cell(tmp_path, monkeypatch):
    a, _ = await run(tmp_path)
    paths = await cli.record_files(a, tmp_path / "replays")
    assert [p.name for p in paths] == [
        "analysis_coffee_hcmc.jsonl", f"cell_coffee_hcmc_{replay.slug(a.memo['plan_name'])}_news.jsonl"
    ]
    cell = replay.load(paths[1])
    ticks = [line for line in cell if line["event"] == "tick"]
    assert ticks[0]["t"] == 0.0 and ticks[-1]["t"] == pytest.approx(23 * cli.RECORD_WEEK_SECONDS)
    assert cell[-1]["event"] == "replay_done" and cell[-1]["t"] == pytest.approx(24 * cli.RECORD_WEEK_SECONDS)
    # a replayed analysis serves that cell from the recording
    monkeypatch.setattr(replay, "REPLAY_DIR", tmp_path / "replays")
    b = Analysis(example="coffee_hcmc", mode="replay", speed=0)
    await b.run(Rec())
    assert b.from_recording
    rec, clock = Rec(), replay.VirtualClock()
    out = await play_cell(b, a.memo["plan_name"], "news", rec, week_seconds=0.375, replay_id="r1", sleep=clock.sleep)
    assert rec.of("replay_start")[0]["replay_id"] == "r1" and rec.of("replay_start")[0]["week_seconds"] == 0.375
    assert clock.now() == pytest.approx(24 * 0.375)  # recorded at 0.75 s a week, played twice as fast
    assert out["cum_profit_usd"] == cell[-1]["data"]["cum_profit_usd"]
    fresh = Rec()
    await play_cell(a, a.memo["plan_name"], "news", fresh, week_seconds=0)
    assert [d for e, d in fresh.events if e == "tick"] == rec.of("tick")


async def test_memo_markdown_has_every_section(tmp_path):
    a, _ = await run(tmp_path)
    md = a.memo_markdown()
    pick = a.memo["plan_name"]
    for part in (f"**Pick: {pick}**", "### What to do", a.memo["cost_line"], "Cheaper stock:", "Total:",
                 "With a rival who never runs out:", "Extra if Highland Supply runs short:", "**Cash:**",
                 "### Not in these numbers", "Taxes", "### Sources", "https://reuters.com/world/robusta-record",
                 "1-in-20 bad case"):
        assert part in md, part


async def test_cheap_mode_sends_ultra_to_super_with_ultra_limits():
    inner = ScriptedRouter()
    seen = []

    async def after(res):
        seen.append(res.record.tier)

    proxy = _RouterProxy(inner, after, cheap=True)
    await proxy.call("ultra", [{"role": "user", "content": "x"}], AnalystStep, thinking=True)
    await proxy.call("fast", [{"role": "user", "content": "id=1 x"}], AnalystStep, thinking=False)
    assert [c[0] for c in inner.calls] == ["super", "fast"] and seen == ["super", "fast"]


async def test_a_broken_setup_still_ends_the_stream(tmp_path):
    a = Analysis(example="coffee_hcmc", mode="live", router=make_router(), scout=None, n_paths=N)
    rec = Rec()
    await a.run(rec)
    assert rec.names() == ["analysis", "error", "done"]
    assert set(rec.of("error")[0]) == KEYS["error"] and rec.of("error")[0]["recoverable"] is False


async def test_ultra_down_still_finishes_with_a_memo(tmp_path):
    from backend.agents.schemas import MemoDraft, ScenarioSet
    from backend.sim.offline import FAIL

    router = make_router({ScenarioSet: [FAIL, FAIL], AnalystStep: [FAIL, FAIL], MemoDraft: [FAIL]})
    router._steps = []
    a, rec = await run(tmp_path, router=router)
    assert rec.names()[-1] == "done" and a.memo is not None and a.memo["fallback_used"]
    assert [c["id"] for c in rec.of("shocks")[0]["cases"]] == ["news", "mild", "severe", "shipping"]


def test_offline_script_is_valid():
    assert STEPS[0].action == "test" and len(STEPS[0].plans) == 2


async def test_shoppers_are_not_asked_about_a_plan_they_cannot_see():
    from backend.agents.analyst import ask_crowd

    router = ScriptedRouter()
    sentiment, rows, missing = await ask_crowd(router, EXAMPLE["profile"], PlanSpec(name="Stock", extra_stock_weeks=4))
    assert router.calls == [] and not missing and not sentiment.mu.any()
    assert all(r["mu"] == [0.0, 0.0] and r["bubble"] == "" for r in rows)
    await ask_crowd(router, EXAMPLE["profile"], PlanSpec(name="Ads", marketing_change_pct=20))
    assert [c[0] for c in router.calls] == ["fast", "fast"]


async def test_a_failed_shopper_half_is_retried_with_the_longer_timeout():
    from backend.agents import analyst
    from backend.agents.schemas import CrowdBatch
    from backend.sim.offline import FAIL, neutral_crowd

    router = ScriptedRouter({CrowdBatch: [FAIL, neutral_crowd, neutral_crowd]})
    timeouts = []
    orig = router.call

    async def spy(tier, messages, schema, **kw):
        timeouts.append(kw.get("timeout"))
        return await orig(tier, messages, schema, **kw)

    router.call = spy
    _, rows, missing = await analyst.ask_crowd(router, EXAMPLE["profile"], PlanSpec(name="Up", price_change_pct=5))
    assert not missing and all(r["bubble"] for r in rows)
    assert sorted(timeouts, key=lambda t: t or 0) == [None, None, analyst.CROWD_RETRY_TIMEOUT]
    def second_half_down(messages):  # fails twice (5 s, then 10 s): that half stays neutral
        return FAIL if "(batch 1)" in messages[-1]["content"].split("\n")[0] else neutral_crowd(messages)

    router = ScriptedRouter({CrowdBatch: [second_half_down] * 5})
    _, rows, missing = await analyst.ask_crowd(router, EXAMPLE["profile"], PlanSpec(name="Up", price_change_pct=5))
    assert missing and len(router.calls) == 3 and sum(1 for r in rows if r["bubble"]) == 6


async def test_fresh_news_skips_the_cache_and_overwrites_it(tmp_path):
    from backend.services.news_watch import NewsWatch

    class Counting(FakeClient):
        n = 0

        async def search(self, **kw):
            Counting.n += 1
            return await super().search(**kw)

    scout = TavilyScout(tmp_path / "cache", client=Counting())
    nw = NewsWatch(scout, make_router())
    fb = EXAMPLE["fallback_shock"]
    await nw.find(EXAMPLE["profile"], fallback_shock=fb, live=True)
    first = Counting.n
    await nw.find(EXAMPLE["profile"], fallback_shock=fb, live=True)
    assert Counting.n == first  # cached
    await nw.find(EXAMPLE["profile"], fallback_shock=fb, live=True, fresh=True)
    assert Counting.n == 2 * first
    await nw.find(EXAMPLE["profile"], fallback_shock=fb, live=False, fresh=True)  # REPLAY never refreshes
    assert Counting.n == 2 * first
