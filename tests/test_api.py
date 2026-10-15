"""T08 tests: the v2 HTTP layer. Scripted router, fake Tavily client, recordings from fixtures/replays; no network."""
import asyncio
import json

import httpx

from backend.config import Settings
from backend.main import create_app
from backend.services.tavily_scout import TavilyScout
from backend.sim.analysis import load_example
from backend.sim.offline import ScriptedRouter
from tests.test_analysis import SHOCK, FakeClient, ShockVector

EXAMPLE = "coffee_hcmc"
PROFILE = load_example(EXAMPLE)["profile"]
PLAN = {"name": "Stock up 3 weeks", "price_change_pct": 0, "price_change_week": 0, "extra_stock_weeks": 3,
        "stock_week": 0, "marketing_change_pct": 0, "switch_supplier": False, "alt_cost_change_pct": 0,
        "alt_lead_time_weeks": 3, "alt_shock_exposure": 0.3}


class Guard:
    def __init__(self, ok=True):
        self.ok = ok

    def allow(self):
        return self.ok


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make_app(tmp_path, *, guard=None, cap=30, clock=None, **kw):
    scouts = []

    def scout():
        sc = TavilyScout(tmp_path / "cache", client=FakeClient())
        scouts.append(sc)
        return sc

    router = ScriptedRouter({ShockVector: [SHOCK] * 10})
    router.n_calls = 0
    inner = router.call

    async def counted(*a, **k):
        router.n_calls += 1
        return await inner(*a, **k)

    router.call = counted
    app = create_app(
        settings=Settings(tavily_daily_credit_cap=cap, _env_file=None),
        router=router, scout_factory=scout,
        guard=guard or Guard(), clock=clock or Clock(), replay_speed=1000.0, telemetry_dir=tmp_path / "tel",
        serve_frontend=False, **kw,
    )
    app.state.scouts, app.state.router = scouts, router
    return app


def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("1.2.3.4", 1)), base_url="http://t")


async def read_sse(app, path, stop, *, timeout=20.0):
    """Read an SSE stream through raw ASGI (httpx buffers whole responses) until `stop(events)`, then disconnect."""
    events, buf = [], ""
    gone = asyncio.Event()
    sent_request = False

    async def receive():
        nonlocal sent_request
        if not sent_request:
            sent_request = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await gone.wait()
        return {"type": "http.disconnect"}

    async def send(msg):
        nonlocal buf
        if msg["type"] != "http.response.body":
            return
        buf += msg.get("body", b"").decode().replace("\r\n", "\n")
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            ev = {"event": "message", "data": ""}
            for line in block.split("\n"):
                if line.startswith("event:"):
                    ev["event"] = line[6:].strip()
                elif line.startswith("data:"):
                    ev["data"] += line[5:].strip()
            if ev["data"]:
                events.append({"event": ev["event"], "data": json.loads(ev["data"])})
        if stop(events):
            gone.set()

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET", "path": path,
             "raw_path": path.encode(), "query_string": b"", "headers": [(b"host", b"t")], "scheme": "http",
             "server": ("t", 80), "client": ("1.2.3.4", 1)}
    await asyncio.wait_for(app(scope, receive, send), timeout)
    return events


def names(events):
    return [e["event"] for e in events]


async def start_example(c, **extra):
    r = await c.post("/api/analyses", json={"example_id": EXAMPLE, "mode": "replay", **extra})
    assert r.status_code == 200, r.text
    return r.json()["analysis_id"]


async def wait_done(app, aid):
    ev = await read_sse(app, f"/api/analyses/{aid}/events", lambda e: "done" in names(e))
    return ev


async def test_examples_and_health(tmp_path):
    async with client(make_app(tmp_path)) as c:
        assert (await c.get("/health")).json() == {"status": "ok"}
        ex = (await c.get("/api/examples")).json()
        assert {e["id"] for e in ex} == {"coffee_hcmc", "furniture_eu", "pc_parts"}
        assert all(e["has_replay"] and e["text"] for e in ex)


async def test_example_in_replay_streams_first_events(tmp_path):
    app = make_app(tmp_path)
    async with client(app) as c:
        aid = await start_example(c)
        ev = await read_sse(app, f"/api/analyses/{aid}/events", lambda e: len(e) >= 4)
    assert names(ev)[0] == "analysis" and "news" in names(ev)
    assert ev[0]["data"]["analysis_id"] == aid and ev[0]["data"]["mode"] == "replay"


