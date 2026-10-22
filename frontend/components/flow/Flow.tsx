"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { reducedMotion } from "../../lib/follow";
import { FILE_ACCEPT, MISSING, NEEDS_LIVE, REJECT_COPY, checkFile, fileSize, hasFiles } from "../../lib/files";
import type { MissingItem } from "../../lib/events";
import { formatDelta, formatPrice } from "../../lib/format";
import { useMarketStore } from "../../lib/store";
import { suggest } from "../../lib/suggest";
import { usePacer, useTimeline } from "../../lib/timeline";
import { ReplayDrawer } from "../replay/ReplayDrawer";
import { CustomerPreview } from "../faces/CustomerPreview";
import { PixelCrowd, PixelLogo } from "../faces/PixelFace";
import { ThemeToggle } from "./parts";
import { StageAnswer } from "./StageAnswer";
import { StageSearch } from "./StageSearch";
import { StageTest, shownFrom } from "./StageTest";
import { StageUnderstand, profileInvalid } from "./StageUnderstand";
import "./flow.css";
import "../faces/dryrun.css";

const STEPS = [
  { title: "Understand", sub: "your business" },
  { title: "Search the web", sub: "news that hits you" },
  { title: "Test plans", sub: "in possible futures" },
  { title: "Your answer", sub: "what to do" },
];
const AUTO_MS = 4000;
const SAMPLE_PLACEHOLDER = "e.g. I run a small bakery-café in Austin, Texas… or paste a link";
const LINK_PLACEHOLDER = "Paste your website, Google Maps, Facebook or Shopee link…";
const STARTERS: { label: string; text: string }[] = [
  { label: "Café", text: "I run a small café in " },
  { label: "Bakery", text: "I run a small bakery in " },
  { label: "Restaurant", text: "I run a small restaurant in " },
  { label: "Online shop", text: "I run a small online shop selling " },
  { label: "Clothing", text: "I run a small clothing shop in " },
  { label: "Salon", text: "I run a small hair salon in " },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2024-01-15" -> "Jan 2024" */
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`;
/** ["2024-01-15", "2025-03-25"] -> "2024–25" */
const yearSpan = (isos: string[]) => {
  const ys = isos.map((d) => Number(d.slice(0, 4)));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return lo === hi ? `${lo}` : `${lo}–${String(hi).slice(2)}`;
};
/** "2024-01-15" -> "15 January 2024" */
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${LONG_MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`;

const HOW = [
  { t: "Describe your business", d: "One line is enough, or paste a link. We guess the rest and mark it." },
  { t: "We search the news", d: "Tavily finds this week's news that actually hits your costs and customers." },
  { t: "An AI analyst proposes plans", d: "Nemotron suggests moves; a simulator stress-tests each across possible futures." },
  { t: "You get a decision memo", d: "The plan that holds up best, with the numbers and sources behind it." },
];

/** Critically damped spring scroll: glides to a target, gives way the moment the user scrolls. */
function useSpringScroll(scroller: React.RefObject<HTMLDivElement>) {
  const st = useRef({ tgt: null as number | null, vel: 0, raf: 0, last: 0, userAt: -1e9 });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mark = () => {
      st.current.userAt = performance.now();
      st.current.tgt = null;
    };
    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("touchstart", mark, { passive: true });
    el.addEventListener("keydown", mark);
    return () => {
      el.removeEventListener("wheel", mark);
      el.removeEventListener("touchstart", mark);
      el.removeEventListener("keydown", mark);
      cancelAnimationFrame(st.current.raf);
    };
  }, [scroller]);
  return useCallback(
    (target: number) => {
      const el = scroller.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      const goal = Math.max(0, Math.min(max, target));
      if (reducedMotion()) {
        el.scrollTop = goal;
        return;
      }
      const s = st.current;
      s.tgt = goal;
      if (s.raf) return;
      s.last = 0;
      const w = 7.5;
      const tick = (t: number) => {
        const dt = Math.min(0.05, s.last ? (t - s.last) / 1000 : 0.016);
        s.last = t;
        if (s.tgt == null) {
          s.raf = 0;
          s.vel = 0;
          return;
        }
        const x = el.scrollTop;
        const acc = w * w * (s.tgt - x) - 2 * w * s.vel;
        s.vel += acc * dt;
        const next = x + s.vel * dt;
        el.scrollTop = next;
        if (Math.abs(s.tgt - next) < 0.6 && Math.abs(s.vel) < 4) {
          el.scrollTop = s.tgt;
          s.tgt = null;
          s.raf = 0;
          s.vel = 0;
          return;
        }
        s.raf = requestAnimationFrame(tick);
      };
      s.raf = requestAnimationFrame(tick);
    },
    [scroller],
  );
}

