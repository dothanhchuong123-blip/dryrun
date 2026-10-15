# Market Digital Twin: app image for the Nebius Serverless Endpoint (and, with a different command, the MC job).
# Build: docker buildx build --platform linux/amd64 -t <registry>/mdt-app:latest --push .
# The static frontend (frontend/out) is copied in if it exists; run `npm run build` in frontend/ first.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend ./backend
COPY fixtures ./fixtures
COPY frontend/out ./frontend/out

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
