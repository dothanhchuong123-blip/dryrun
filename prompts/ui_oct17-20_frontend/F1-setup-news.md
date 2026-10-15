# F1: Screens 1–2, "Your business" and "News that affects you"

| | |
|---|---|
| Builder | **Gemini 4 Argon**, Pro account #1. Then a Claude check (Sonnet 5.5, effort medium). |
| Start | `uv run scripts/argon.py pack F1`, then follow `prompts/argon/HOW-TO.md` → "Build a task". Upload screenshots of D7's screens 1 and 2. |
| Parallel with | F2, F3 (Argon) · P4 (Claude). Each F task owns its own folders. |
| Time | ~2 h |
| Depends on | F0 committed |
| Target date | Oct 18–19 |

---
You are building the first two screens of the pivot UI.

**Read these first:** `docs/DESIGN.md` §12.1 rows 1–2, §12.3 and §11; `docs/mockups/D7-pivot.html` screens 1–2 (match them); `docs/EVENTS.md` v2 (`/api/examples`, `/api/profile/parse`, the `news` event, news-check); and F0's `frontend/lib/store.ts`, `events.ts` and `format.ts`. Use only the store's actions; don't call `fetch` yourself.

**Only create or change** files in `frontend/components/setup/` and `frontend/components/news/`. The slot files `SetupScreen.tsx` and `NewsScreen.tsx` keep their names and props.

**Screen 1: `SetupScreen`**
- **Left:**
  - the free-text box, with the placeholder "Describe it like you would to a friend…";
  - the 3 example chips (`examples` from the store);
  - "Read my business →", which shows a calm loading state ("Nemotron Super is reading it…") and errors in plain words.
- **Right:** every `BusinessProfile` field as an editable row, with labels from the glossary ("Your price", "Raw cost per unit", "Sales per week", "Supplier lead time", "Stock on hand", "Main rival", "Rival's price").
  - Numbers in mono tabular figures, with units.
  - Fields in `guessed_fields` get a small "guessed" tag until edited.
  - Validation: unit cost must be below price, and every value within the SPEC §15.3 bounds. Show inline hints.
- A `ModelChip` "Super · reads your business".
- Primary button: "Looks right → find news". It calls `startAnalysis()` and goes to step "news".
- Empty state, before parsing: the right side shows the fields greyed out with "Nemotron fills these in. You can change any of them."

**Screen 2: `NewsScreen`**
- 3–5 cards, each with:
  - source · relative date;
  - the headline as a link that opens in a new tab;
  - an impact chip ("−$6.4k over 6 months if you do nothing"), red or grey with its sign;
  - the verbatim quote in a muted block, then "→" and the parameter chips it changed ("Costs +31%", "Shipping +1 week").
- The card in `used_for_grid` is marked "Used for your plans".
- Cards from `live: true` items say "Just fetched", and "Not applied to this run" when `applied: false`.
- A "Check live news" button. It shows the limits' plain-word errors ("Try again in a minute").
- `ModelChip` "Super · reads the news", plus a small "Search by Tavily" credit.
- Primary button: "Find the best plan for this →", which goes to step "analyst".
- Loading: skeleton cards with "Searching news about {supplier_region} and {product_unit}…".

**Quality bar:** DESIGN.md §12.3 copy rules. Keyboard reachable with visible focus. Works at 390 px wide (the two columns stack). No new dependencies.

**Done when** `npm run build` passes and both screens work end to end on F0's mock. Commit as `F1: setup and news screens`.

## v3.1 realism update (2026-10-15)

DESIGN.md §12.3a and EVENTS v2.1 win over anything above that conflicts.

- Screen 1:
  - the fields Country, "Share of your cost that is {input}" (shown as %, with the guessed tag) and "Cash you could put into stock" (empty = "not given").
- Screen 2:
  - supply cards show `cost_line` verbatim under the quote;
  - market cards (`kind: "market"`) go in a lower group, "In your market ({country})", with the chip "Used to pick futures" and no impact chip;
  - the loading text mentions the country.
