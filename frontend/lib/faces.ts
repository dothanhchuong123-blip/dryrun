/**
 * Pixel customers (DESIGN.md §12.6). A 20×20 face per shopper type, drawn in code with no image files.
 * Looks are fixed per archetype id so the same customer is the same person on every screen;
 * the expression comes from the crowd's lean toward you (μ_A).
 */
import type { CrowdArchetype } from "./events";

export const FACE_N = 20;
const INK = "#1B1A17";
const SKIN = ["#F6D7BE", "#E7B892", "#C48A62", "#A06A48", "#7A4E36"];
const HAIR = ["#2A211B", "#5B3A22", "#A8723B", "#D9B46A", "#8C8C8C", "#B5452E"];
const NAMES = ["Priya", "Marcus", "Dana", "Tom", "Lena", "Walt", "Jae", "Rosa", "Grace", "Omar", "Mei", "Frank"];
// one row per archetype slot: skin, hair colour, hair style, glasses
const LOOK: [number, number, number, number][] = [
  [0, 3, 1, 0], [3, 0, 0, 0], [1, 0, 3, 0], [4, 1, 4, 0], [2, 5, 2, 0], [0, 4, 5, 1],
  [2, 0, 6, 0], [1, 1, 3, 1], [3, 2, 1, 1], [4, 0, 0, 0], [0, 1, 2, 1], [2, 4, 5, 1],
];

