/**
 * Kept so call sites stay unchanged. Steps no longer swap pages (that needed a root cross-fade):
 * they stack in one flow and the camera in follow.ts glides to the new one.
 */
export function withTransition(change: () => void, _direction: "forward" | "back" | "none" = "forward"): void {
  change();
}
