"use client";

import { useState } from "react";
import type { NewsItem } from "../../lib/events";
import { formatDelta, formatSignedPercent } from "../../lib/format";
import { useMarketStore } from "../../lib/store";
import { withTransition } from "../../lib/transition";
import { ModelChip } from "../shell/ModelChip";
import "./news.css";

const MINUS = "−";
const DAY = 86_400_000;

/** "3 days ago" from an ISO date; falls back to the raw text. */
function relDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = Math.floor((Date.now() - t) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The parameters this article moved, as short chips. */
function paramChips(n: NewsItem): string[] {
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

function Card({ n, picked }: { n: NewsItem; picked: boolean }) {
  const chips = paramChips(n);
  const market = n.kind === "market";
  const bad = n.impact_usd != null && n.impact_usd < 0;
  return (
    <article className={`card nw-card slidein${picked ? " picked" : ""}`} aria-label={n.title}>
      <div className="nw-src">
        <span>
          {n.source} · {relDate(n.published)}
        </span>
        {picked && <span className="nw-tag used">Used for your plans</span>}
        {market && <span className="nw-tag mkt">Used to pick futures</span>}
        {n.live && <span className="nw-tag fresh">Just fetched</span>}
        {n.live && !n.applied && <span className="nw-tag skip">Not applied to this run</span>}
      </div>
      <a className="nw-hl" href={n.url} target="_blank" rel="noopener noreferrer">
        {n.title}
      </a>
      {!market && n.impact_usd != null && (
        <div className={`nw-impact ${bad ? "bad" : "ok"}`}>
          {formatDelta(n.impact_usd)}
          <small>over 6 months if you do nothing</small>
        </div>
      )}
      <div className="nw-chain">
        <q>{n.quote}</q>
        {chips.length > 0 && <span className="arr" aria-hidden>→</span>}
        {chips.map((c) => (
          <span key={c} className="nw-dchip">
            {c}
          </span>
        ))}
      </div>
      {!market && n.cost_line && <div className="nw-cost">{n.cost_line}</div>}
    </article>
  );
}

function Skeletons({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card nw-skel" aria-hidden>
          <i style={{ width: "30%" }} />
          <i style={{ width: "75%", height: 16 }} />
          <i style={{ width: "55%" }} />
        </div>
      ))}
    </>
  );
}

/** Screen 2, "News that affects you". */
export function NewsScreen() {
  const news = useMarketStore((s) => s.news);
  const usedForGrid = useMarketStore((s) => s.usedForGrid);
  const status = useMarketStore((s) => s.analysis.status);
  const note = useMarketStore((s) => s.analysis.note);
  const profile = useMarketStore((s) => s.profile);
  const setStep = useMarketStore((s) => s.setStep);
  const newsCheck = useMarketStore((s) => s.newsCheck);
  const planCount = useMarketStore((s) => s.plans.length);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);

  const supply = news.filter((n) => n.kind !== "market");
  const market = news.filter((n) => n.kind === "market");
  const loading = news.length === 0 && (status === "starting" || status === "running");
  const country = cap(profile?.country || "your country");

  const check = async () => {
    setChecking(true);
    setMsg(null);
    const err = await newsCheck();
    setChecking(false);
    setMsg(err ? { text: err, err: true } : { text: "Looking for fresh news…", err: false });
  };

  return (
    <section className="screen" data-slot="NewsScreen">
      <div className="wrap">
        <div className="sub" style={{ marginBottom: 6 }}>
          {profile && <span className="biz">{profile.business_name}</span>}
          <h1>News that affects you</h1>
        </div>
        <p className="nw-intro">Each number is your gross profit over 6 months if you change nothing.</p>
        <div className="nw-top">
          <ModelChip tier="super" job="reads the news" />
          <span className="nw-credit">Search by Tavily</span>
        </div>

        {loading && (
          <>
            <p className="nw-load" role="status">
              Searching news about {profile?.supplier_region || "your supplier"} and {profile?.product_unit || "your product"}, and the market in {country}…
            </p>
            <div className="nw-group">
              <Skeletons n={3} />
            </div>
          </>
        )}

        {news.length === 0 && !loading && (
          <div className="card empty">
            {status === "error" ? (note ?? "The analysis stopped.") : "No news yet. Go back and read your business first."}
          </div>
        )}

        {supply.length > 0 && (
          <div className="nw-group">
            <h2>Your supply route</h2>
            {supply.map((n) => (
              <Card key={n.id} n={n} picked={n.id === usedForGrid} />
            ))}
            <p className="nw-cap">Tavily news search, last week</p>
          </div>
        )}

        {market.length > 0 && (
          <div className="nw-group">
            <h2>In your market ({country})</h2>
            {market.map((n) => (
              <Card key={n.id} n={n} picked={false} />
            ))}
            <p className="nw-cap">Tavily local search, {country}, last month</p>
          </div>
        )}

        <div className="nw-acts">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn ghost" disabled={status === "idle" || status === "starting" || checking} onClick={() => void check()}>
              {checking ? "Checking…" : "Check live news"}
            </button>
            {msg && (
              <span className={`msg${msg.err ? " err" : ""}`} role={msg.err ? "alert" : "status"}>
                {msg.text}
              </span>
            )}
          </div>
          <div className="nw-go">
            {status === "running" && news.length > 0 && (
              <span className="nw-ahead" role="status">
                <span className="nw-spin" />
                {planCount > 0 ? `Nemotron is already testing plans (${planCount} so far)` : "Nemotron has already started on your plans"}
              </span>
            )}
            {status === "done" && planCount > 0 && <span className="nw-ahead done">✓ {planCount} plans tested and ready</span>}
            <button className="btn" disabled={news.length === 0} onClick={() => withTransition(() => setStep("analyst"))}>
              Find the best plan for this →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default NewsScreen;
