"use client";

import { useState } from "react";
import type { NewsItem, ShockCase } from "../../lib/events";
import { formatDelta, formatSignedPercent } from "../../lib/format";
import { useMarketStore } from "../../lib/store";
import { MINUS, hue, relDate } from "./parts";

const ORIGIN: Record<ShockCase["origin"], string> = { news: "From the news", ai: "Nemotron's pick", default: "Standard test", realized: "What really happened" };
const LIKELY: Record<ShockCase["likelihood"], string> = { likely: "Likely", possible: "Possible", unlikely: "Unlikely" };

/** What an article moved, as short chips. */
function moved(n: NewsItem): string[] {
  const out: string[] = [];
  const sh = n.shock;
  if (!sh) return out;
  if (sh.delta_c_raw) out.push(`Costs ${formatSignedPercent(sh.delta_c_raw)}`);
  if (sh.delta_lead_time) {
    const w = Math.abs(sh.delta_lead_time);
    out.push(`Shipping ${sh.delta_lead_time < 0 ? MINUS : "+"}${w} ${w === 1 ? "week" : "weeks"}`);
  }
  if (sh.demand_shock) out.push(`Demand ${formatSignedPercent(sh.demand_shock)}`);
  return out;
}

function Source({ n, picked, i }: { n: NewsItem; picked: boolean; i: number }) {
  const link = /^https?:\/\//.test(n.url) ? n.url : null;
  const chips = moved(n);
  const market = n.kind === "market";
  return (
    <div className="fl-src fl-in" style={{ ["--i" as string]: i }}>
      <span className="fl-fav" style={{ background: `hsl(${hue(n.source)} 45% 42%)` }} aria-hidden>
        {n.source.slice(0, 1).toUpperCase()}
      </span>
      <div style={{ minWidth: 0 }}>
        {link ? (
          <a className="ti" href={link} target="_blank" rel="noopener noreferrer">
            {n.title}
          </a>
        ) : (
          <span className="ti">{n.title}</span>
        )}
        <div className="me">
          {n.source} · {relDate(n.published)} · {market ? "your market" : "your supplies"}
        </div>
        <p className="fl-quote">
          “<mark>{n.quote}</mark>”
        </p>
        <div className="fl-chips">
          {chips.map((c) => (
            <span key={c} className="fl-chip">
              {c}
            </span>
          ))}
          {market && <span className="fl-chip mk">Used to pick the futures</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        {!market && <span className="fl-pill ok">Quote checked</span>}
        {picked && <span className="fl-pill acc">Sets today&apos;s future</span>}
        {n.live && <span className="fl-pill amb">{n.applied ? "Just fetched" : "Just fetched · not in this run"}</span>}
      </div>
    </div>
  );
}

export function StageSearch() {
  const p = useMarketStore((s) => s.profile);
  const news = useMarketStore((s) => s.news);
  const usedForGrid = useMarketStore((s) => s.usedForGrid);
  const shocks = useMarketStore((s) => s.shocks);
  const mode = useMarketStore((s) => s.analysis.mode);
  const backend = useMarketStore((s) => s.backend);
  const status = useMarketStore((s) => s.analysis.status);
  const newsCheck = useMarketStore((s) => s.newsCheck);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const searching = news.length === 0 && status !== "error";
  const supply = news.filter((n) => n.kind === "supply");
  const market = news.filter((n) => n.kind === "market");
  const lead = news.find((n) => n.id === usedForGrid) ?? supply[0];
  const queries: { k: string; q: string; found: number }[] = [
    ...(p?.search_terms ?? []).map((q) => ({ k: "Supplies", q, found: supply.length })),
    ...(p?.market_terms ?? []).map((q) => ({ k: "Local market", q, found: market.length })),
  ];
  const sourceName = (id: string) => news.find((n) => n.id === id)?.source;

  const check = async () => {
    setChecking(true);
    const err = await newsCheck();
    setChecking(false);
    setCheckMsg(err ?? "Checking live news. New articles appear above when they arrive.");
  };

  return (
    <div className="fl-stage">
      <div className="fl-g2">
        <div className="fl-col">
          <div className="fl-card">
            <div className="fl-ch">
              <div>
                <h2>{searching ? "Searching this week's news" : `Read ${news.length} articles`}</h2>
                <p className="fl-sub">Tavily searches the web, then reads each full page so every quote can be checked word for word.</p>
              </div>
              <span className="fl-pill tav">{searching ? <span className="fl-spin" /> : null}Tavily search + extract</span>
            </div>
            {queries.map((x, i) => (
              <div key={x.k + x.q} className="fl-q fl-in" style={{ ["--i" as string]: i }}>
                <span className="k">{x.k}</span>
                <span className="s">{x.q}</span>
                <span className="r">{searching ? <span className="fl-spin" /> : `${x.found} kept`}</span>
              </div>
            ))}
          </div>
          <div className="fl-card">
            <div className="fl-ch">
              <h2>Sources</h2>
              {!searching && <span className="fl-sub" style={{ margin: 0 }}>Tap a headline to read it</span>}
            </div>
            {searching ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{ display: "grid", gap: 6 }}>
                    <span className="fl-skel" style={{ width: "70%", height: 14 }} />
                    <span className="fl-skel" style={{ width: "40%" }} />
                  </div>
                ))}
              </div>
            ) : (
              [...supply, ...market].map((n, i) => <Source key={n.id} n={n} picked={n.id === usedForGrid} i={i} />)
            )}
          </div>
        </div>

        <div className="fl-col">
          {lead && lead.impact_usd != null && (
            <div className="fl-card fl-in" style={{ ["--i" as string]: 2 }}>
              <h3>If you do nothing</h3>
              <div className={`fl-impact ${lead.impact_usd < 0 ? "neg" : "pos"}`} style={{ marginTop: 8 }}>
                {formatDelta(lead.impact_usd)}
              </div>
              <p className="fl-sub">over the next 6 months, from “{lead.title}” ({lead.source}), simulated.</p>
              {lead.cost_line && <p className="fl-note" style={{ marginTop: 10 }}>{lead.cost_line}</p>}
            </div>
          )}
          <div className="fl-card">
            <div className="fl-ch">
              <div>
                <h2>Futures to test</h2>
                <p className="fl-sub">Nemotron Ultra reads the news and picks the futures your plans must survive.</p>
              </div>
              {shocks.length === 0 && !searching && (
                <span className="fl-pill acc">
                  <span className="fl-spin" /> Picking…
                </span>
              )}
            </div>
            {shocks.length === 0 ? (
              <div className="fl-fut" aria-hidden>
                {[0, 1].map((i) => (
                  <div key={i} className="fl-futc">
                    <span className="fl-skel" style={{ width: "60%", height: 14 }} />
                    <span className="fl-skel" style={{ width: "85%" }} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="fl-fut">
                {shocks.map((c, i) => (
                  <div key={c.id} className="fl-futc fl-in" style={{ ["--i" as string]: i }}>
                    <b>{c.label}</b>
                    <span>{c.why}</span>
                    <div className="fl-chips" style={{ marginTop: 2 }}>
                      <span className="fl-pill">{LIKELY[c.likelihood]}</span>
                      <span className={`fl-pill${c.origin === "news" ? " ok" : ""}`}>{ORIGIN[c.origin]}</span>
                      {c.source_ids.map((id) => sourceName(id)).filter(Boolean).map((s) => (
                        <span key={s} className="fl-pill tav">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="fl-tav">
            <span>
              {backend === "mock" || mode === "replay" ? "Recorded search, replayed for free. Every response is cached." : "Live search on Tavily. Every response is cached."}
            </span>
            {status !== "idle" && (
              <button type="button" className="fl-btn2" onClick={() => void check()} disabled={checking}>
                {checking && <span className="fl-spin" />} Check live news
              </button>
            )}
          </div>
          {checkMsg && <p className="fl-sub" role="status">{checkMsg}</p>}
        </div>
      </div>
    </div>
  );
}
