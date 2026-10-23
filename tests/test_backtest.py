"""B1 Parts B and C: weekly paths, the as-of news filter and prompts, the leak check, scoring and the `backtest`
event, `GET /api/backtests` and the backtest replay through the API. Scripted router, fake Tavily, no network."""
from __future__ import annotations

import shutil
from datetime import date

import pytest

from backend.agents.schemas import BusinessProfile
from backend.engine.planner import PlanSpec
from backend.services import asof, replay
from backend.services.news_watch import NewsWatch
from backend.services.tavily_scout import TavilyScout
from backend.sim import backtest as bt
from backend.sim.analysis import Analysis
from backend.sim.offline import ScriptedRouter
from tests.test_analysis import ARTICLE, SHOCK, Rec
from tests.test_api import client, make_app, names, wait_done

CASE_IDS = ["bt_cocoa_2024", "bt_eggs_2025", "bt_robusta_2024", "bt_tariff_2025"]
# Held-out cases (ho_*): never shown in the app, used only to test general fixes; the four above stay frozen.
HELD_OUT_IDS = ["ho_arabica_2021", "ho_cocoa_2025", "ho_palm_2022", "ho_rice_2023", "ho_sunflower_2022", "ho_wheat_2025"]
AS_OF = date(2024, 1, 15)


# ---------------------------------------------------------------- series and paths


def test_interpolation_is_straight_lines_between_mid_months():
    pts = [(date(2024, 1, 15), 4.0), (date(2024, 2, 15), 5.0), (date(2024, 3, 15), 3.0)]
    assert bt.interpolate(pts, date(2024, 1, 15)) == 4.0
    assert bt.interpolate(pts, date(2024, 2, 15)) == 5.0
    assert bt.interpolate(pts, date(2024, 2, 1)) == pytest.approx(4.0 + 17 / 31)
    with pytest.raises(ValueError):
        bt.interpolate(pts, date(2024, 4, 1))
    path = bt.price_path(pts, date(2024, 1, 15), 8)
    assert path[0] == 0.0 and path[4] == pytest.approx((4.0 + 28 / 31) / 4.0 - 1.0)  # Feb 12
    pr = bt.series_points(pts, date(2024, 1, 15), 4)
    assert [p["week"] for p in pr] == [0, 1, 2, 3, 4] and pr[0]["change"] == 0.0 and pr[1]["date"] == "2024-01-22"


def test_the_series_files_load_and_give_the_expected_paths():
    cocoa = bt.price_path(bt.load_series("cocoa.csv"), AS_OF)
    assert len(cocoa) == 24 and cocoa[0] == 0.0
    assert max(cocoa) == pytest.approx(9.74 / 4.40 - 1.0, abs=0.12)   # the April monthly average: +121%
    robusta = bt.price_path(bt.load_series("coffee_robusta.csv"), date(2024, 2, 1))
    assert 0.38 < robusta[-1] < 0.45 and robusta[6] < robusta[12] < robusta[-1]    # about +40%, a climb


STEPS = [{"date": "2025-03-04", "duty": 0.20}, {"date": "2025-04-05", "duty": 0.30},
         {"date": "2025-04-10", "duty": 1.45}, {"date": "2025-05-14", "duty": 0.30}]


def test_policy_step_path_and_the_order_week_shift():
    as_of = date(2025, 3, 25)
    assert bt.duty_on(STEPS, as_of) == 0.20 and bt.duty_on(STEPS, date(2025, 2, 1)) == 0.0
    by_date = bt.policy_path(STEPS, 0.0, as_of, 24)
    assert by_date[0] == 0.0 and by_date[2] == pytest.approx(1.30 / 1.20 - 1)    # Apr 8: 30% in force
    assert by_date[3] == pytest.approx(2.45 / 1.20 - 1)                          # Apr 15: 145%
    assert by_date[8] == pytest.approx(1.30 / 1.20 - 1)                          # May 20: 30% again
    shifted = bt.policy_path(STEPS, 0.0, as_of, 24, lead_weeks=5)
    assert shifted[:19] == by_date[5:24]            # week t pays the rate at week t + 5
    assert shifted[0] == pytest.approx(2.45 / 1.20 - 1)  # an order placed on the as-of date lands under 145%
    assert bt.policy_path(STEPS, 0.075, as_of, 24)[3] == pytest.approx(2.525 / 1.275 - 1)


