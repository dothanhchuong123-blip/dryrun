/**
 * Gentle auto-scroll: brings the next thing the user should look at into view, unless they have
 * scrolled or typed since the reveal started (then they are in charge and we leave the page alone).
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

/** Scrolls `el` into view if it is not fully visible and the user has not moved since `since`. */
export function follow(el: Element | null | undefined, since: number, block: ScrollLogicalPosition = "nearest"): boolean {
  if (!el || lastUserMove > since) return false;
  const r = el.getBoundingClientRect();
  const main = el.closest("main");
  const top = main ? main.getBoundingClientRect().top : 0;
  const bottom = main ? main.getBoundingClientRect().bottom : window.innerHeight;
  if (r.top >= top && r.bottom <= bottom) return true;
  el.scrollIntoView({ block, behavior: reducedMotion() ? "auto" : "smooth" });
  return true;
}
