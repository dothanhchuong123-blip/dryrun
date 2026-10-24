"""One analysis, from business profile to decision memo (SPEC §15.1, §15.6; docs/EVENTS.md v2.1).

`Analysis.run(emit)` streams the whole analysis: `analysis`, `news`, then the analyst's events (`scenarios`,
`shocks`, `plan`, `crowd`, `grid_cell`, `grid_summary`, `agent_step`, `reasoning*`, `memo`), `telemetry` after LLM
calls (at most one a second) and at the end, then `done`. In REPLAY mode an example with a recording plays that
recording instead, at `speed` x real time, and makes no LLM call.

Every event also updates the state kept here (profile, calibration, columns, plans, each plan's shoppers, cells,
summary, memo), whether it was computed or replayed. So `add_user_plan`, `news_check`, `job_payload`,
`memo_markdown` and `backend.sim.replay_cell.play_cell` work the same after a LIVE run and after a replay.

`emit(event, data)` may be a plain function or a coroutine function.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np

from backend.agents import wording
from backend.agents.analyst import GUT_PREFIX, Analyst, _slug_spec, _unique_name, ask_crowd, gut_name
from backend.agents.prompts import profile_parser_messages
from backend.agents.schemas import BusinessProfile, ProfileNumericField, ProfileParse
from backend.config import ROOT
from backend.engine import planner
from backend.engine.planner import DO_NOTHING, PlanSpec, ShockCase
from backend.engine.types import N_ARCHETYPES, CrowdSentiment
from backend.services import replay
from backend.services.news_watch import NewsWatch
from backend.services.router import DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT, ModelsUnavailable, RunHealth
from backend.services.telemetry import CallRecord, TelemetryStore
from backend.sim import backtest as bt

log = logging.getLogger(__name__)

HORIZON = 24
N_PATHS = 1000
MAX_USER_PLANS = 4               # per analysis (EVENTS.md /plans); the gut call doesn't count
TELEMETRY_EVERY_S = 1.0          # `telemetry` events at most this often during a run
EXAMPLES_DIR = ROOT / "fixtures" / "examples"
# A custom profile with no usable article: an honest, labelled assumption (NewsWatch shows it as such).
DEFAULT_FALLBACK_SHOCK = {
    "delta_c_raw": 0.2, "delta_lead_time": 1, "demand_shock": 0.0,
    "evidence": [{"quote": "Assumed: your main input costs 20% more and deliveries take a week longer."}],
}

Emit = Callable[[str, dict], Any]
MODELS_DOWN = {
    "no_credit": "The AI models aren't available right now, so this live run stopped. You can watch a recorded run instead.",
    "capped": "Today's live budget is used up, so this live run stopped. You can watch a recorded run, or try live again tomorrow.",
    "server_error": "Token Factory isn't answering right now, so this live run stopped. Try again in a few minutes, or watch a recorded run.",
}
MODELS_DOWN["auth"] = MODELS_DOWN["no_credit"]


def load_example(example_id: str) -> dict:
    return json.loads((EXAMPLES_DIR / f"{example_id}.json").read_text(encoding="utf-8"))


def gut_preset(example: Mapping[str, Any], name: str | None = None) -> PlanSpec | None:
    """One of the example's `gut_plans` by name (case-insensitive), or the first one when `name` is None."""
    presets = list(example.get("gut_plans") or [])
    if not presets:
        return None
    if name is None:
        return PlanSpec.from_dict(presets[0])
    for p in presets:
        if p["name"].lower() == name.strip().lower():
            return PlanSpec.from_dict(p)
    raise ValueError(f"no gut plan named {name!r}; choose one of: {', '.join(p['name'] for p in presets)}")


class InputRejected(Exception):
    """The input is not enough to build a profile (F5 gate). `code` is "too_little" or "not_business"."""

    def __init__(self, code: str, reason: str, missing: list[str] | None = None) -> None:
        super().__init__(reason)
        self.code, self.reason, self.missing = code, reason, list(missing or [])


TOO_LITTLE_FREE = "There's almost nothing to read in that. Tell us what you sell and where."
TOO_LITTLE = "We need a bit more. What do you sell, and roughly where?"
NOT_BUSINESS = "This doesn't look like it's about a business. Try your price list, a sales report, or a line about your shop."
MIN_LETTERS = 8  # "I run a cafe" (9 letters) must pass; "hello" (5) must not. Spec said ~20; the existing F4 test needs less
GENERIC_UNITS = {"", "product", "products", "item", "items", "thing", "things", "goods", "stuff", "unit", "units"}
_URL = re.compile(r"https?://\S+|www\.\S+")


