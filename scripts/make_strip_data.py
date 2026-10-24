"""Builds the data for the landing page's "how it works" strip (frontend/components/flow/HowItWorks.tsx).

The strip must show exactly what the "Coffee roaster in Austin" example card then plays, so it is cut from the same sources:
  strip_mock.json  <- frontend/mock/coffee_austin.json            (offline demo)
  strip_live.json  <- fixtures/replays/analysis_coffee_austin.jsonl (backend replay)
Re-run after re-recording either one:  python3 scripts/make_strip_data.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "mock"


# what the typed line highlights and sends to the news search (each must sit in the first ~110 characters of the text)
KEYWORDS = {
    "coffee_austin": ["coffee", "Austin", "Brazil"],
    "coffee_hcmc": ["robusta", "Ho Chi Minh City", "cafés"],
    "furniture_eu": ["dining sets", "Bình Dương", "Germany"],
}
PLACEHOLDER = "Example assumption"  # the stand-in story the analyst adds when no live article is found: never shown


def build(example, news, shocks, plans, cells, memo, headline):
    prof = example["profile"]
    news = [n for n in news if n["source"] != PLACEHOLDER]
    rec = memo["plan_name"]
    # box 2: every story the search found, in order; the ones with a cost shock are the hits
    scan = [{"source": n["source"], "title": n["title"], "shock": n["shock"] if n.get("shock") and n["shock"].get("delta_c_raw") else None} for n in news]
    # the strip's reel shows 4: keep a miss in it so "N of 4 hit your costs" is never all of them, then restore the order found
    if len(scan) > 4:
        miss = next((i for i, r in enumerate(scan) if not r["shock"]), None)
        keep = [i for i, r in enumerate(scan) if r["shock"]][: 3 if miss is not None else 4]
        scan = [scan[i] for i in sorted(keep + ([miss] if miss is not None else []))]
    # box 3: the recommended plan's simulated result in every future the analyst picked (today's news first)
    by = {c["shock_id"]: c for c in cells if c["plan_name"] == rec}
    futures = []
    for s in shocks:
        c = by.get(s["id"])
        if not c:
            continue
        mean = c["mean_delta_usd"]
        futures.append({
            "label": s["label"],
            "mean": round(mean),
            "p5": round(c.get("p5_delta_usd", mean - abs(mean) * 0.4)),
            "payback": c.get("payback_week") or 8,
        })
    if not any(r["shock"] for r in scan):
        return None  # a run with no story that hits the costs has nothing to hand to the simulator
    return {
        "id": example["id"],
        "keywords": KEYWORDS[example["id"]],
        "text": example["text"],
        "profile": {k: prof[k] for k in ("product_unit", "price", "unit_cost", "rival_name", "rival_price")},
        "scan": scan,
        "sim": {
            "plan": rec,
            "runs": next(iter(by.values())).get("n", 1000),
            "futures": futures,
            "wins": sum(f["mean"] > 0 for f in futures),
        },
        "headline": headline,
        "gain": round(memo["numbers"]["mean_delta_usd"], 2),
    }


def example_of(m):
    return next(e for e in m["examples"] if e["id"] == m["example_id"])


def main():
    """Offline strips come from the recorded mock runs, live strips from the backend replays; a run is only used when at
    least one real story hits the costs. The page plays them one after another, a new one each loop."""
    mock, live = [], []
    for name in ("coffee_austin", "coffee_hcmc"):
        m = json.loads((ROOT / f"frontend/mock/{name}.json").read_text())
        plans = [p["name"] if isinstance(p, dict) else p for p in (m["plans"]["plans"] if isinstance(m["plans"], dict) else m["plans"])]
        sc = m["script"]
        b = build(
            example_of(m),
            m["news"]["items"] if isinstance(m["news"], dict) else m["news"],
            m["shocks"]["cases"] if isinstance(m["shocks"], dict) else m["shocks"],
            plans, m["cells"], m["memo"], sc["memo_headlines"].get(m["memo"]["plan_name"], sc["memo_headline_default"]),
        )
        if b:
            mock.append(b)
    ex = {e["id"]: e for e in json.loads((ROOT / "frontend/mock/coffee_austin.json").read_text())["examples"]}
    for name in ("coffee_austin", "furniture_eu", "coffee_hcmc", "pc_parts"):
        if name not in KEYWORDS:
            continue
        ev, pl, cells = {}, [], []
        for line in (ROOT / f"fixtures/replays/analysis_{name}.jsonl").read_text().splitlines():
            d = json.loads(line)
            if d["event"] in ("news", "shocks", "memo"):
                ev[d["event"]] = d["data"]
            elif d["event"] == "plan":
                pl.append(d["data"]["name"])
            elif d["event"] == "grid_cell":
                cells.append(d["data"])
        b = build(ex[name], ev["news"]["items"], ev["shocks"]["cases"], pl, cells, ev["memo"], ev["memo"]["headline"])
        if b:
            live.append(b)
    for name, data in (("strip_mock", mock), ("strip_live", live)):
        (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
        for d in data:
            print(name, d["id"], d["headline"], d["gain"], d["sim"]["wins"], "/", len(d["sim"]["futures"]), "hits", sum(bool(r["shock"]) for r in d["scan"]), "/", len(d["scan"]))


main()