def test_realized_case_and_label():
    case = bt.load_case("bt_cocoa_2024")
    sc = bt.realized_case(case)
    assert sc.id == "realized" and sc.origin == "realized" and sc.likelihood == "likely"
    assert len(sc.cost_path) == 24 and (sc.onset_week, sc.ramp_weeks) == (0, 1)
    assert sc.delta_c_raw == 0 and sc.delta_lead_time == 0 and sc.demand_shock == 0
    assert sc.label.startswith("What happened: Cocoa +121%, then +") and len(sc.label) <= 40
    ev = bt.realized_event(case, case["profile"])
    assert "at the peak in April" in ev["cost_line"] and "30% of your cost is cocoa" in ev["cost_line"]
    tariff = bt.load_case("bt_tariff_2025")
    assert "by October" in bt.realized_event(tariff, tariff["profile"])["cost_line"]   # arrival months, not order months


@pytest.mark.parametrize("case_id", CASE_IDS + HELD_OUT_IDS)
def test_case_files_are_complete_and_do_not_spoil(case_id):
    case = bt.load_case(case_id)
    BusinessProfile.model_validate(case["profile"])
    assert case["horizon_weeks"] == 24 and case["path_index"] in ("order_week", "spot_week")
    path = bt.cost_path_for(case)
    assert len(path) == 24 and all(-0.9 <= v <= 3.0 for v in path)
    assert case["what_happened"] and all(w["url"].startswith("https://") and w["date"] and w["text"] for w in case["what_happened"])
    assert case["caveats"] and case["spoiler_terms"]
    for field in ("title", "subtitle"):           # the cards are read before the run
        assert not any(t.lower() in case[field].lower() for t in case["spoiler_terms"])
    ev = bt.series_for_event(case)
    assert len(ev["points"]) == 25 and ev["source_url"] and ev["points"][0]["change"] == 0.0
    assert case["profile"]["search_terms"] and case["id"] == case_id
    assert bt.list_cases() == sorted(bt.list_cases(), key=lambda c: (c["as_of"], c["id"]))


def test_list_cases_shape(tmp_path):
    out = bt.list_cases(replays=tmp_path)
    assert {c["id"] for c in out} == set(CASE_IDS)
    assert all(set(c) == {"id", "title", "subtitle", "as_of", "has_replay", "verdict", "hindsight"} for c in out)
    (tmp_path / "backtest_bt_cocoa_2024.jsonl").write_text("{}\n")
    assert {c["id"]: c["has_replay"] for c in bt.list_cases(replays=tmp_path)}["bt_cocoa_2024"] is True
    with pytest.raises(KeyError):
        bt.load_case("../secrets")


def test_recorded_verdict_reads_the_recording():
    v = bt.recorded_verdict("bt_tariff_2025")
    assert v and v["beat_do_nothing"] is False and v["real_usd"] < 0 < v["said_usd"] and v["rank"] <= v["n_plans"]
    assert bt.recorded_verdict("bt_nope") is None
    tariff = next(c for c in bt.list_cases() if c["id"] == "bt_tariff_2025")
    assert tariff["hindsight"] and "145%" in tariff["hindsight"]


# ---------------------------------------------------------------- as-of news filter


def test_later_dated_text():
    as_of = date(2024, 1, 15)
    assert asof.later_dated("Prices hit a record in April 2024.", as_of) == ["April 2024"]
    assert asof.later_dated("On 16 January 2024 cocoa rose", as_of) == ["16 January 2024"]
    assert asof.later_dated("On January 15, 2024 cocoa rose", as_of) == []                # the as-of day itself is fine
    assert asof.later_dated("Report of 2024-03-01", as_of) == ["2024-03-01"]
    assert asof.later_dated("In December 2023 and January 2024", as_of) == []
    assert asof.later_dated("A forecast for 2025", as_of) == []                          # bare years only on request
    assert asof.later_dated("A forecast for 2025", as_of, bare_years=True) == ["2025"]