def letters_in(text: str) -> int:
    """Real letters in `text` once links are removed (emoji, digits, punctuation and spaces do not count)."""
    return sum(1 for ch in _URL.sub(" ", text) if ch.isalpha())


def is_empty_profile(profile: dict) -> bool:
    """Backstop after the model said "ok": every number is a guess AND the product is a generic word."""
    guessed = set(profile.get("guessed_fields") or [])
    all_guessed = set(ProfileNumericField.__args__) <= guessed
    unit = re.sub(r"[^a-z ]", "", str(profile.get("product_unit", "")).lower()).strip()
    return all_guessed and unit in GENERIC_UNITS


async def parse_profile(
    router: Any, text: str, page: dict | None = None, doc: dict | None = None
) -> tuple[dict, bool]:
    """Plain words (plus a page or file) -> BusinessProfile with one Super call (EVENTS.md /api/profile/parse).
    Raises InputRejected when the input is not enough or not about a business; ValueError if the parse fails."""
    res = await router.call(
        "super", profile_parser_messages(text, page, doc), ProfileParse, thinking=False, role="profile_parser",
        max_tokens=1000,
    )
    out = res.parsed
    if out is None:
        raise ValueError("Could not read a business profile from that text.")
    check = out.check
    if check.verdict != "ok":
        code = check.verdict
        raise InputRejected(code, check.reason or (NOT_BUSINESS if code == "not_business" else TOO_LITTLE), check.missing)
    if out.profile is None:
        raise ValueError("The model said ok but gave no profile.")
    profile = BusinessProfile.model_validate(out.profile.model_dump()).model_dump()
    if is_empty_profile(profile):
        raise InputRejected("too_little", TOO_LITTLE, ["what_you_sell"])
    return profile, False


def _sentiment(rows: Iterable[Mapping[str, Any]]) -> CrowdSentiment:
    """A `crowd` event's rows back to the engine's sentiment (the planner only reads mu, clipped to [-1, 1])."""
    mu = np.zeros((N_ARCHETYPES, 2))
    sigma = np.zeros((N_ARCHETYPES, 2))
    for r in rows:
        i = int(r["id"]) - 1
        if 0 <= i < N_ARCHETYPES:
            mu[i] = np.clip(np.asarray(r["mu"], dtype=float), -1.0, 1.0)
            sigma[i] = np.clip(np.asarray(r["sigma"], dtype=float), 0.0, 0.5)
    return CrowdSentiment(mu=mu, sigma=sigma)


class _RouterProxy:
    """Wraps the router: reports every finished call (for telemetry) and, with `cheap`, sends Ultra's calls to Super
    with Ultra's token and time limits (the SPEC §7.1 dev rule). Telemetry then prices them as Super, correctly."""

    def __init__(self, inner: Any, after_call: Callable[[Any], Any], *, cheap: bool = False) -> None:
        self.inner, self.after_call, self.cheap = inner, after_call, cheap
        self.health = RunHealth()   # this run's only: the inner router is shared by every visitor

    @property
    def hard_failure(self) -> str | None:
        """Why the models are unreachable ("no_credit", "auth", "capped", "server_error"), or None."""
        return self.health.reason

    @property
    def store(self) -> Any:
        return getattr(self.inner, "store", None)

    async def call(self, tier: str, messages: list[dict], schema: Any, **kw: Any) -> Any:
        if self.cheap and tier == "ultra":
            tier = "super"
            kw.setdefault("max_tokens", DEFAULT_MAX_TOKENS["ultra"])
            kw.setdefault("timeout", DEFAULT_TIMEOUT["ultra"])
        res = await self.inner.call(tier, messages, schema, **kw)
        rec = getattr(res, "record", None)
        if isinstance(rec, CallRecord):
            self.health.note(rec)
        await self.after_call(res)
        return res


