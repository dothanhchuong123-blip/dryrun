"use client";

import { useState } from "react";
import type { AnalystSearchData, MemoSource, NewsItem, SearchReport, SearchRow } from "../../lib/events";

/** Everything on the answer page that says where the news came from: the source lines and the search log. */

const DATE = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function dateLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : DATE.format(d);
}

/** A memo source with the outlet, date and favicon the news step found (joined by URL for older recordings). */
export function enrichSource(s: MemoSource, news: NewsItem[]): MemoSource {
  const n = news.find((x) => x.url && x.url === s.url);
  return {
    ...s,
    source: s.source || n?.source || hostOf(s.url),
    published: s.published || n?.published || "",
    favicon: s.favicon || n?.favicon || "",
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function Favicon({ src, name }: { src?: string; name: string }) {
  const [bad, setBad] = useState(false);
  if (src && /^https:\/\//.test(src) && !bad) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="tv-fav" src={src} alt="" width={16} height={16} loading="lazy" onError={() => setBad(true)} />;
  }
  return (
    <span className="tv-fav tv-fav-letter" aria-hidden="true">
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}

/** "Tavily · outlet · 14 Oct 2026 · open" under every source (the search itself is Tavily's). */
export function SourceMeta({ s }: { s: MemoSource }) {
  const date = dateLabel(s.published);
  const link = /^https?:\/\//.test(s.url);
  return (
    <span className="tv-meta">
      <Favicon src={s.favicon} name={s.source || ""} />
      <b>Tavily</b>
      {s.source && <span>{s.source}</span>}
      {date && <time dateTime={s.published}>{date}</time>}
      {link && (
        <a href={s.url} target="_blank" rel="noopener noreferrer">
          Open article ↗
        </a>
      )}
    </span>
  );
}

function windowLabel(r: SearchRow): string {
  if (r.start_date || r.end_date) return `${r.start_date ?? "…"} to ${r.end_date ?? "…"}`;
  if (r.time_range) return `past ${r.time_range}`;
  return "any date";
}

function params(r: SearchRow): string {
  const bits = [`topic: ${r.topic}`, windowLabel(r)];
  if (r.country) bits.push(`country: ${r.country}`);
  if (r.language) bits.push(`language: ${r.language}`);
  if (r.exact_match) bits.push("exact match");
  bits.push(`${r.depth} depth`);
  return bits.join(" · ");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : /(s|sh|ch|x)$/.test(word) ? "es" : "s"}`;

/** Compact "How we searched" panel. Every figure is counted from the recorded Tavily calls. */
export function SearchPanel({ report, asked = [] }: { report: SearchReport | null; asked?: AnalystSearchData[] }) {
  if (!report) return asked.length ? <AskedList asked={asked} wrap /> : null;
  return <SearchPanelFull report={report} asked={asked} />;
}

/** Nemotron's own searches: what it asked, why, and what came of each (EVENTS v2.6). */
function AskedList({ asked, wrap = false }: { asked: AnalystSearchData[]; wrap?: boolean }) {
  const credits = asked.reduce((n, a) => n + a.credits, 0);
  const body = (
    <>
      <p className="tv-line">
        <b>Asked by Nemotron mid-analysis</b>: {plural(asked.length, "search")}, {plural(credits, "credit")}. Each answer is
        read by Super, its quote checked word for word, and (if it holds) added as a new future every plan is tested in.
      </p>
      <ol className="tv-q">
        {asked.map((a, i) => (
          <li key={i}>
            <span className={`tv-tag ${a.status === "added" ? "supply" : "market"}`}>
              {a.status === "added" ? "Added a future" : "Skipped"}
            </span>
            <q>{a.query}</q>
            <small>
              {a.why ? `${a.why} · ` : ""}
              {a.status === "added" && a.item ? `Found: ${a.item.title}` : a.reason} · {plural(a.credits, "credit")}
            </small>
          </li>
        ))}
      </ol>
    </>
  );
  if (!wrap) return body;
  return (
    <details className="am-fold tv-panel">
      <summary>How we searched (Tavily)</summary>
      <div className="tv-body">{body}</div>
    </details>
  );
}

function SearchPanelFull({ report, asked }: { report: SearchReport; asked: AnalystSearchData[] }) {
  const { results: r } = report;
  const d = r.dropped;
  const dropped = d.non_article + d.social + d.short + d.outside_window;
  const parts: [string, number][] = [
    ["not articles (index, ticker or sitemap pages)", d.non_article],
    ["social posts", d.social],
    ["too short to read", d.short],
    ["outside the date window", d.outside_window],
  ];
  return (
    <details className="am-fold tv-panel">
      <summary>How we searched (Tavily)</summary>
      <div className="tv-body">
        <p className="tv-sum">
          {plural(report.searches.length, "search")}
          {report.extract ? ` and ${plural(report.extract.read, "page")} read` : ""} · {plural(report.credits, "credit")} · {r.returned} results,{" "}
          {r.kept} kept
        </p>
        <ol className="tv-q">
          {report.searches.map((q, i) => (
            <li key={i}>
              <span className={`tv-tag ${q.kind}`}>{q.kind === "supply" ? "Supply" : "Local market"}</span>
              <q>{q.query}</q>
              <small>
                {params(q)} · {plural(q.results, "result")}
              </small>
            </li>
          ))}
        </ol>
        {report.extract && (
          <p className="tv-line">
            <b>Extract</b>: read {report.extract.read} of {plural(report.extract.urls, "top article")} in full, asking for
            passages about “{report.extract.query}”.
          </p>
        )}
        <p className="tv-line">
          <b>Results</b>: {r.returned} returned, {dropped} dropped, {r.kept} kept.
          {dropped > 0 && (
            <>
              {" "}
              Dropped:{" "}
              {parts
                .filter(([, n]) => n > 0)
                .map(([t, n]) => `${n} ${t}`)
                .join(", ")}
              .
            </>
          )}{" "}
          {r.read > 0 ? `${r.read} read in full; ${plural(r.used, "article")} gave a usable number.` : ""}
        </p>
        {report.quotes && (
          <p className="tv-line">
            <b>Quotes</b>: {report.quotes.verified} of {report.quotes.checked} quotes the AI pulled out were found word for
            word on the page; the rest were thrown away.
          </p>
        )}
        {asked.length > 0 && <AskedList asked={asked} />}
        <p className="tv-line">
          <b>Credits</b>: {report.credits + asked.reduce((n, a) => n + a.credits, 0)}{" "}
          {report.credits_reported
            ? "(as reported by Tavily)"
            : "(list price: 1 per basic search, 1 per 5 pages read; the older cached responses did not report usage)"}
          .
        </p>
      </div>
    </details>
  );
}
