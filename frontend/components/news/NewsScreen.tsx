"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NewsItem } from "../../lib/events";
import { formatDelta, formatSignedPercent } from "../../lib/format";
import { follow, now, reducedMotion } from "../../lib/follow";
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
const BEAT_MS: Record<string, number> = { q: 600, read: 900, h: 300, c: 500, i: 650, end: 0 };
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

  // The Tavily queries the backend runs: the profile's supply terms (news, last week) and market terms (local, last month).
  const queries = useMemo(
    () => [
      ...(profile?.search_terms ?? []).slice(0, 3).map((q) => ({ q, kind: "supply" as const })),
      ...(profile?.market_terms ?? []).slice(0, 2).map((q) => ({ q, kind: "market" as const })),
    ],
    [profile],
  );

  // One id per beat, in the order things appear.
  const steps = useMemo(() => {
    const out = queries.map((_, i) => `q:${i}`);
    out.push("read");
    if (supply.length) out.push("h:supply");
    for (const n of supply) out.push(`c:${n.id}`, ...(n.impact_usd != null ? [`i:${n.id}`] : []));
    if (market.length) out.push("h:market");
    for (const n of market) out.push(`c:${n.id}`);
    out.push("end");
    return out;
  }, [queries, supply, market]);

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
    const kind = steps[Math.max(0, beat - 1)]?.split(":")[0] ?? "q";
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

  const qState = (i: number) => (beat > i + 1 || beat > readIdx ? "done" : "run");
  const readDone = beat > readIdx + 1 && news.length > 0;

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

        <div className="card nw-search fu" style={{ ["--i" as string]: 2 }} aria-label="How we found this news">
          <div className="nw-sh">
            <b>How we found this</b>
            <span className="nw-credit">Search by Tavily</span>
            <ModelChip tier="super" job="reads the news" />
            {!finished && (
              <button className="nw-skip" onClick={() => setBeat(Number.MAX_SAFE_INTEGER)}>
                Show all
              </button>
            )}
          </div>
          <ol className="nw-steps">
            {queries.map((x, i) =>
              seen(`q:${i}`) ? (
                <li key={i} className={`nw-q fu ${qState(i)}`} data-step={`q:${i}`}>
                  <span className="ic" aria-hidden>{qState(i) === "done" ? "✓" : <span className="nw-spin" />}</span>
                  <span className="what">
                    <span className="lbl">{x.kind === "supply" ? "Searching news" : `Searching ${country}`}</span>
                    <code>{x.q}</code>
                  </span>
                  <small>{x.kind === "supply" ? "news · last 7 days" : `local results · ${country} · last month`}</small>
                </li>
              ) : null,
            )}
            {seen("read") && (
              <li className={`nw-q fu ${readDone ? "done" : "run"}`} data-step="read">
                <span className="ic" aria-hidden>{readDone ? "✓" : <span className="nw-spin" />}</span>
                <span className="what">
                  {news.length === 0 ? (
                    <span className="lbl">Nemotron Super is reading the articles…</span>
                  ) : (
                    <span className="lbl">
                      Nemotron Super read the articles: <b>{supply.length}</b> move your costs, <b>{market.length}</b> are about your market
                    </span>
                  )}
                </span>
              </li>
            )}
          </ol>
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
