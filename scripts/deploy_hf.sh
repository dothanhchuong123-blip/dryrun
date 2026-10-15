#!/usr/bin/env bash
# Push the app to a Hugging Face Space (Docker). Usage: scripts/deploy_hf.sh <hf-user>/<space-name>
# Git asks for a username and password: use your HF username and a WRITE access token as the password.
set -euo pipefail
SPACE="${1:?usage: scripts/deploy_hf.sh <hf-user>/<space-name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

[ -f "$ROOT/frontend/out/index.html" ] || { echo "Build the frontend first: cd frontend && npm ci && npm run build"; exit 1; }

cd "$ROOT"
cp Dockerfile pyproject.toml uv.lock "$STAGE"/
cp -R backend fixtures "$STAGE"/
mkdir -p "$STAGE/frontend" && cp -R frontend/out "$STAGE/frontend/out"
find "$STAGE" -name __pycache__ -type d -prune -exec rm -rf {} +
rm -rf "$STAGE"/fixtures/tavily_cache 2>/dev/null || true; cp -R fixtures/tavily_cache "$STAGE/fixtures/" 2>/dev/null || true
cat > "$STAGE/README.md" <<'EOM'
---
title: Market Digital Twin
emoji: 📈
sdk: docker
app_port: 7860
pinned: false
license: mit
---
Test your plans against the news before you commit. Built for the Nebius x NVIDIA Global AI Hackathon.
EOM

cd "$STAGE"
git init -q -b main
git add -A
git -c user.name="deploy" -c user.email="deploy@example.com" commit -q -m "Deploy"
git push --force "https://huggingface.co/spaces/$SPACE" main
echo "Pushed. Watch the build at https://huggingface.co/spaces/$SPACE (App tab → Logs)."
