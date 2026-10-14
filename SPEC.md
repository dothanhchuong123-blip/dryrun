# Market Digital Twin: Build Spec v2

**Event:** Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents track
**Version:** v2, 2026-10-14. Replaces the v1 research prompt. **This file is the source of truth.**
**Legend:** ✅ verified on 2026-10-14 (source in §14) · ⚠️ not verified, check on Day 1 (§13)

---

## 0. What changed from v1 (read first)

| # | v1 said | Problem | v2 decision |
|---|---|---|---|
| 1 | Ultra and Nano run on **Nebius Serverless Endpoints** | Serverless Endpoints run *your own container* on Nebius Compute VMs. Hosting a 550B model yourself would need a multi-GPU node, and you'd have to keep it running through judging. Managed per-token inference is **Token Factory**. | **All Nemotron inference goes through the Token Factory API.** A **Serverless Endpoint** hosts *our app* (the live URL). A **Serverless Job** runs the 10k-path Monte Carlo. Together they cover both "runs on Nebius" paths. |
| 2 | 1.5 s per tick, with a 4.0 s timeout on every LLM call, Ultra included | Ultra is a long-winded reasoning model: ~150–200 tok/s, and thousands of reasoning tokens means 10–40 s per decision. It would hit the timeout on every call. | **Two-speed loop** (§3.2). Market ticks are pure NumPy every 1.5 s. CEO decisions come at **decision epochs** every K ticks and run asynchronously, so the sim keeps going on the previous policy until the new one arrives. Each tier gets its own timeout. |
| 3 | 2 Ultra + 1–3 Super + 3–12 Nano calls on every tick | That works out to ~250–400 RPM. Token Factory's illustrative baseline is **60 RPM / 400k TPM** ✅ (it auto-scales ×1.2 per 15 min, up to 20×), so this would return 429s. | **≈ 45 RPM total.** The limits we actually measured are per model and much higher (§3.2), but TPM is what binds for Ultra. A **per-model** limiter reads the `x-ratelimit-*` headers and honours `Retry-After`. Priority is Ultra > Super > crowd, and crowd calls are dropped first. |
| 4 | Monte Carlo layer = "Nemotron Nano + NumPy" over 10,000 paths | You can't make LLM calls inside 10k rollouts. | **The MC is pure NumPy.** The LLMs' chosen policies are frozen and replayed. Randomness comes from demand noise, lead times and shock size. |
| 5 | HUD shows "Ultra 2% / Super 8% / Nano 90%" | This contradicts v1's own call table (Ultra would be 12–30% of calls), and Ultra dominates by token count. Judges will notice a hardcoded number. | **Every telemetry figure is computed from real call logs.** Report both call share and token share. "Cost saved" is measured against a counterfactual where every call goes to Ultra. |
| 6 | $t$-test of AI vs baseline profit | A single run gives you n = 1. With n = 10k, p ≈ 0 every time, so p alone means nothing. | **Paired $t$-test over MC paths using common random numbers.** Report mean Δπ, CI95 **and Cohen's d** (§4.6). |
| 7 | Stockout spillover goes A→B only and is uncapped | It's asymmetric, the spilled demand can exceed B's stock, and the order of operations is undefined. | Spillover is symmetric and capped by the rival's remaining stock, with the order of operations fixed (§4.3). |
| 8 | Nothing about the judging period | Judging runs **Dec 1–15**. The demo has to stay *functional, free and unrestricted* until then ✅. | **REPLAY mode is the public default.** LIVE mode is rate-limited per IP and has a daily spend cap. Hosting is budgeted through Dec 15 (§7). |
| 9 | Model tiers: Ultra / Super / Nano | **Nemotron 3.5 Lightning** (30B-A3B) shipped 2026-08-11 ✅. It scores about +9 on the Artificial Analysis index vs Nano and is built for fast agent steps. **It is on Token Factory** ✅. In the Day-1 test it had a TTFT of 0.94 s, against 5.2 s for Nano (n=1). NVIDIA also shipped **NeMo Switchyard**, an open-source model-routing library ✅. | **Fast tier = Lightning.** Nano stays as a fallback and as the comparison in the benchmark. **Benchmark Lightning against Nano** for the feedback report. Switchyard is a P2 stretch. |
| 10 | `json_schema` on every call | Strict JSON plus reasoning mode can conflict. | Super and the fast tier run with **thinking OFF** and strict `json_schema`. For Ultra, test on Day 1 whether reasoning comes back separately (§5). |
| 11 | No scope cut line | 16 days is not enough for everything in v1. | P0/P1/P2 priorities plus two hard milestones (§11–12). |
| 12 | "3-minute video" | The rule is under 3 minutes, in English. | Aim for **2:45**. |
| 13 | "Most Valuable Feedback: $100 × 10" | Only one third-party source mentions this; the winner count isn't confirmed. | Feedback is a **required submission field** anyway, so we write it with data either way. |

