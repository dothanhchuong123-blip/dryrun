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


def build(example, news, shocks, plans, cells, memo, headline):
    prof = example["profile"]
    rec = memo["plan_name"]
    # box 2: every story the search found, in order; the ones with a cost shock are the hits
    scan = [{"source": n["source"], "title": n["title"], "shock": n["shock"] if n.get("shock") and n["shock"].get("delta_c_raw") else None} for n in news][:5]
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
    return {
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


def main():
    m = json.loads((ROOT / "frontend/mock/coffee_austin.json").read_text())
    plans = [p["name"] if isinstance(p, dict) else p for p in (m["plans"]["plans"] if isinstance(m["plans"], dict) else m["plans"])]
    sc = m["script"]
    mock = build(
        m["examples"][0],
        m["news"]["items"] if isinstance(m["news"], dict) else m["news"],
        m["shocks"]["cases"] if isinstance(m["shocks"], dict) else m["shocks"],
        plans, m["cells"], m["memo"], sc["memo_headlines"].get(m["memo"]["plan_name"], sc["memo_headline_default"]),
    )
    ev = {}
    pl = []
    cells = []
    for line in (ROOT / "fixtures/replays/analysis_coffee_austin.jsonl").read_text().splitlines():
        d = json.loads(line)
        if d["event"] in ("news", "shocks", "memo"):
            ev[d["event"]] = d["data"]
        elif d["event"] == "plan":
            pl.append(d["data"]["name"])
        elif d["event"] == "grid_cell":
            cells.append(d["data"])
    live = build(m["examples"][0], ev["news"]["items"], ev["shocks"]["cases"], pl, cells, ev["memo"], ev["memo"]["headline"])
    for name, data in (("strip_mock", mock), ("strip_live", live)):
        (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
        print(name, data["headline"], data["gain"], data["sim"]["wins"], "/", len(data["sim"]["futures"]), [f["mean"] for f in data["sim"]["futures"]])


main()
