<!-- DRAFT for the public README (Oct 28 slot). Not linked from the README yet. Every number comes from our own logs or cache;
     fill the one blank from the next LIVE run, never guess it. -->

## How Dry Run uses Tavily

Dry Run tests a small business's plans against the news. Tavily is the part that finds the news, and it is called at runtime in every analysis, not just in a demo script.

**1. It finds the news that hits this business.** From a few lines about the business (or a pasted link), Nemotron Super writes search queries. We send them to Tavily Search: one set for the supply side (`topic: news`, past week) and one for the local market (`topic: general`, `country` set to the business's country, queries in the local language, `language` as a ranking boost). Rival names go in quotes with `exact_match`.

**2. It reads the articles.** The top three articles go through Tavily Extract with the search query attached, so the passages about our topic come first. Nemotron Super turns an article into three numbers (how much the main input costs more, how much later it arrives, how demand moves) and a quote. The quote has to be found word for word in the text Tavily extracted, or the number is thrown away. The NumPy engine never sees a number without a quote behind it.

**3. Nemotron can ask its own question.** Halfway through an analysis, Nemotron Ultra can send Tavily one more search (at most one a round and two an analysis, basic depth, cached). If the top article reports a real change, it becomes a new "future" column and every plan already on the grid is tested in it. If the search finds nothing usable, the run carries on without it.

**4. It reads a shop's own site.** Paste a link and Tavily Extract reads the page. If the page is thin (a home page, a JavaScript shell), Tavily Map finds the menu, price-list and product pages with a path filter, and one more Extract reads them. At most 3 credits a link.

**5. It keeps our backtests honest.** For each past case we search only the 90 days before its date with Tavily's `start_date` and `end_date`, so the model cannot read later news. That window is what keeps each historical case blind. We also drop any result dated later than the case, and we show the misses.

**6. It shows its work.** The decision memo lists every source as "Tavily · outlet · date · link" with the outlet's favicon (`include_favicon`), and a "How we searched" panel lists every query with its parameters, the credits it cost (`include_usage`), what came back, what was dropped and why, and how many articles were read.

### What it costs and how well it works

| | |
|---|---|
| Credits per analysis | 3.6 on average (3 to 5; 14 recorded analyses), up to 4 more if Nemotron asks 2 questions |
| Results dropped before reading | 27 of 144 (18.8%): social posts and results outside a backtest's window |
| Articles read that gave a verified number | 24 of 37 (65%) |
| Quotes found word for word | ___ of ___ (counted from the first LIVE runs; the recorded demos predate the counter) |
| Real credits per call (`usage`) | search 1, one-URL extract 1, a 9-page map 0 |
| Cached responses (so the recorded demo needs no Tavily call) | 47 search, 25 extract |

Every Tavily response is cached on disk. The public demo defaults to a recorded run that makes no Tavily call; the "Check live news" button and a custom business make real ones, capped at 30 credits a day.

### Tavily endpoints and parameters we use

`search` (`search_depth: basic`, `topic`, `time_range`, `start_date`, `end_date`, `country`, `language`, `exact_match`, `include_domains` with `include_domains_mode: prefer`, `include_favicon`, `include_usage`), `extract` (`extract_depth: basic`, `query`, `format: text`, `include_usage`) and `map` (`select_paths`, `max_depth`, `limit`). What did not work as we hoped is in `docs/FEEDBACK_LOG.md` (for example `exact_match` returning nothing, and `topic: general` results having no `published_date`).
