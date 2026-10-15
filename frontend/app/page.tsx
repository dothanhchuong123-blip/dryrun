"use client";

import { useEffect } from "react";
import { AnalystLog } from "../components/analyst/AnalystLog";
import { PlanGrid } from "../components/grid/PlanGrid";
import { MemoScreen } from "../components/memo/MemoScreen";
import { NewsScreen } from "../components/news/NewsScreen";
import { ReplayDrawer } from "../components/replay/ReplayDrawer";
import { SetupScreen } from "../components/setup/SetupScreen";
import { Footer } from "../components/shell/Footer";
import { TopBar } from "../components/shell/TopBar";
import { useMarketStore } from "../lib/store";

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** Replay shortcuts: Space play/pause, ←/→ step a week, Esc close. */
function useReplayKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useMarketStore.getState();
      if (!s.replay.open || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "Escape") s.closeReplay();
      else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        s.toggleReplay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        s.stepReplay(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        s.stepReplay(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function AnalystScreen() {
  const name = useMarketStore((s) => s.profile?.business_name);
  const replayOpen = useMarketStore((s) => s.replay.open);
  const closeReplay = useMarketStore((s) => s.closeReplay);
  return (
    <section className="screen fill" data-screen="analyst">
      <div className="sub">
        {name && <span className="biz">{name}</span>}
        <h2>Which plan holds up best?</h2>
      </div>
      <div className="body3">
        <AnalystLog />
        <PlanGrid />
      </div>
      {replayOpen && (
        <>
          <div className="scrim" onClick={closeReplay} />
          <aside className="drawer" role="dialog" aria-label="Replay one plan">
            <ReplayDrawer />
          </aside>
        </>
      )}
    </section>
  );
}

export default function Page() {
  const step = useMarketStore((s) => s.step);
  const loadExamples = useMarketStore((s) => s.loadExamples);
  useReplayKeys();
  useEffect(() => {
    void loadExamples();
  }, [loadExamples]);

  return (
    <div className="app">
      <TopBar />
      <main className="stage">
        {step === "business" && <SetupScreen />}
        {step === "news" && <NewsScreen />}
        {step === "analyst" && <AnalystScreen />}
        {step === "memo" && <MemoScreen />}
      </main>
      <Footer />
    </div>
  );
}
