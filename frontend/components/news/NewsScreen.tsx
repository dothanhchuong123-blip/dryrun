"use client";

import { formatDelta } from "../../lib/format";
import { useMarketStore } from "../../lib/store";
import { withTransition } from "../../lib/transition";

/** STUB (F1 replaces this): screen 2, "News that affects you". */
export function NewsScreen() {
  const news = useMarketStore((s) => s.news);
  const status = useMarketStore((s) => s.analysis.status);
  const setStep = useMarketStore((s) => s.setStep);
  const newsCheck = useMarketStore((s) => s.newsCheck);
  return (
    <section className="screen" data-slot="NewsScreen">
      <div className="wrap" style={{ display: "grid", gap: 12 }}>
        <div className="sub" style={{ margin: 0 }}>
          <h1>News that affects you</h1>
          <span className="slot-note">NewsScreen · F1 builds this</span>
        </div>
        {news.length === 0 && <div className="card empty">{status === "error" ? "The analysis stopped." : "Searching the news for your business…"}</div>}
        {news.map((n) => (
          <div key={n.id} className="card slidein" style={{ padding: 18 }}>
            <div className="muted" style={{ fontSize: 12.5 }}>{n.source} · {n.published} · {n.kind}</div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{n.title}</div>
            {n.cost_line && <div className="muted">{n.cost_line}</div>}
            {n.impact_usd != null && <span className="rchip neg num">{formatDelta(n.impact_usd)} if you do nothing</span>}
          </div>
        ))}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn ghost" disabled={status === "idle"} onClick={() => void newsCheck()}>Check live news</button>
          <button className="btn" disabled={news.length === 0} onClick={() => withTransition(() => setStep("analyst"))}>
            Find the best plan for this →
          </button>
        </div>
      </div>
    </section>
  );
}

export default NewsScreen;
