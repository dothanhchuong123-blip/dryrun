"""Add the Tavily search log (`news.searched`, EVENTS v2.6) to recordings made before it existed.

    uv run python scripts/backfill_search_log.py            # check only: prints what it would add
    uv run python scripts/backfill_search_log.py --write    # rewrite fixtures/replays/analysis_*.jsonl

No Tavily credit and no model call: the searches are re-read from `fixtures/tavily_cache/` with the same queries and
filters the recording used (`NewsWatch.find` with `live=False`), so the counts are the real ones. A recording whose
searches are not all in the cache is left alone and reported. What the old recording never kept stays empty:
`quotes` is null (the verbatim check was not counted then), and favicons are missing (the cached responses were
fetched before `include_favicon`); the page shows a letter badge for those. Nothing else in a line changes.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import ROOT
from backend.services import replay
from backend.services.news_watch import NewsWatch
from backend.services.tavily_scout import TavilyScout

FALLBACK = {"delta_c_raw": 0.0, "delta_lead_time": 0, "demand_shock": 0.0, "evidence": [{"quote": "x"}]}


class _NoRouter:
    async def call(self, *a, **kw):
        return SimpleNamespace(parsed=None)


async def report_for(lines: list[dict]) -> dict | None:
    first = next(line for line in lines if line["event"] == "analysis")["data"]
    news = next(line for line in lines if line["event"] == "news")["data"]
    scout = TavilyScout(ROOT / "fixtures" / "tavily_cache", router=_NoRouter())
    nw = NewsWatch(scout, _NoRouter())
    nw.use_language = False  # these recordings were made before `language` was sent, so their cache keys lack it
    res = await nw.find(first["profile"], fallback_shock=FALLBACK, live=False)
    rep = res["searched"]
    if any(s.get("failed") for s in rep["searches"]) or not rep["searches"]:
        return None
    rep["quotes"] = None
    rep["results"]["used"] = sum(1 for i in news["items"] if i["kind"] == "supply" and i["source"] != "Example assumption")
    rep["backfilled"] = True
    return rep


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    rc = 0
    for path in sorted((ROOT / "fixtures" / "replays").glob("analysis_*.jsonl")):
        raw = path.read_text(encoding="utf-8").splitlines()
        lines = [json.loads(x) for x in raw if x.strip()]
        news = next((line for line in lines if line["event"] == "news"), None)
        if news is None:
            continue
        had = bool(news["data"].get("searched"))
        rep = news["data"]["searched"] if had else asyncio.run(report_for(lines))
        if rep is None:
            print(f"{path.name}: some searches are not in the cache, left alone")
            rc = 1
            continue
        r = rep["results"]
        print(f"{path.name}: {len(rep['searches'])} searches, returned {r['returned']}, kept {r['kept']}, "
              f"dropped {r['dropped']}, credits {rep['credits']}{' (already there)' if had else ''}")
        news["data"]["searched"] = rep
        if args.write:
            if not had:
                replay.write(path, lines)
            mock = ROOT / "frontend" / "mock" / f"{path.stem.removeprefix('analysis_')}.json"
            if mock.exists():  # the offline demo (no backend) shows the same log
                data = json.loads(mock.read_text(encoding="utf-8"))
                data["searched"] = rep
                mock.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
