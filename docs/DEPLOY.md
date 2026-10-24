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
6. **Rename to Dry Run (2026-10-20):** the GitHub repo is now `dothanhchuong123-blip/dryrun` (GitHub redirects the old URL) and the Blueprint service is named `dryrun`. Render can't change an existing service's `*.onrender.com` address, so the rename creates a new service (target https://dryrun.onrender.com). Add `NEBIUS_API_KEY` and `TAVILY_API_KEY` to it in the dashboard, then point the UptimeRobot monitor at it and delete the old `market-digital-twin` service.
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

## 7. Tavily credit cap review (2026-10-24, proposals only, nothing deployed)

Checked against the public site (`POST /api/analyses/{id}/news-check` on dryrun-1hny.onrender.com: 200 in 11 s, 2 credits, the card arrived on the SSE stream).

- **30 a day is about right for the month, not for the judging window on its own.** The free plan is 1,000 credits a month shared with our own research. 30 × 31 = 930, which leaves 70 for us; Dec 1–15 alone could use 450. A button check costs 2 credits, so the cap is 15 checks a day, and the rate limit already stops one visitor at 1 a minute.
- **The counter is in memory.** `credits` lives in the process, so every restart or redeploy resets it to 0 (the same ephemeral-disk problem as the dollar cap in §5). On Render free, any sleep (15 min idle without the UptimeRobot ping) or push to `ui/guided-flow` resets today's count. A restart loop could spend more than 30.
- **Custom LIVE analyses were not counted** (they cost 4 to 5 credits for the news step, up to 4 more if Ultra searches). As of this branch the news step and Ultra's searches report their credits into the same daily counter and Ultra's searches stop when it is full; the news step itself still starts regardless.

Proposals, in order of value:
1. **Before a custom LIVE analysis starts, check `credits_used_today() + 9 <= cap`; if not, run its news step from the cache only** (the analysis still finishes, with the labelled assumption). One `if` in `create_analysis`.
2. **Stop at a monthly figure, not just a daily one.** Read Tavily's own usage for the key (their `usage` endpoint, not verified by us) at startup and every hour, and refuse live calls above 850 of 1,000. This survives restarts and covers our own research use.
3. **Persist the daily counter** next to the telemetry files (it will still reset on a redeploy, but not on a plain restart), or put it in the same place as the dollar cap whichever way §5 is resolved.
4. **Lower `TAVILY_DAILY_CREDIT_CAP` to 20 until Nov 30, back to 30 for Dec 1–15** (it is an env var, no deploy needed). Judges are likelier to click the button than to run a custom business.
5. Keep `LIVE_ENABLED=false` as the real switch; it should also stop Tavily calls (today it only stops paid Nemotron calls).