/** Eases the stage container's height when the view inside it changes size. */
function useEasedHeight() {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current,
      i = inner.current;
    if (!o || !i) return;
    const ro = new ResizeObserver(() => {
      o.style.height = `${i.offsetHeight}px`;
    });
    ro.observe(i);
    o.style.height = `${i.offsetHeight}px`;
    return () => ro.disconnect();
  }, []);
  return { outer, inner };
}

export function Flow() {
  const s = useMarketStore();
  const p = s.profile;
  const scroller = useRef<HTMLDivElement>(null);
  const stepper = useRef<HTMLDivElement>(null);
  const glide = useSpringScroll(scroller);
  const { outer, inner } = useEasedHeight();
  const [view, setView] = useState(-1);
  const [reached, setReached] = useState(-1);
  const [auto, setAuto] = useState<boolean | null>(null); // null = follow the example
  const [autoLeft, setAutoLeft] = useState(AUTO_MS);
  const [sc, setSc] = useState<HTMLElement | null>(null);

  const beats = useTimeline();
  const finished = !!s.memo;
  const shownN = usePacer(beats, reached >= 2, view === 2 ? 1 : 3);
  const shown = shownFrom(beats, shownN, finished);

  useEffect(() => setSc(scroller.current), []);

  // a fresh run (Replay / logo / new business) brings the user back to the box
  useEffect(() => {
    if (s.analysis.status === "idle" && !p && s.profileStatus === "idle") {
      setView(-1);
      setReached(-1);
    }
  }, [s.analysis.status, p, s.profileStatus]);

  const go = useCallback((v: number) => {
    setView(v);
    setReached((r) => Math.max(r, v));
  }, []);

  // each new view: glide so the stepper sits at the top
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (view < 0) {
      glide(0);
      return;
    }
    const id = requestAnimationFrame(() => {
      const el = scroller.current,
        st = stepper.current;
      if (!el || !st) return;
      glide(el.scrollTop + st.getBoundingClientRect().top - el.getBoundingClientRect().top);
    });
    return () => cancelAnimationFrame(id);
  }, [view, glide]);

  // ---- the box ------------------------------------------------------------------------------------
  // a notification that slides in when the box is sent back for more (too little, or not about a business)
  const [toast, setToast] = useState<string | null>(null);
  const toastId = useRef(0);
  const notify = (msg: string) => {
    setToast(msg);
    const id = ++toastId.current;
    window.setTimeout(() => toastId.current === id && setToast(null), 6000);
  };
  useEffect(() => {
    if (s.profileReject) notify(REJECT_COPY[s.profileReject.code]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.profileReject]);
  const read = (text: string) => {
    // same free check as the server: no file and almost no letters -> stay home and say so, no screen change
    if (!s.profileFile && Array.from(text.replace(/https?:\/\/\S+/g, "")).filter((c) => /\p{L}/u.test(c)).length < 8) {
      notify(text.trim() && /https?:\/\//.test(text) ? REJECT_COPY.too_little : "There's almost nothing to read in that. Tell us what you sell and where.");
      return;
    }
    void s.parseProfile(text);
    go(0);
  };
  const pickExample = (id: string) => {
    const ex = s.examples.find((e) => e.id === id);
    if (!ex) return;
    s.pickExample(id);
    void useMarketStore.getState().parseProfile(ex.text);
    go(0);
  };
  const pickBacktest = (id: string) => {
    void s.pickBacktest(id);
    go(0);
  };
  const restart = () => {
    const text = useMarketStore.getState().profileText;
    s.reset();
    useMarketStore.getState().setProfileText(text);
    setView(-1);
    setReached(-1);
  };
  const up = view >= 0;
  const [showFull, setShowFull] = useState(false);
  const exReplay = !!s.examples.find((e) => e.id === (s.exampleId ?? s.analysis.exampleId))?.has_replay || s.analysis.mode === "replay";
  const autoEff = auto ?? exReplay;
  const [linkMode, setLinkMode] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const placeholder = linkMode ? LINK_PLACEHOLDER : SAMPLE_PLACEHOLDER;
  const showChips = !s.profileText.trim() || STARTERS.some((c) => c.text === s.profileText);
  const pickStarter = (text: string | null) => {
    setLinkMode(text === null);
    s.setProfileText(text ?? "");
    window.setTimeout(() => {
      const el = boxRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  };
  const offline = s.backend === "mock";

  // ---- ghost text: Tab fills in the next missing fact, then the suggestion cycles on ---------------
  const [focused, setFocused] = useState(false);
  const ghostRef = useRef<HTMLDivElement>(null);
  const ghost = focused && !linkMode && !/https?:\/\/|www\./i.test(s.profileText) ? suggest(s.profileText) : null;
  const acceptGhost = () => {
    if (!ghost) return;
    s.setProfileText(s.profileText + ghost.add);
    window.setTimeout(() => {
      const el = boxRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  };

  // ---- files: drop, pick or paste one into the box ------------------------------------------------
  const [dragging, setDragging] = useState(false);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const attach = (f: File | null | undefined) => {
    if (!f) return;
    const bad = checkFile(f);
    if (bad) {
      setFileMsg(bad);
      return;
    }
    setFileMsg(useMarketStore.getState().backend === "mock" ? NEEDS_LIVE : null);
    s.setProfileFile(f);
  };
  const dropFile = (f: File | null | undefined) => {
    setDragging(false);
    attach(f);
  };
  // a file dropped anywhere else must not make the browser open it
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);
  const addMissing = (m: MissingItem) => {
    const cur = useMarketStore.getState().profileText;
    s.setProfileText(cur + (cur && !/\s$/.test(cur) && !MISSING[m].phrase.startsWith(" ") && !MISSING[m].phrase.startsWith(",") ? " " : "") + MISSING[m].phrase);
    window.setTimeout(() => {
      const el = boxRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  };
  const file = s.profileFile;
  const canGo = (!!s.profileText.trim() || !!file) && s.profileStatus !== "reading";

  // ---- gates --------------------------------------------------------------------------------------
  const frontier = view === reached;
  const nNews = s.news.length,
    nShocks = s.shocks.length;
  let gate: { title: string; sub: string; btn: string; ready: boolean; act: () => void; autoOk: boolean; ms: number; hero?: string; gain?: string } | null = null;
  if (view >= 0 && !frontier) {
    gate = { title: `Looking back at “${STEPS[view].title}”`, sub: "Nothing is lost. The run keeps going.", btn: `Back to ${STEPS[reached].title}`, ready: true, act: () => setView(reached), autoOk: false, ms: AUTO_MS };
  } else if (view === 0) {
    const ok = !!p && s.profileStatus === "ready" && !profileInvalid(p) && s.analysis.status !== "starting";
    gate = {
      title: ok ? "Does this look right?" : s.profileStatus === "error" ? "We could not read that" : "Reading your business…",
      sub: ok ? "Change any number above. Next, Tavily searches this week's news." : (s.profileError ?? s.analysis.note ?? "Nemotron Super is pulling out the numbers."),
      btn: "Search the web",
      ready: ok,
      act: () => {
        // a real case is already running: it started when its card was picked
        if (!s.analysis.backtestId) void s.startAnalysis();
        go(1);
      },
      autoOk: exReplay,
      ms: 1200,
    };
  } else if (view === 1) {
    const ok = nShocks > 0;
    gate = {
      title: ok ? `Read ${nNews} articles · ${nShocks} futures to test` : nNews ? "Picking the futures to test…" : "Searching the web…",
      sub: ok ? "Next, Nemotron proposes plans and the simulator tests each one 1,000 times." : s.analysis.status === "error" ? (s.analysis.note ?? "Something went wrong.") : "Tavily is reading the news. Take a look while it works.",
      btn: "Test plans",
      ready: ok,
      act: () => go(2),
      autoOk: true,
      ms: exReplay ? 2500 : AUTO_MS,
    };
  } else if (view === 2) {
    const ok = shown.done;
    const nPlans = shown.plans.size;
    const best = s.summary?.best_today ?? s.memo?.plan_name ?? "";
    const d = s.memo?.numbers.mean_delta_usd;
    gate = {
      title: ok ? `Tested ${nPlans} plans in ${nShocks} futures` : `Testing plans… ${nPlans ? `${nPlans} so far` : ""}`,
      sub: ok ? "Hover any box in the grid to see why." : "Watch the analyst think, the shoppers react and the grid fill in.",
      hero: ok && best ? best : undefined,
      gain: ok && d != null && Number.isFinite(d) ? `${formatDelta(d)} vs doing nothing` : undefined,
      btn: "See your answer",
      ready: ok,
      act: () => go(3),
      autoOk: true,
      ms: exReplay ? 9000 : AUTO_MS,
    };
  }

  // auto-continue: a gate that is ready moves on by itself after a few seconds
  const gateMs = gate?.ms ?? AUTO_MS;
  const autoOn = autoEff && !!gate?.ready && !!gate.autoOk && frontier;
  const gateAct = gate?.act;
  useEffect(() => {
    if (!autoOn || !gateAct) {
      setAutoLeft(gateMs);
      return;
    }
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const left = gateMs - (performance.now() - t0);
      setAutoLeft(Math.max(0, left));
      if (left <= 0) {
        window.clearInterval(id);
        gateAct();
      }
    }, 100);
    return () => window.clearInterval(id);
    // restart the countdown only when the gate itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOn, view]);

  // ---- stepper state ------------------------------------------------------------------------------
  const stepState = (i: number) => {
    if (i > reached) return "todo";
    if (i < reached || (i === 3 && s.memo)) return "done";
    return gate?.ready ? "wait" : "live";
  };
  const progress = (i: number) => {
    if (i < reached) return 100;
    if (i > reached) return 0;
    if (i === 0) return p ? 100 : 40;
    if (i === 1) return Math.min(100, (nNews ? 50 : 15) + (nShocks ? 50 : 0));
    if (i === 2) return beats.length ? Math.round((100 * shownN) / Math.max(beats.length, 24)) : 5;
    return 100;
  };

  const calls = s.telemetry ? s.telemetry.tiers.ultra.calls + s.telemetry.tiers.super.calls + s.telemetry.tiers.fast.calls : 0;
  const modeLabel = offline
    ? "OFFLINE DEMO"
    : s.analysis.mode === "live"
      ? "LIVE"
      : s.analysis.backtestId
        ? "REAL CASE REPLAY"
        : s.exampleId || s.analysis.mode === "replay"
          ? "EXAMPLE REPLAY"
          : null;

  return (
    <div className="fl">
      {toast && (
        <div className="fl-toast" role="alert">
          <span>{toast}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
        </div>
      )}
      <header className="fl-top">
        <button type="button" className="fl-logo" onClick={restart} aria-label="Dry Run, start over">
          <PixelLogo />
          Dry Run
        </button>
        {p && (
          <span className="fl-biz">
            <b>{p.business_name}</b>
          </span>
        )}
        {modeLabel && (
          <span className={`fl-mode${s.analysis.mode === "live" && !offline ? " live" : ""}`} title={s.analysis.note ?? undefined}>
            {modeLabel}
          </span>
        )}
        <span className="fl-sp" />
        {calls > 0 && s.telemetry && (
          <span className="fl-cred" title="Counted from this run's call log">
            <b>{calls}</b> Nemotron calls · <b>${s.telemetry.cost_usd.toFixed(2)}</b>
          </span>
        )}
        <button type="button" role="switch" aria-checked={autoEff} aria-label="Auto-continue" className="fl-auto" onClick={() => setAuto(!autoEff)}>
          <span className="fl-sw" aria-hidden />
          <span className="l">Auto-continue</span>
        </button>
        <ThemeToggle />
      </header>

      {up && s.analysis.asOf && (
        <div className="bt-banner" role="status">
          <b>Replaying {longDate(s.analysis.asOf)}.</b> Dry Run only sees news from before this date.
        </div>
      )}

      <div className="fl-scroll" ref={scroller}>
        <main className="fl-main">
          <div className={`fl-hero${up ? " up" : ""}`} style={{ paddingTop: up ? 8 : "min(6vh, 48px)" }}>
            <h1>
              Try your plan on <em>200 customers</em> before you try it on real ones.
            </h1>
            <p>Describe your business. We find the news that hits it, test a few plans against good and bad futures, and tell you which one holds up.</p>
            {!up && s.backtests.length > 0 && (
              <button type="button" className="bt-proof" onClick={() => document.getElementById("real-cases")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                <span className="bt-chip">Backtested</span> Checked on {s.backtests.length} real cases from {yearSpan(s.backtests.map((b) => b.as_of))}: see what it said, then what really happened ↓
              </button>
            )}
          </div>

          {!up && (
            <div className="px-field">
              <PixelCrowd />
              <span className="lbl a">Your shop</span>
              <span className="lbl b">The rival</span>
            </div>
          )}

          <div
            className={`fl-box${up ? " up" : ""}${dragging ? " drag" : ""}`}
            onDragOver={(e) => {
              if (up || !hasFiles(e)) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              if (up || !hasFiles(e)) return;
              e.preventDefault();
              dropFile(e.dataTransfer.files[0]);
            }}
          >
            {dragging && <div className="fl-dropveil">Drop your file</div>}
            {up ? (
              <div className="fl-sum">
                <div className="head">
                  <b>{p ? p.business_name : "Your business"}</b>
                  <span className="sp" />
                  <button type="button" className="fl-btn2" onClick={restart}>
                    Edit
                  </button>
                </div>
                {p ? (
                  <div className="chips">
                    {[
                      p.country && ["Where", p.country.replace(/\b\w/g, (c) => c.toUpperCase())],
                      p.product_unit && ["Sells", p.product_unit],
                      ["Price → cost", `${formatPrice(p.price)} → ${formatPrice(p.unit_cost)}`],
                      ["Weekly sales", p.weekly_sales.toLocaleString("en-US")],
                      p.rival_name && ["Rival", `${p.rival_name} at ${formatPrice(p.rival_price)}`],
                    ]
                      .filter((c): c is string[] => Array.isArray(c))
                      .map(([k, v]) => (
                        <span className="chip" key={k}>
                          <small>{k}</small>
                          {v}
                        </span>
                      ))}
                  </div>
                ) : (
                  <p className="trunc">{s.profileText}</p>
                )}
                {p && !s.analysis.backtestId && (
                  <>
                    <button type="button" className="more" aria-expanded={showFull} onClick={() => setShowFull((v) => !v)}>
                      {showFull ? "Hide full text" : "Show full text"}
                    </button>
                    {showFull && <p className="full">{s.profileText}</p>}
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="fl-ta">
                  {ghost && (
                    <div className="fl-ghost" ref={ghostRef} aria-hidden>
                      <span className="t">{s.profileText}</span>
                      <span className="g">{ghost.add}</span>
                    </div>
                  )}
                  <textarea
                    ref={boxRef}
                    aria-label="Describe your business"
                    rows={4}
                    value={s.profileText}
                    onChange={(e) => s.setProfileText(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onScroll={(e) => {
                      if (ghostRef.current) ghostRef.current.scrollTop = e.currentTarget.scrollTop;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) read(s.profileText);
                      else if (e.key === "Tab" && !e.shiftKey && ghost && e.currentTarget.selectionStart === s.profileText.length) {
                        e.preventDefault();
                        acceptGhost();
                      }
                    }}
                    placeholder={placeholder}
                    onPaste={(e) => {
                      const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
                      if (img) {
                        e.preventDefault();
                        attach(img);
                      }
                    }}
                  />
                  {ghost && (
                    <button type="button" className="fl-tab" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={acceptGhost} aria-label="Accept suggestion">
                      <kbd>Tab</kbd> {MISSING[ghost.item].label.toLowerCase()}
                    </button>
                  )}
                </div>
                {file && (
                  <div className="fl-file" role="group" aria-label="Attached file">
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                      <path d="M3 1h7l3 3v11H3z M10 1v3h3" stroke="currentColor" strokeWidth="1.6" fill="none" />
                    </svg>
                    <span className="nm" title={file.name}>{file.name}</span>
                    <small>{fileSize(file.size)}</small>
                    <button type="button" aria-label="Remove file" onClick={() => { s.setProfileFile(null); setFileMsg(null); }}>×</button>
                  </div>
                )}
                <div className="fl-boxbar">
                  <span>One line is enough: we guess the rest and mark it. Or paste your website, Google Maps or shop link · <kbd>⌘</kbd> <kbd>Enter</kbd> to start</span>
                  <input
                    ref={picker}
                    type="file"
                    hidden
                    accept={FILE_ACCEPT}
                    onChange={(e) => {
                      attach(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" className="fl-clip" aria-label="Attach a file: PDF, photo or text" title="Attach a PDF, photo or text file" onClick={() => picker.current?.click()}>
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                      <path d="M11 5.5 6.2 10.3a1.4 1.4 0 0 0 2 2L13 7.5a3 3 0 0 0-4.2-4.2L3.9 8.2a4.5 4.5 0 0 0 6.4 6.4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button type="button" className="fl-btn" disabled={s.profileStatus === "reading"} onClick={() => read(s.profileText)}>
                    Test my business
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
                {showChips && (
                  <div className="fl-starters" role="group" aria-label="Quick starts">
                    {STARTERS.map((c) => (
                      <button key={c.label} type="button" className="fl-starter" aria-pressed={s.profileText === c.text} onClick={() => pickStarter(c.text)}>
                        {c.label}
                      </button>
                    ))}
                    <button type="button" className="fl-starter link" onClick={() => pickStarter(null)}>
                      My shop&apos;s link
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {!up && s.backtests.length > 0 && (
            <div className="fl-ex bt-ex" id="real-cases">
              <p>Real cases: would it have helped? We replay a past date with only the news from before it, then check the advice against what really happened.</p>
              <div className="fl-exg">
                {s.backtests.map((b) => (
                  <button key={b.id} type="button" className="fl-exb bt-card" onClick={() => pickBacktest(b.id)}>
                    <span className="bt-chip">{monthYear(b.as_of)}</span>
                    <b>{b.title}</b>
                    <span>{b.subtitle}</span>
                    <small>Replay this date →</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {!up && s.examples.length > 0 && (
            <div className="fl-ex">
              <p>No business in mind? Pick one. One click runs it end to end, free.</p>
              <div className="fl-exg">
                {s.examples.map((e) => {
                  // offline, only recorded examples have data; the others would replay someone else's run
                  const blocked = offline && !e.has_replay;
                  return (
                    <button key={e.id} type="button" className="fl-exb" disabled={blocked} onClick={() => pickExample(e.id)}>
                      <b>{e.title}</b>
                      <span>{e.subtitle}</span>
                      <small className={e.has_replay ? undefined : "live"}>{e.has_replay ? "Run this example →" : blocked ? "Needs the live server" : "Runs live · about 2 min"}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!up && file && <p className="fl-keepnote">We read it once and don&apos;t keep it.</p>}
          {!up && (fileMsg || s.profileReject) && (
            <div className="fl-note" role="status">
              <p>{fileMsg ?? REJECT_COPY[s.profileReject!.code]}</p>
              {!fileMsg && s.profileReject!.code === "too_little" && s.profileReject!.missing.length > 0 && (
                <div className="miss">
                  {s.profileReject!.missing.map((m) => (
                    <button key={m} type="button" className="fl-starter" onClick={() => addMissing(m)}>
                      + {MISSING[m].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!up && s.profileError && <p className="fl-err">{s.profileError}</p>}

          {!up && <CustomerPreview />}

          {!up && (
            <ol className="fl-how" aria-label="How it works">
              {HOW.map((h, i) => (
                <li key={h.t}>
                  <span className="n">{i + 1}</span>
                  <b>{h.t}</b>
                  <small>{h.d}</small>
                </li>
              ))}
            </ol>
          )}


          {up && (
            <div className="fl-stepper" ref={stepper}>
              <ol className="fl-steps" aria-label="Steps">
                {STEPS.map((st, i) => {
                  const state = stepState(i);
                  return (
                    <li key={st.title}>
                      <button
                        type="button"
                        className={`fl-step ${state}${view === i ? " view" : ""}`}
                        disabled={i > reached}
                        aria-current={view === i ? "step" : undefined}
                        onClick={() => setView(i)}
                      >
                        <span className="n">{state === "done" ? "✓" : i + 1}</span>
                        <span className="t">
                          <b>{st.title}</b>
                          <small>{state === "wait" ? "ready · your turn" : state === "live" ? "working…" : st.sub}</small>
                        </span>
                        <span className="bar" style={{ width: `${progress(i)}%` }} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <div className="fl-grow" ref={outer}>
            <div ref={inner}>
              {view === 0 && <StageUnderstand key="v0" />}
              {view === 1 && <StageSearch key="v1" />}
              {view === 2 && <StageTest key="v2" shown={shown} active={view === 2} scroller={sc} />}
              {view === 3 && <StageAnswer key="v3" onRestart={restart} />}
            </div>
          </div>

        </main>
      </div>

      {gate && (
        <div className="fl-bar">
          <div className="fl-barin" key={`${view}-${frontier}`}>
            <div className="tx" aria-live="polite">
              <b>{gate.title}</b>
              {gate.hero && (
                <span className="best">
                  Best plan: <em>{gate.hero}</em>
                  {gate.gain && <i>{gate.gain}</i>}
                </span>
              )}
              <span>{gate.sub}</span>
            </div>
            {!gate.ready && (
              <span className="wait">
                <span className="fl-spin" />
              </span>
            )}
            <button type="button" className="go" disabled={!gate.ready} onClick={gate.act}>
              {gate.btn}
              {autoOn ? ` · ${Math.ceil(autoLeft / 1000)}` : ""}
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {autoOn && <span className="fill" style={{ width: `${100 * (1 - autoLeft / gateMs)}%` }} />}
            </button>
          </div>
        </div>
      )}

      {s.replay.open && (
        <>
          <div className="scrim" onClick={s.closeReplay} />
          <aside className="drawer" role="dialog" aria-label="Replay one plan">
            <ReplayDrawer />
          </aside>
        </>
      )}
    </div>
  );
}