async def test_late_subscriber_still_gets_analysis_event(tmp_path):
    app = make_app(tmp_path)
    async with client(app) as c:
        aid = await start_example(c)
        await wait_done(app, aid)           # the whole run is over before this second subscriber arrives
        ev = await read_sse(app, f"/api/analyses/{aid}/events", lambda e: "done" in names(e))
    assert names(ev)[0] == "analysis" and "memo" in names(ev) and names(ev)[-1] == "done"


async def test_unknown_analysis_is_404(tmp_path):
    async with client(make_app(tmp_path)) as c:
        assert (await c.get("/api/analyses/nope/memo")).status_code == 404
        assert (await c.post("/api/analyses/nope/stop")).status_code == 404


async def test_custom_profile_rejected_with_429_when_spend_guard_trips(tmp_path):
    async with client(make_app(tmp_path, guard=Guard(ok=False))) as c:
        r = await c.post("/api/analyses", json={"profile": PROFILE, "mode": "live"})
        assert r.status_code == 429 and "budget" in r.json()["reason"]
        r = await c.post("/api/profile/parse", json={"text": "I sell coffee"})
        assert r.status_code == 429 and r.json()["reason"]


async def test_live_example_downgrades_to_replay_with_a_mode_event(tmp_path):
    app = make_app(tmp_path, guard=Guard(ok=False))
    async with client(app) as c:
        r = await c.post("/api/analyses", json={"example_id": EXAMPLE, "mode": "live"})
        assert r.json()["mode"] == "replay"
        ev = await read_sse(app, f"/api/analyses/{r.json()['analysis_id']}/events", lambda e: len(e) >= 2)
    assert ev[0]["event"] == "mode" and ev[0]["data"]["mode"] == "replay" and ev[0]["data"]["reason"]
    assert ev[1]["event"] == "analysis"


async def test_per_ip_live_limit_and_window(tmp_path):
    clock = Clock()
    app = make_app(tmp_path, clock=clock)
    async with client(app) as c:
        for _ in range(2):
            r = await c.post("/api/analyses", json={"profile": PROFILE})
            assert r.status_code == 200 and r.json()["mode"] == "live"
        r = await c.post("/api/analyses", json={"profile": PROFILE})
        assert r.status_code == 429
        # an example asked for LIVE from the same IP falls back to its recording
        r = await c.post("/api/analyses", json={"example_id": EXAMPLE, "mode": "live"})
        assert r.json()["mode"] == "replay"
        clock.t += 3601
        assert (await c.post("/api/analyses", json={"profile": PROFILE})).status_code == 200
    await asyncio.sleep(0)  # let the background runs start; they are cancelled with the loop


async def test_max_three_live_analyses_running(tmp_path):
    app = make_app(tmp_path)
    async with client(app) as c:
        codes = []
        for ip in ("1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"):
            r = await c.post("/api/analyses", json={"profile": PROFILE}, headers={"x-forwarded-for": ip})
            codes.append(r.status_code)
    assert codes == [200, 200, 200, 429]


async def test_profile_parse_limit_per_ip(tmp_path):
    app = make_app(tmp_path)
    async with client(app) as c:
        codes = [(await c.post("/api/profile/parse", json={"text": "I roast coffee"})).status_code for _ in range(6)]
    assert codes[-1] == 429 and 429 not in codes[:5]


async def test_plans_work_in_replay_without_llm_calls(tmp_path):
    app = make_app(tmp_path)
    async with client(app) as c:
        aid = await start_example(c)
        await wait_done(app, aid)
        r = await c.post(f"/api/analyses/{aid}/plans", json={"plan": PLAN})
        assert r.json()["accepted"] is True and app.state.router.n_calls == 0
        ev = await read_sse(app, f"/api/analyses/{aid}/events", lambda e: any(
            x["event"] == "grid_summary" and x["data"] for x in e[-1:]) and "Stock up 3 weeks" in json.dumps(e))
    user_cells = [e for e in ev if e["event"] == "grid_cell" and e["data"]["plan_name"] == "Stock up 3 weeks"]
    assert user_cells and all(e["data"]["source"] == "local" for e in user_cells)
    assert not any(e["event"] == "crowd" and e["data"]["plan_name"] == "Stock up 3 weeks" for e in ev)
    # same plan again, and an unreadable one, are refused with a reason
    again = (await client(app).post(f"/api/analyses/{aid}/plans", json={"plan": PLAN})).json()
    assert again["accepted"] is False and again["reason"]