def test_usable_result_drops_a_result_dated_a_day_after_as_of():
    ok = {"url": "https://x.com/a", "title": "Cocoa climbs", "published_date": "Mon, 15 Jan 2024 09:00:00 GMT"}
    assert asof.usable_result(ok, AS_OF)
    assert not asof.usable_result({**ok, "published_date": "Tue, 16 Jan 2024 09:00:00 GMT"}, AS_OF)
    assert not asof.usable_result({k: v for k, v in ok.items() if k != "published_date"}, AS_OF)
    assert not asof.usable_result({**ok, "published_date": "garbage"}, AS_OF)
    assert not asof.usable_result({**ok, "url": "https://x.com/2024/02/03/cocoa"}, AS_OF)
    assert not asof.usable_result({**ok, "url": "https://x.com/news/2024-04-19-cocoa"}, AS_OF)
    assert asof.usable_result({**ok, "url": "https://x.com/2023/10/25/cocoa"}, AS_OF)
    assert not asof.usable_result({**ok, "title": "Cocoa tops $10,000 in April 2024"}, AS_OF)


class DatedClient:
    """A fake Tavily that returns one good result, one dated a day late, one undated, one with a later URL."""

    def __init__(self):
        self.searches: list[dict] = []

    async def search(self, **kw):
        self.searches.append(kw)
        text = ARTICLE * 2
        return {"results": [
            {"url": "https://reuters.com/world/cocoa-jan", "title": "Cocoa climbs", "content": text, "score": 0.9,
             "published_date": "Thu, 11 Jan 2024 08:00:00 GMT"},
            {"url": "https://reuters.com/world/cocoa-late", "title": "Cocoa later", "content": text, "score": 0.8,
             "published_date": "Tue, 16 Jan 2024 08:00:00 GMT"},
            {"url": "https://reuters.com/world/cocoa-undated", "title": "Cocoa undated", "content": text, "score": 0.7},
            {"url": "https://reuters.com/2024/03/02/cocoa", "title": "Cocoa march", "content": text, "score": 0.6,
             "published_date": "Fri, 12 Jan 2024 08:00:00 GMT"},
        ]}

    async def extract(self, **kw):
        return {"results": [{"url": u, "raw_content": ARTICLE} for u in kw["urls"]]}


async def test_news_find_in_a_backtest_uses_the_window_and_drops_late_results(tmp_path):
    client_ = DatedClient()
    scout = TavilyScout(tmp_path / "cache", client=client_)
    case = bt.load_case("bt_cocoa_2024")
    router = ScriptedRouter({__import__("backend.agents.schemas", fromlist=["ShockVector"]).ShockVector: [SHOCK] * 3})
    news = await NewsWatch(scout, router).find(case["profile"], fallback_shock={}, live=True, as_of=AS_OF)
    assert client_.searches and all(
        s["start_date"] == "2023-10-17" and s["end_date"] == "2024-01-15" and "time_range" not in s
        for s in client_.searches
    )
    urls = {i["url"] for i in news["items"]}
    assert urls == {"https://reuters.com/world/cocoa-jan"}
    assert news["dropped_asof"] == 3   # per merged URL: late, undated, URL dated March (merged across the 2 queries)


async def test_dated_searches_do_not_share_a_cache_entry_with_undated_ones(tmp_path):
    scout = TavilyScout(tmp_path, client=DatedClient())
    a = await scout.search("cocoa price", "basic", None, start_date="2023-10-17", end_date="2024-01-15")
    b = await scout.search("cocoa price", "basic", "week")
    assert len(list(tmp_path.glob("search_*.json"))) == 2 and a and b
    assert scout._path("search", {"query": "q", "depth": "basic", "time_range": "week", "include_domains": []}) != scout._path(
        "search", {"query": "q", "depth": "basic", "time_range": None, "include_domains": [],
                   "start_date": "2023-10-17", "end_date": "2024-01-15"})


# ---------------------------------------------------------------- leak check


