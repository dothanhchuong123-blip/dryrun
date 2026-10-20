# Deploying (T09)

## Decision (2026-10-15): public demo on Render (free), not Nebius compute or Hugging Face
- Nebius projects are suspended until a $25 top-up; a 24/7 CPU endpoint to Dec 15 would cost about $90-195.
- Hugging Face Docker Spaces now need PRO (paid). Static Spaces are free but can't run the backend.
- We stay eligible through Token Factory runtime calls (SPEC §1). The Nebius section below is an optional short run.

### Render (free Docker web service)
1. Push the repo to GitHub (Render deploys from a repo; `render.yaml` and the multi-stage `Dockerfile` are in it).
2. render.com → New → Blueprint → pick the repo. Add secrets `NEBIUS_API_KEY` and `TAVILY_API_KEY` when asked.
3. The image builds the frontend itself, serves it, and runs the 10k verify job in-process (`JOB_BACKEND=local`, ~140 MB peak).
4. Free services sleep after 15 min idle (first visit ~50 s). Ping `GET /health` every 10 min with a free monitor (UptimeRobot).
5. **Live (2026-10-20):** https://market-digital-twin.onrender.com, branch `ui/guided-flow`, autoDeploy on push. Uptime: https://stats.uptimerobot.com/6CwXtkPMBX (pings `/health` every 5 min).
6. **Judging calendar (automatic, UTC):** now → Nov 30: $0.20/day (≈1 LIVE run); Dec 1 → Dec 16: $0.70/day (≈2 runs, ≤ ~$11 total); from Dec 17: LIVE off, examples only. Change with `JUDGING_START`, `JUDGING_END`, `JUDGING_LIVE_DAILY_CAP_USD`, `PUBLIC_LIVE_DAILY_CAP_USD` in Render → Environment.
7. **Spend safety:** `LIVE_ENABLED=false` (Render → Environment) stops every paid Nemotron call without a deploy; examples still replay. Only 1 LIVE run at a time (`MAX_LIVE_ANALYSES`). The daily cap file lives on Render's ephemeral disk and resets on every restart or redeploy, so the switch plus a key-level limit in the Token Factory console are the real backstops.
8. Test from a logged-out browser and check that SSE streams (`curl -N <url>/api/analyses/<id>/events`).

---

## Nebius deploy (optional)
Status: **code and images are ready; nothing is deployed yet.** This machine has no `nebius` CLI and no Docker,
so the billable steps below are waiting for the owner's OK. Commands come from the Nebius CLI reference
(`nebius ai endpoint create`, `nebius ai create --type job`); flags marked ⚠️ were not confirmed against a live run.

## 0. Prerequisites (owner, once)
1. Install the Nebius CLI and run `nebius profile create` (pick the project, region and subnet).
2. Install Docker with buildx (or build in CI).
3. Create a **Container Registry** and log in (`nebius registry ...`) or use public GHCR. Set `REG=<registry-path>`.
4. Create an **Object Storage bucket** (`BUCKET`) and an access profile/secret for it (MysteryBox). The job and the
   endpoint both mount it at `/data`.
5. Put the keys in **MysteryBox** (`NEBIUS_API_KEY`, `TAVILY_API_KEY`). Never bake them into an image.

## 1. Build and push (linux/amd64)
```bash
cd frontend && npm ci && npm run build && cd ..          # writes frontend/out, which the image copies in
docker buildx build --platform linux/amd64 -t $REG/mdt-app:latest --push .
docker buildx build --platform linux/amd64 -f jobs/mc_worker/Dockerfile -t $REG/mdt-mc:latest --push .
```

## 2. Endpoint (the live URL)
List presets and prices first, and pick the cheapest CPU one (`cpu-d3 / 4vcpu-16gb` is the docs' example; check for
smaller): `nebius compute platform list` ⚠️, and the pricing page https://nebius.com/prices.
```bash
nebius ai endpoint create --name mdt-app --image $REG/mdt-app:latest \
  --platform cpu-d3 --preset 4vcpu-16gb --container-port 8000 --auth none \
  --env-secret NEBIUS_API_KEY=<secret> --env-secret TAVILY_API_KEY=<secret> \
  --env JOB_BACKEND=nebius --env JOB_BUCKET=$BUCKET --env JOB_IMAGE=$REG/mdt-mc:latest \
  --volume s3://$BUCKET:/data
nebius ai endpoint get <id> --format json     # status.public_endpoints → the https:// URL
```
The endpoint also needs the Nebius CLI and credentials to submit jobs (a service account); until that is in the image,
leave `JOB_BACKEND` empty and `/verify` answers "not deployed yet". ⚠️ (open item: bake the CLI into the image.)

## 3. Check from outside
```bash
curl -s $URL/health
curl -N $URL/api/analyses/<id>/events        # events must trickle in, not arrive in one block
uv run python scripts/bench_serverless.py $URL   # cold start, SSE, 10k job timings → bench/results/serverless.json
```

## 4. The 10k job
`POST /api/analyses/{id}/verify` writes `job.json` to `/data/<run>/`, runs
`nebius ai create --type job --image $REG/mdt-mc:latest --volume s3://$BUCKET:/data --container-command python
--args "-m backend.engine.planner --job /data/<run>/job.json --n 10000 --out /data/<run>/result.json"`, polls
`nebius ai job get`, then emits `grid_cell` (`source: "cloud"`) and `grid_summary` (`verified: true`).
Dev without the cloud: `JOB_BACKEND=local` runs the same planner CLI in a subprocess.
To run it by hand: `docker run -v $PWD/io:/data $REG/mdt-mc:latest --job /data/job.json --n 10000 --out /data/result.json`.

## 5. Stop, start, redeploy
- Stop billing: `nebius ai endpoint delete <id>` (⚠️ no stop/start subcommand is documented; recreate with step 2).
- Logs: `nebius ai endpoint logs <id>` · `nebius ai job logs <id>`
- Redeploy: push a new image tag, delete the endpoint, re-run step 2.

## 6. Cost to Dec 15
Hours from Oct 20 to Dec 15 ≈ 1,350 h (use 1,500 h for margin). Fill in the real hourly price before the OK.

| Item | Price/h | Hours | Total |
|---|---|---|---|
| Endpoint, cheapest CPU preset | _TBD from price list_ | 1,500 | _TBD_ |
| Job, 4 vcpu, ~minutes per run | _TBD_ | ~0.1 × runs | _TBD_ |
| Object Storage | negligible | | |
