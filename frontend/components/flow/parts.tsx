"use client";

import { useEffect, useRef, useState } from "react";
import type { GridCellData } from "../../lib/events";
import { formatDelta } from "../../lib/format";

export const MINUS = "−";

const ENGINE_TIP =
  "The same plan with every shopper reaction counted as neutral. Only the simulator's price, cost and stock maths, no AI shopper mood.";

/** The engine-only figure next to a gain (SPEC §15.5): the same plan with neutral shoppers. Nothing when absent. */
export function EngineOnly({ v, long = false }: { v?: number | null; long?: boolean }) {
  if (v == null) return null;
  return long ? (
    <span className="fl-eng long" title={ENGINE_TIP}>
      Without the shoppers&apos; reactions (simulator alone): <b className={sign(v)}>{formatDelta(v)}</b>
    </span>
  ) : (
    <span className="fl-eng" title={ENGINE_TIP}>
      sim alone {formatDelta(v)}
    </span>
  );
}

/** Light/dark: follows the system until the user picks; the pick is saved (same key as app/layout.tsx). */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const t = document.documentElement.dataset.theme;
      setDark(t ? t === "dark" : mq.matches);
    };
    read();
    mq.addEventListener("change", read);
    const onStore = (e: StorageEvent) => {
      if (e.key !== "theme") return;
      if (e.newValue === "dark" || e.newValue === "light") document.documentElement.dataset.theme = e.newValue;
      read();
    };
    window.addEventListener("storage", onStore);
    return () => {
      mq.removeEventListener("change", read);
      window.removeEventListener("storage", onStore);
    };
  }, []);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode: the switch still works for this visit */
    }
    setDark(!dark);
  };
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" className="fl-ib" onClick={toggle} aria-label={label} title={label}>
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M3 13l1.1-1.1M11.9 4.1L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export const sign = (x: number) => (Math.round(x) === 0 ? "" : x > 0 ? "pos" : "neg");

/** A bar centred on zero. `max` is the largest absolute value on the same scale. */
export function DivBar({ v, max }: { v: number; max: number }) {
  const w = max > 0 ? Math.min(50, (Math.abs(v) / max) * 50) : 0;
  const bg = v >= 0 ? "var(--fl-gain-bar)" : "var(--fl-loss-bar)";
  return (
    <span className="fl-dv" aria-hidden>
      <i style={{ left: v >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: bg }} />
    </span>
  );
}

/** Grid colour scale, relative to the biggest move on the grid. */
export function tone(v: number, max: number): string {
  if (max <= 0) return "z";
  const r = v / max;
  if (r > 0.5) return "g3";
  if (r > 0.18) return "g2";
  if (r > 0.03) return "g1";
  if (r > -0.03) return "z";
  if (r > -0.3) return "r1";
  return "r2";
}

export const maxAbs = (cells: GridCellData[]) => cells.reduce((m, c) => Math.max(m, Math.abs(c.mean_delta_usd)), 0);

/** A stable hue per outlet, for its monogram. */
export function hue(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

const DAY = 86_400_000;
export function relDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = Math.floor((Date.now() - t) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

/** Counts up to `to` over `ms` (snaps when motion is reduced). */
export function useCountUp(to: number, ms = 900, start?: number): number {
  const [v, setV] = useState(start ?? to);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(to);
      return;
    }
    let raf = 0;
    const from = v;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // only re-run when the target moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, ms]);
  return v;
}

/** Types `text` out while `active` (about `cps` characters a second). Already-typed text stays. */
export function useTyped(text: string, active: boolean, cps = 140): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n > text.length) setN(text.length);
  }, [text.length, n]);
  useEffect(() => {
    if (!active || n >= text.length) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setN(text.length);
      return;
    }
    const t = window.setTimeout(() => setN((x) => Math.min(text.length, x + Math.max(3, Math.round(cps / 20)))), 50);
    return () => window.clearTimeout(t);
  }, [active, n, text.length, cps]);
  return text.slice(0, n);
}

/** Follows `value`, but changes at most once every `ms`; the latest value always lands in the end. */
export function useHeld<T>(value: T, ms: number): T {
  const [held, setHeld] = useState(value);
  const since = useRef(0);
  useEffect(() => {
    if (Object.is(value, held)) return;
    const wait = Math.max(0, since.current + ms - performance.now());
    const t = window.setTimeout(() => {
      since.current = performance.now();
      setHeld(value);
    }, wait);
    return () => window.clearTimeout(t);
  }, [value, held, ms]);
  return held;
}