def test_leak_check_flags_and_misses():
    case = bt.load_case("bt_cocoa_2024")
    path = bt.cost_path_for(case)
    clean = bt.leak_check([("memo: why", "Stock up now; cocoa is volatile and a rise is plausible.")], case, path)
    assert clean == {"clean": True, "flags": []}
    spoiler = bt.leak_check([("reasoning", "Prices will make an all-time high of 12,567 soon")], case, path)
    assert not spoiler["clean"] and spoiler["flags"][0]["where"] == "reasoning" and "12,567" in spoiler["flags"][0]["text"]
    dated = bt.leak_check([("step", "Cocoa should peak around April 2024.")], case, path)
    assert dated["flags"] and "April 2024" in dated["flags"][0]["text"]
    year = bt.leak_check([("step", "Expect tight supply through 2025.")], case, path)
    assert year["flags"] and "2025" in year["flags"][0]["text"]
    # a percent claim about price near the real peak (+121%) or end (+80%) is flagged
    claim = bt.leak_check([("why", "I expect the cocoa price to rise about 118% by summer.")], case, path)
    assert not claim["clean"] and "118%" in claim["flags"][0]["text"]
    near_end = bt.leak_check([("why", "Cocoa could be up 77% over the period.")], case, path)
    assert not near_end["clean"]
    # far from the real path, too small, or not about prices: not flagged
    assert bt.leak_check([("why", "The cocoa price may rise 30%.")], case, path)["clean"]
    assert bt.leak_check([("why", "Cocoa up 9% is within noise; a 118% weight gain is silly.")], case, path)["clean"]  # 2 sentences
    assert bt.leak_check([("why", "Customers rose 118% at the fair.")], case, path)["clean"]       # no price word
    # a figure that is in the news the run was given is not hindsight
    news = [{"title": "Cocoa up 118% in a year", "quote": "", "cost_line": ""}]
    assert bt.leak_check([("why", "Cocoa price up 118% already.")], case, path, news)["clean"]
    # claims are only scanned where the caller says so (the futures' own numbers are scenarios)
    only_text = bt.leak_check([("future s1: label", "Cocoa price +120%")], case, path, claim_texts=[])
    assert only_text["clean"]


# ---------------------------------------------------------------- the whole run


class CaptureRouter(ScriptedRouter):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.systems: list[str] = []

    async def call(self, tier, messages, schema, **kw):
        self.systems.append(messages[0]["content"])
        return await super().call(tier, messages, schema, **kw)


async def run_backtest(tmp_path, case_id="bt_cocoa_2024", **kw):
    from backend.agents.schemas import ShockVector
    router = CaptureRouter({ShockVector: [SHOCK] * 3})
    scout = TavilyScout(tmp_path / "cache", client=DatedClient())
    a = Analysis(backtest=case_id, mode="live", router=router, scout=scout, n_paths=200, **kw)
    rec = Rec()
    await a.run(rec)
    return a, rec, router


async def test_backtest_run_event_order_prompts_and_shape(tmp_path):
    a, rec, router = await run_backtest(tmp_path)
    names_ = rec.names()
    assert "error" not in names_
    assert names_.index("memo") < names_.index("backtest") < names_.index("done") and names_.count("backtest") == 1
    first = rec.of("analysis")[0]
    assert first["as_of"] == "2024-01-15" and first["backtest_id"] == "bt_cocoa_2024" and first["profile"]["price"] == 6.2
    # every Super, Ultra and shopper prompt starts with the date line
    line = "Today's date is 15 January 2024. You know nothing after this date. Use only the news below."
    assert router.systems and all(s.startswith(line) for s in router.systems)

    d = rec.of("backtest")[0]
    assert set(d) == {"backtest_id", "as_of", "horizon_end", "series", "realized_case", "cells", "pick", "pick_rank",
                      "n_plans", "beat_do_nothing", "pick_delta_usd", "pick_engine_only_usd", "hindsight_best", "regret_usd", "baselines",
                      "futures_cover", "leak_check", "dropped_news", "what_happened", "caveats"}
    assert d["backtest_id"] == "bt_cocoa_2024" and d["horizon_end"] == "2024-07-01"
    assert set(d["series"]) == {"label", "unit", "source_url", "as_of_value", "points"} and d["series"]["as_of_value"] == 4.4
    assert set(d["series"]["points"][1]) == {"week", "date", "value", "change"}
    rc = d["realized_case"]
    assert rc["id"] == "realized" and rc["origin"] == "realized" and len(rc["cost_path"]) == 24 and rc["cost_line"]
    assert d["pick"] == rec.of("memo")[0]["plan_name"]
    assert d["cells"] and all(set(c) == {"plan_name", "mean_delta_usd", "engine_only_delta_usd", "p5_delta_usd", "p_better", "bridge"} for c in d["cells"])
    assert sorted({c["plan_name"] for c in d["cells"]}) == sorted(p["name"] for p in rec.of("plan"))
    assert 1 <= d["pick_rank"] <= d["n_plans"] == len(d["cells"]) + 1
    assert d["beat_do_nothing"] == (d["pick_delta_usd"] > 0)
    hb = d["hindsight_best"]
    assert set(hb) == {"name", "spec", "mean_delta_usd", "plain"} and hb["mean_delta_usd"] >= d["pick_delta_usd"]
    assert PlanSpec.from_dict(hb["spec"]).name == hb["name"]
    assert d["regret_usd"] == pytest.approx(hb["mean_delta_usd"] - d["pick_delta_usd"], abs=0.02)
    assert [b["name"] for b in d["baselines"]] == ["Do nothing", "Raise price 5% now", "Stock up 4 weeks now", "Textbook price rule"]
    fc = d["futures_cover"]
    assert set(fc) == {"min", "max", "realized_peak", "realized_end", "peak_inside", "end_inside"}
    assert fc["peak_inside"] == (fc["min"] <= fc["realized_peak"] <= fc["max"])
    assert set(d["leak_check"]) == {"clean", "flags"} and d["dropped_news"] == 3
    assert d["what_happened"] == bt.load_case("bt_cocoa_2024")["what_happened"]
    assert any("cutoff" in c for c in d["caveats"]) and len(d["caveats"]) >= 5
    switched = any(p["spec"]["switch_supplier"] for p in rec.of("plan"))
    assert any("switches supplier" in c for c in d["caveats"]) == switched
    # the realised column replays through the normal cell player
    assert a.shock("realized").cost_path == rc["cost_path"]


