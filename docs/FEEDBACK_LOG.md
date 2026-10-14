# Feedback log: Nemotron, Token Factory, Nebius, Tavily

**Rule for every session:** when you hit something worth reporting (a quirk, docs error, bad default, missing feature, or something that worked unusually well), add a row right away.
- Keep it to one row with evidence (a number, an error, a link).
- T13 turns this log into `docs/FEEDBACK.md` and the required Devpost feedback answers.
- Specific, evidenced feedback is what wins the Most Valuable Feedback prize (10 × $100).

| Date | Area | What happened | Evidence | Suggestion |
|---|---|---|---|---|
| 2026-10-14 | Token Factory · Ultra | `reasoning_budget` and `reasoning_effort` have no effect | Same prompt: 541 reasoning tokens uncapped, 638 with `reasoning_budget=128`, 635 with `reasoning_effort=low` | Support a reasoning-budget parameter, or document that it's unsupported |
| 2026-10-14 | Token Factory · structured output | `json_object` mode let Ultra return a value outside the enum: `"strategic price adjustment"` | `bench/results/day1_check_20261014T043015Z.json` | Steer docs toward strict `json_schema` for enum-constrained output |
| 2026-10-14 | Token Factory · docs | The JSON docs page's code example is missing commas, so it won't run as pasted | docs.tokenfactory.nebius.com/ai-models-inference/json.md | Fix the snippet |
| 2026-10-14 | Token Factory · model IDs | ID casing is inconsistent across Nemotron models, and IDs are case-sensitive | `nvidia/Nemotron-3-Ultra-550b-a55b` · `nvidia/nemotron-3-super-120b-a12b` · `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` · `nvidia/Nemotron-3_5-Lightning` | Use one naming scheme, or accept IDs case-insensitively |
| 2026-10-14 | Token Factory · base URLs | The two base URLs list different catalogues: 25 vs 18 models | `api.tokenfactory.nebius.com` vs the us-central1 URL | Document which one to use, and why they differ |
| 2026-10-14 | Token Factory · Nano vs Lightning | Nano 3's TTFT is 5.5× Lightning's | Nano 5.2 s / 71 tok/s vs Lightning 0.94 s / 198 tok/s (n=1) | Show expected latency on the model page |
| 2026-10-14 | Token Factory · pricing | Lightning has no named row on the pricing page; its price is inferred from an unnamed 30B-A3B row | SPEC §3.3 | Name it on the pricing page |
| 2026-10-14 | 👍 Token Factory | Strict `json_schema` works with thinking on, and reasoning arrives separately in `reasoning_content`, so `content` stays clean JSON | Day-1 run, all 4 models | Keep it; document it on the Nemotron page |
| 2026-10-14 | 👍 Token Factory | Per-model `x-ratelimit-*` headers made limiter design easy | Ultra and Super 300 RPM / 200k TPM · Nano 100 / 800k · Lightning 600 / 400k | Keep it |
| 2026-10-14 | 👍 Token Factory · Ultra | Fast reasoning stream with thinking on | ≈ 340 tok/s, answer at 8.5 s with 2,508 reasoning tokens, $0.0077 | |
