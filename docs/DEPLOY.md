# Deploying (T09)

## Decision (2026-10-15): public demo on Hugging Face Spaces, not Nebius compute
Nebius projects are suspended until a $25 top-up, and a 24/7 CPU endpoint to Dec 15 would cost about $90-195.
We stay eligible through Token Factory runtime calls (SPEC §1). The Nebius deploy below stays as an optional short
run (a few hours) for benchmark numbers if we choose to top up. Hugging Face needs no card.

### Hugging Face Spaces (Docker, free)
1. Create a Space: SDK **Docker**, public. Add secrets `NEBIUS_API_KEY` and `TAVILY_API_KEY` in Settings.
2. The Space repo needs a README with this front matter (keep the project README.md untouched; use a separate Space README):
   `---\ntitle: Market Digital Twin\nsdk: docker\napp_port: 7860\n---`
3. Push this repo's files (Dockerfile, backend/, fixtures/, frontend/out/, pyproject.toml, uv.lock) to the Space git remote.
   `frontend/out` is gitignored here, so build it first and force-add it in the Space copy.
4. The image runs as uid 1000 on `$PORT` (7860) with `JOB_BACKEND=local`: the 10k verify job runs in-process.
5. Free Spaces sleep after inactivity; set up an uptime ping on `/health` to keep it awake, and test from a logged-out browser.

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
