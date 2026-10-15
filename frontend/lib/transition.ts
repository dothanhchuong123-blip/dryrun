import { flushSync } from "react-dom";

/** Runs a state change inside a View Transition when the browser has them (and the user allows motion). */
export function withTransition(change: () => void, direction: "forward" | "back" | "none" = "forward"): void {
  type VT = { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduce) {
    change();
    return;
  }
  document.documentElement.dataset.dir = direction === "forward" ? "" : direction;
  const vt = doc.startViewTransition(() => flushSync(change));
  // a transition skipped by a quick second click rejects these promises; that is not an error
  for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p?.catch(() => undefined);
}