async def test_a_backtest_never_does_live_news_checks(tmp_path):
    a, _, _ = await run_backtest(tmp_path)
    res = await a.news_check(Rec())
    assert res["accepted"] is False and "before its date" in res["reason"]


async def test_backtest_state_is_rebuilt_from_a_recording(tmp_path):
    a, _rec, _ = await run_backtest(tmp_path)
    path = replay.write(tmp_path / "backtest_bt_cocoa_2024.jsonl", a.run_events)
    b = Analysis.from_events(replay.load(path))
    assert b.backtest_id == "bt_cocoa_2024" and b.as_of == AS_OF and b.example_id == "backtest_bt_cocoa_2024"
    assert b.backtest_result["pick"] == a.memo["plan_name"] and b.shock("realized").origin == "realized"
    assert b.memo["plan_name"] == a.memo["plan_name"]


# ---------------------------------------------------------------- the API


async def test_api_lists_backtests_and_replays_one(tmp_path, monkeypatch):
    a, _, _ = await run_backtest(tmp_path)
    rec_dir = tmp_path / "replays"
    replay.write(replay.backtest_path("bt_cocoa_2024", rec_dir), a.run_events)
    shutil.copy(replay.analysis_path("coffee_hcmc"), replay.analysis_path("coffee_hcmc", rec_dir))
    monkeypatch.setattr(replay, "REPLAY_DIR", rec_dir)
    app = make_app(tmp_path)
    async with client(app) as c:
        listed = (await c.get("/api/backtests")).json()
        assert [x["id"] for x in listed] == ["bt_cocoa_2024", "bt_robusta_2024", "bt_eggs_2025", "bt_tariff_2025"]
        assert {x["id"]: x["has_replay"] for x in listed} == {
            "bt_cocoa_2024": True, "bt_robusta_2024": False, "bt_eggs_2025": False, "bt_tariff_2025": False}
        assert (await c.post("/api/analyses", json={"backtest_id": "bt_robusta_2024"})).status_code == 409   # no recording
        assert (await c.post("/api/analyses", json={"backtest_id": "nope"})).status_code == 404
        r = await c.post("/api/analyses", json={"backtest_id": "bt_cocoa_2024", "mode": "live"})
        assert r.status_code == 200 and r.json()["mode"] == "replay"       # REPLAY only, whatever was asked
        aid = r.json()["analysis_id"]
        ev = await wait_done(app, aid)
        assert app.state.router.n_calls == 0                                # no model was called
        order = names(ev)
        assert order.index("memo") < order.index("backtest") < order.index("done")
        assert ev[0]["data"]["as_of"] == "2024-01-15" and ev[0]["data"]["backtest_id"] == "bt_cocoa_2024"
        pick = next(e["data"] for e in ev if e["event"] == "backtest")["pick"]
        r = await c.post(f"/api/analyses/{aid}/replay", json={"plan_name": pick, "shock_id": "realized", "speed": 1000})
        assert r.status_code == 200
        text = (await c.get(f"/api/replays/{r.json()['replay_id']}/events")).text
        # "realized" only exists for a backtest
        other = (await c.post("/api/analyses", json={"example_id": "coffee_hcmc", "mode": "replay"})).json()["analysis_id"]
        await wait_done(app, other)
        bad = await c.post(f"/api/analyses/{other}/replay", json={"plan_name": "Do nothing", "shock_id": "realized"})
        assert bad.status_code == 404
    kinds = [line[6:].strip() for line in text.splitlines() if line.startswith("event:")]
    assert kinds[0] == "replay_start" and kinds[-1] == "replay_done" and kinds.count("tick") == 48
    assert '"shock_id": "realized"' in text or '"shock_id":"realized"' in text