export type Income = "Low" | "Mid" | "High";
export interface Shopper {
  slot: number;
  name: string;
  income: Income;
  hunter: boolean;
  loyal: "you" | "rival" | null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Reads "High-income · price-hunter · A-loyal" style labels; unknown labels still get a stable look. */
export function shopperOf(a: Pick<CrowdArchetype, "id" | "label">): Shopper {
  const l = a.label.toLowerCase();
  const slot = (Number.isInteger(a.id) && a.id >= 0 ? a.id : hash(a.label)) % LOOK.length;
  const income: Income = l.includes("high") ? "High" : l.includes("low") ? "Low" : "Mid";
  const loyal = /\ba-loyal|loyal to you/.test(l) ? "you" : /\bb-loyal|loyal to (the )?rival/.test(l) ? "rival" : null;
  return { slot, name: NAMES[slot], income, hunter: /price|hunter|budget|deal/.test(l), loyal };
}

/** Plain words for the label, no "A-loyal" jargon. */
export function traitLine(s: Shopper): string {
  const parts = [`${s.income.toLowerCase()} income`, s.hunter ? "deal hunter" : "steady"];
  if (s.loyal) parts.push(s.loyal === "you" ? "usually yours" : "usually the rival's");
  return parts.join(" · ");
}

/** Lean toward you in [-1, 1], from the crowd's μ for firm A. */
export function moodOf(a: Pick<CrowdArchetype, "mu">): number {
  return Math.max(-1, Math.min(1, (a.mu?.[0] ?? 0) * 1.2));
}
export function leanOf(a: Pick<CrowdArchetype, "mu">): -1 | 0 | 1 {
  const m = a.mu?.[0] ?? 0;
  return m > 0.02 ? 1 : m < -0.02 ? -1 : 0;
}

export interface Px {
  x: number;
  y: number;
  w: number;
  c: string;
}
export interface FaceArt {
  px: Px[]; // disc, outline, figure, features (row runs)
  eyes: { open: Px[]; shut: Px[] } | null; // blinkable eyes, when the face has plain open eyes
}

type Grid = (string | null)[][];
const grid = (): Grid => Array.from({ length: FACE_N }, () => Array<string | null>(FACE_N).fill(null));

/** Builds the pixels for one face. `bg` is the disc colour (any CSS colour, so tokens work). */
export function drawFace(s: Shopper, mood: number, bg: string): FaceArt {
  const F = grid(); // figure: gets an ink outline
  const X = grid(); // features on top
  const put = (G: Grid, x: number, y: number, c: string) => {
    if (x >= 0 && x < FACE_N && y >= 0 && y < FACE_N) G[y][x] = c;
  };
  const box = (G: Grid, x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(G, x, y, c);
  };
  const pts = (G: Grid, list: number[][], c: string) => list.forEach(([x, y]) => put(G, x, y, c));

  const [si, hi, style, gl] = LOOK[s.slot];
  const skin = SKIN[si];
  const hair = HAIR[hi];
  const glasses = gl === 1;
  const squint = s.hunter && !glasses;
  const shirt = s.income === "High" ? "#2F3442" : s.income === "Mid" ? "#5F8A6A" : "#C9A06A";

  if (style === 1) box(F, 3, 4, 16, 15, hair); // long hair falls behind
  box(F, 3, 17, 16, 19, shirt);
  box(F, 4, 16, 15, 16, shirt);
  if (s.income === "High") pts(F, [[9, 16], [10, 16], [9, 17], [10, 17]], "#FFFFFF");
  box(F, 8, 14, 11, 15, skin);
  box(F, 5, 4, 14, 13, skin);
  box(F, 6, 14, 13, 14, skin);
  pts(F, [[4, 9], [4, 10], [15, 9], [15, 10]], skin);
  const crop = () => {
    box(F, 5, 3, 14, 4, hair);
    pts(F, [[5, 5], [14, 5], [5, 6], [14, 6]], hair);
  };
  if (style === 0) crop();
  if (style === 1) {
    box(F, 5, 3, 14, 4, hair);
    pts(F, [[5, 5], [6, 5], [7, 5], [12, 5], [13, 5], [14, 5]], hair);
  }
  if (style === 2) {
    crop();
    box(F, 8, 0, 11, 2, hair);
  }
  if (style === 3) {
    box(F, 4, 3, 15, 5, hair);
    pts(F, [[5, 2], [6, 2], [9, 2], [10, 2], [13, 2], [14, 2], [4, 6], [4, 7], [15, 6], [15, 7], [5, 6], [14, 6]], hair);
  }
  if (style === 4) {
    crop();
    box(F, 5, 5, 9, 5, hair);
  }
  if (style === 5) pts(F, [[5, 6], [5, 7], [5, 8], [14, 6], [14, 7], [14, 8]], hair);
  if (style === 6) {
    box(F, 5, 2, 14, 4, "#3B4BDB");
    box(F, 4, 5, 17, 5, "#1E2A9C");
  }
  if (style === 5 || s.slot === 9) {
    box(F, 6, 11, 13, 14, hair);
    pts(F, [[5, 11], [5, 12], [14, 11], [14, 12]], hair);
  }
  if (s.loyal === "rival" && style !== 1 && style !== 2) pts(F, [[4, 11], [15, 11]], "#D9B46A");

  let open = false;
  if (glasses) {
    box(X, 6, 8, 8, 8, INK);
    box(X, 11, 8, 13, 8, INK);
    box(X, 6, 11, 8, 11, INK);
    box(X, 11, 11, 13, 11, INK);
    pts(X, [[9, 8], [10, 8]], INK);
    box(X, 6, 9, 8, 10, "#E4EEF6");
    box(X, 11, 9, 13, 10, "#E4EEF6");
  }
  if (mood > 0.55) pts(X, [[6, 10], [7, 9], [8, 10], [11, 10], [12, 9], [13, 10]], INK);
  else if (squint) pts(X, [[7, 9], [8, 9], [11, 9], [12, 9]], INK);
  else open = true;

  if (mood > 0.3) pts(X, [[6, 6], [7, 6], [12, 6], [13, 6]], INK);
  else if (mood < -0.55) pts(X, [[6, 7], [7, 6], [13, 7], [12, 6]], INK); // sad: inner ends up
  else if (mood < -0.15) pts(X, [[6, 6], [7, 7], [13, 6], [12, 7]], INK); // annoyed: inner ends down
  else pts(X, [[6, 7], [7, 7], [12, 7], [13, 7]], INK);

  if (mood > 0.55) {
    pts(X, [[7, 11], [12, 11], [7, 12], [12, 12]], INK);
    box(X, 8, 12, 11, 12, "#FFFFFF");
    box(X, 8, 13, 11, 13, INK);
  } else if (mood > 0.15) pts(X, [[7, 12], [8, 13], [9, 13], [10, 13], [11, 13], [12, 12]], INK);
  else if (mood < -0.55) pts(X, [[7, 13], [8, 12], [9, 12], [10, 12], [11, 12], [12, 13]], INK);
  else if (mood < -0.15) pts(X, [[8, 13], [9, 12], [10, 12], [11, 13]], INK);
  else box(X, 8, 12, 11, 12, INK);
  if (mood > 0.3) {
    const [l, r] = glasses ? [5, 14] : [6, 13];
    pts(X, [[l, 11], [r, 11]], "#EE9A8A");
  }
  if (mood < -0.55) pts(X, [[14, 10], [14, 11], [14, 12]], "#6FB0E8"); // a tear

  const inDisc = (x: number, y: number) => (x - 9.5) ** 2 + (y - 9.5) ** 2 <= 99;
  const px: Px[] = [];
  const runs = (cell: (x: number, y: number) => string | null) => {
    for (let y = 0; y < FACE_N; y++) {
      let x = 0;
      while (x < FACE_N) {
        const c = cell(x, y);
        if (!c) {
          x++;
          continue;
        }
        let w = 1;
        while (x + w < FACE_N && cell(x + w, y) === c) w++;
        px.push({ x, y, w, c });
        x += w;
      }
    }
  };
  runs((x, y) => (inDisc(x, y) ? bg : null));
  runs((x, y) => {
    if (!inDisc(x, y) || F[y][x]) return null;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => F[y + dy]?.[x + dx]) ? INK : null;
  });
  runs((x, y) => (inDisc(x, y) ? F[y][x] : null));
  runs((x, y) => X[y][x]);

  const eyes = open
    ? {
        open: [
          { x: 6, y: 9, w: 1, c: "#FFFFFF" }, { x: 6, y: 10, w: 1, c: "#FFFFFF" },
          { x: 13, y: 9, w: 1, c: "#FFFFFF" }, { x: 13, y: 10, w: 1, c: "#FFFFFF" },
          { x: 7, y: 9, w: 1, c: INK }, { x: 7, y: 10, w: 1, c: INK },
          { x: 12, y: 9, w: 1, c: INK }, { x: 12, y: 10, w: 1, c: INK },
        ],
        shut: [{ x: 7, y: 10, w: 2, c: INK }, { x: 11, y: 10, w: 2, c: INK }],
      }
    : null;
  return { px, eyes };
}
