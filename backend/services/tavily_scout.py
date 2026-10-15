"""Tavily Search+Extract with disk cache, grounded shocks, "Check live news" and Deep-Scout triggers.

See SPEC §6. The LLM (Super) only parses article text into a ShockVector; every quote it returns is
verified verbatim against the extracted text before it can reach the engine or the UI.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.agents.prompts import scout_query_messages, shock_parser_messages
from backend.agents.schemas import Evidence, ScoutQuery, ShockVector
from backend.config import ROOT, get_settings

CREDITS_SEARCH = {"basic": 1, "advanced": 2}
MAX_QUOTE = 300
TAVILY_TIMEOUT = 40.0  # seconds per Tavily call; a hang must not stall the sim
PARAMS = ("delta_c_raw", "delta_lead_time", "demand_shock")
_PARAM_SCALE = {"delta_c_raw": 1.0, "delta_lead_time": 10.0, "demand_shock": 0.5}


class OfflineCacheMiss(RuntimeError):
    """Raised in offline mode when a request has no cached response."""


@dataclass
class ScoutResult:
    """Unpacks as `(shock, cards)`; `credits` is what this call spent (for TAVILY_DAILY_CREDIT_CAP)."""

    shock: ShockVector | None
    cards: list[dict] = field(default_factory=list)
    credits: int = 0
    fallback: bool = False

    def __iter__(self):
        yield self.shock
        yield self.cards


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def verify_evidence(shock: ShockVector, articles: list[dict]) -> ShockVector | None:
    """Keep only quotes found verbatim (whitespace/case-insensitive) in the extracted text; None if none remain."""
    haystack = _norm(" ".join(str(a.get("content", "")) for a in articles))
    kept: list[Evidence] = []
    for ev in shock.evidence:
        q = _norm(ev.quote)
        if len(q) >= 8 and q in haystack:
            kept.append(ev)
    if not kept:
        return None
    return shock.model_copy(update={"evidence": kept})


def _cards(shock: ShockVector, articles: list[dict], query: str, *, live: bool, applied: bool = False) -> list[dict]:
    """One grounding card (EVENTS.md) per surviving quote, tying it to the parameter it moved most."""
    titles = {a.get("url"): a.get("title", "") for a in articles}
    values = {p: getattr(shock, p) for p in PARAMS}
    ranked = sorted((p for p in PARAMS if values[p]), key=lambda p: -abs(values[p]) / _PARAM_SCALE[p]) or ["delta_c_raw"]
    ts = datetime.now(UTC).isoformat(timespec="seconds")
    out = []
    for i, ev in enumerate(shock.evidence):
        param = ranked[i % len(ranked)]
        out.append(
            {
                "id": hashlib.sha1(f"{query}|{ev.url}|{ev.quote}".encode()).hexdigest()[:12],
                "query": query,
                "url": ev.url,
                "title": titles.get(ev.url, ""),
                "quote": ev.quote[:MAX_QUOTE],
                "param": param,
                "value": values[param],
                "ts": ts,
                "live": live,
                "applied": applied,
            }
        )
    return out


class TavilyScout:
    def __init__(self, cache_dir: str | Path = "fixtures/tavily_cache", offline: bool = False, *, client: Any = None, router: Any = None) -> None:
        p = Path(cache_dir)
        self.cache_dir = p if p.is_absolute() else ROOT / p
        self.offline = offline
        self._client = client
        self._router = router
        self.credits_used = 0

    # --- plumbing ---------------------------------------------------------------------
    @property
    def client(self):
        if self._client is None:
            from tavily import AsyncTavilyClient

            self._client = AsyncTavilyClient(api_key=get_settings().tavily_api_key.get_secret_value())
        return self._client

    @property
    def router(self):
        if self._router is None:
            from backend.services.router import NemotronRouter

            self._router = NemotronRouter()
        return self._router

    def _path(self, kind: str, req: dict) -> Path:
        key = hashlib.sha1(json.dumps({"kind": kind, **req}, sort_keys=True, default=str).encode()).hexdigest()
        return self.cache_dir / f"{kind}_{key}.json"

    async def _cached(self, kind: str, req: dict, credits: int, fetch, use_cache: bool, cache_only: bool = False) -> dict:
        path = self._path(kind, req)
        if use_cache and path.exists():
            return json.loads(path.read_text())
        if self.offline or cache_only:
            raise OfflineCacheMiss(f"offline mode: no cached {kind} for {req}")
        resp = await asyncio.wait_for(fetch(), TAVILY_TIMEOUT)
        self.credits_used += credits
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(resp))
        return resp

    # --- Tavily calls -----------------------------------------------------------------
    async def search(
        self, query: str, depth: str = "advanced", time_range: str = "week",
        include_domains: list[str] | None = None, *, use_cache: bool = True,
        topic: str = "news", country: str = "", cache_only: bool = False,
    ) -> dict:
        """`country` boosts local results and is only sent with `topic="general"` (Tavily ignores it for news).
        `cache_only` raises OfflineCacheMiss instead of spending a credit when the cache has no answer."""
        req: dict[str, Any] = {"query": query, "depth": depth, "time_range": time_range, "include_domains": include_domains or []}
        if topic != "news":  # keep the cache keys of plain news searches unchanged
            req["topic"] = topic
        if topic == "general" and country:
            req["country"] = country

        async def fetch():
            kw: dict[str, Any] = {
                "query": query, "search_depth": depth, "topic": topic, "time_range": time_range, "max_results": 5,
            }
            if include_domains:
                kw["include_domains"] = include_domains
            if topic == "general" and country:
                kw["country"] = country
            return await self.client.search(**kw)

        return await self._cached("search", req, CREDITS_SEARCH[depth], fetch, use_cache, cache_only)

    async def extract(self, urls: list[str], query: str = "", *, use_cache: bool = True, cache_only: bool = False) -> dict:
        req = {"urls": urls, "query": query}

        async def fetch():
            return await self.client.extract(urls=urls, query=query or None, extract_depth="basic", format="text")

        return await self._cached("extract", req, math.ceil(len(urls) / 5), fetch, use_cache, cache_only)

    # --- pipeline ---------------------------------------------------------------------
    async def _parse(self, articles: list[dict], hint: str) -> ShockVector | None:
        res = await self.router.call(
            "super", shock_parser_messages(articles, hint), ShockVector, thinking=False, role="shock_parser"
        )
        if res.parsed is None:
            return None
        return verify_evidence(res.parsed, articles)

    async def _pipeline(
        self, query: str, depth: str, domains: list[str] | None, hint: str, n_urls: int, *, use_cache: bool
    ) -> tuple[ShockVector | None, list[dict]]:
        sr = await self.search(query, depth, include_domains=domains, use_cache=use_cache)
        results = [r for r in sr.get("results", []) if r.get("url")][:n_urls]
        if not results:
            return None, []
        er = await self.extract([r["url"] for r in results], query, use_cache=use_cache)
        titles = {r["url"]: r.get("title", "") for r in results}
        articles = [
            {"url": e["url"], "title": titles.get(e["url"], ""), "content": e.get("raw_content") or ""}
            for e in er.get("results", [])
            if e.get("raw_content")
        ]
        if not articles:
            return None, []
        return await self._parse(articles, hint), articles

    @staticmethod
    def _fallback(scenario: dict, credits: int) -> ScoutResult:
        shock = ShockVector.model_validate(scenario["fallback_shock"])
        return ScoutResult(shock, _cards(shock, [], scenario["seed_queries"][0], live=False), credits, fallback=True)

    async def ground_shock(self, scenario: dict) -> ScoutResult:
        """Advanced search -> extract top 2 -> Super parse -> verbatim quote check, trying each seed query in turn.
        Falls back to the scenario's fallback shock if none yields a verified quote."""
        before = self.credits_used
        shock, articles, query = None, [], scenario["seed_queries"][0]
        for query in scenario["seed_queries"]:  # next seed query only if this one yields no verified quote
            try:
                shock, articles = await self._pipeline(
                    query, "advanced", scenario.get("include_domains"), scenario.get("title", ""), 2, use_cache=True
                )
            except Exception:  # noqa: BLE001  Tavily / network / offline miss: scenario still runs
                shock, articles = None, []
            if shock is not None:
                break
        spent = self.credits_used - before
        if shock is None:
            return self._fallback(scenario, spent)
        return ScoutResult(shock, _cards(shock, articles, query, live=False), spent)

    async def news_check(self, scenario: dict) -> ScoutResult:
        """Judges' "Check live news": a real runtime call (cache read bypassed, response still cached)."""
        if self.offline:
            raise OfflineCacheMiss("news_check needs a live Tavily call")
        before = self.credits_used
        query = scenario["seed_queries"][0]
        shock, articles = None, []
        try:
            shock, articles = await self._pipeline(
                query, "basic", scenario.get("include_domains"), scenario.get("title", ""), 1, use_cache=False
            )
        except Exception:  # noqa: BLE001, S110  caller sees shock=None and the credits spent
            pass
        spent = self.credits_used - before
        if shock is None:
            return ScoutResult(None, [], spent)
        return ScoutResult(shock, _cards(shock, articles, query, live=True), spent)


