"use client";

import { useEffect } from "react";
import { Flow } from "../components/flow/Flow";
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

export default function Page() {
  const loadExamples = useMarketStore((s) => s.loadExamples);
  useReplayKeys();
  useEffect(() => {
    void loadExamples();
  }, [loadExamples]);

  return <Flow />;
}