# ---------------------------------------------------------------- the recorded fixtures


@pytest.mark.parametrize("case_id", CASE_IDS)
def test_recordings_are_complete_and_consistent(case_id):
    """The four recordings B1b builds against: order, scoring fields, the pick's realised cell, no leaked hindsight in
    the card text, and the case's own words carried through unchanged."""
    case = bt.load_case(case_id)
    lines = replay.load(replay.backtest_path(case_id))
    order = [line["event"] for line in lines]
    assert order[0] == "analysis" and order[-3:] == ["backtest", "telemetry", "done"]
    assert order.index("memo") < order.index("backtest") and "error" not in order
    first = lines[0]["data"]
    assert first["as_of"] == case["as_of"] and first["backtest_id"] == case_id and first["profile"] == case["profile"]
    d = next(line["data"] for line in lines if line["event"] == "backtest")
    memo = next(line["data"] for line in lines if line["event"] == "memo")
    assert d["pick"] == memo["plan_name"] and d["what_happened"] == case["what_happened"]
    assert d["realized_case"]["cost_path"] == pytest.approx(bt.cost_path_for(case))
    assert d["regret_usd"] >= 0 and d["n_plans"] == len(d["cells"]) + 1 and d["dropped_news"] >= 0
    assert d["caveats"][: len(case["caveats"])] == case["caveats"]
    plans = [PlanSpec.from_dict(line["data"]["spec"]) for line in lines if line["event"] == "plan"]
    assert d["caveats"] == bt.caveats(case, plans)
    shock_ids = [c["id"] for line in lines if line["event"] == "shocks" for c in line["data"]["cases"]]
    assert "realized" not in shock_ids                       # the real path is a reveal, not a grid column
    cell = replay.load(replay.cell_path(f"backtest_{case_id}", d["pick"], "realized"))
    assert cell[0]["event"] == "replay_start" and cell[0]["data"]["shock_id"] == "realized"
    assert [e["event"] for e in cell].count("tick") == 48 and cell[-1]["event"] == "replay_done"


def test_all_four_cases_have_recordings():
    assert all(c["has_replay"] for c in bt.list_cases())


def test_held_out_cases_stay_out_of_the_app():
    listed = {c["id"] for c in bt.list_cases()}
    assert listed == set(CASE_IDS)
    assert all(bt.load_case(h)["set"] == "held_out" for h in HELD_OUT_IDS)


def test_supplier_caveat_only_when_a_tested_plan_switches():
    case = bt.load_case("bt_cocoa_2024")
    assert not any("switches supplier" in c for c in bt.caveats(case, [PlanSpec(name="x", price_change_pct=3)]))
    assert any("switches supplier" in c for c in bt.caveats(case, [PlanSpec(name="x", switch_supplier=True)]))


@pytest.mark.parametrize(("quote", "as_of", "stale"), [
    ("By December 2023, wheat prices had dropped 44.5 percent.", date(2025, 5, 15), True),   # held-out wheat headline
    ("The average retail price of eggs has risen 38% since November 2023.", date(2024, 12, 15), False),  # still running
    ("egg prices could rise by more than 40% this year", date(2025, 5, 15), False),          # no date: a forecast
    ("prices rose 20% in 2024", date(2025, 5, 15), False),                                    # bare year: up to Dec 2024
    ("In March 2025 prices jumped 30%", date(2025, 5, 15), False),                            # recent
    ("prices fell 10% in 2022 and are forecast to rise in 2026", date(2025, 5, 15), False),   # any recent/later date wins
])
def test_stale_quote(quote, as_of, stale):
    assert asof.stale_quote(quote, as_of) is stale
