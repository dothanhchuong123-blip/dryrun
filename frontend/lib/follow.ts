/**
 * Gentle auto-scroll: brings the next thing the user should look at into view, unless they have
 * scrolled or typed since the reveal started (then they are in charge and we leave the page alone).
 *
 * All calls feed one "camera": a single rAF loop eases the scroll position toward the latest target,
 * so a run of reveals reads as one continuous glide instead of a series of separate jumps.
 */
let lastUserMove = 0;
if (typeof window !== "undefined") {
  const mark = () => {
    lastUserMove = performance.now();
  };
  for (const ev of ["wheel", "touchmove", "keydown"]) window.addEventListener(ev, mark, { passive: true, capture: true });
}

export const now = (): number => (typeof performance === "undefined" ? 0 : performance.now());

export const reducedMotion = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** breathing room kept between a revealed element and the edge of the view (px) */
const PAD = 28;
/** time constant of the glide (ms): about 3× this to settle */
const TAU = 420;

let scroller: HTMLElement | null = null;
let target = 0;
let raf = 0;
let last = 0;
let startedAt = 0;

function scrollerOf(el: Element): HTMLElement {
  const main = el.closest("main");
  if (main && getComputedStyle(main).overflowY !== "visible") return main as HTMLElement;
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

function viewOf(s: HTMLElement): { top: number; bottom: number } {
  if (s === document.scrollingElement || s === document.documentElement) return { top: 0, bottom: window.innerHeight };
  const r = s.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom };
}

function tick(t: number) {
  const s = scroller;
  if (!s || lastUserMove > startedAt) {
    raf = 0;
    return;
  }
  const dt = Math.min(64, t - (last || t));
  last = t;
  const max = s.scrollHeight - s.clientHeight;
  const goal = Math.max(0, Math.min(max, target));
  const cur = s.scrollTop;
  const d = goal - cur;
  if (Math.abs(d) < 0.5) {
    s.scrollTop = goal;
    raf = 0;
    return;
  }
  s.scrollTop = cur + d * (1 - Math.exp(-dt / TAU));
  raf = requestAnimationFrame(tick);
}

/** Glides `el` into view if it is not fully visible and the user has not moved since `since`. */
export function follow(el: Element | null | undefined, since: number, block: "nearest" | "center" | "start" = "nearest"): boolean {
  if (!el || lastUserMove > since) return false;
  const s = scrollerOf(el);
  const v = viewOf(s);
  const r = el.getBoundingClientRect();
  if (r.top >= v.top && r.bottom <= v.bottom - (block === "nearest" ? PAD : 0)) return true;
  let delta = 0;
  if (block === "start") delta = r.top - v.top - PAD;
  else if (block === "center") delta = (r.top + r.bottom) / 2 - (v.top + v.bottom) / 2;
  else if (r.bottom > v.bottom - PAD) delta = Math.min(r.bottom - (v.bottom - PAD), r.top - v.top - PAD);
  else if (r.top < v.top) delta = r.top - v.top - PAD;
  if (Math.abs(delta) < 1) return true;
  if (reducedMotion()) {
    s.scrollTop += delta;
    return true;
  }
  // retarget the running glide; a "nearest" follow never pulls the camera back from where it is heading
  const goal = s.scrollTop + delta;
  target = raf && scroller === s && block === "nearest" && delta > 0 ? Math.max(target, goal) : goal;
  scroller = s;
  if (!raf) {
    startedAt = now();
    last = 0;
    raf = requestAnimationFrame(tick);
  }
  return true;
}
