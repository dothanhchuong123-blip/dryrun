# Market Digital Twin: app image for the Nebius Serverless Endpoint (and, with a different command, the MC job).
# Build: docker buildx build --platform linux/amd64 -t <registry>/mdt-app:latest --push .
# Stage 1 builds the static frontend (frontend/out); stage 2 is the Python app that also serves it.
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
COPY fixtures/replays ./fixtures/replays
RUN cd frontend && npm run build

FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend ./backend
COPY fixtures ./fixtures
COPY --from=web /web/frontend/out ./frontend/out

# Hosts (Render, Hugging Face) set $PORT. The 10k verify job runs in-process (local backend, ~140 MB peak).
RUN useradd -m -u 1000 app && mkdir -p /tmp/jobs && chown -R app /app /tmp/jobs
USER app
ENV PORT=8000 JOB_BACKEND=local JOB_DATA_DIR=/tmp/jobs
EXPOSE 8000
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
