"""FastAPI app: the v2 REST + SSE contract in docs/EVENTS.md.

`create_app(...)` builds the app (tests pass fakes); `app` is the production instance. State is in memory:
a registry of analyses and cell replays with a 2-hour TTL. Every stream buffers the events it has emitted, so a
client that connects late (the UI opens the stream after the POST returns) first gets everything so far.
"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import time
import uuid
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError
from sse_starlette.sse import EventSourceResponse

from backend.agents.schemas import BusinessProfile
from backend.config import ROOT, Settings, get_settings
from backend.engine.planner import PlanSpec
from backend.services import benchmark, replay
from backend.services.doc_reader import MAX_BYTES, DocError, read_document
from backend.services.telemetry import SpendGuard
from backend.sim import backtest as bt
from backend.sim.analysis import (
    EXAMPLES_DIR,
    MIN_LETTERS,
    NOT_BUSINESS,
    TOO_LITTLE_FREE,
    Analysis,
    InputRejected,
    letters_in,
    load_example,
    parse_profile,
)
from backend.sim.replay_cell import play_cell

log = logging.getLogger(__name__)

TTL_S = 2 * 3600
LIVE_OFF = "Live analyses are switched off on this demo right now. Pick an example to see a recorded run."
LIVE_PER_IP_HOUR = 2
PARSE_PER_IP_HOUR = 5
NEWS_CHECK_PER_IP_MINUTE = 1
HEARTBEAT_S = 15
BASE_WEEK_SECONDS = 0.75
FRONTEND_OUT = ROOT / "frontend" / "out"


class Hits:
    """Sliding-window counter per key (an IP): at most `limit` hits in the last `window` seconds."""

    def __init__(self, limit: int, window: float, clock: Callable[[], float]) -> None:
        self.limit, self.window, self.clock = limit, window, clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _trim(self, key: str) -> deque[float]:
        q, now = self._hits[key], self.clock()
        while q and now - q[0] >= self.window:
            q.popleft()
        return q

    def full(self, key: str) -> bool:
        return len(self._trim(key)) >= self.limit

    def add(self, key: str) -> None:
        self._trim(key).append(self.clock())


@dataclass
class Stream:
    """An append-only event buffer with live subscribers. `closed` ends every subscriber's stream."""

    events: list[dict] = field(default_factory=list)
    subs: set[asyncio.Queue] = field(default_factory=set)
    closed: bool = False

    def emit(self, event: str, data: dict) -> None:
        item = {"event": event, "data": json.dumps(replay._plain(data), ensure_ascii=False)}
        self.events.append(item)
        for q in self.subs:
            q.put_nowait(item)

    def close(self) -> None:
        self.closed = True
        for q in self.subs:
            q.put_nowait(None)

    async def subscribe(self) -> AsyncIterator[dict]:
        q: asyncio.Queue = asyncio.Queue()
        backlog = list(self.events)       # snapshot and register with no await between: nothing is missed
        self.subs.add(q)
        try:
            for item in backlog:
                yield item
            if self.closed:
                return
            while True:
                item = await q.get()
                if item is None:
                    return
                yield item
        finally:
            self.subs.discard(q)


@dataclass
class AnalysisEntry:
    analysis: Analysis
    stream: Stream
    created: float
    task: asyncio.Task | None = None
    live: bool = False
    finished: bool = False


@dataclass
class ReplayEntry:
    stream: Stream
    created: float
    task: asyncio.Task | None = None


class CreateAnalysis(BaseModel):
    example_id: str | None = None
    profile: dict | None = None
    mode: str = "replay"
    gut_plan: dict | None = None
    backtest_id: str | None = None   # a real case from fixtures/backtests; REPLAY only (B1)


class ParseRequest(BaseModel):
    text: str = ""
    url: str | None = None


BAD_URL = "That link doesn't look like a public web page. Paste a website, Google Maps, Facebook or Shopee link."
TOO_BIG_FILE = "That file is over 8 MB. Try a smaller one, or paste the numbers."
UNREADABLE = "Couldn't read that page. Describe your business in a line instead."


def check_page_url(url: str) -> str | None:
    """The URL if it is a public http(s) page (no localhost or private IPs), else None."""
    url = url.strip()
    if not url or len(url) > 500:
        return None
    try:
        u = urlparse(url)
        host = (u.hostname or "").lower()
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not host:
        return None
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".test")) or "." not in host:
            return None
        return url
    return None if not ip.is_global else url


