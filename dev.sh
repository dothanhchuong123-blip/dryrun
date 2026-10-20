#!/usr/bin/env bash
# Run the app on localhost.
#   ./dev.sh          offline demo: frontend only, plays the recorded coffee run. Free.   → http://localhost:3000
#   ./dev.sh --live   backend on :8000 + frontend on :3000. Uses the keys in .env, so live runs
#                     spend Token Factory credit (about $0.33 a run, capped by DAILY_SPEND_CAP_USD).
# PORT=3005 ./dev.sh picks another frontend port (e.g. a second checkout or worktree).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
API_PORT="${API_PORT:-8000}"

# a fresh checkout or worktree has no node_modules yet
[ -d frontend/node_modules ] || npm --prefix frontend install

if [ "${1:-}" = "--live" ]; then
  [ -f .env ] || { echo "No .env here: copy .env.example to .env and add the keys, or run ./dev.sh for the offline demo." >&2; exit 1; }
  uv sync -q
  FRONTEND_ORIGIN="http://localhost:$PORT" uv run uvicorn backend.main:app --reload --port "$API_PORT" &
  API_PID=$!
  trap 'kill $API_PID 2>/dev/null' EXIT
  echo "Backend: http://localhost:$API_PORT · Frontend: http://localhost:$PORT"
  NEXT_PUBLIC_API_BASE="http://localhost:$API_PORT" npm --prefix frontend run dev -- -p "$PORT"
else
  echo "Offline demo: http://localhost:$PORT"
  NEXT_PUBLIC_API_BASE= npm --prefix frontend run dev -- -p "$PORT"
fi
