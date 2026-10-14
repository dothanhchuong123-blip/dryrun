# T10: Frontend shell (layout, HUD, store, mock stream)

| | |
|---|---|
| Model | **Sonnet 5.5**, effort medium |
| Time | ~4 h |
| Depends on | nothing. It runs on a mock stream, so it can start any time. |

---
You are building the frontend shell of the Market Digital Twin, a dark "institutional terminal" UI.

**Read only these:** `SPEC.md` §9 and `docs/EVENTS.md` (the contract).

**Set up `frontend/`:**
- Next.js App Router with TypeScript, configured for static export (`output: "export"`).
- Tailwind and Zustand. Pin exact versions in `package.json`.

**Files to write:**
- `lib/events.ts`: TypeScript types for every event in EVENTS.md.
- `lib/stream.ts`: an EventSource client that reconnects, using `NEXT_PUBLIC_API_BASE`.
- `lib/store.ts` (Zustand):
  - Buffer incoming events and flush them **once per U1 `tick`**, via requestAnimationFrame.
  - Keep rolling series of the last 120 ticks.
- `mock/`: a mock stream so UI work never needs the backend or spends money.
  - If `fixtures/replays/*.jsonl` exists (copy one into `public/`), replay it.
  - Otherwise, generate a plausible fake run.

**Layout:**
- Top HUD
- Left pane 25%, centre 45%, right 30%
- Panes stack below 900 px wide

**HUD contents:**
- TTFT and tok/s per tier.
- A call-share / token-share bar. Tier colours: Ultra purple/gold, Super cyan, fast tier emerald.
- Cost and savings %.
- Job badge.
- Scenario picker.
- LIVE/REPLAY toggle.
- Export Benchmark button.

**Left pane:**
- Reasoning stream, colour-coded by role, with autoscroll and one collapsible group per epoch.
- A slot for the grounding cards (T11 builds them).

**Centre and right panes:** sized placeholders for now (T11 and T12 fill them).

**Done when** `npm run build` produces a static export, and `npm run dev` with the mock shows the HUD and an animated reasoning stream. Take a screenshot to confirm.

Commit as `T10: frontend shell + mock stream`.