class AddPlan(BaseModel):
    plan: dict


class ReplayRequest(BaseModel):
    plan_name: str
    shock_id: str
    speed: float | None = None


def client_ip(request: Request) -> str:
    """The caller's IP. Behind a proxy the last X-Forwarded-For entry is the one the proxy itself added."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _examples() -> list[dict]:
    out = []
    # the US demo first, the Ho Chi Minh City roaster second as the alternative, then the rest by name
    order = {"coffee_austin": 0, "coffee_hcmc": 1}
    for path in sorted(EXAMPLES_DIR.glob("*.json"), key=lambda p: (order.get(p.stem, 99), p.stem)):
        ex = json.loads(path.read_text(encoding="utf-8"))
        out.append({
            "id": ex["id"], "title": ex["title"], "subtitle": ex.get("subtitle", ""), "text": ex["text"],
            "has_replay": replay.has_replay(ex["id"]),
        })
    return out


def create_app(
    *,
    settings: Settings | None = None,
    router: Any = None,
    scout_factory: Callable[[], Any] | None = None,
    guard: SpendGuard | None = None,
    clock: Callable[[], float] = time.monotonic,
    replay_speed: float = 1.0,
    today: Callable[[], date] = lambda: datetime.now(UTC).date(),
    telemetry_dir: Path | None = None,
    serve_frontend: bool = True,
) -> FastAPI:
    """`router` (a NemotronRouter) and `scout_factory` (one TavilyScout per analysis) default to the real ones,
    built on first use. `replay_speed` scales the playback of recorded analyses."""
    s = settings or get_settings()
    guard = guard or SpendGuard(lambda: s.live_cap_on(today()), telemetry_dir)

    def live_on() -> bool:
        return s.live_cap_on(today()) > 0
    app = FastAPI(title="Market Digital Twin")
    if s.frontend_origin:
        app.add_middleware(
            CORSMiddleware, allow_origins=[o.strip() for o in s.frontend_origin.split(",") if o.strip()],
            allow_methods=["*"], allow_headers=["*"],
        )

    analyses: dict[str, AnalysisEntry] = {}
    replays: dict[str, ReplayEntry] = {}
    live_hits = Hits(LIVE_PER_IP_HOUR, 3600, clock)
    parse_hits = Hits(PARSE_PER_IP_HOUR, 3600, clock)
    news_hits = Hits(NEWS_CHECK_PER_IP_MINUTE, 60, clock)
    credits = {"day": "", "used": 0}
    shared: dict[str, Any] = {"router": router}

    def get_router() -> Any:
        if shared["router"] is None:
            from backend.services.router import NemotronRouter

            shared["router"] = NemotronRouter(spend_guard=guard)
        return shared["router"]

    def make_scout() -> Any:
        if scout_factory is not None:
            return scout_factory()
        from backend.services.tavily_scout import TavilyScout

        return TavilyScout(ROOT / "fixtures" / "tavily_cache", router=get_router())

    def credits_used_today() -> int:
        day = f"{datetime.now(UTC):%Y%m%d}"
        if credits["day"] != day:
            credits["day"], credits["used"] = day, 0
        return credits["used"]

    def sweep() -> None:
        now = clock()
        for registry in (analyses, replays):
            for key in [k for k, e in registry.items() if now - e.created > TTL_S]:
                e = registry.pop(key)
                if e.task is not None and not e.task.done():
                    e.task.cancel()
                e.stream.close()

    def get_entry(analysis_id: str) -> AnalysisEntry:
        e = analyses.get(analysis_id)
        if e is None:
            raise HTTPException(404, {"reason": "That analysis is not here any more. Start a new one."})
        return e

    def sse(stream: Stream) -> EventSourceResponse:
        return EventSourceResponse(stream.subscribe(), ping=HEARTBEAT_S)

    # --- basics -----------------------------------------------------------------------------
    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/examples")
    def examples() -> list[dict]:
        return _examples()

    def rejected(code: str, reason: str, missing: list[str] | None = None) -> JSONResponse:
        return JSONResponse({"code": code, "reason": reason, "missing": list(missing or [])}, 422)

    def parse_gate(ip: str) -> JSONResponse | None:
        if not live_on():
            return JSONResponse({"reason": LIVE_OFF}, 429)
        if parse_hits.full(ip):
            return JSONResponse({"reason": "You have read a few businesses already. Try again in an hour, or pick an example."}, 429)
        if not guard.allow():
            return JSONResponse({"reason": "Today's free live budget is used up. Pick an example, or try again tomorrow."}, 429)
        return None

    async def run_parse(text: str, page: dict | None, doc: dict | None, source: dict | None) -> Any:
        try:
            profile, fallback = await parse_profile(get_router(), text, page, doc)
        except InputRejected as e:
            return rejected(e.code, e.reason, e.missing)
        except Exception as e:
            log.warning("profile parse failed: %s", e)
            raise HTTPException(502, {"reason": "Could not read a business from that text. Try again, or pick an example."}) from e
        return {"profile": profile, "fallback_used": fallback, "source": source}

    @app.post("/api/profile/parse")
    async def profile_parse(body: ParseRequest, request: Request) -> Any:
        ip = client_ip(request)
        if (blocked := parse_gate(ip)) is not None:
            return blocked
        text = body.text.strip()
        url = None
        if body.url is not None and body.url.strip():
            url = check_page_url(body.url)
            if url is None:
                raise HTTPException(422, {"reason": BAD_URL})
        if len(text) > 4000 or not (text or url):
            raise HTTPException(422, {"reason": "Describe your business in a few sentences (up to 4,000 characters)."})
        page, source = None, None
        if url is not None:
            if credits_used_today() >= s.tavily_daily_credit_cap:
                return JSONResponse(
                    {"reason": "Reading links is used up for today. Describe your business in a line instead."}, 429
                )
            parse_hits.add(ip)
            scout = make_scout()
            before = getattr(scout, "credits_used", 0)
            try:
                read = await scout.read_page(url)
            except Exception as e:  # noqa: BLE001  Tavily / network / cache miss: treated as unreadable
                log.warning("page read failed: %s", e)
                read = None
            finally:
                credits["used"] = credits_used_today() + max(0, getattr(scout, "credits_used", 0) - before)
            if read is None:
                raise HTTPException(422, {"reason": UNREADABLE})
            page = {"url": url, "title": read.title, "text": read.text}
            source = {"kind": "link", "url": url, "title": read.title, "method": read.method, "credits": read.credits}
        else:
            if letters_in(text) < MIN_LETTERS:  # layer 1: free, before any model call, not counted
                return rejected("too_little", TOO_LITTLE_FREE, ["what_you_sell", "where"])
            parse_hits.add(ip)
        return await run_parse(text, page, None, source)

    @app.post("/api/profile/parse-file")
    async def profile_parse_file(request: Request, file: UploadFile = File(...), text: str = Form("")) -> Any:  # noqa: B008
        ip = client_ip(request)
        if (blocked := parse_gate(ip)) is not None:
            return blocked
        note = text.strip()
        if len(note) > 4000:
            raise HTTPException(422, {"reason": "Keep the note under 4,000 characters."})
        try:
            declared = int(request.headers.get("content-length") or 0)
        except ValueError:
            declared = 0
        if declared > MAX_BYTES + 200_000:
            raise HTTPException(413, {"reason": TOO_BIG_FILE})
        data = await file.read(MAX_BYTES + 1)  # in memory only; never written anywhere
        name = (file.filename or "file").replace("\\", "/").rsplit("/", 1)[-1][:80]
        try:
            doc = await read_document(get_router(), data, name)
        except DocError as e:
            raise HTTPException(e.status, {"reason": e.reason}) from e
        finally:
            data = b""
        if doc.method == "vision":  # a model call was spent, so it counts toward the hourly limit
            parse_hits.add(ip)
        if letters_in(doc.text) + letters_in(note) < MIN_LETTERS:
            return rejected("too_little", TOO_LITTLE_FREE, ["what_you_sell", "where"])
        if doc.kind == "not_business" and letters_in(note) < MIN_LETTERS:
            return rejected("not_business", NOT_BUSINESS)
        if doc.method != "vision":
            parse_hits.add(ip)
        source = {"kind": "file", "name": name, "method": doc.method, "pages": doc.pages}
        return await run_parse(note, None, {"name": name, "kind": doc.kind, "text": doc.text}, source)

    # --- analyses ---------------------------------------------------------------------------
    @app.get("/api/backtests")
    def backtests() -> list[dict]:
        return bt.list_cases()

    @app.post("/api/analyses")
    async def create_analysis(body: CreateAnalysis, request: Request) -> Any:
        sweep()
        if body.backtest_id is not None:
            return start_backtest(body.backtest_id)
        if (body.example_id is None) == (body.profile is None):
            raise HTTPException(422, {"reason": "Give either an example or a business profile."})
        ip = client_ip(request)
        gut: PlanSpec | None = None
        if body.gut_plan is not None:
            try:
                gut = PlanSpec.from_dict(body.gut_plan)
            except (ValueError, TypeError, KeyError) as e:
                raise HTTPException(422, {"reason": "That plan could not be read."}) from e

        example = None
        profile = None
        if body.example_id is not None:
            try:
                example = load_example(body.example_id)
            except (OSError, ValueError) as e:
                raise HTTPException(404, {"reason": "Unknown example."}) from e
        else:
            try:
                profile = BusinessProfile.model_validate(body.profile).model_dump()
            except ValidationError as e:
                raise HTTPException(422, {"reason": "The business profile is incomplete or out of range."}) from e

        running = sum(1 for e in analyses.values() if e.live and not e.finished)
        blocked: str | None = None
        if not live_on():
            blocked = LIVE_OFF
        elif live_hits.full(ip):
            blocked = "You have used your live analyses for this hour. Try again later, or pick an example."
        elif not guard.allow():
            blocked = "Today's free live budget is used up. Pick an example, or try again tomorrow."
        elif running >= s.max_live_analyses:
            blocked = "Live analyses are busy right now. Try again in a few minutes, or pick an example."

        wants_live = profile is not None or body.mode == "live"
        mode_note: str | None = None
        if wants_live and blocked is None:
            mode = "live"
        elif profile is not None:
            return JSONResponse({"reason": blocked}, 429)
        else:
            mode = "replay"
            if wants_live:
                mode_note = blocked
        if mode == "replay" and not replay.has_replay(example["id"]):
            raise HTTPException(409, {"reason": "That example has no recording yet."})

        stream = Stream()
        a = Analysis(
            profile=profile, example=example, mode=mode, router=get_router(), scout=make_scout(),
            gut_plan=gut, speed=replay_speed,
        )
        entry = AnalysisEntry(a, stream, clock(), live=mode == "live")
        analyses[a.analysis_id] = entry
        if mode_note:
            stream.emit("mode", {"mode": "replay", "reason": mode_note})
        if entry.live:
            live_hits.add(ip)

        async def run() -> None:
            try:
                await a.run(stream.emit)
            finally:
                entry.finished = True

        entry.task = asyncio.create_task(run())
        return {"analysis_id": a.analysis_id, "mode": mode}

    def start_backtest(backtest_id: str) -> dict:
        """A backtest plays its recording (`backtest_<id>.jsonl`). There is no LIVE mode: it costs real money and the
        recording is the one run that was checked against the real prices."""
        try:
            case = bt.load_case(backtest_id)
        except KeyError as e:
            raise HTTPException(404, {"reason": "Unknown backtest."}) from e
        if not replay.backtest_path(case["id"]).exists():
            raise HTTPException(409, {"reason": "That backtest has no recording yet."})
        a = Analysis(
            backtest=case, mode="replay", router=get_router(), scout=make_scout(), speed=replay_speed,
        )
        stream = Stream()
        entry = AnalysisEntry(a, stream, clock(), live=False)
        analyses[a.analysis_id] = entry

        async def run() -> None:
            try:
                await a.run(stream.emit)
            finally:
                entry.finished = True

        entry.task = asyncio.create_task(run())
        return {"analysis_id": a.analysis_id, "mode": "replay"}

    @app.get("/api/analyses/{analysis_id}/events")
    async def analysis_events(analysis_id: str) -> EventSourceResponse:
        return sse(get_entry(analysis_id).stream)

    @app.post("/api/analyses/{analysis_id}/plans")
    async def add_plan(analysis_id: str, body: AddPlan) -> dict:
        e = get_entry(analysis_id)
        try:
            spec = PlanSpec.from_dict(body.plan)
        except (ValueError, TypeError, KeyError):
            return {"accepted": False, "reason": "That plan could not be read."}
        return await e.analysis.add_user_plan(spec, e.stream.emit)

    @app.post("/api/analyses/{analysis_id}/news-check")
    async def news_check(analysis_id: str, request: Request) -> Any:
        e = get_entry(analysis_id)
        ip = client_ip(request)
        if news_hits.full(ip):
            return JSONResponse({"accepted": False, "reason": "Live news is limited to one check a minute."}, 429)
        if credits_used_today() >= s.tavily_daily_credit_cap:
            return {"accepted": False, "reason": "Today's live news checks are used up. Try again tomorrow."}
        if not guard.allow():
            return {"accepted": False, "reason": "Today's free live budget is used up. Try again tomorrow."}
        news_hits.add(ip)
        scout = e.analysis.scout
        before = getattr(scout, "credits_used", 0)
        try:
            res = await e.analysis.news_check(e.stream.emit)
        finally:
            credits["used"] = credits_used_today() + max(0, getattr(scout, "credits_used", 0) - before)
        return res

    @app.post("/api/analyses/{analysis_id}/verify")
    async def verify(analysis_id: str) -> dict:
        e = get_entry(analysis_id)
        try:
            from backend.services import nebius_jobs  # built in T09
        except ImportError:
            return {"accepted": False, "reason": "not deployed yet"}
        return await nebius_jobs.start(e.analysis, e.stream.emit)

    @app.post("/api/analyses/{analysis_id}/replay")
    async def start_replay(analysis_id: str, body: ReplayRequest) -> dict:
        e = get_entry(analysis_id)
        a = e.analysis
        try:
            a.plan_spec(body.plan_name)
            a.shock(body.shock_id)
        except KeyError as err:
            raise HTTPException(404, {"reason": str(err.args[0])}) from err
        speed = min(max(body.speed or 1.0, 0.25), 1000.0)
        stream = Stream()
        rid = uuid.uuid4().hex[:12]

        async def run() -> None:
            try:
                await play_cell(a, body.plan_name, body.shock_id, stream.emit,
                                week_seconds=BASE_WEEK_SECONDS / speed, replay_id=rid)
            except Exception as err:
                log.exception("replay failed")
                stream.emit("error", {"message": f"The replay stopped: {type(err).__name__}.", "recoverable": False})
            finally:
                stream.close()

        re_entry = ReplayEntry(stream, clock())
        replays[rid] = re_entry
        re_entry.task = asyncio.create_task(run())
        return {"replay_id": rid}

    @app.get("/api/replays/{replay_id}/events")
    async def replay_events(replay_id: str) -> EventSourceResponse:
        r = replays.get(replay_id)
        if r is None:
            raise HTTPException(404, {"reason": "That replay is not here any more."})
        return sse(r.stream)

    @app.get("/api/analyses/{analysis_id}/memo")
    async def memo(analysis_id: str, format: str = "json") -> Any:
        a = get_entry(analysis_id).analysis
        if format == "md":
            return Response(
                a.memo_markdown(), media_type="text/markdown; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="decision-memo-{analysis_id}.md"'},
            )
        if a.memo is None:
            raise HTTPException(409, {"reason": "The memo is not ready yet."})
        return a.memo

    @app.post("/api/analyses/{analysis_id}/stop")
    async def stop(analysis_id: str) -> dict:
        e = get_entry(analysis_id)
        if e.task is not None and not e.task.done():
            e.task.cancel()
            e.finished = True
            e.stream.emit("done", {"analysis_id": analysis_id, "cost_usd": e.analysis.telemetry_snapshot()["cost_usd"]})
        return {"stopped": True}

    @app.get("/api/benchmark/export")
    def benchmark_export(format: str = "json") -> Response:
        report = benchmark.build(telemetry_dir)
        if format == "md":
            return Response(
                benchmark.to_markdown(report), media_type="text/markdown; charset=utf-8",
                headers={"Content-Disposition": 'attachment; filename="benchmark.md"'},
            )
        return Response(
            json.dumps(report, indent=2), media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="benchmark.json"'},
        )

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else {"reason": str(exc.detail)}
        return JSONResponse(detail, status_code=exc.status_code)

    # One container hosts everything: the exported Next.js site, last so the API routes win.
    if serve_frontend and FRONTEND_OUT.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_OUT, html=True), name="frontend")
    return app


app = create_app()
