"""Measure the deployed Serverless Endpoint and the 10k Serverless Job; writes bench/results/serverless.json.

Usage: uv run python scripts/bench_serverless.py https://<endpoint-url> [--example coffee_hcmc]
Endpoint cold start: time to the first 200 from /health (run it right after `endpoint start`).
SSE: the first event of an analysis stream must arrive while the stream is still open (no buffering).
Job: POST /verify, then read telemetry.job from the stream: queued_s (cold start), run_s, total_s.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

OUT = Path(__file__).resolve().parents[1] / "bench" / "results" / "serverless.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--example", default="coffee_hcmc")
    ap.add_argument("--timeout", type=float, default=900.0)
    args = ap.parse_args()
    base = args.url.rstrip("/")
    res: dict = {"measured_at": datetime.now(UTC).isoformat(), "url": base}

    t0 = time.monotonic()
    with httpx.Client(timeout=10) as c:
        while True:
            try:
                if c.get(f"{base}/health").status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if time.monotonic() - t0 > 600:
                raise SystemExit("endpoint never became healthy")
            time.sleep(2)
        res["endpoint_cold_start_s"] = round(time.monotonic() - t0, 1)

        aid = c.post(f"{base}/api/analyses", json={"example_id": args.example, "mode": "replay"}).json()["analysis_id"]
        t1, first, seen = time.monotonic(), None, 0
        with httpx.Client(timeout=None) as s, s.stream("GET", f"{base}/api/analyses/{aid}/events") as r:
            for line in r.iter_lines():
                if line.startswith("event:"):
                    seen += 1
                    first = first if first is not None else time.monotonic() - t1
                    if line.endswith("done"):
                        break
        res["sse"] = {"first_event_s": round(first or -1, 2), "events": seen,
                      "total_s": round(time.monotonic() - t1, 2)}

        v = c.post(f"{base}/api/analyses/{aid}/verify").json()
        res["verify_accepted"] = v.get("accepted", False)
        if v.get("accepted"):
            t2, job = time.monotonic(), {}
            with httpx.Client(timeout=None) as s, s.stream("GET", f"{base}/api/analyses/{aid}/events") as r:
                ev = ""
                for line in r.iter_lines():
                    if line.startswith("event:"):
                        ev = line.split(":", 1)[1].strip()
                    elif line.startswith("data:") and ev == "telemetry":
                        job = json.loads(line[5:]).get("job", {})
                        if job.get("status") in ("verified", "failed") or time.monotonic() - t2 > args.timeout:
                            break
            res["job"] = job
            res["job_wall_s"] = round(time.monotonic() - t2, 1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(json.dumps(res, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
