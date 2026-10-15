"""T09: the verify job lifecycle, run against the local subprocess backend (no cloud)."""

from backend.config import get_settings
from backend.services import nebius_jobs
from tests.test_api import client, make_app, read_sse, start_example, wait_done


async def test_no_backend_means_not_deployed(tmp_path):
    app = make_app(tmp_path)
    async with client(app) as c:
        aid = await start_example(c)
        assert (await c.post(f"/api/analyses/{aid}/verify")).json() == {"accepted": False, "reason": "not deployed yet"}


async def test_verify_emits_cloud_cells(tmp_path, monkeypatch):
    monkeypatch.setenv("JOB_N_PATHS", "200")
    monkeypatch.setenv("JOB_POLL_S", "0.2")
    monkeypatch.setenv("JOB_DATA_DIR", str(tmp_path / "data"))
    get_settings.cache_clear()
    monkeypatch.setattr(nebius_jobs, "make_backend", lambda: nebius_jobs.LocalBackend())
    try:
        app = make_app(tmp_path)
        async with client(app) as c:
            aid = await start_example(c)
            await wait_done(app, aid)
            res = (await c.post(f"/api/analyses/{aid}/verify")).json()
            assert res["accepted"] and res["job_id"]
            ev = await read_sse(app, f"/api/analyses/{aid}/events", lambda e: any(
                x["event"] == "telemetry" and (x["data"])["job"]["status"] in ("verified", "failed")
                for x in e), timeout=60)
        jobs = [(x["data"])["job"]["status"] for x in ev if x["event"] == "telemetry"]
        assert jobs[-1] == "verified"
        cloud = [(x["data"]) for x in ev if x["event"] == "grid_cell" and (x["data"])["source"] == "cloud"]
        assert cloud
        assert [x for x in ev if x["event"] == "grid_summary"][-1]["data"]["verified"] is True
        assert not list((tmp_path / "data").iterdir())  # job files cleaned up
    finally:
        get_settings.cache_clear()