---

## 1. Hackathon facts

- **Deadline:** **Fri Oct 30 2026, 10:00 PDT** = 17:00 UTC = **Sat Oct 31, 00:00 GMT+7** ✅
  **Our internal submit time: Fri Oct 30, 12:00 GMT+7** (12 h buffer).
- Submission period opened Aug 26. Judging runs **Dec 1–15**, and winners are announced around Jan 11, 2027 ✅.
- **Eligibility** ✅: the app must *run on Nebius*, meaning **a runtime call to the Token Factory inference API** OR **deployment on Nebius AI Cloud compute (Serverless Jobs, Serverless Endpoints or DevPods)**. It must use ≥1 **NVIDIA open model** and fit one track.
- **Tracks** ✅: Coding & Agentic Engineering · **Best Apps and Agents (ours)** · Personal AI · Physical AI.
- **Prizes:** Grand $20k / $10k / $6k ✅ · each track winner gets an NVIDIA Jetson Orin Nano ✅ · Best Use of Tavily $3k ✅ · Most Valuable Feedback $100 ⚠️ (number of winners not confirmed).
- **Judging** ✅:
  - **Stage 1, pass/fail:** genuine track fit and *meaningful* use of the required APIs. A superficial rebrand fails.
  - **Stage 2, equal weights:** Technological Implementation · Design · Potential Impact · Quality of Idea.
  - Judges are engineers from NVIDIA and Nebius, plus Tavily staff.
- **Submission must include** ✅:
  - a hosted demo URL that stays up through judging;
  - a public repo with a visible OSS license (**MIT**);
  - a README covering NVIDIA model use, Nebius use and setup;
  - a public YouTube video **under 3 min**;
  - a feature description, the track, and testing instructions (English);
  - **feedback on the Nebius and NVIDIA tech**;
  - **no secrets in the repo**. If judges need access, use synthetic data.
