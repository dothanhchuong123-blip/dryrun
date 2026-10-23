"use client";

import { useEffect, useState } from "react";
import { STEPS, canGoTo, useMarketStore, type Step } from "../../lib/store";
import { withTransition } from "../../lib/transition";

function StepBar() {
  const step = useMarketStore((s) => s.step);
  const gates = useMarketStore((s) => ({ profile: s.profile, analysis: s.analysis, shocks: s.shocks, memo: s.memo, news: s.news }));
  const setStep = useMarketStore((s) => s.setStep);
  const index = STEPS.findIndex((x) => x.id === step);
  const go = (id: Step) => {
    const to = STEPS.findIndex((x) => x.id === id);
    withTransition(() => setStep(id), to < index ? "back" : "forward");
  };
  return (
    <nav className="steps" aria-label="Steps">
      {STEPS.map((st, i) => {
        const reachable = canGoTo(gates, st.id);
        const cls = st.id === step ? "on" : i < index ? "done" : "";
        return (
          <button
            key={st.id}
            className={cls}
            disabled={!reachable && st.id !== step}
            aria-current={st.id === step ? "step" : undefined}
            onClick={() => go(st.id)}
          >
            <span className="n">{i < index ? "✓" : i + 1}</span>
            <span className="l">{st.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ModeChip() {
  const backend = useMarketStore((s) => s.backend);
  const mode = useMarketStore((s) => s.analysis.mode);
  const note = useMarketStore((s) => s.analysis.note);
  const offline = backend === "mock";
  const label = offline ? "Recorded run · free" : mode === "live" ? "Live" : "Example replay";
  const cls = offline ? "offline" : mode === "live" ? "live" : "";
  const title = offline
    ? "Replays a real recorded run, no credit spent."
    : (note ?? (mode === "live" ? "Running live on Nemotron." : "Replaying a recorded run. Costs nothing."));
  return (
    <span className={`chip mode ${cls}`} title={title}>
      {label}
    </span>
  );
}

function CredChip() {
  const t = useMarketStore((s) => s.telemetry);
  // the savings share swings while calls stream in; show it once the run is finished
  const done = useMarketStore((s) => s.analysis.status === "done");
  const calls = t ? t.tiers.ultra.calls + t.tiers.super.calls + t.tiers.fast.calls : 0;
  return (
    <span className="chip cred" title="Counted from this run's call log">
      <span className="num">{calls}</span> Nemotron calls
      {t && (
        <>
          <span>·</span>
          <span className="num">${t.cost_usd.toFixed(2)}</span>
          {done && t.savings_pct > 0 && <span className="x">· <span className="num">{Math.round(t.savings_pct)}%</span> cheaper than all-Ultra</span>}
        </>
      )}
    </span>
  );
}

function ThemeButton() {
  const [, force] = useState(0);
  useEffect(() => force(1), []);
  const toggle = () => {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === "dark" ||
      (root.dataset.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode */
    }
  };
  return (
    <button className="theme" onClick={toggle} title="Light / dark" aria-label="Switch light or dark mode">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}

export function TopBar() {
  return (
    <header className="top">
      <div className="brand">
        <i />
        Dry Run
      </div>
      <StepBar />
      <div className="right">
        <ModeChip />
        <ThemeButton />
        <CredChip />
      </div>
    </header>
  );
}
