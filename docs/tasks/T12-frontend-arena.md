# T12: Market arena (Canvas, centre pane)

| | |
|---|---|
| Model | **Sonnet 5.5**, effort medium |
| Time | ~4 h |
| Depends on | T10 |

---
You are building the 2D market arena for the Market Digital Twin UI.

**Read only these:**
- `SPEC.md` §9 (centre pane)
- the `tick` and `crowd` payloads in `docs/EVENTS.md`
- `frontend/lib/store.ts`

**`frontend/components/Arena.tsx`:**
- Use HTML5 Canvas 2D (only bring in PixiJS if Canvas truly can't keep up) and its own `requestAnimationFrame` loop.
- **All sprite state lives in refs:** `Float32Array` for x/y/vx/vy and `Int8Array` for targets. **Never React state.**
- **Zones:** Port/Suppliers (left) → Firm A HQ and Firm B HQ → Shopping district. Plus a "Bank" zone for the outside good.
- **On each U1 tick:**
  - decode `choices_b64` into each consumer's target zone;
  - consumers walk there with easing;
  - colour each consumer by their choice.
- **Trucks:** speed ∝ 1/lead_time; flash when orders > 0.
- **Warehouses:** a stock bar per firm that flashes red when unmet > 0.
- **Thought bubbles:** for each crowd archetype bubble, show it above 3–5 consumers of that archetype for 3 s.
- Start at 200 sprites, with a config option for 500. Hold ≥ 55 FPS on a laptop and log the FPS in dev.
- The canvas is DPR-aware and resizes with a ResizeObserver.

**Done when** this works with the mock stream. Take a screenshot, and report the FPS at 200 and 500 sprites.

Commit as `T12: canvas market arena`.
