"use client";

import { useMarketStore } from "../../lib/store";
import { withTransition } from "../../lib/transition";

/** STUB (F1 replaces this): screen 1, "Your business". Reads the store; takes no props. */
export function SetupScreen() {
  const s = useMarketStore();
  return (
    <section className="screen" data-slot="SetupScreen">
      <div className="wrap">
        <div className="card" style={{ padding: 28, display: "grid", gap: 14 }}>
          <div className="sub" style={{ margin: 0 }}>
            <h1>Describe your business</h1>
            <span className="slot-note">SetupScreen · F1 builds this</span>
          </div>
          <textarea
            value={s.profileText}
            onChange={(e) => s.setProfileText(e.target.value)}
            placeholder="We make… we sell to… our main cost is… our big rival is…"
            style={{ minHeight: 120, padding: 12, borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--bg-sunk)", color: "inherit", font: "inherit" }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {s.examples.map((e) => (
              <button key={e.id} className="btn ghost sm" onClick={() => s.pickExample(e.id)}>
                {e.title}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" disabled={!s.profileText.trim() || s.profileStatus === "reading"} onClick={() => s.parseProfile(s.profileText)}>
              {s.profileStatus === "reading" ? "Reading…" : "Read my business →"}
            </button>
            {s.profile && <span className="biz">{s.profile.business_name}</span>}
            <button className="btn" disabled={!s.profile} onClick={() => withTransition(() => void s.startAnalysis())}>
              Looks right → find news
            </button>
          </div>
          {s.profileError && <p className="neg">{s.profileError}</p>}
          {s.analysis.status === "error" && <p className="neg">{s.analysis.note}</p>}
        </div>
      </div>
    </section>
  );
}

export default SetupScreen;
