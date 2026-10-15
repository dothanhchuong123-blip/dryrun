"""The 10,000-paths-per-cell Serverless Job (SPEC §15.5, T09).

`start()` is called by `POST /api/analyses/{id}/verify`. It writes `Analysis.job_payload()` to the shared data
directory (an Object Storage bucket mounted at `JOB_DATA_DIR` in both the endpoint and the job), submits the job,
polls it into `telemetry.job`, and when it finishes emits every cell as `grid_cell` (`source: "cloud"`) and a
`grid_summary` with `verified: true`. Backends: "nebius" (Nebius CLI subprocess) and "local" (planner CLI subprocess,
for dev and tests). With no backend the route answers "not deployed yet".
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from backend.config import get_settings

log = logging.getLogger(__name__)

Emit = Callable[[str, dict], Any]
DONE, FAILED, RUNNING, QUEUED = "done", "failed", "running", "queued"
_FAILED_STATES = {"FAILED", "CANCELLED", "CANCELED", "ERROR", "TIMED_OUT", "TIMEOUT"}
_RUNNING_STATES = {"RUNNING", "STARTING", "IN_PROGRESS"}
_tasks: set[asyncio.Task] = set()
_active: dict[str, str] = {}  # analysis_id -> job id, one job per analysis at a time


class JobBackend(Protocol):
    async def submit(self, name: str, job_dir: Path, n_paths: int) -> str: ...
    async def state(self, job_id: str) -> str: ...
    async def cleanup(self, job_id: str) -> None: ...


async def _run(cmd: list[str], timeout: float = 120.0) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        raise
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


class LocalBackend:
    """Runs `python -m backend.engine.planner` in a subprocess: same files, same result, no cloud."""

    def __init__(self) -> None:
        self.procs: dict[str, asyncio.subprocess.Process] = {}

    async def submit(self, name: str, job_dir: Path, n_paths: int) -> str:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "backend.engine.planner", "--job", str(job_dir / "job.json"),
            "--n", str(n_paths), "--out", str(job_dir / "result.json"),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        self.procs[name] = proc
        return name

    async def state(self, job_id: str) -> str:
        proc = self.procs.get(job_id)
        if proc is None:
            return "FAILED"
        if proc.returncode is None:
            return "RUNNING"
        return "COMPLETED" if proc.returncode == 0 else "FAILED"

    async def cleanup(self, job_id: str) -> None:
        self.procs.pop(job_id, None)


class NebiusBackend:
    """Submits the job with the Nebius CLI (`nebius ai create --type job`). The bucket is mounted at /data."""

    def __init__(self, bucket: str, image: str, platform: str, preset: str, timeout: str, cli: str, data_dir: str) -> None:
        self.bucket, self.image, self.platform, self.preset = bucket, image, platform, preset
        self.timeout, self.cli, self.data_dir = timeout, cli, data_dir

    async def submit(self, name: str, job_dir: Path, n_paths: int) -> str:
        rel = job_dir.name
        args = (f"-m backend.engine.planner --job /data/{rel}/job.json --n {n_paths} "
                f"--out /data/{rel}/result.json")
        cmd = [
            self.cli, "ai", "create", "--type", "job", "--name", name, "--image", self.image,
            "--platform", self.platform, "--preset", self.preset, "--timeout", self.timeout,
            "--volume", f"s3://{self.bucket}:/data", "--container-command", "python", "--args", args,
            "--format", "json",
        ]
        code, out, err = await _run(cmd, 300)
        if code != 0:
            raise RuntimeError(f"job submit failed: {err.strip()[:300]}")
        return _job_id(out) or name

    async def state(self, job_id: str) -> str:
        code, out, err = await _run([self.cli, "ai", "job", "get", job_id, "--format", "json"], 60)
        if code != 0:
            raise RuntimeError(err.strip()[:200])
        data = json.loads(out)
        return str((data.get("status") or {}).get("state", "")).upper()

    async def cleanup(self, job_id: str) -> None:
        try:
            await _run([self.cli, "ai", "job", "delete", job_id], 60)
        except Exception:  # noqa: BLE001
            log.warning("could not delete job %s", job_id)


def _job_id(out: str) -> str | None:
    try:
        data = json.loads(out)
    except ValueError:
        return None
    for node in (data, data.get("resource") if isinstance(data, dict) else None):
        if isinstance(node, dict) and isinstance(node.get("metadata"), dict) and node["metadata"].get("id"):
            return str(node["metadata"]["id"])
    return None


def make_backend() -> JobBackend | None:
    s = get_settings()
    if s.job_backend == "local":
        return LocalBackend()
    if s.job_backend == "nebius":
        if not (s.job_bucket and s.job_image) or shutil.which(s.nebius_cli) is None:
            log.warning("JOB_BACKEND=nebius needs JOB_BUCKET, JOB_IMAGE and the nebius CLI")
            return None
        return NebiusBackend(s.job_bucket, s.job_image, s.job_platform, s.job_preset, s.job_timeout,
                             s.nebius_cli, s.job_data_dir)
    return None


async def start(
    analysis: Any, emit: Emit, backend: JobBackend | None = None, data_dir: Path | None = None
) -> dict:
    """Submit the verify job and return at once; progress and results arrive as events."""
    s = get_settings()
    backend = backend or make_backend()
    if backend is None:
        return {"accepted": False, "reason": "not deployed yet"}
    if not analysis.shocks or not analysis.plans:
        return {"accepted": False, "reason": "There are no plans to verify yet."}
    if analysis.analysis_id in _active:
        return {"accepted": False, "reason": "A verification is already running.", "job_id": _active[analysis.analysis_id]}
    root = Path(data_dir or s.job_data_dir)
    job_dir = root / f"{analysis.analysis_id}-{int(time.time())}"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "job.json").write_text(json.dumps(analysis.job_payload()), encoding="utf-8")
        job_id = await backend.submit(f"mc-10k-{job_dir.name}"[:60], job_dir, s.job_n_paths)
    except Exception as err:
        log.exception("job submit failed")
        await _set_job(analysis, emit, None, FAILED)
        return {"accepted": False, "reason": f"Could not start the verification: {type(err).__name__}."}
    _active[analysis.analysis_id] = job_id
    await _set_job(analysis, emit, job_id, QUEUED)
    task = asyncio.create_task(_watch(analysis, emit, backend, job_id, job_dir, s.job_poll_s, s.job_max_wait_s))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"accepted": True, "job_id": job_id}


async def _set_job(analysis: Any, emit: Emit, job_id: str | None, status: str, **extra: Any) -> None:
    analysis.telemetry.job = {"id": job_id, "status": status, **extra}
    res = emit("telemetry", analysis.telemetry_snapshot())
    if asyncio.iscoroutine(res):
        await res


async def _watch(analysis: Any, emit: Emit, backend: JobBackend, job_id: str, job_dir: Path,
                 poll_s: float, max_wait_s: float) -> None:
    t0 = time.monotonic()
    status, running_at = QUEUED, None
    try:
        while True:
            if time.monotonic() - t0 > max_wait_s:
                raise TimeoutError("job did not finish in time")
            state = await backend.state(job_id)
            if state in _FAILED_STATES:
                raise RuntimeError(f"job state {state}")
            new = RUNNING if state in _RUNNING_STATES else (DONE if state == "COMPLETED" else QUEUED)
            if new == RUNNING and running_at is None:
                running_at = time.monotonic()
            if new != status and new != DONE:
                status = new
                await _set_job(analysis, emit, job_id, status, queued_s=round(time.monotonic() - t0, 1))
            if new == DONE:
                break
            await asyncio.sleep(poll_s)
        result = json.loads((job_dir / "result.json").read_text(encoding="utf-8"))
        for cell in result["cells"]:
            await analysis._send(emit, "grid_cell", {**cell, "source": "cloud"})
        summary = analysis._summary()
        summary["baseline_profit_usd"] = dict(result.get("baseline_profit_usd", summary["baseline_profit_usd"]))
        summary["verified"] = True
        await analysis._send(emit, "grid_summary", summary)
        await _set_job(analysis, emit, job_id, "verified", total_s=round(time.monotonic() - t0, 1),
                       run_s=round(time.monotonic() - (running_at or t0), 1))
    except Exception as err:  # noqa: BLE001
        log.warning("verify job %s failed: %s", job_id, err)
        await _set_job(analysis, emit, job_id, FAILED)
    finally:
        _active.pop(analysis.analysis_id, None)
        await backend.cleanup(job_id)
        shutil.rmtree(job_dir, ignore_errors=True)
