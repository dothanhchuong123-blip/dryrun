# T09: Nebius deploy (Serverless Endpoint, Serverless Job MC-10K)

| | |
|---|---|
| Builder | **Claude Code**: **Sonnet 5.5**, effort medium, **plus you** for the console and billing steps |
| Start | New Claude Code session in this folder → pick that model → type: `Do the task in prompts/4_oct19-20_in-order/T09-nebius-deploy.md` |
| Parallel with | nothing. Starts after T08 (part 1 may start earlier). |
| Time | ~3 h |
| Depends on | Part 1 can run as early as Oct 19 with just `/health`. Part 2 needs T03 + T08. |

---
You are deploying the Market Digital Twin on Nebius AI Cloud.

**Read these:**
- `SPEC.md` §3.1, §7
- The Nebius docs. Fetch them:
  - https://docs.nebius.com/serverless/quickstart/endpoints
  - https://docs.nebius.com/serverless/quickstart/jobs
  - https://docs.nebius.com/serverless/endpoints/manage
  - https://docs.nebius.com/cli/reference/ai

**Rules:**
- **Before running any command that creates a billable resource,** show it to me along with the preset and the hourly price, then wait for my OK.
- Never put secrets in an image or in the repo.

**Part 1: de-risk early**
1. Write a `Dockerfile` (python:3.12-slim, `uv sync --frozen --no-dev`, `uvicorn backend.main:app --host 0.0.0.0 --port 8000`). Build it for linux/amd64. A frontend build stage gets added later.
2. Push the image to the Nebius Container Registry (or to public GHCR).
3. Create a Serverless Endpoint:
   - use the cheapest CPU preset; list the available presets and their prices first;
   - auth `none`, port `8000/http`;
   - pass the keys as env/secrets.
4. Check from outside: `curl /health`, and confirm that `curl -N` on an SSE route streams without buffering.

**Part 2: Monte Carlo job**
- `jobs/mc_worker/Dockerfile` runs `python -m backend.engine.montecarlo --schedule /in/schedule.json --n 10000 --out /out/result.json`.
- Move the input and output through an Object Storage bucket, using whichever method the docs make simplest.
- `backend/services/nebius_jobs.py` handles the job lifecycle:
  - submit the job (CLI subprocess or API);
  - poll its status;
  - fetch the result;
  - emit `stats` with source `cloud`, and set the job status in `telemetry`.
- Measure cold-start time and runtime, and write them to `bench/results/serverless.json`. This feeds the feedback report.

**Part 3: `docs/DEPLOY.md`**
- The exact redeploy commands.
- A cost table: hourly price × hours from now until Dec 15.
- How to stop and start the endpoint.

Commit as `T09: Nebius Serverless Endpoint + MC job`.
