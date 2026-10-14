# T11: Econometric terminal (right pane) and grounding cards

| | |
|---|---|
| Model | **Sonnet 5.5**, effort medium |
| Time | ~4 h |
| Depends on | T10 |

---
You are building the right-hand "econometric terminal" and the Tavily cards of the Market Digital Twin UI.

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
- **Custom shock input:** POSTs to `/shock`; disabled in REPLAY mode.

**Polish:**
- Format numbers as k, %, $.
- No layout shift when values update.
- Confirm the arena stays at 60 FPS (check the Performance panel).

**Done when** this works with the mock stream. Take a screenshot.

Commit as `T11: econometric terminal + grounding cards`.
