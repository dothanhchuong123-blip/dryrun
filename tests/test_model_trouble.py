"""F6 tests: a dead or failing Token Factory stops a LIVE run early, and --record refuses a run that fell back. Offline, $0."""
import asyncio
from types import SimpleNamespace as NS

import httpx
import openai

from backend.services.router import RunHealth
from backend.services.telemetry import CallRecord, TelemetryStore
from backend.sim import cli
from backend.sim.analysis import _RouterProxy
from backend.sim.offline import ScriptedRouter
from tests.test_analysis import Rec, make_analysis
from tests.test_router import MSGS, Out, make_router


def status_error(code, body):
    req = httpx.Request("POST", "https://example.invalid/v1/chat/completions")
    resp = httpx.Response(code, request=req, headers={"authorization": "secret"})
    return openai.APIStatusError("boom", response=resp, body=body)


def proxied(tmp_path, scripts):
    router = make_router(tmp_path, scripts)
    return router, _RouterProxy(router, lambda _res: asyncio.sleep(0))


async def test_status_errors_are_classified_with_a_short_error(tmp_path):
    cases = [
        (402, {"error": {"code": "credit_balance_exhausted", "message": "top up"}}, "no_credit", "402 credit_balance_exhausted"),
        (401, {"error": {"type": "invalid_api_key"}}, "auth", "401 invalid_api_key"),
        (503, None, "server_error", "503"),
        (400, {"code": "bad_request"}, "error", "400 bad_request"),
    ]
    for code, body, status, error in cases:
        r = make_router(tmp_path, [status_error(code, body)])
        res = await r.call("ultra", MSGS, Out, thinking=False)
        assert (res.record.status, res.record.error) == (status, error)
        assert res.fallback_needed and len(error) <= 120
        assert "secret" not in res.record.model_dump_json()


async def test_hard_failure_on_no_credit_and_auth_but_not_one_503(tmp_path):
    for code, reason in [(402, "no_credit"), (401, "auth")]:
        _, p = proxied(tmp_path, [status_error(code, None)])
        await p.call("super", MSGS, Out, thinking=False)
        assert p.hard_failure == reason
    _, p = proxied(tmp_path, [status_error(503, None)])
    await p.call("ultra", MSGS, Out, thinking=False)
    assert p.hard_failure is None


async def test_two_server_errors_in_a_row_on_ultra_or_super_set_it(tmp_path):
    _, p = proxied(tmp_path, [status_error(503, None), status_error(502, None)])
    await p.call("ultra", MSGS, Out, thinking=False)
    await p.call("super", MSGS, Out, thinking=False)
    assert p.hard_failure == "server_error"


async def test_a_good_call_between_server_errors_resets_the_streak(tmp_path):
    ok = [NS(choices=[NS(delta=NS(content='{"a": 1, "inner": {"x": 0.5}}', model_extra={}))], usage=None)]
    _, p = proxied(tmp_path, [status_error(503, None), ok, status_error(503, None)])
    for _ in range(3):
        await p.call("ultra", MSGS, Out, thinking=False)
    assert p.hard_failure is None


async def test_timeouts_never_set_it(tmp_path):
    scripts = [openai.APITimeoutError(request=httpx.Request("POST", "https://x.invalid"))] * 3
    _r, p = proxied(tmp_path, scripts)
    for _ in range(3):
        res = await p.call("ultra", MSGS, Out, thinking=False)
        assert res.record.status == "timeout"
    assert p.hard_failure is None


def test_one_run_does_not_stop_another():
    a, b = RunHealth(), RunHealth()
    a.note(CallRecord(tier="ultra", model="m", status="no_credit"))
    assert a.reason == "no_credit" and b.reason is None


def test_new_fields_survive_the_telemetry_store(tmp_path):
    store = TelemetryStore(tmp_path)
    store.add(CallRecord(tier="ultra", model="m", status="no_credit", error="402 credit_balance_exhausted"))
    assert store.snapshot()["tiers"]["ultra"]["errors"] == 1
    assert "credit_balance_exhausted" in next(tmp_path.glob("calls-*.jsonl")).read_text()


class DeadRouter(ScriptedRouter):
    """Every call ends in a 402, like an account with no credit."""

    async def call(self, tier, messages, schema, **kw):
        self.calls.append((tier, schema.__name__, kw.get("role", ""), False))
        rec = CallRecord(tier=tier, model="dead", role=kw.get("role", ""), status="no_credit",
                         error="402 credit_balance_exhausted", fallback_used=True)
        self.store.add(rec)
        return NS(parsed=None, raw_text="", reasoning_text="", record=rec, fallback_needed=True)


async def test_live_run_with_no_credit_stops_early(tmp_path):
    router = DeadRouter()
    a = make_analysis(tmp_path, router=router)
    rec = Rec()
    await a.run(rec)
    names = rec.names()
    assert names[-2:] == ["error", "done"] and "memo" not in names
    err = rec.of("error")[0]
    assert err["recoverable"] is True and "aren't available" in err["message"] and "402" not in err["message"]
    assert len(router.calls) <= 6, router.calls


async def test_run_not_stopped_by_a_few_fallbacks(tmp_path):
    a = make_analysis(tmp_path, router=ScriptedRouter(defaults=True))
    rec = Rec()
    await a.run(rec)
    assert "memo" in rec.names() and not rec.of("error")


def fake_run(records):
    a = NS(telemetry=NS(records=records))
    return a


def test_record_refuses_ultra_or_super_fallback_but_allows_shoppers(capsys):
    shopper = CallRecord(tier="fast", model="m", role="crowd", status="timeout", fallback_used=True)
    superc = CallRecord(tier="super", model="m", role="news", status="server_error", error="503", fallback_used=True)
    assert cli.refuse_fallback_record(fake_run([shopper])) is False
    assert cli.refuse_fallback_record(fake_run([shopper, superc])) is True
    err = capsys.readouterr().err
    assert "news (super): server_error 503" in err and "--allow-fallback" in err


def test_record_flag_aborts_before_writing(tmp_path, monkeypatch):
    written = []

    async def fake_record(a, directory=None):
        written.append(1)
        return []

    class FakeAnalysis:
        telemetry = NS(records=[CallRecord(tier="super", model="m", role="x", status="error", fallback_used=True)])
        cells, shock_events, shocks, summary, memo = {}, [], [], {}, None
        run_events, scout = [], None
        async def run(self, emit): return {}
        def telemetry_snapshot(self): return {"cost_usd": 0, "cost_all_ultra_usd": 0, "tiers": {}}
        def memo_markdown(self): return ""

    import backend.services.router as rt
    monkeypatch.setattr(rt, "NemotronRouter", lambda **kw: NS(store=None))
    monkeypatch.setattr(cli, "Analysis", lambda **kw: FakeAnalysis())
    monkeypatch.setattr(cli, "record_files", fake_record)
    monkeypatch.setattr(cli, "ROOT", tmp_path)
    monkeypatch.setattr(cli, "LAST_RUN", tmp_path / "run.jsonl")
    monkeypatch.setattr(cli, "LAST_MEMO", tmp_path / "memo.md")
    monkeypatch.setattr(cli, "_print_result", lambda a: None)
    monkeypatch.setattr(cli.replay, "write", lambda *a, **k: None)
    args = ["--example", "coffee_hcmc", "--record"]
    assert cli.main(args) == 1 and written == []
    monkeypatch.setattr(cli, "LAST_MEMO", tmp_path / "memo.md")
    assert cli.main([*args, "--allow-fallback"]) == 0 and written == [1]