class Analysis:
    def __init__(
        self,
        *,
        profile: Mapping[str, Any] | None = None,
        example: str | Mapping[str, Any] | None = None,
        mode: str = "live",
        router: Any = None,
        scout: Any = None,
        telemetry: TelemetryStore | None = None,
        seed: int = 0,
        gut_plan: PlanSpec | Mapping[str, Any] | None = None,
        n_paths: int = N_PATHS,
        max_rounds: int = 3,
        cheap: bool = False,
        fresh_news: bool = False,
        assumption_news: bool = False,
        recording: Path | None = None,
        speed: float = 1.0,
        analysis_id: str | None = None,
        clock: Callable[[], float] = time.monotonic,
        backtest: str | Mapping[str, Any] | None = None,
    ) -> None:
        """`example` is an example id or its loaded JSON; `profile` defaults to the example's. `mode` is "live" or
        "replay". In REPLAY, `recording` (default: the example's `analysis_<id>.jsonl`) is played if it exists;
        otherwise the analysis is computed with cached news only. `fresh_news` (LIVE) re-runs the Tavily searches
        instead of reading the cache, and overwrites the cache with the new results. `assumption_news` puts the example's
        labelled assumption in the `news` column even when articles are found (used for the recordings). `telemetry` is this analysis's own HUD store
        (default: a fresh in-memory one; the router keeps logging every call to disk as usual).
        `backtest` (B1) is a case id from `fixtures/backtests` or its loaded JSON: the analysis then runs as of the case's
        date, with only the news before it, and ends with a `backtest` event that scores the advice against what
        really happened. Its profile is the case's; its recording is `backtest_<id>.jsonl`."""
        self.case: dict | None = None
        if backtest is not None:
            self.case = bt.load_case(backtest) if isinstance(backtest, str) else dict(backtest)
            self.case.setdefault("as_of_date", date.fromisoformat(self.case["as_of"]))
            profile = profile if profile is not None else self.case["profile"]
        self.as_of: date | None = self.case["as_of_date"] if self.case else None
        self.backtest_id: str | None = self.case["id"] if self.case else None
        self.example = load_example(example) if isinstance(example, str) else (dict(example) if example else None)
        self.example_id: str | None = self.example["id"] if self.example else None
        if self.case is not None:  # a backtest has no example; its replay files are named backtest_<id>
            self.example_id = f"backtest_{self.case['id']}"
        if profile is None and self.example is None:
            raise ValueError("give a profile or an example")
        self.profile: dict = dict(profile if profile is not None else self.example["profile"])  # type: ignore[index]
        self.fallback_shock = dict((self.example or {}).get("fallback_shock") or DEFAULT_FALLBACK_SHOCK)
        self.mode = mode if mode in ("live", "replay") else "live"
        self.analysis_id = analysis_id or uuid.uuid4().hex[:12]
        self.seed, self.n_paths, self.max_rounds, self.speed = int(seed), int(n_paths), int(max_rounds), float(speed)
        self.gut_plan = None if gut_plan is None else (
            gut_plan.clamp() if isinstance(gut_plan, PlanSpec) else PlanSpec.from_dict(gut_plan)
        )
        self._router_inner = router
        self.router = _RouterProxy(router, self._after_call, cheap=cheap) if router is not None else None
        self.scout = scout
        self.fresh_news = fresh_news
        self.assumption_news = assumption_news
        self.telemetry = telemetry if telemetry is not None else TelemetryStore(persist=False)
        if recording is None and self.mode == "replay" and self.example_id:
            recording = (
                replay.backtest_path(self.case["id"]) if self.case is not None else replay.analysis_path(self.example_id)
            )
        self.recording = recording
        self._clock = clock
        self._news_watch = NewsWatch(scout, self.router) if scout is not None else None

        # state, filled by every event (computed or replayed)
        self._cal: planner.Calibration | None = None
        # the shoppers' mood weight this run uses; a replayed recording keeps the one it was recorded with
        self.sentiment_weight: float = planner.SENTIMENT_WEIGHT
        self.news: dict | None = None
        self.live_news: list[dict] = []
        self.scenarios: dict | None = None
        self.shock_events: list[dict] = []
        self.shocks: list[ShockCase] = []
        self.plans: dict[str, dict] = {}              # name -> {name, source, round, spec}, in order
        self.crowd_rows: dict[str, list[dict]] = {}
        self.cells: dict[tuple[str, str], dict] = {}  # (plan_name, shock_id) -> grid_cell
        self.summary: dict = {}
        self.memo: dict | None = None
        self.steps: list[dict] = []
        self.cost_usd = 0.0
        self.user_plans = 0
        self.from_recording = False
        self.backtest_result: dict | None = None      # the `backtest` event, once scored or replayed
        self.realized: ShockCase | None = None        # its `realized` column (a backtest only)
        self._reasoning: dict[tuple[str, int], str] = {}
        self.run_events: list[dict] = []              # run()'s stream as replay lines ({t, event, data})
        self._t0 = clock()
        self._recording_run = False
        self._telemetry_send: Callable[[str, dict], Any] | None = None
        self._last_telemetry = float("-inf")

    @classmethod
    def from_events(cls, lines: Iterable[Mapping[str, Any]], **kw: Any) -> Analysis:
        """Rebuild an analysis's state from a recorded stream without playing it (e.g. the CLI's last run)."""
        lines = list(lines)
        first = next(line for line in lines if line["event"] == "analysis")["data"]
        kw.setdefault("mode", "replay")
        if first.get("backtest_id") and "backtest" not in kw:
            kw["backtest"] = first["backtest_id"]
            example = None
        else:
            example = kw.pop("example", None) or first.get("example_id")
        a = cls(profile=first["profile"], example=example, analysis_id=first.get("analysis_id"), **kw)
        for line in lines:
            a._absorb(line["event"], line["data"])
        a.from_recording = True
        return a

    # --- state -------------------------------------------------------------------------------
    @property
    def cal(self) -> planner.Calibration:
        if self._cal is None:
            self._cal = planner.calibrate(self.profile, seed=self.seed, sentiment_weight=self.sentiment_weight)
        return self._cal

    def _absorb(self, event: str, data: Mapping[str, Any]) -> None:
        if event == "analysis":
            self.profile = dict(data["profile"])
            self.n_paths = int(data.get("n_paths", self.n_paths))
            self.sentiment_weight = float(data.get("sentiment_weight", planner.LEGACY_SENTIMENT_WEIGHT))
            self._cal = None
        elif event == "news":
            if self.news is None:
                self.news = {"items": list(data.get("items", [])), "used_for_grid": data.get("used_for_grid")}
            else:
                self.live_news.extend(data.get("items", []))
        elif event == "reasoning":
            key = (str(data.get("role", "")), int(data.get("round", 0)))
            self._reasoning[key] = self._reasoning.get(key, "") + str(data.get("delta", ""))
        elif event == "backtest":
            self.backtest_result = dict(data)
            self.realized = ShockCase.from_dict(data["realized_case"])
        elif event == "scenarios":
            self.scenarios = dict(data)
        elif event == "shocks":
            self.shock_events = [dict(c) for c in data["cases"]]
            self.shocks = [ShockCase.from_dict(c) for c in data["cases"]]
        elif event == "plan":
            self.plans[data["name"]] = {k: data[k] for k in ("name", "source", "round", "spec")}
        elif event == "crowd":
            self.crowd_rows[data["plan_name"]] = [dict(r) for r in data["archetypes"]]
        elif event == "grid_cell":
            self.cells[(data["plan_name"], data["shock_id"])] = dict(data)
        elif event == "grid_summary":
            self.summary = dict(data)
        elif event == "memo":
            self.memo = dict(data)
        elif event == "agent_step":
            self.steps.append(dict(data))
        elif event == "done":
            self.cost_usd = float(data.get("cost_usd", 0.0))

    def plan_spec(self, name: str) -> PlanSpec:
        if name.strip().lower() == DO_NOTHING.lower():
            return PlanSpec.do_nothing()
        if name not in self.plans:
            raise KeyError(f"no plan named {name!r}")
        return PlanSpec.from_dict(self.plans[name]["spec"])

    def shock(self, shock_id: str) -> ShockCase:
        if shock_id == bt.REALIZED_ID and self.realized is not None:
            return self.realized
        for c in self.shocks:
            if c.id == shock_id:
                return c
        raise KeyError(f"no shock column {shock_id!r}")

    def crowd_for(self, name: str) -> CrowdSentiment | None:
        rows = self.crowd_rows.get(name)
        return _sentiment(rows) if rows else None

    def cell(self, plan_name: str, shock_id: str = "news") -> dict | None:
        return self.cells.get((plan_name, shock_id))

    def _summary(self) -> dict:
        """Engine labels over every plan with a full row (SPEC §15.5.2), as a `grid_summary`."""
        specs, by_plan = [PlanSpec.do_nothing()], {}
        for name, p in self.plans.items():
            row = {c.id: self.cells.get((name, c.id)) for c in self.shocks}
            if all(row.values()):
                by_plan[len(specs)] = row
                specs.append(PlanSpec.from_dict(p["spec"]))
        best, safest = planner._labels(specs, self.shocks, by_plan)
        cells = [c for row in by_plan.values() for c in row.values()]
        return {
            "baseline_profit_usd": dict(self.summary.get("baseline_profit_usd", {})),
            "best_today": best, "safest": safest,
            "verified": bool(cells) and all(c.get("source") == "cloud" for c in cells),
        }

    # --- plumbing ----------------------------------------------------------------------------
    async def _send(self, emit: Emit, event: str, data: dict) -> None:
        self._absorb(event, data)
        if self._recording_run:
            self.run_events.append({"t": round(self._clock() - self._t0, 3), "event": event, "data": replay._plain(data)})
        res = emit(event, data)
        if asyncio.iscoroutine(res):
            await res

    async def _after_call(self, res: Any) -> None:
        rec = getattr(res, "record", None)
        if isinstance(rec, CallRecord) and self.telemetry is not getattr(self._router_inner, "store", None):
            self.telemetry.add(rec)
        if self._telemetry_send is not None and self._clock() - self._last_telemetry >= TELEMETRY_EVERY_S:
            await self._emit_telemetry(self._telemetry_send)

    def telemetry_snapshot(self) -> dict:
        snap = self.telemetry.snapshot()
        snap["job"] = dict(self.telemetry.job)
        return snap

    async def _emit_telemetry(self, send: Callable[[str, dict], Any]) -> None:
        self._last_telemetry = self._clock()
        await send("telemetry", self.telemetry_snapshot())

    # --- run ---------------------------------------------------------------------------------
    async def run(self, emit: Emit) -> dict:
        """The whole analysis as a stream. Returns `{plans, cells, summary, memo, cost_usd}`."""
        async def send(event: str, data: dict) -> None:
            await self._send(emit, event, data)

        self._t0, self.run_events, self._recording_run = self._clock(), [], True
        self._telemetry_send = send
        try:
            if self.mode == "replay" and self.recording is not None and Path(self.recording).exists():
                await self._play_recording(send)
            else:
                await self._compute(send)
        except asyncio.CancelledError:
            raise
        except ModelsUnavailable as e:
            log.warning("analysis %s stopped: models unavailable (%s)", self.analysis_id, e.reason)
            await send("error", {"message": MODELS_DOWN.get(e.reason, MODELS_DOWN["no_credit"]), "recoverable": True})
            await send("done", {"analysis_id": self.analysis_id, "cost_usd": round(self.telemetry_snapshot()["cost_usd"], 6)})
        except Exception as e:  # the stream must always end cleanly
            log.exception("analysis %s failed", self.analysis_id)
            await send("error", {"message": f"The analysis stopped: {type(e).__name__}.", "recoverable": False})
            await send("done", {"analysis_id": self.analysis_id, "cost_usd": round(self.telemetry_snapshot()["cost_usd"], 6)})
        finally:
            self._recording_run = False
            self._telemetry_send = None
        return {
            "plans": list(self.plans.values()), "cells": list(self.cells.values()), "summary": self.summary,
            "memo": self.memo, "cost_usd": self.cost_usd,
        }

    async def _compute(self, send: Callable[[str, dict], Any]) -> None:
        await send("analysis", {
            "analysis_id": self.analysis_id, "mode": self.mode, "example_id": self.example_id,
            "profile": self.profile, "horizon_weeks": HORIZON, "n_paths": self.n_paths,
            "as_of": self.as_of.isoformat() if self.as_of else None, "backtest_id": self.backtest_id,
            "sentiment_weight": self.sentiment_weight,
        })
        self._cal = await asyncio.to_thread(planner.calibrate, self.profile, self.seed, self.sentiment_weight)
        if self._news_watch is None:
            raise RuntimeError("no news scout configured")
        live_news = self.mode == "live" and not getattr(self.scout, "offline", False)
        news = await self._news_watch.find(
            self.profile, fallback_shock=self.fallback_shock, live=live_news, fresh=self.fresh_news,
            pin_assumption=self.assumption_news, as_of=self.as_of,
        )
        await send("news", {"items": news["items"], "used_for_grid": news["used_for_grid"], "searched": news.get("searched")})
        if self.router is None:
            raise RuntimeError("no router configured")
        analyst = Analyst(
            self.router, self.cal, self.profile, news, None, send,
            max_rounds=self.max_rounds, n_paths=self.n_paths, seed=self.seed, gut_plan=self.gut_plan,
            as_of=self.as_of,
        )
        await analyst.run()
        if self.case is not None:
            await self._score_backtest(send, analyst, news)
        await self._emit_telemetry(send)
        await send("done", {"analysis_id": self.analysis_id, "cost_usd": round(self.telemetry_snapshot()["cost_usd"], 6)})

    # --- backtest ----------------------------------------------------------------------------
    def llm_texts(self) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
        """Everything the models wrote in this run, for the leak check: `(texts, claim_texts)`. The futures' labels
        and reasons are in `texts` only: they are scenarios the models chose, not claims about what happens."""
        claims: list[tuple[str, str]] = []
        for (role, rnd), text in self._reasoning.items():
            claims.append((f"Ultra reasoning ({role}, round {rnd})", text))
        for st in self.steps:
            if st.get("kind") in ("think", "test", "finish", "shoppers"):
                claims.append((f"agent step ({st['kind']}, round {st.get('round', 0)})", str(st.get("text", ""))))
        sc = self.scenarios or {}
        if sc.get("thought"):
            claims.append(("futures: thought", str(sc["thought"])))
        claims += [("futures: not modelled", str(u["text"])) for u in sc.get("unmodelled", [])]
        for name, rows in self.crowd_rows.items():
            claims += [(f"shopper bubble ({name})", str(r["bubble"])) for r in rows if r.get("bubble")]
        if self.memo:
            for key in ("headline", "why", "watch_out", "recheck_when"):
                claims.append((f"memo: {key}", str(self.memo.get(key, ""))))
            claims += [("memo: not modelled", str(f["text"])) for f in (self.memo.get("not_modelled") or {}).get("found", [])]
        texts = list(claims)
        for c in self.shock_events:
            texts.append((f"future {c['id']}: label", str(c.get("label", ""))))
            if c.get("why"):
                texts.append((f"future {c['id']}: why", str(c["why"])))
        texts += [(f"plan name ({n})", n) for n in self.plans]
        return texts, claims

    async def _score_backtest(self, send: Callable[[str, dict], Any], analyst: Any, news: Mapping[str, Any]) -> None:
        """After the memo: score the advice against the real path and send the `backtest` event (SPEC §15.12)."""
        assert self.case is not None and self.memo is not None
        scored = await asyncio.to_thread(
            bt.score, case=self.case, cal=self.cal, plans={s.name: s for s in analyst.specs},
            crowd_for=lambda n: analyst._sent.get(n), pick=self.memo["plan_name"], seed=self.seed,
        )
        texts, claims = self.llm_texts()
        leak = bt.leak_check(texts, self.case, scored["realized"].cost_path, news.get("items", []), claims)
        data = bt.event(
            case=self.case, scored=scored, columns=analyst.shocks, leak=leak,
            dropped_news=int(news.get("dropped_asof", 0)), profile=self.profile, plans=analyst.specs,
        )
        await send("backtest", data)

    async def _play_recording(self, send: Callable[[str, dict], Any]) -> None:
        recorded_done: dict = {}

        def transform(event: str, data: dict) -> dict | None:
            if event == "done":
                recorded_done.update(data)
                return None
            if event in ("analysis",):
                data = {**data, "analysis_id": self.analysis_id, "mode": "replay"}
            return data

        self.from_recording = True
        await replay.play(Path(self.recording), send, speed=self.speed, transform=transform)  # type: ignore[arg-type]
        await self._add_gut_after_replay(send)
        await send("done", {"analysis_id": self.analysis_id, "cost_usd": float(recorded_done.get("cost_usd", 0.0))})

    async def _add_gut_after_replay(self, send: Callable[[str, dict], Any]) -> None:
        """A gut call that the recording doesn't have is added as an engine-only row (Ultra never saw it)."""
        g = self.gut_plan
        if g is None:
            return
        if _slug_spec(g) == _slug_spec(PlanSpec.do_nothing()):
            await send("agent_step", {
                "round": 0, "kind": "result", "plan_name": None, "tier": "engine", "latency_ms": None,
                "text": "Your gut call is to wait and see. That is the “Do nothing” line every plan is scored against.",
            })
            return
        name = gut_name(g.name)
        if name in self.plans or any(_slug_spec(self.plan_spec(n)) == _slug_spec(g) for n in self.plans):
            return
        await self._add_plan(replace(g, name=name), send, source="user", crowd=False)

    # --- user plans --------------------------------------------------------------------------
    async def add_user_plan(self, spec: PlanSpec | Mapping[str, Any], emit: Emit) -> dict:
        """Add a plan row the user built (EVENTS.md /plans). Engine only in REPLAY, so free; in LIVE the shoppers react
        first (one Lightning pair). Returns `{accepted, plan_name?, reason?}`."""
        async def send(event: str, data: dict) -> None:
            await self._send(emit, event, data)

        if not self.shocks:
            return {"accepted": False, "reason": "The analysis has not set up its futures yet."}
        if self.user_plans >= MAX_USER_PLANS:
            return {"accepted": False, "reason": f"You can add at most {MAX_USER_PLANS} plans."}
        plan = spec.clamp() if isinstance(spec, PlanSpec) else PlanSpec.from_dict(spec)
        if _slug_spec(plan) == _slug_spec(PlanSpec.do_nothing()):
            return {"accepted": False, "reason": "That plan changes nothing: it is the “Do nothing” line."}
        for name in self.plans:
            if _slug_spec(self.plan_spec(name)) == _slug_spec(plan):
                return {"accepted": False, "reason": f"That plan is already in the grid as “{name}”."}
        taken = {DO_NOTHING.lower(), *(n.lower() for n in self.plans)}
        name = _unique_name(plan.name, taken)
        if name.startswith(GUT_PREFIX):
            name = _unique_name(name[len(GUT_PREFIX):], taken)
        self.user_plans += 1
        self._telemetry_send = send
        try:
            await self._add_plan(replace(plan, name=name), send, source="user", crowd=self.mode == "live")
        finally:
            self._telemetry_send = None
        return {"accepted": True, "plan_name": name}

    async def _add_plan(self, plan: PlanSpec, send: Callable[[str, dict], Any], *, source: str, crowd: bool) -> None:
        rnd = max((p["round"] for p in self.plans.values()), default=0)
        await send("plan", {"name": plan.name, "source": source, "round": rnd, "spec": plan.to_dict()})
        sentiment: CrowdSentiment | None = None
        if crowd and self.router is not None:
            sentiment, rows, _missing = await ask_crowd(self.router, self.profile, plan)
            await send("crowd", {"plan_name": plan.name, "archetypes": rows})
        for case in self.shocks:
            cell = await asyncio.to_thread(
                planner.evaluate_cell, self.cal, plan, case, sentiment, HORIZON, self.n_paths, self.seed
            )
            await send("grid_cell", {**cell, "source": "local"})
        await send("grid_summary", self._summary())

    # --- live news ---------------------------------------------------------------------------
    async def news_check(self, emit: Emit) -> dict:
        """"Check live news" (SPEC §6, §15.7): one fresh search; the card arrives as a `news` event."""
        if self.case is not None:
            return {"accepted": False, "reason": "A backtest only sees the news from before its date."}
        if self._news_watch is None:
            return {"accepted": False, "reason": "Live news is not available here."}
        res = await self._news_watch.check(self.profile)
        if not res["items"]:
            return {"accepted": False, "reason": res.get("reason") or "No usable article found."}
        await self._send(emit, "news", {"items": res["items"], "used_for_grid": None})
        return {"accepted": True}

    # --- outputs -----------------------------------------------------------------------------
    def job_payload(self) -> dict:
        """Input for `planner.run_job` (the 10,000-per-cell Serverless Job): the same plans, columns, shoppers, seed."""
        crowd = {}
        for name in self.plans:
            s = self.crowd_for(name)
            if s is not None:
                crowd[name] = {"mu": s.mu.tolist(), "sigma": s.sigma.tolist()}
        return {
            "profile": dict(self.profile),
            "plans": [dict(p["spec"]) for p in self.plans.values()],
            "shocks": [c.to_dict() for c in self.shocks],
            "crowd": crowd,
            "seed": self.seed,
            "horizon": HORIZON,
        }

    def memo_markdown(self) -> str:
        """The decision memo as Markdown: words from Ultra, every number from the engine."""
        if self.memo is None:
            return "# Decision memo\n\nThe analysis has not finished yet.\n"
        m, p = self.memo, self.profile
        num = m["numbers"]
        pick = m["plan_name"]
        rival = p.get("rival_name") or "your rival"
        out = [
            f"# Decision memo: {p.get('business_name', 'your business')}",
            "",
            f"## {m['headline']}",
            "",
            f"**Pick: {pick}**" + ("  _(some steps used a fallback)_" if m.get("fallback_used") else ""),
            "",
            m["why"],
            "",
        ]
        if m.get("actions"):
            out += ["### What to do", ""] + [f"- Week {a['week']}: {a['text']}" for a in m["actions"]] + [""]
        out += ["### Today's news", "", m["cost_line"], ""]

        if pick != DO_NOTHING and self.shock_events:
            head = "| Future | Likelihood | Average vs Do nothing | 1-in-20 bad case | Better in |"
            out += [f"### “{pick}” in every future (24 weeks, gross profit vs doing nothing)", "", head, "|---|---|---|---|---|"]
            for c in self.shock_events:
                cell = self.cell(pick, c["id"])
                if cell is None:
                    continue
                out.append(
                    f"| {c['label']} | {c.get('likelihood', '')} | {wording.usd_k(cell['mean_delta_usd'])} | "
                    f"{wording.usd_k(cell['p5_delta_usd'])} | {round(100 * cell['p_better'])}% of runs |"
                )
            out.append("")

        out += ["### Where the result comes from (today's news)", ""]
        out += [f"- {line['text']}" for line in wording.bridge_lines(num["bridge"])]
        steady = num.get("steady_rival_delta_usd")
        if steady is not None:
            out += [
                f"- With a rival who never runs out: {wording.usd_k(steady)}",
                f"- Extra if {rival} runs short: {wording.usd_k(num['mean_delta_usd'] - steady)}",
            ]
        out.append("")

        cash = num.get("cash_available") or 0.0
        peak = num.get("peak_cash_usd") or 0.0
        if peak > 0:
            back = (f"it is back by week {num['payback_week']}" if num.get("payback_week") is not None
                    else "it is not back within 24 weeks")
            line = f"**Cash:** ties up {wording.usd_k(peak, signed=False)} at most compared with doing nothing; {back}."
            if num.get("over_cash"):
                line += f" That is more than the {wording.usd_k(cash, signed=False)} you said you have."
            elif cash > 0:
                line += f" You said you have {wording.usd_k(cash, signed=False)}."
        else:
            line = "**Cash:** ties up no extra cash compared with doing nothing."
        out += [line, ""]

        verified = "verified on the cloud" if num.get("verified") else "on this machine"
        out += [f"_Each result is {num['n']:,} simulated runs, {verified}._", ""]
        out += ["### Watch out", "", m["watch_out"], "", "### Check again", "", m["recheck_when"], ""]
        ru = m.get("runner_up")
        if ru:
            out += [
                f"### Runner-up: {ru['name']}", "",
                f"Average {wording.usd_k(ru['mean_delta_usd'])}, bad case {wording.usd_k(ru['p5_delta_usd'])}. {ru['why_not']}", "",
            ]

        nm = m.get("not_modelled") or {}
        out += ["### Not in these numbers", ""]
        titles = {i.get("id"): i.get("title") or i.get("source") for i in (self.news or {}).get("items", [])}
        for f in nm.get("found", []):
            src = titles.get(f.get("source_id"))
            out.append(f"- {f['text']}" + (f" ({src})" if src else ""))
        out += [f"- {t}" for t in nm.get("fixed", [])]
        out.append("")

        if m.get("sources"):
            out += ["### Sources", ""]
            for s in m["sources"]:
                quote = f" — “{s['quote']}”" if s.get("quote") else ""
                meta = " · ".join(x for x in (s.get("source"), s.get("published")) if x)
                out.append(f"- [{s.get('title') or s['url']}]({s['url']})" + (f" ({meta}, via Tavily)" if meta else "") + quote)
            out.append("")
        return "\n".join(out)