class DeepScout:
    """Agent-initiated follow-up search (SPEC §6): at most one per decision epoch."""

    WINDOW = 3
    MARGIN_DROP = 0.15
    LEAD_SPIKE = 2

    def __init__(self, scout: TavilyScout) -> None:
        self.scout = scout
        self._last_epoch: int | None = None

    def should_trigger(self, history: list[dict]) -> str | None:
        """history rows: {"tick", "margin", "lead_time", "new_shock": bool}. Returns a symptom text or None."""
        if len(history) <= self.WINDOW:
            return None
        recent, base = history[-self.WINDOW :], history[-self.WINDOW - 1]
        if any(r.get("new_shock") for r in recent):
            return None
        m0, m1 = base.get("margin"), history[-1].get("margin")
        if m0 is not None and m1 is not None and m0 > 0 and (m0 - m1) / m0 > self.MARGIN_DROP:
            return f"Profit margin fell {100 * (m0 - m1) / m0:.0f}% over {self.WINDOW} ticks with no known shock"
        l0, l1 = base.get("lead_time"), history[-1].get("lead_time")
        if l0 is not None and l1 is not None and l1 - l0 >= self.LEAD_SPIKE:
            return f"Supplier lead time jumped from {l0} to {l1} ticks with no known shock"
        return None

    async def run(self, history: list[dict], epoch: int, scenario: dict) -> ScoutResult | None:
        if self._last_epoch == epoch:
            return None
        symptom = self.should_trigger(history)
        if symptom is None:
            return None
        self._last_epoch = epoch
        before = self.scout.credits_used
        res = await self.scout.router.call(
            "super", scout_query_messages(symptom), ScoutQuery, thinking=False, role="scout_query"
        )
        query = res.parsed.query if res.parsed is not None else scenario["seed_queries"][-1]
        try:
            shock, articles = await self.scout._pipeline(
                query, "basic", scenario.get("include_domains"), symptom, 1, use_cache=True
            )
        except Exception:  # noqa: BLE001
            shock, articles = None, []
        spent = self.scout.credits_used - before
        if shock is None:
            return ScoutResult(None, [], spent)
        return ScoutResult(shock, _cards(shock, articles, query, live=not self.scout.offline), spent)
