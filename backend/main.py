"""FastAPI entrypoint. SSE streaming, LIVE/REPLAY modes and spend guard arrive in task T09."""
from fastapi import FastAPI

app = FastAPI(title="Market Digital Twin")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
