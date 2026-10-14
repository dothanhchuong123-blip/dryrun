# T11: Econometric terminal (right pane) and grounding cards

| | |
|---|---|
| Builder | **Gemini 4 Argon**, Pro account #3. Then a short Claude check (Sonnet 5.5, effort medium). |
| Start | Run `uv run scripts/argon.py pack T11`, then follow `prompts/argon/HOW-TO.md` → "Build a task" |
| Parallel with | T03, T12 (Argon) · T06 (Claude) |
| Time | ~4 h |
| Depends on | T10 committed |

---
You are building the right-hand "econometric terminal" and the Tavily cards of the Market Digital Twin UI.

**Only create or edit:** `components/Terminal.tsx`, `components/GroundingCards.tsx`, anything under `components/terminal/`, `lib/format.ts`, and `package.json` (to add Recharts) (all under `frontend/`). T12 runs in parallel. Don't edit `app/page.tsx`, `lib/store.ts` or `lib/events.ts`; if you need a change there, say so at the end.

**Read only these:**
- `SPEC.md` §4.4, §4.6, §9
- `docs/EVENTS.md`
- `frontend/lib/store.ts` and `frontend/lib/events.ts`

Use Recharts or small custom SVG; keep the bundle lean.

**Right pane components:**
1. **Profit chart:** A's cumulative profit, AI (U1) vs baseline (U2).
   - Draw a CI fan from `stats.fan` when it's present.
   - Show the n label and a `Live (n=100)` / `Cloud-Verified (n=10,000)` badge.
2. **Inventory chart:** inventory vs ROP for each firm, plus a counter of stockout spillover.
3. **Bullwhip gauge** for each firm (blank while the value is null).
4. **Nash 3×3 matrix:**
   - each cell shows (π_A, π_B);
   - pure NEs get an outline;
   - the chosen cell is filled;
   - a chip shows the label (Nash / Price war / Collusion).
5. **Stats table:** Δπ, CI95, Cohen's d, p, χ², χ² p, n.
6. **Mini chart:** price vs MC and ATC, per firm.

**Left pane:**
- **Tavily Grounding Proof Cards:** quote → parameter change, the source domain, and a link that opens in a new tab.
- **"Check live news" button:**
  - POSTs to `/news-check` and is enabled in **both** modes (SPEC §6).
  - Cards with `live: true` get a `LIVE` badge. Cards with `applied: false` also get "not applied (replay)".
  - Show the `reason` when a request is rejected, and use a 60 s cooldown.
- **Custom shock input:** POSTs to `/shock`; disabled in REPLAY mode.

**Polish:**
- Format numbers as k, %, $.
- No layout shift when values update.
- Confirm the arena stays at 60 FPS (check the Performance panel).

**Done when** this works with the mock stream. Take a screenshot.

Commit as `T11: econometric terminal + grounding cards`.