async def test_replay_streams_24_weeks(tmp_path):
    app = make_app(tmp_path)
    async with client(app) as c:
        aid = await start_example(c)
        await wait_done(app, aid)
        memo = (await c.get(f"/api/analyses/{aid}/memo")).json()
        r = await c.post(f"/api/analyses/{aid}/replay",
                         json={"plan_name": memo["plan_name"], "shock_id": "news", "speed": 1000})
        rid = r.json()["replay_id"]
        text = (await c.get(f"/api/replays/{rid}/events")).text   # the replay stream ends by itself
        assert (await c.post(f"/api/analyses/{aid}/replay", json={"plan_name": "zzz", "shock_id": "news"})).status_code == 404
    kinds = [line[6:].strip() for line in text.splitlines() if line.startswith("event:")]
    assert kinds[0] == "replay_start" and kinds[-1] == "replay_done"
    assert kinds.count("tick") == 48          # 24 weeks x (plan, do nothing)


async def test_news_check_works_in_replay_and_never_applies(tmp_path):
    app = make_app(tmp_path)
    async with client(app) as c:
        aid = await start_example(c)
        await wait_done(app, aid)
        r = await c.post(f"/api/analyses/{aid}/news-check")
        assert r.status_code == 200 and r.json()["accepted"] is True, r.text
        ev = await read_sse(app, f"/api/analyses/{aid}/events",
                            lambda e: any(x["event"] == "news" and x["data"]["items"][0].get("live") for x in e if x["event"] == "news"))
    card = next(e["data"] for e in ev if e["event"] == "news" and e["data"]["items"][0].get("live"))
    assert card["items"][0]["applied"] is False and card["used_for_grid"] is None


async def test_news_check_per_ip_minute_limit(tmp_path):
    clock = Clock()
    app = make_app(tmp_path, clock=clock)
    async with client(app) as c:
        aid = await start_example(c)
        await wait_done(app, aid)
        assert (await c.post(f"/api/analyses/{aid}/news-check")).status_code == 200
        r = await c.post(f"/api/analyses/{aid}/news-check")
        assert r.status_code == 429 and r.json()["accepted"] is False
        clock.t += 61
        assert (await c.post(f"/api/analyses/{aid}/news-check")).status_code == 200


async def test_news_check_rejected_after_credit_cap(tmp_path):
    clock = Clock()
    app = make_app(tmp_path, cap=1, clock=clock)
    async with client(app) as c:
        aid = await start_example(c)
        await wait_done(app, aid)
        first = (await c.post(f"/api/analyses/{aid}/news-check")).json()
        assert first["accepted"] is True and app.state.scouts[0].credits_used >= 1
        clock.t += 61
        r = await c.post(f"/api/analyses/{aid}/news-check")
    assert r.json()["accepted"] is False and "used up" in r.json()["reason"]


async def test_memo_markdown_download(tmp_path):
    app = make_app(tmp_path)
    async with client(app) as c:
        aid = await start_example(c)
        await wait_done(app, aid)
        r = await c.get(f"/api/analyses/{aid}/memo", params={"format": "md"})
        j = await c.get(f"/api/analyses/{aid}/memo")
    assert r.headers["content-type"].startswith("text/markdown") and "attachment" in r.headers["content-disposition"]
    assert r.text.startswith("# Decision memo") and j.json()["plan_name"] in r.text


async def test_verify_before_deploy_and_stop_and_benchmark(tmp_path):
    tel = tmp_path / "tel"
    tel.mkdir()
    (tel / "calls-20261015.jsonl").write_text(json.dumps({
        "ts": "2026-10-15T01:00:00+00:00", "tier": "ultra", "role": "analyst", "total_ms": 5000, "ttft_ms": 900,
        "prompt_tokens": 100, "completion_tokens": 200, "tok_per_s": 40, "status": "ok", "json_valid": True,
        "est_cost_usd": 0.01}) + "\n")
    app = make_app(tmp_path)
    async with client(app) as c:
        aid = await start_example(c)
        v = (await c.post(f"/api/analyses/{aid}/verify")).json()
        assert v == {"accepted": False, "reason": "not deployed yet"}
        assert (await c.post(f"/api/analyses/{aid}/stop")).json() == {"stopped": True}
        j = (await c.get("/api/benchmark/export")).json()
        assert j["by_tier"]["ultra"]["calls"] == 1 and j["by_tier"]["ultra"]["cost_usd"] == 0.01
        md = await c.get("/api/benchmark/export", params={"format": "md"})
    assert "| ultra |" in md.text and "attachment" in md.headers["content-disposition"]


async def test_bad_requests(tmp_path):
    async with client(make_app(tmp_path)) as c:
        assert (await c.post("/api/analyses", json={})).status_code == 422
        assert (await c.post("/api/analyses", json={"example_id": "nope"})).status_code == 404
        assert (await c.post("/api/analyses", json={"profile": {"business_name": "x"}})).status_code == 422
