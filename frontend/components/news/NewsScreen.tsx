"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NewsItem } from "../../lib/events";
import { formatDelta, formatSignedPercent } from "../../lib/format";
import { follow, now, reducedMotion } from "../../lib/follow";
import { useMarketStore } from "../../lib/store";
import { withTransition } from "../../lib/transition";
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

/** a stable hue per outlet, for its monogram */
function hue(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
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

function Card({ n, picked, priced, i }: { n: NewsItem; picked: boolean; priced: boolean; i?: number }) {
  const chips = paramChips(n);
  const market = n.kind === "market";
  const bad = n.impact_usd != null && n.impact_usd < 0;
  const link = /^https?:\/\//.test(n.url) ? n.url : null;
  return (
    <article className={`card nw-card fu${picked ? " picked" : ""}`} style={{ ["--i" as string]: i ?? 0 }} aria-label={n.title} data-step={`c:${n.id}`}>
      <div className="nw-src">
        <span>
          {n.source} · {relDate(n.published)}
        </span>
        {picked && <span className="nw-tag used">Used for your plans</span>}
        {market && <span className="nw-tag mkt">Used to pick futures</span>}
        {n.live && <span className="nw-tag fresh">Just fetched</span>}
        {n.live && !n.applied && <span className="nw-tag skip">Not applied to this run</span>}
      </div>
      {link ? (
        <a className="nw-hl" href={link} target="_blank" rel="noopener noreferrer">
          {n.title}
        </a>
      ) : (
        <span className="nw-hl">{n.title}</span>
      )}
      {!market && n.impact_usd != null && (
        priced ? (
          <div className={`nw-impact fu ${bad ? "bad" : "ok"}`} data-step={`i:${n.id}`}>
            {formatDelta(n.impact_usd)}
            <small>over 6 months if you do nothing</small>
          </div>
        ) : (
          <div className="nw-impact pending" aria-label="Simulating the impact">
            <span className="nw-spin" /> Simulating the impact…
          </div>
        )
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
      {!market && n.cost_line && priced && <div className="nw-cost fu">{n.cost_line}</div>}
      {link && (
        <a className="nw-read" href={link} target="_blank" rel="noopener noreferrer">
          Read it on {n.source} <span aria-hidden>↗</span>
        </a>
      )}
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

/** How long each reveal beat holds before the next one, by kind of beat (ms). */
const BEAT_MS: Record<string, number> = { search: 1800, read: 1100, h: 250, c: 450, i: 600, end: 0 };
/** analyses whose news reveal already played once; going back to this screen shows everything at once */
const played = new Set<string>();

/** Screen 2, "News that affects you". Plays the search → read → price story one beat at a time. */
export function NewsScreen() {
  const news = useMarketStore((s) => s.news);
  const usedForGrid = useMarketStore((s) => s.usedForGrid);
  const status = useMarketStore((s) => s.analysis.status);
  const analysisId = useMarketStore((s) => s.analysis.id);
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

  // distinct outlets, shown as they "come back" from the search
  const sources = useMemo(() => [...new Set(news.map((n) => n.source).filter(Boolean))].slice(0, 6), [news]);

  // One id per beat, in the order things appear.
  const steps = useMemo(() => {
    const out = ["search", "read"];
    if (supply.length) out.push("h:supply");
    for (const n of supply) out.push(`c:${n.id}`, ...(n.impact_usd != null ? [`i:${n.id}`] : []));
    if (market.length) out.push("h:market");
    for (const n of market) out.push(`c:${n.id}`);
    out.push("end");
    return out;
  }, [supply, market]);

  const key = analysisId ?? "local";
  const [beat, setBeat] = useState(() => (played.has(key) || reducedMotion() ? Number.MAX_SAFE_INTEGER : 0));
  const since = useRef(now());
  const boxRef = useRef<HTMLDivElement>(null);
  const at = (id: string) => steps.indexOf(id);
  const seen = (id: string) => {
    const k = at(id);
    return k >= 0 && k < beat;
  };
  const readIdx = at("read");
  const finished = beat >= steps.length;

  useEffect(() => {
    if (beat >= steps.length) {
      if (news.length) played.add(key);
      return;
    }
    // hold on "Nemotron is reading" until the articles exist
    if (beat > readIdx && news.length === 0) return;
    const kind = steps[Math.max(0, beat - 1)]?.split(":")[0] ?? "search";
    const t = window.setTimeout(() => setBeat((b) => b + 1), beat === 0 ? 250 : (BEAT_MS[kind] ?? 500));
    return () => window.clearTimeout(t);
  }, [beat, steps, readIdx, news.length, key]);

  // leaving the screen early also counts as "seen": coming back shows everything at once
  const hasNews = useRef(false);
  hasNews.current = news.length > 0;
  useEffect(
    () => () => {
      if (hasNews.current) played.add(key);
    },
    [key],
  );

  // keep the newest beat on screen while the user is just watching
  useEffect(() => {
    const id = steps[Math.min(beat, steps.length) - 1];
    if (!id || beat > steps.length) return;
    const el = boxRef.current?.querySelector(`[data-step="${CSS.escape(id)}"]`);
    follow(el, since.current, id === "end" ? "center" : "nearest");
  }, [beat, steps]);

  const check = async () => {
    setChecking(true);
    setMsg(null);
    const err = await newsCheck();
    setChecking(false);
    setMsg(err ? { text: err, err: true } : { text: "Looking for fresh news…", err: false });
  };

  const readDone = beat > readIdx + 1 && news.length > 0;
  const phase = readDone ? "done" : seen("read") ? "reading" : "searching";
  const title =
    phase === "done"
      ? `Found ${news.length} ${news.length === 1 ? "story" : "stories"} that affect you`
      : phase === "reading"
        ? "Reading the articles"
        : "Searching the news";
  const subline =
    phase === "done"
      ? `${supply.length} move your costs · ${market.length} about your market · searched by Tavily, read by Nemotron Super`
      : phase === "reading"
        ? "Nemotron Super is picking the ones that touch your costs"
        : `Tavily is looking through this week's news for your supply route and ${country}`;

  return (
    <section className="screen" data-slot="NewsScreen">
      <div className="wrap" ref={boxRef}>
        <div className="sub fu" style={{ marginBottom: 6 }}>
          {profile && <span className="biz">{profile.business_name}</span>}
          <h1>News that affects you</h1>
        </div>
        <p className="nw-intro fu" style={{ ["--i" as string]: 1 }}>
          Tavily searches the news, Nemotron Super reads each article, and the simulator prices what it does to your gross profit over 6 months.
        </p>

        <div className={`card nw-search liquid fu ${phase}${phase === "done" ? "" : " on"}`} style={{ ["--i" as string]: 2 }} aria-live="polite" data-step="read">
          <div className="nw-sr">
            <span className="nw-orb" aria-hidden>
              {phase === "done" ? (
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <path d="M3.4 8.4l3 3 6.2-6.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="15" height="15">
                  <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M10.4 10.4l3.2 3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <div className="nw-st">
              <b key={title} className={phase === "done" ? "fu" : "nw-shimmer"}>
                {title}
              </b>
              <span key={subline} className="nw-sub fu">
                {subline}
              </span>
            </div>
            {!finished && (
              <button className="nw-skip" onClick={() => setBeat(Number.MAX_SAFE_INTEGER)}>
                Skip
              </button>
            )}
          </div>
          {sources.length > 0 && (
            <div className="nw-srcs" aria-label={`Sources: ${sources.join(", ")}`}>
              {sources.map((src, i) => (
                <span key={src} className="nw-fav" style={{ ["--i" as string]: i }}>
                  <i style={{ ["--h" as string]: hue(src) }}>{src.replace(/^www\./, "")[0]?.toUpperCase()}</i>
                  {src}
                </span>
              ))}
            </div>
          )}
          <div className="nw-bar" aria-hidden>
            <i />
          </div>
        </div>

        {news.length === 0 && !loading && (
          <div className="card empty">
            {status === "error" ? (note ?? "The analysis stopped.") : "No news yet. Go back and read your business first."}
          </div>
        )}
        {loading && beat > readIdx && (
          <div className="nw-group">
            <Skeletons n={2} />
          </div>
        )}

        {supply.length > 0 && seen("h:supply") && (
          <div className="nw-group">
            <h2 className="fu" data-step="h:supply">Your supply route</h2>
            {supply.map((n) =>
              seen(`c:${n.id}`) ? <Card key={n.id} n={n} picked={n.id === usedForGrid} priced={seen(`i:${n.id}`)} /> : null,
            )}
            {finished && <p className="nw-cap fu">Tavily news search, last week · click a headline to read the source</p>}
          </div>
        )}

        {market.length > 0 && seen("h:market") && (
          <div className="nw-group">
            <h2 className="fu" data-step="h:market">In your market ({country})</h2>
            {market.map((n) => (seen(`c:${n.id}`) ? <Card key={n.id} n={n} picked={false} priced /> : null))}
            {finished && <p className="nw-cap fu">Tavily local search, {country}, last month</p>}
          </div>
        )}

        <div className={`nw-acts${finished ? " fu" : " nw-wait"}`} data-step="end">
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
            <button
              className={`btn${finished && news.length ? " nudge" : ""}`}
              disabled={news.length === 0}
              onClick={() => withTransition(() => setStep("analyst"))}
            >
              Find the best plan for this →
            </button>
          </div>
          {finished && news.length > 0 && (
            <span className="nextline">Next: Nemotron Ultra proposes plans and the simulator tests each one against these futures</span>
          )}
        </div>
      </div>
    </section>
  );
}

export default NewsScreen;