- Devpost blocks automated fetching (Cloudflare), so these facts come from participant mirrors of the rules. **A human should open the [rules page](https://nebiusglobalaihackathon.devpost.com/rules) once and confirm the ⚠️ items.**

## 2. Concept

**Market Digital Twin / Decision Intelligence Sandbox.** A real-world shock (tariff, route closure, commodity spike) is pulled live via Tavily, then:

1. Nemotron agents decide *behaviour*: price, quantity, marketing, reorder buffer, consumer sentiment.
2. A **deterministic NumPy/SciPy engine** computes every number: demand, sales, stockouts, profit, Nash equilibria and statistical tests.

**Core rule:** LLMs output *decisions*, never *outcomes*.

Two "universes" run side by side under the same shock:

- **AI CEO:** run by Nemotron 3 Ultra.
- **Baseline:** cost-plus pricing, $P = ATC\,(1+m)$.

The difference between them, $\Delta\pi$, is the measured "AI Strategic Alpha".

## 3. Architecture

### 3.1 Components

```
Browser (Next.js, Canvas arena + terminal)
   │  SSE (one EventSource per session)
   ▼
FastAPI orchestrator ── Nebius Serverless ENDPOINT (our container, public URL)
   ├─► Nebius Token Factory API (OpenAI-compatible)
   │      Ultra (CEO A/B) · Super (shock parser, inventory) · Fast tier (crowd)
   ├─► Tavily Search + Extract (cached to disk)
   └─► Nebius Serverless JOB "mc-10k" (container; writes result JSON to Object Storage)
          backend polls job status → SSE badge: Queued → Running → Cloud-Verified
```

- **Fallback:** if a CPU preset is unavailable or too expensive for the Endpoint ⚠️, host the frontend on Vercel and keep only the backend on Nebius. We stay eligible either way, because the runtime calls Token Factory.
- **Base URL comes from env `NEBIUS_BASE_URL` = `https://api.tokenfactory.nebius.com/v1/`** ✅. It lists 25 models. The `us-central1` URL lists 18. Both serve all four Nemotrons.

### 3.2 Two-speed loop

- **Market tick (every 1.5 s wall clock, < 10 ms compute).** NumPy only: choice, sales, inventory and costs, plus a 100-path local MC preview.
- **Decision epoch (every K ticks, default K = 8, ≈ 12 s).** Launches the Ultra CEO calls (A and B in parallel) and the Super inventory call, all async.
  - While the calls run, the sim keeps using the previous policy and the UI streams the reasoning ("CEO A deliberating…").
  - The new policy applies at the first tick after it arrives.
  - **Tune K from the Day-1 Ultra latency measurement.**
- **Crowd update (every 3 ticks).** 12 archetypes are split across **2 parallel calls** of 6 each.
- **Tavily scout (event-driven).** Runs at scenario start, then as Deep-Scout when a trigger fires (§6). At most one per epoch.

**Budget check** (per 12 s epoch): 2 Ultra + ≤2 Super + ~5 crowd ≈ 9 calls, i.e. **≈ 45 RPM**.

**Measured rate limits** ✅ (Day 1, from response headers; per model, dynamic scale 1.00, 15-minute window):

| Model | RPM | TPM |
|---|---|---|
| Ultra | 300 | 200k |
| Super | 300 | 200k |
| Nano | 100 | 800k |
| Lightning | 600 | 400k |

Ultra's binding limit is TPM. At ~5.5k tokens per call, 200k TPM allows ~36 calls/min, and we use ~10. That leaves a lot of headroom.

**Measured Ultra latency** ✅ (thinking ON):
- Reasoning starts streaming after 1.0 s.
- The JSON answer arrives at 8.5 s.
- That was 2,508 reasoning tokens at ~340 tok/s, on a *tiny* prompt.

So **K = 8 ticks (12 s) works**, and the Ultra timeout can drop to 30 s.

### 3.3 Model routing

All model IDs live in env vars. **Verified IDs** ✅ (Day 1, `GET /v1/models`). They are **case-sensitive and inconsistently cased**:

| Model | ID |
|---|---|
| Ultra | `nvidia/Nemotron-3-Ultra-550b-a55b` |
| Super | `nvidia/nemotron-3-super-120b-a12b` |
| Nano | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` |
| Lightning | `nvidia/Nemotron-3_5-Lightning` |

| Role | Env var | Expected ID | Thinking | Timeout | Fallback |
|---|---|---|---|---|---|
| CEO A / CEO B (game-theoretic pricing) | `MODEL_ULTRA` | `nvidia/Nemotron-3-Ultra-550b-a55b` ✅ (550B-A55B; 1M ctx, FP4) | ON, budget ~1.5–2k tokens | 30 s | Engine best-response to rival's last price (or the NE cell) |
| Shock parser + Inventory manager (ω) | `MODEL_SUPER` | `nvidia/nemotron-3-super-120b-a12b` ✅ (Token Factory: 256K ctx, FP4) | OFF | 10 s | Previous ω, or rule-based (s,S) |
| Consumer crowd (12 archetypes) | `MODEL_FAST` | `nvidia/Nemotron-3_5-Lightning` ✅ (Nano `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` as fallback) | OFF | 5 s | Previous (μ, σ) decayed 20% toward 0 |

**Token Factory prices** ✅ (Nebius Nemotron pricing page, 2026-10-14; USD per 1M tokens, input / output):

| Model | Input | Output |
|---|---|---|
| Ultra | 1.00 | 3.00 |
| Super | 0.30 | 0.90 |
| Nano 30B-A3B | 0.06 | 0.24 |
| Lightning | 0.06 | 0.24 |

Lightning's price is inferred: the page also lists an unnamed 30B-A3B model (1M ctx, BF16) at 0.06 / 0.24, which is probably Lightning ⚠️.

Thinking toggle: `extra_body={"chat_template_kwargs": {"enable_thinking": False}}`. **Token Factory passes it through** ✅. With it OFF, every model returned 0 reasoning tokens.
Sampling: NVIDIA recommends `temperature=1.0, top_p=0.95` ✅. For JSON calls, start at `temperature=0.6` and tune.

## 4. Engine math (deterministic, vectorised, seeded RNG)

### 4.1 Consumer choice: MNL with an outside good

$$U_{ij} = \beta_{0j}(t) - \alpha_i P_j + \gamma\ln(1+M_j) + \delta\,\text{Sent}_{ij} + \epsilon_{ij},\quad j\in\{A,B\}$$

$$U_{i0} = -\alpha_i P_{\text{ref}}(t) + \epsilon_{i0}$$

$$\Pr_{ij} = \frac{e^{\bar U_{ij}}}{e^{\bar U_{i0}} + \sum_{k\in\{A,B\}} e^{\bar U_{ik}}}$$

- Compute with **log-sum-exp**.
- $\alpha_i$ is lognormal per archetype.
- Sentiment is sampled from the archetype's Gaussian and clipped:

$$\text{Sent}_{ij} = \text{clip}\big(\mathcal N(\mu_{k(i)}, \sigma_{k(i)}^2), -1, 1\big)$$

- Elasticities $E_d = \%\Delta Q_A / \%\Delta P_A$ and $E_{AB} = \%\Delta Q_A / \%\Delta P_B$ are computed numerically by perturbing $P$ ±1% inside the engine.

### 4.2 Costs and capacity

$$TC_j = FC_j + c_{\text{raw}}(t)\,Q_j + \eta Q_j^2,\quad MC_j = c_{\text{raw}}(t) + 2\eta Q_j,\quad ATC_j = \tfrac{FC_j}{\max(Q_j,1)} + c_{\text{raw}}(t) + \eta Q_j$$

$$c_{\text{raw}}(t) = c_{\text{raw}}(0)\,\big(1 + \Delta c_{\text{raw}}^{\text{Tavily}}(t)\big)$$

**Capacity:** $Q_j \le \min\big(K^{\text{cap}}_j,\; M_{\text{raw},j}/r\big)$. This simple cap replaces v1's Cobb-Douglas for the MVP; Cobb-Douglas is P2.

### 4.3 Stockout spillover (symmetric, capped, fixed order)

1. Expected demand: $D_j = \sum_i \Pr_{ij}$
2. Own sales and unmet demand: $S^{\text{own}}_j = \min(D_j, I_j)$, $U_j = D_j - S^{\text{own}}_j$
3. Spillover into the rival $k \ne j$: $X_k = \min\big(\theta U_j,\; I_k - S^{\text{own}}_k\big)$
4. Total sales: $S_j = S^{\text{own}}_j + X_j$. Everything else goes to the outside good (lost sales).
5. Goodwill erosion with mean reversion:

$$\beta_{0j}(t{+}1) = \beta_{0j}(t) - \lambda\,\frac{U_j}{\max(D_j,\varepsilon)} + \kappa\,(\bar\beta_{0j} - \beta_{0j}(t))$$

### 4.4 Game theory (once per decision epoch)

- **Payoff matrix:** 3×3, with actions {Cut −10%, Hold, Raise +10%} applied to current prices. Each payoff is the one-period expected profit from **the same engine** (no LLM).
- **Equilibria:** find pure NEs with a best-response check, and mixed NEs with `nashpy` support enumeration.
- **Labels** shown in the UI:
  - **Nash play:** the realised cell is a NE.
  - **Price war (Prisoner's Dilemma):** both firms Cut, and $\pi_A+\pi_B$ is less than the joint profit at (Hold, Hold).
  - **Tacit collusion:** the realised cell is not a NE, and its joint profit is at least the NE's joint profit.
- Bertrand is the default; Cournot mode is P2.

### 4.5 Supply chain: (s,S) with behavioural ω

$$ROP_j = \hat\mu_d\hat L + z_\alpha\hat\sigma_d\sqrt{\hat L}\,(1+\omega^{\text{Super}}_t),\quad \omega\in[-0.5, 2.0]$$

- Order up to $S_j$.
- Orders arrive after $\hat L$ ticks (pipeline queue).
- A lead-time shock $\Delta L > 0$ from Tavily/Super, combined with ω > 0, produces phantom ordering, which is the bullwhip effect.

$$\text{Bullwhip}_j = \frac{\text{Var}(\text{Orders}_j)}{\text{Var}(\text{Demand}_j)}$$

The bullwhip ratio uses a rolling window of ≥ 8 ticks and is guarded against Var = 0.

### 4.6 Statistics

- **Monte Carlo:** n = 100 paths run locally on every tick; n = 10,000 run in a Serverless Job. Both use **common random numbers**: the same seed drives the AI universe and the baseline universe in path r. The AI policy schedule is the frozen sequence of LLM decisions.
- **Confidence interval:** $CI_{95} = \bar\pi \pm t_{0.025,n-1}\, s/\sqrt n$
- **AI alpha test:** compute $\Delta_r = \pi^{AI}_r - \pi^{Base}_r$ and run `scipy.stats.ttest_rel(..., alternative="greater")`. Show the mean Δ, its CI95, Cohen's $d = \bar\Delta / s_\Delta$, and p. **Label n on every figure.**
- **χ² test:** a 2×2 contingency table, (pre-shock window vs post-shock window) × (switched brand vs stayed), built from agent-level choice logs, then `scipy.stats.chi2_contingency`.
- **UI badges:** "Live (n=100)" shows first, then switches to "Cloud-Verified (n=10,000)" when the job finishes.

### 4.7 Canonical tick sequence (all engine code follows this order)

Firms are indexed 0 = A and 1 = B, and per-firm arrays have shape `(2,)`. Each consumer buys 0 or 1 unit per tick. The types are in `backend/engine/types.py`.

1. **Receive** raw-material orders whose `arrival_tick == t`: `raw_inv += qty`.
2. **Apply the active shock:** $c_{\text{raw}}(t)$, lead time $L(t) = L_0 + \Delta L$, and the demand multiplier $(1 + \text{demand\_shock})$.
3. **Produce:** $Q_j = \min(\text{plan}_j, K^{\text{cap}}_j, \text{raw\_inv}_j / r)$. Then `raw_inv -= r*Q` and `inventory += Q`.
4. **Choice:** compute the probabilities `(N, 3)` with columns `[outside, A, B]` (§4.1). Expected demand is $D_j = (1+\text{demand\_shock})\sum_i \Pr_{ij}$.
5. **Clear** with spillover (§4.3), giving `own_sales`, `spill_in`, `sales`, `unmet` and `lost`. Then `inventory -= sales`.
6. **Profit:** $\pi_j = P_j S_j - TC_j(Q_j) - M_j - h\,(\text{inventory}_j + \text{raw\_inv}_j)$.
7. **Goodwill** update (§4.3, step 5).
8. **Replenish** using (s,S) with ω (§4.5).
   - Inventory position = `raw_inv + Σ pipeline`.
   - If position ≤ ROP, order up to S. The order arrives at `t + L(t)`.
   - Record `orders_j(t)` (0 if no order).
9. **Sample realised choices:** one categorical draw per consumer from the probabilities. These are used by the arena and the χ² test, and they come from a seeded `rng`.
10. **Emit** a `TickResult`.

**Counterfactual universes** (same shock, same seed, same crowd sentiment):

- **U1:** A = Ultra CEO, B = Ultra CEO.
- **U2:** A = cost-plus baseline. Its price is $ATC(Q_{t-1})(1+m)$, its plan is the 4-tick moving average of demand, ω = 0, and its marketing is constant.
- In U2, B **replays its U1 decisions** (open loop). In the UI this is labelled "rival behaviour held fixed". It keeps the counterfactual at 2 Ultra calls per epoch instead of 4.

**Monte Carlo** (§4.6): every decision schedule is frozen. The randomness per path is:

- per-tick lognormal demand noise ($\sigma = 0.1$);
- lead-time jitter of ±1 tick;
- shock magnitude × U(0.8, 1.2);
- multinomial choice sampling.

## 5. LLM contracts (Pydantic v2, strict `json_schema`, clamp after validation)

```python
class Evidence(BaseModel):     quote: str (≤300 chars, verbatim from Extract); url: HttpUrl
class ShockVector(BaseModel):  delta_c_raw: float [-0.5, 1.0]; delta_lead_time: int [-2, 10] ticks;
                               demand_shock: float [-0.5, 0.5]; severity: float [0, 1]; evidence: list[Evidence] (1–3)
class InventoryDecision:       omega: float [-0.5, 2.0]; rationale: str ≤200
class CEODecision:             price: float; production_qty: float ≥0; marketing_budget: float ≥0;
                               expected_rival_action: Literal["cut","hold","raise"]; rationale: str ≤400
class ArchetypeSentiment:      id: int 1..12; mu: float [-1,1]; sigma: float [0, 0.5]; bubble: str ≤60
class CrowdBatch:              archetypes: list[ArchetypeSentiment]
```

- **Clamp price** to $P\in[0.5\,MC, 4.0\,ATC]$, and quantities to capacity.
- **On failure:** if validation fails, retry once with the error message appended. If that fails too, use the tier's fallback (§3.3). Log `json_valid` and `fallback_used`.
- **Ultra:** strict `json_schema` with thinking ON **works** ✅.
  - Reasoning streams in `delta.reasoning_content`. It is also mirrored as `delta.reasoning`, and on non-stream calls it's `message.reasoning_content`.
  - The answer in `content` is clean JSON with no `<think>` tags.
  - So: stream `reasoning_content` to the UI and parse `content`. No two-step pipeline is needed.
  - `usage.completion_tokens_details.reasoning_tokens` is populated for Ultra, Super and Lightning, but was null for Nano.

## 6. Tavily integration (Best Use of Tavily prize)

- **Client:** `tavily-python`, async client (`AsyncTavilyClient` ⚠️).
- **Search:** `topic="news"`, `time_range="week"`, `max_results=5`, plus an `include_domains` allowlist (Reuters, FT, Bloomberg, WTO, Freightos, Drewry, …).
  - Use `search_depth="advanced"` (2 credits ✅) for scenario seeding.
  - Use `"basic"` (1 credit ✅) for Deep-Scout follow-ups.
- **Extract:** pull the top 2 URLs, then Super turns them into a `ShockVector` that carries **verbatim quotes** as evidence. Basic extract costs 1 credit per 5 successful URLs; failed URLs are free ✅.
- **Credits:** we're on the free Researcher plan, **1,000 credits/month** ✅, which resets in November and covers the judging period.
  - Seeding a scenario costs about 3 credits (advanced search 2 + extract 1). A Deep-Scout costs about 2.
  - A live run with 2 scouts costs about 7. Replays and cached runs cost 0.
  - Target: **≤ 300 credits** for all of October's development.
  - Claude's own research through the Tavily MCP draws on the same pool, so keep it to `basic` depth.
- **Deep-Scout:** autonomous and agent-initiated. It triggers when
  - margin falls > 15% over 3 ticks with no shock that explains it, **or**
  - lead time spikes.

  Super writes the query itself. At most one scout per epoch.
- **Grounding Proof Card:** shows the quote, the parameter change it caused, the URL and a timestamp, e.g. `"25% tariff on semiconductors" → Δc_raw = +0.25`.
- **Cache every Tavily response to disk** under `fixtures/`. This saves credits and feeds REPLAY mode.
- **Pitch to the Tavily judges:** Tavily sits *inside the control loop*, since agents decide when to search, and every changed parameter can be traced back to a quote.

## 7. Demo safety and the judging period

- **Two modes, same UI:**
  - **REPLAY** (public default): a recorded LIVE run, stored as JSONL, played back at real speed.
  - **LIVE:** real Token Factory and Tavily calls. Gated by a per-IP rate limit and a **daily spend cap** (env). When the cap is hit, the app switches to REPLAY automatically and shows a banner.
- Record a REPLAY of all 3 scenarios before feature freeze. The video can use LIVE; the site must never break.
- Keep the Endpoint running until **Dec 15**. Estimate cost as hourly preset price × ~1,500 h ⚠️. Add a `/health` route and an uptime monitor.
- Secrets go in env or the Nebius secret store only. Before submitting, test from a logged-out browser.

### 7.1 Token Factory budget: $25 (maybe +$25 from Nebius's promo programme)

**Estimated cost per call:**

| Call | Tokens (input / output) | Cost |
|---|---|---|
| Ultra CEO | ~3k / ~2.5k, incl. reasoning | ≈ $0.011 |
| Super | ~3k / 0.4k | ≈ $0.0013 |
| Crowd | ~1.5k / 0.6k | ≈ $0.0002 |

That works out to **≈ $0.026 per 12 s epoch, ≈ $0.13 per minute of LIVE, ≈ $0.39 per 3-minute run.**

- **Biggest risk:** Ultra is very verbose, and Token Factory ignores reasoning-budget parameters (§13). Control cost through the prompt and `max_tokens`. Day 1 measured 2.5k reasoning tokens on a trivial prompt, which cost $0.0077. Measure again with the real CEO prompt.

**Allocation:**

| Use | Budget |
|---|---|
| Day-1 checks | $0.25 (hard cap in the script) |
| Development LIVE runs | $8 (~25 runs) |
| Benchmark suite | $2 |
| Recording replays + video | $2 |
| **Judging-period LIVE reserve, Oct 30 → Dec 15** | **$10** |
| Buffer | ~$3 |

The $10 reserve works out to `PUBLIC_LIVE_DAILY_CAP_USD=0.20`, about one short live run per day.

**Development rules:**
- Frontend work uses REPLAY or mock streams only.
- Backend iteration runs with `MODEL_ULTRA` temporarily pointed at Super. Use the real Ultra only for integration runs.
- Every call is logged with `est_cost_usd`. The backend stops LIVE mode when `DAILY_SPEND_CAP_USD` is reached.
- Token Factory's console is the only true balance. Check it every few days, because our estimate can drift.

## 8. Telemetry and the feedback report

**What we log:** one record per call, with these fields: `tier, model, ttft_ms, total_ms, prompt_tokens, completion_tokens, reasoning_tokens, tok_per_s, status, retries, n_429, json_valid, fallback_used, est_cost_usd`.

**HUD:** p50 TTFT per tier, tok/s, call share and token share by tier, cost so far, and **savings vs all-Ultra** (computed), plus Serverless Job status.

**`bench/run_bench.py`:**
- Runs our three real task prompts against each model at concurrency {1, 4, 16}.
- Measures TTFT, tok/s, p95 latency, 429 rate, and schema compliance with thinking on vs off.
- Compares **Lightning vs Nano 3**.
- Measures Serverless Job and Endpoint cold starts.
- Writes CSV and charts to **`docs/FEEDBACK.md`**, which is both the Devpost feedback field and our entry for the feedback prize.
- Also note any problems we hit along the way: docs errors, bad defaults, missing features.

## 9. UI (3 panes, dark terminal style)

- **Top HUD:** telemetry, scenario picker, LIVE/REPLAY toggle, Export Benchmark (JSON/MD).
- **Left (25%):** shock input, Tavily Grounding Cards, colour-coded reasoning stream (Ultra = purple/gold · Super = cyan · fast tier = emerald).
- **Centre (45%):** Canvas arena with Port → Firm A / Firm B HQ → shopping district, plus an outside-good "bank".
  - Trucks slow down when L spikes; stock bars flash red on a stockout.
  - Start with **200 sprites** and go to 500 if 60 FPS holds. Use `requestAnimationFrame`, positions in `useRef`/typed arrays, **never React state**.
- **Right (30%):** profit AI vs baseline with CI fan, inventory vs ROP with spillover counter, bullwhip gauge, 3×3 Nash matrix (NE cell and chosen cell highlighted), stats table (Δπ, CI, d, p, χ²).
- **State:** Zustand store updated **once per tick** from SSE.

## 10. Repo layout

```
LICENSE (MIT) · README.md (judge-facing, written last) · SPEC.md · CLAUDE.md
backend/  main.py (FastAPI + SSE) · engine/{market,inventory,game,stats,montecarlo}.py
          services/{router,limiter,telemetry,tavily_scout,replay}.py · agents/{schemas,prompts}.py
jobs/mc_worker/  Dockerfile · run.py        (Serverless Job)
frontend/        Next.js + Tailwind + Zustand + Canvas
bench/           run_bench.py · results/
fixtures/        scenarios/*.json · tavily_cache/ · replays/*.jsonl
docs/            FEEDBACK.md · ARCHITECTURE.md (diagram for README)
tests/           engine unit tests (seeded, deterministic)
```

## 11. Priorities (cut line)

- **P0, must ship:**
  - Engine §4.1–4.3 with tests
  - Router + limiter + telemetry
  - Tavily → Super → ShockVector with a Proof Card
  - Ultra CEOs on the two-speed loop
  - Crowd archetypes
  - AI vs baseline profit chart
  - HUD
  - Scenario 1 end-to-end
  - REPLAY mode
  - Deployed on Nebius
  - LICENSE, README, video, FEEDBACK.md
- **P1, should ship:** Nash matrix + labels · (s,S)/ω + bullwhip · MC preview + 10k Serverless Job + paired t-test · Scenarios 2–3 · Deep-Scout trigger · χ² · 500 sprites
- **P2, only if time:**
  - Cournot mode
  - Cobb-Douglas capacity
  - Live CoT cell highlighting while Ultra streams
  - NeMo Switchyard as the router
  - Self-hosting Lightning on a GPU Serverless Endpoint to benchmark against Token Factory

## 12. Schedule (dates are GMT+7)

| Date | Work | Gate |
|---|---|---|
| Oct 14 (Wed) | Day-1 checklist (§13) · create repo + MIT · engine skeleton | All ⚠️ items resolved or have a fallback |
| Oct 15–16 | Engine P0 + tests · router, limiter, telemetry · schemas and prompts | |
| Oct 17–18 | Tavily scout · Super shock parser · Ultra CEO loop · crowd · **headless CLI run of Scenario 1** | **Milestone A: headless end-to-end** |
| Oct 19–20 | FastAPI SSE + REPLAY recorder · MC worker as a Serverless Job · **deploy a hello-world Endpoint now** | **Milestone B: deployed + job runs** |
| Oct 21–24 | Frontend: HUD, 3 panes, charts, arena (can run in parallel with backend P1) | |
| Oct 25–26 | Scenarios 2–3 · Nash · bullwhip · stats · run benchmark suite | |
| Oct 27 | **Feature freeze 23:59** · record REPLAYs for all scenarios | |
| Oct 28 | Video (2:45: problem → live shock → econometric proof → Nebius/NVIDIA architecture) · README · FEEDBACK.md | |
| Oct 29 | QA from a logged-out browser · fill in Devpost · **submit by Oct 30 12:00 GMT+7** | |
| Oct 30 | Buffer only. Hard deadline Oct 31 00:00 GMT+7. | |

## 13. Day-1 verification checklist (blocking)

- [x] Model IDs + base URL (§3.3, §3.1)
- [x] `json_schema` strict passes on all four models; `enable_thinking` passes through; reasoning arrives in `reasoning_content` (§5)
- [x] Ultra latency measured → K = 8 (§3.2)
- [x] Rate limits measured from headers (§3.2)
- [x] Ultra reasoning caps: **`reasoning_budget` and `reasoning_effort` have no effect** on Token Factory ✅.
  - Same prompt, uncapped: 541 reasoning tokens. With `reasoning_budget=128`: 638. With `reasoning_effort=low`: 635.
  - Reasoning length depends on the prompt: 541 tokens on a short prompt, 2,508 on the stricter Day-1 prompt.
  - Cost levers that do work: a prompt instruction to keep reasoning short, `max_tokens` ≈ 3000 as a hard stop (on overflow use the fallback), and thinking OFF for routine epochs.
- [x] `json_object` is not enough. In the test, Ultra returned `"action": "strategic price adjustment"`, which is outside the enum. **Always use strict `json_schema`.**
- [ ] Nebius AI Cloud:
  - Do we have credits?
  - Is there a CPU-only preset for an Endpoint, and what does it cost per hour?
  - Does SSE stream through the Endpoint URL?
  - Endpoint and Job cold-start times
  - How Job output reaches Object Storage
- [x] Tavily: connected. Free plan, 1,000 credits/month. Still unknown: whether there are hackathon bonus credits. Put the app's key in `.env` as `TAVILY_API_KEY`.
- [x] Token Factory prices verified (§3.3). Budget is $25 (§7.1).
- [x] `scripts/day1_check.py` run on 2026-10-14. Spend $0.008. Raw results are in `bench/results/day1_check_20261014T043015Z.json`.
- [ ] Open the Devpost rules page as a human and confirm the ⚠️ items in §1.

## 14. Sources (checked 2026-10-14)

- Rules digest mirrored from Devpost: [RenatoMignone/nvidia-x-nebius-personal-ai docs/hackathon.md](https://github.com/RenatoMignone/nvidia-x-nebius-personal-ai/blob/main/docs/hackathon.md) · [tierones.io](https://tierones.io/opportunities/nebius-nvidia-ai-2026) · [startupgrantsindia](https://www.startupgrantsindia.com/competitions/nebius-x-nvidia-global-ai-hackathon) · official (bot-protected): <https://nebiusglobalaihackathon.devpost.com/rules>
- Nemotron on Token Factory: <https://nebius.com/services/token-factory/nemotron> · pricing: <https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference> · [Ultra launch on Token Factory (Jun 4)](https://x.com/nebiusai/status/2062531459647226181)
- Tavily credits and pricing: <https://docs.tavily.com/documentation/api-credits>
- Token Factory structured output: <https://docs.tokenfactory.nebius.com/ai-models-inference/json.md> · rate limits: <https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits.md>
- Nebius Serverless AI (Endpoints/Jobs): <https://docs.nebius.com/serverless/overview> · endpoints: <https://docs.nebius.com/serverless/endpoints/manage> · CLI: <https://docs.nebius.com/cli/reference/ai>
- Model IDs, prices, providers: OpenRouter `/api/v1/models` and `/endpoints` (queried live) · [Requesty (Nebius Ultra)](https://www.requesty.ai/models-new/nebius/nvidia-nemotron-3-ultra-550b-a55b) · [Artificial Analysis: Ultra](https://artificialanalysis.ai/models/nvidia-nemotron-3-ultra-550b-a55b)
- Nemotron 3.5 Lightning + NeMo Switchyard: [NVIDIA blog](https://blogs.nvidia.com/blog/nemotron-lightning-switchyard-rtx-dgx/) · [Artificial Analysis launch](https://artificialanalysis.ai/articles/nemotron-3-5-lightning-launch) · [Switchyard repo](https://github.com/NVIDIA-NeMo/Switchyard)
- Nemotron thinking toggle / sampling: [build.nvidia.com model card](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard) · [SGLang cookbook](https://docs.sglang.io/cookbook/autoregressive/NVIDIA/Nemotron3-Super)
- Tavily: <https://docs.tavily.com/documentation/api-reference/endpoint/search.md>
