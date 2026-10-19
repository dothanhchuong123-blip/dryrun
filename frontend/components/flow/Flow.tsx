"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { reducedMotion } from "../../lib/follow";
import { useMarketStore } from "../../lib/store";
import { usePacer, useTimeline } from "../../lib/timeline";
import { ReplayDrawer } from "../replay/ReplayDrawer";
import { Logo, ThemeToggle } from "./parts";
import { StageAnswer } from "./StageAnswer";
import { StageSearch } from "./StageSearch";
import { StageTest, shownFrom } from "./StageTest";
import { StageUnderstand, profileInvalid } from "./StageUnderstand";
import "./flow.css";

const STEPS = [
  { title: "Understand", sub: "your business" },
  { title: "Search the web", sub: "news that hits you" },
  { title: "Test plans", sub: "in possible futures" },
  { title: "Your answer", sub: "what to do" },
];
const AUTO_MS = 4000;

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
  const [auto, setAuto] = useState(false);
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
  const read = (text: string) => {
    if (!text.trim()) return;
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
  const restart = () => {
    const text = useMarketStore.getState().profileText;
    s.reset();
    useMarketStore.getState().setProfileText(text);
    setView(-1);
    setReached(-1);
  };
  const up = view >= 0;

  // ---- gates --------------------------------------------------------------------------------------
  const frontier = view === reached;
  const nNews = s.news.length,
    nShocks = s.shocks.length;
  let gate: { title: string; sub: string; btn: string; ready: boolean; act: () => void; autoOk: boolean } | null = null;
  if (view >= 0 && !frontier) {
    gate = { title: `Looking back at “${STEPS[view].title}”`, sub: "Nothing is lost. The run keeps going.", btn: `Back to ${STEPS[reached].title}`, ready: true, act: () => setView(reached), autoOk: false };
  } else if (view === 0) {
    const ok = !!p && s.profileStatus === "ready" && !profileInvalid(p) && s.analysis.status !== "starting";
    gate = {
      title: ok ? "Does this look right?" : s.profileStatus === "error" ? "We could not read that" : "Reading your business…",
      sub: ok ? "Change any number above. Next, Tavily searches this week's news." : (s.profileError ?? s.analysis.note ?? "Nemotron Super is pulling out the numbers."),
      btn: "Search the web",
      ready: ok,
      act: () => {
        void s.startAnalysis();
        go(1);
      },
      autoOk: !!s.exampleId,
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
    };
  } else if (view === 2) {
    const ok = shown.done;
    const nPlans = shown.plans.size;
    gate = {
      title: ok ? `Tested ${nPlans} plans in ${nShocks} futures` : `Testing plans… ${nPlans ? `${nPlans} so far` : ""}`,
      sub: ok ? `Best today: ${s.summary?.best_today ?? s.memo?.plan_name ?? ""}. Hover any box to see why.` : "Watch the analyst think, the shoppers react and the grid fill in.",
      btn: "See your answer",
      ready: ok,
      act: () => go(3),
      autoOk: true,
    };
  }

  // auto-continue: a gate that is ready moves on by itself after a few seconds
  const autoOn = auto && !!gate?.ready && !!gate.autoOk && frontier;
  const gateAct = gate?.act;
  useEffect(() => {
    if (!autoOn || !gateAct) {
      setAutoLeft(AUTO_MS);
      return;
    }
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const left = AUTO_MS - (performance.now() - t0);
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
  const offline = s.backend === "mock";
  const modeLabel = offline ? "OFFLINE DEMO" : s.analysis.mode === "live" ? "LIVE" : s.exampleId || s.analysis.mode === "replay" ? "EXAMPLE REPLAY" : null;

  return (
    <div className="fl">
      <header className="fl-top">
        <button type="button" className="fl-logo" onClick={restart} aria-label="Market Twin, start over">
          <Logo />
          Market Twin
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
        <button type="button" role="switch" aria-checked={auto} aria-label="Auto-continue" className="fl-auto" onClick={() => setAuto((a) => !a)}>
          <span className="fl-sw" aria-hidden />
          <span className="l">Auto-continue</span>
        </button>
        <ThemeToggle />
      </header>

      <div className="fl-scroll" ref={scroller}>
        <main className="fl-main">
          <div className={`fl-hero${up ? " up" : ""}`} style={{ paddingTop: up ? 8 : "min(12vh, 110px)" }}>
            <h1>Let&apos;s test your business</h1>
            <p>Tell us what you sell. We find the news that hits it, test a few plans against good and bad futures, and tell you which one holds up.</p>
          </div>

          <div className={`fl-box${up ? " up" : ""}`}>
            {up ? (
              <div className="fl-said">
                <span className="q" aria-hidden>
                  You
                </span>
                <p>{s.profileText}</p>
                <button type="button" className="fl-btn2" onClick={restart}>
                  Edit
                </button>
              </div>
            ) : (
              <>
                <textarea
                  aria-label="Describe your business"
                  rows={4}
                  value={s.profileText}
                  onChange={(e) => s.setProfileText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) read(s.profileText);
                  }}
                  placeholder="e.g. I roast coffee in Ho Chi Minh City and sell about 280 bags a week to cafés at $11 a bag. Beans cost me about $6.50 a bag…"
                />
                <div className="fl-boxbar">
                  <span>Helps to include: what you sell, your price, your cost, your main rival</span>
                  <button type="button" className="fl-btn" disabled={!s.profileText.trim() || s.profileStatus === "reading"} onClick={() => read(s.profileText)}>
                    Test my business
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>

          {!up && s.examples.length > 0 && (
            <div className="fl-ex">
              <p>Or start from a real example. It replays instantly and costs nothing.</p>
              <div className="fl-exg">
                {s.examples.map((e) => (
                  <button key={e.id} type="button" className="fl-exb" onClick={() => pickExample(e.id)}>
                    <b>{e.title}</b>
                    <span>{e.subtitle}</span>
                    {e.has_replay && <small>Instant replay</small>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!up && s.profileError && <p className="fl-err">{s.profileError}</p>}

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

          {gate && (
            <div className="fl-gate">
              <div className="fl-gatein" key={`${view}-${frontier}`}>
                <div className="tx" aria-live="polite">
                  <b>{gate.title}</b>
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
                  {autoOn && <span className="fill" style={{ width: `${100 * (1 - autoLeft / AUTO_MS)}%` }} />}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

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
