# Serverless Job "mc-10k": 10,000 paths per cell. Build from the repo root:
#   docker buildx build --platform linux/amd64 -f jobs/mc_worker/Dockerfile -t <registry>/mdt-mc:latest --push .
# Input/output live in the Object Storage bucket the job mounts at /data (the app passes --job/--out paths).
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend ./backend

ENTRYPOINT ["python", "-m", "backend.engine.planner"]
CMD ["--job", "/data/job.json", "--n", "10000", "--out", "/data/result.json"]
