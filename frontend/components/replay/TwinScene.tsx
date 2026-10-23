"use client";

import { useEffect, useRef, useState } from "react";
import type { TickEventData } from "../../lib/events";
import { formatPrice } from "../../lib/format";
import { reducedMotion } from "../../lib/follow";
import type { Shopper } from "../../lib/faces";
import { PixelFace } from "../faces/PixelFace";

/**
 * One pixel world (DESIGN §12.6): the blue field, your shop, the rival's shop and 60 pixel customers.
 * Two of these sit side by side (do nothing / with the plan). Both use the same seed, so every person
 * has the same rank and the same spot in both worlds; they only stand in different places where the
 * futures differ. Customers are split by the week's `shares`; the people who switch walk over in whole
 * pixels and flash amber on the way. Everything that moves lives in refs; React only re-renders the tags.
 *
 * The answer page turns on three extras (mockup D9), each only when its prop is given:
 * `twin` (the other world's same week) lights up the shoppers the plan wins and dims the rest of the crowd;
 * `cashMax` adds a cash jar that coins fly into, on one scale shared by both worlds;
 * `baseCost` (the pre-news unit cost) adds a cost gauge and a delivery truck on the road whenever stock lands,
 * and brings the shops to life: shoppers pop in and out of the door, the chimney smokes, the price board flips
 * when the price moves, and a sold-out shop pulls its shutter down while visitors walk away puzzled.
 * `voice` puts one shopper's real crowd quote in a speech bubble over their side of the crowd.
 */
const NC = 60;
const FLASH = "#FFE066";
const RIVAL_FAN = "#F5A25D";
const GOLD = "#FFD23F";
const LOSS = "#FF7A6B";
const GAIN = "#5FD08A";
const STEP_PX = 4; // whole pixels per frame
const FRAME_MS = 60;
const ROAD_H = 11;
const JAR_W = 12;
const COST_BAR = 0.02; // one gauge bar per 2% on your unit cost

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same 60 people every time: a stratified rank (so shares come out exact) and a spot in the unit disc. */
const PEOPLE = (() => {
  const rnd = mulberry32(20261020);
  const perm = Array.from({ length: NC }, (_, i) => i);
  for (let i = NC - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm.map((p) => {
    const ang = rnd() * Math.PI * 2;
    const rad = Math.sqrt(rnd());
    return { rank: (p + 0.5) / NC, u: Math.cos(ang) * rad, v: Math.sin(ang) * rad };
  });
})();

type Group = 0 | 1 | 2; // 0 you, 1 rival, 2 not buying
const groupOf = (rank: number, s: [number, number, number]): Group => {
  const tot = s[0] + s[1] + s[2] || 1;
  const a = s[0] / tot;
  const b = a + s[1] / tot;
  return rank < a ? 0 : rank < b ? 1 : 2;
};

/** How many of the 60 buy from you here but not in the twin world (won), and the other way round (lost). */
export function switchers(tick: TickEventData | undefined, twin: TickEventData | undefined) {
  let won = 0;
  let lost = 0;
  if (!tick || !twin) return { won, lost };
  for (const p of PEOPLE) {
    const g = groupOf(p.rank, tick.shares);
    const t = groupOf(p.rank, twin.shares);
    if (g === 0 && t !== 0) won++;
    else if (g !== 0 && t === 0) lost++;
  }
  return { won, lost };
}

/** mark: 1 = buys from you only in this world (glows), 2 = buys from you only in the twin world (ring) */
interface Person {
  g: Group;
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
  mark: 0 | 1 | 2;
  trail: number[];
  popped: boolean;
  hx: number; // their spot in the group; idle shoppers mill around it
  hy: number;
  idle: boolean; // a small idle step, not a switch
}
interface Geo {
  P: number;
  W: number;
  H: number;
  top: number; // shop top row
  road: number; // road top row (= H when there is no road)
  jar: { x: number; y: number; h: number } | null;
}
interface Coin {
  t: number;
  up: boolean; // true: door -> jar, false: jar -> road (a losing week)
}

/** Where each group stands: under your shop, under the rival's, and loosely in the middle. */
const homes = (g: Geo): Record<Group, { x: number; y: number; rx: number; ry: number }> => {
  const y0 = g.top + 46;
  const bottom = g.road - 3;
  const cy = (y0 + bottom) / 2;
  const ry = Math.max(4, (bottom - y0) / 2);
  return {
    0: { x: g.W * 0.25, y: cy, rx: g.W * 0.17, ry },
    1: { x: g.W * 0.75, y: cy, rx: g.W * 0.17, ry },
    2: { x: g.W * 0.5, y: cy, rx: g.W * 0.1, ry },
  };
};
/** A shopper who walks to a door and goes in, or turns back with a "?" when the shop has sold out. */
interface Visitor {
  shop: 0 | 1;
  x: number;
  y: number;
  hx: number;
  hy: number;
  back: number; // 0 while walking in; frames left of walking back puzzled
}

const isSoldOut = (t: TickEventData, i: 0 | 1) => t.unmet[i] > 0.5 || t.cover_weeks[i] < 0.05;
const costPct = (t: TickEventData | undefined, base: number | undefined) => (t && base && base > 0 ? t.unit_cost[0] / base - 1 : 0);
const pctLabel = (x: number) => `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`;
const money1 = (x: number) => `${x < 0 ? "−" : ""}$${(Math.abs(x) / 1000).toFixed(1)}k`;

export interface TwinSceneProps {
  tick: TickEventData | undefined;
  title: string;
  /** "plan" or "none": styles the header tag; with `twin`, picks who glows and who gets a ring */
  kind: "plan" | "none";
  you: string;
  rival: string;
  /** the other world's tick for the same week */
  twin?: TickEventData;
  /** the jar is full at this cumulative profit (USD); the same number for both worlds */
  cashMax?: number;
  /** your unit cost before the news (USD) */
  baseCost?: number;
  /** one shopper speaking: their face, words and lean toward you (-1 rival, 0 unsure, 1 you) */
  voice?: { shopper: Shopper; mood: number; lean: -1 | 0 | 1; text: string } | null;
}

export function TwinScene({ tick, title, kind, you, rival, twin, cashMax, baseCost, voice }: TwinSceneProps) {
  const cv = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const truckTag = useRef<HTMLDivElement>(null);
  const tickRef = useRef<TickEventData | undefined>(tick);
  const twinRef = useRef<TickEventData | undefined>(twin);
  const opts = useRef({ kind, cashMax, baseCost });
  const geoRef = useRef<Geo | null>(null);
  const people = useRef<Person[]>([]);
  const fx = useRef({ coins: [] as Coin[], pops: [] as number[], visitors: [] as Visitor[], puffs: [] as number[], cash: 0, truck: { x: 0, phase: "off" as "off" | "in" | "wait" | "out", wait: 0 } });
  const prevTick = useRef<TickEventData | undefined>(undefined);
  const retarget = useRef<((snap: boolean) => void) | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  tickRef.current = tick;
  twinRef.current = twin;
  opts.current = { kind, cashMax, baseCost };
  const vivid = baseCost !== undefined;

  // layout + loop: set up once, reads the latest tick from refs
  useEffect(() => {
    const c = cv.current;
    const wrap = box.current;
    const ctx = c?.getContext("2d");
    if (!c || !wrap || !ctx) return;
    let raf = 0;
    let last = 0;
    let frame = 0;
    const still = reducedMotion();

    const aim = (snap: boolean) => {
      const g = geoRef.current;
      const t = tickRef.current;
      const tw = twinRef.current;
      if (!g) return;
      const h = homes(g);
      const s: [number, number, number] = t ? t.shares : [0.4, 0.4, 0.2];
      if (people.current.length !== NC) {
        people.current = PEOPLE.map(() => ({ g: 2, x: 0, y: 0, tx: 0, ty: 0, t: 0, mark: 0, trail: [], popped: false, hx: 0, hy: 0, idle: false }));
        snap = true;
      }
      PEOPLE.forEach((p, i) => {
        const q = people.current[i];
        const was = q.g;
        q.g = groupOf(p.rank, s);
        const other = tw ? groupOf(p.rank, tw.shares) : q.g;
        q.mark = q.g === 0 && other !== 0 ? 1 : q.g !== 0 && other === 0 ? 2 : 0;
        if (q.mark !== 1 || q.g !== was) q.popped = false;
        const home = h[q.g];
        q.tx = q.hx = Math.round(home.x + p.u * home.rx);
        q.ty = q.hy = Math.round(home.y + p.v * home.ry);
        q.idle = false;
        if (snap) {
          q.x = q.tx;
          q.y = q.ty;
          q.trail = [];
          q.popped = true;
        }
      });
    };

    const fit = () => {
      const cw = wrap.clientWidth;
      if (cw < 40) return;
      const o = opts.current;
      const P = cw >= 420 ? 3 : 2;
      const W = Math.floor(cw / P);
      // narrow worlds need room under the shops for the crowd; the road takes a strip off the bottom
      const H = Math.round(W * (cw >= 560 ? 0.5 : cw >= 360 ? 0.7 : 0.85)) + (o.baseCost !== undefined ? ROAD_H : 0);
      c.width = W;
      c.height = H;
      c.style.height = `${H * P}px`;
      const top = Math.max(20, Math.round(H * 0.18));
      const jx = Math.round(W * 0.25) - 18 - 5 - JAR_W;
      const jar = o.cashMax !== undefined && jx >= 2 ? { x: jx, y: top + 4, h: 30 } : null;
      const g: Geo = { P, W, H, top, road: o.baseCost !== undefined ? H - ROAD_H : H, jar };
      geoRef.current = g;
      setGeo(g);
      aim(true);
      draw();
    };

    const shop = (cx: number, top: number, awning: string, dim: boolean) => {
      const x = Math.round(cx - 18);
      ctx.fillStyle = dim ? "#cfc9bb" : "#fff";
      ctx.fillRect(x, top + 8, 36, 18);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? (dim ? "#cfc9bb" : "#fff") : awning;
        ctx.fillRect(Math.round(x - 2 + i * 6.66), top + 2, 7, 6);
      }
      ctx.fillStyle = awning;
      ctx.fillRect(x + 4, top + 12, 12, 8);
      ctx.fillRect(x + 22, top + 14, 8, 12);
      if (!opts.current.baseCost) return;
      ctx.fillStyle = "#8f93b8";
      ctx.fillRect(x + 28, top - 3, 4, 5); // chimney
      if (dim) {
        // sold out: the shutter is down over the window and the door
        ctx.fillStyle = "#9a968c";
        ctx.fillRect(x + 2, top + 10, 32, 16);
        ctx.fillStyle = "#6f6b62";
        for (let y = top + 11; y < top + 26; y += 2) ctx.fillRect(x + 2, y, 32, 1);
      }
    };

    const rect = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), w, h);
    };
    const ring = (x: number, y: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(x - 2, y - 2, 7, 1);
      ctx.fillRect(x - 2, y + 5, 7, 1);
      ctx.fillRect(x - 2, y - 2, 1, 8);
      ctx.fillRect(x + 4, y - 2, 1, 8);
    };

    function draw() {
      const g = geoRef.current;
      if (!g) return;
      const t = tickRef.current;
      const o = opts.current;
      const f = fx.current;
      const paired = !!twinRef.current;
      const css = getComputedStyle(c as HTMLCanvasElement);
      const field = css.getPropertyValue("--px-field").trim() || "#3B4BDB";
      const ink = css.getPropertyValue("--px-field-ink").trim() || "#1E2A9C";
      const riv = css.getPropertyValue("--px-rival").trim() || "#D9822B";
      ctx!.fillStyle = field;
      ctx!.fillRect(0, 0, g.W, g.H);
      // faint pixel grain, fixed (same in both worlds)
      ctx!.fillStyle = "rgba(255,255,255,.10)";
      for (let i = 0; i < 70; i++) ctx!.fillRect((i * 53 + 7) % g.W, (i * 29 + 11) % g.road, 1, 1);
      if (g.road < g.H) {
        rect(0, g.road, g.W, g.H - g.road, "rgba(10,12,50,.55)");
        for (let x = 0; x < g.W; x += 12) rect(x, g.road + 5, 6, 1, "rgba(255,255,255,.3)");
      }
      const cxs = [Math.round(g.W * 0.25), Math.round(g.W * 0.75)];
      const blink = Math.floor(frame / 8) % 2 === 0;
      ([0, 1] as const).forEach((i) => {
        const out = t ? isSoldOut(t, i) : false;
        shop(cxs[i], g.top, i === 0 ? ink : riv, out);
        // stock meter: one crate per week of cover, up to 12
        const cover = t ? t.cover_weeks[i] : 0;
        const n = Math.max(0, Math.min(12, Math.ceil(cover - 0.15)));
        for (let k = 0; k < 12; k++) {
          ctx!.fillStyle = k < n ? "#fff" : "rgba(255,255,255,.22)";
          ctx!.fillRect(cxs[i] - 18 + k * 3, g.top + 30, 2, 3);
        }
        // crates on the way: a small amber stack beside the shop
        if (t && t.in_transit[i] > 0.5) {
          const sx = cxs[i] + 22;
          const sy = g.top + 26;
          ctx!.fillStyle = blink ? FLASH : "#E69A4E";
          ctx!.fillRect(sx, sy, 4, 3);
          ctx!.fillRect(sx + 5, sy, 4, 3);
          ctx!.fillRect(sx + 2, sy - 4, 4, 3);
        }
      });
      // chimney smoke: puffs rise from both shops while they are open (x offset, age) pairs
      for (let k = 0; k < f.puffs.length; k += 3) {
        const age = f.puffs[k + 2];
        const sx = cxs[f.puffs[k]] - 18 + 29 + Math.round(Math.sin((age + k) / 5) * 1.5) + f.puffs[k + 1];
        rect(sx, g.top - 5 - age * 0.5, 2, 2, `rgba(255,255,255,${(0.45 * (1 - age / 30)).toFixed(2)})`);
      }
      // visitors: in through the door, or back out with a "?"
      for (const v of f.visitors) {
        const c = v.shop === 0 ? "rgba(255,255,255,.9)" : "rgba(245,162,93,.95)";
        const x = Math.round(v.x);
        const y = Math.round(v.y);
        rect(x + 1, y, 1, 1, c);
        rect(x, y + 1, 3, 2, c);
        rect(x + (frame % 2 ? 0 : 2), y + 3, 1, 1, c);
        rect(x + 1, y + 3, 1, 1, c);
        if (v.back > 0) {
          // a pixel "?"
          ctx!.fillStyle = "#FFB566";
          ctx!.fillRect(x, y - 7, 3, 1);
          ctx!.fillRect(x + 2, y - 6, 1, 1);
          ctx!.fillRect(x + 1, y - 5, 1, 1);
          ctx!.fillRect(x + 1, y - 3, 1, 1);
        }
      }
      // cash jar: gold up to this world's cumulative profit, on the scale both worlds share
      if (g.jar && o.cashMax) {
        const { x, y, h } = g.jar;
        const lvl = Math.round(Math.max(0, Math.min(1, f.cash / o.cashMax)) * (h - 2));
        rect(x, y + h - lvl, JAR_W, lvl, GOLD);
        for (let r = 2; r < lvl; r += 3) rect(x + ((r / 3) % 2 < 1 ? 2 : 5), y + h - r, 5, 1, "#B8860B");
        ctx!.fillStyle = "rgba(255,255,255,.85)";
        ctx!.fillRect(x - 1, y, 1, h + 1);
        ctx!.fillRect(x + JAR_W, y, 1, h + 1);
        ctx!.fillRect(x - 1, y + h, JAR_W + 2, 1);
        ctx!.fillRect(x - 2, y - 1, 3, 1);
        ctx!.fillRect(x + JAR_W - 1, y - 1, 3, 1);
        rect(x + 2, y + 3, 1, h - 7, "rgba(255,255,255,.3)");
      }
      for (const p of people.current) {
        const moving = p.x !== p.tx || p.y !== p.ty;
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        const glow = paired && p.mark === 1 && o.kind === "plan";
        if (glow) {
          for (let k = 0; k < p.trail.length; k += 2) {
            rect(p.trail[k] + 1, p.trail[k + 1] + 1, 1, 1, `rgba(255,224,102,${(((k / 2 + 1) / (p.trail.length / 2 + 2)) * 0.7).toFixed(2)})`);
          }
          rect(x - 1, y - 1, 5, 6, "rgba(255,224,102,.28)");
        }
        // paired worlds dim the crowd so the switchers stand out; yellow then only means "won by the plan"
        ctx!.fillStyle = glow
          ? FLASH
          : paired
            ? p.g === 2 ? "rgba(255,255,255,.22)" : p.g === 1 ? "rgba(245,162,93,.62)" : "rgba(255,255,255,.72)"
            : moving ? FLASH : p.g === 2 ? "rgba(255,255,255,.32)" : p.g === 1 ? RIVAL_FAN : "#fff";
        ctx!.fillRect(x + 1, y, 1, 1);
        ctx!.fillRect(x, y + 1, 3, 2);
        const step = moving ? Math.floor(p.t) % 2 : 0;
        ctx!.fillRect(x + (step ? 0 : 2), y + 3, 1, 1);
        ctx!.fillRect(x + 1, y + 3, 1, 1);
        // a ring on the shoppers the other world gets: the plan's wins seen from "do nothing", its losses seen from the plan
        if (paired && p.mark === 2) ring(x, y, o.kind === "plan" ? LOSS : FLASH);
      }
      // the delivery truck, while stock lands
      if (f.truck.phase !== "off") {
        const tx = Math.round(f.truck.x);
        const ty = g.road + 1;
        const bad = costPct(t, o.baseCost) > 0.02;
        rect(tx, ty, 20, 7, "#E8E8E8");
        rect(tx + 2, ty + 2, 16, 1, "#BBB");
        rect(tx - 6, ty + 2, 6, 5, bad ? LOSS : GAIN);
        rect(tx - 5, ty + 3, 3, 2, "#9FD3FF");
        rect(tx - 4, ty + 7, 3, 2, "#111");
        rect(tx + 13, ty + 7, 3, 2, "#111");
      }
      // coins: an arc from your door into the jar (or out of the jar in a losing week)
      if (g.jar) {
        const sx = cxs[0] - 8;
        const sy = g.top + 16;
        const ex = g.jar.x + JAR_W / 2 - 1;
        const ey = g.jar.y;
        for (const k of f.coins) {
          if (k.t < 0 || k.t > 1) continue;
          const [ax, ay, bx, by] = k.up ? [sx, sy, ex, ey] : [ex, ey + g.jar.h, ex - 6, g.road];
          const cx = ax + (bx - ax) * k.t;
          const cy = ay + (by - ay) * k.t - (k.up ? Math.sin(k.t * Math.PI) * 14 : 0);
          rect(cx, cy, 3, 3, k.up ? GOLD : "#9C8A4A");
          if (k.up) rect(cx, cy, 1, 1, "#FFF8C8");
        }
      }
      // "+1" over your shop when a won shopper gets there
      for (const pt of f.pops) {
        const a = 1 - pt;
        const ox = cxs[0] - 4;
        const oy = Math.round(g.top - 6 - pt * 12);
        ctx!.fillStyle = `rgba(255,224,102,${a.toFixed(2)})`;
        ctx!.fillRect(ox, oy + 2, 3, 1);
        ctx!.fillRect(ox + 1, oy + 1, 1, 3);
        ctx!.fillRect(ox + 5, oy, 1, 5);
        ctx!.fillRect(ox + 4, oy + 1, 1, 1);
        ctx!.fillRect(ox + 4, oy + 4, 3, 1);
      }
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      frame++;
      const g = geoRef.current;
      const f = fx.current;
      const plan = opts.current.kind === "plan" && !!twinRef.current;
      const mill = opts.current.baseCost !== undefined;
      for (const p of people.current) {
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        if (dx === 0 && dy === 0) {
          // idle: now and then take a step or two around your spot, so the crowd never stands frozen
          if (mill && Math.random() < 0.035) {
            p.tx = p.hx + Math.round((Math.random() - 0.5) * 8);
            p.ty = p.hy + Math.round((Math.random() - 0.5) * 5);
            p.idle = true;
          }
          if (p.trail.length) p.trail.splice(0, 2);
          if (plan && p.mark === 1 && !p.popped) {
            p.popped = true;
            f.pops.push(0);
          }
          continue;
        }
        p.t += 1;
        if (p.idle) {
          p.x += Math.sign(dx);
          p.y += Math.sign(dy);
          continue;
        }
        if (plan && p.mark === 1) {
          p.trail.push(Math.round(p.x), Math.round(p.y));
          if (p.trail.length > 16) p.trail.splice(0, 2);
        }
        p.x += Math.abs(dx) <= STEP_PX ? dx : Math.sign(dx) * STEP_PX;
        p.y += Math.abs(dy) <= STEP_PX ? dy : Math.sign(dy) * STEP_PX;
      }
      if (g && opts.current.baseCost !== undefined) {
        const t = tickRef.current;
        for (let k = 2; k < f.puffs.length; k += 3) f.puffs[k] += 1;
        while (f.puffs.length && f.puffs[2] > 30) f.puffs.splice(0, 3);
        ([0, 1] as const).forEach((i) => {
          const out = t ? isSoldOut(t, i) : false;
          if (!out && frame % 7 === i * 3) f.puffs.push(i, 0, 0);
          // shoppers come to the door about as often as the shop's share of the crowd says
          const share = t ? t.shares[i] : 0;
          if (f.visitors.length < 16 && Math.random() < share * 0.6) {
            const from = people.current.filter((p) => p.g === i);
            const p = from[Math.floor(Math.random() * from.length)];
            if (p) f.visitors.push({ shop: i, x: p.x, y: p.y, hx: p.x, hy: p.y, back: 0 });
          }
        });
        const cx = [Math.round(g.W * 0.25), Math.round(g.W * 0.75)];
        f.visitors = f.visitors.filter((v) => {
          const [tx, ty] = v.back > 0 ? [v.hx, v.hy] : [cx[v.shop] + 8, g.top + 27];
          const dx = tx - v.x;
          const dy = ty - v.y;
          if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
            if (v.back > 0) return false; // home again
            if (t && isSoldOut(t, v.shop)) {
              v.back = 1;
              return true;
            }
            return false; // went in
          }
          v.x += Math.abs(dx) <= 2 ? dx : Math.sign(dx) * 2;
          v.y += Math.abs(dy) <= 2 ? dy : Math.sign(dy) * 2;
          if (v.back > 0) v.back += 1;
          return true;
        });
      }
      for (const k of f.coins) k.t += 0.07;
      f.coins = f.coins.filter((k) => k.t <= 1);
      f.pops = f.pops.map((pt) => pt + 0.04).filter((pt) => pt < 1);
      f.cash += ((tickRef.current?.cum_profit[0] ?? 0) - f.cash) * 0.15;
      const tr = f.truck;
      if (g && tr.phase !== "off") {
        const stop = Math.round(g.W * 0.25) + 4;
        if (tr.phase === "in" && (tr.x -= 3) <= stop) {
          tr.x = stop;
          tr.phase = "wait";
          tr.wait = 14;
        } else if (tr.phase === "wait" && --tr.wait <= 0) tr.phase = "out";
        else if (tr.phase === "out" && (tr.x -= 3) < -30) tr.phase = "off";
      }
      const tag = truckTag.current;
      if (tag && g) {
        tag.style.opacity = tr.phase === "off" ? "0" : "1";
        tag.style.left = `${((tr.x + 4) / g.W) * 100}%`;
      }
      draw();
    };

    retarget.current = (snap) => {
      aim(snap || still);
      const t = tickRef.current;
      const prev = prevTick.current;
      prevTick.current = t;
      const f = fx.current;
      if (snap || still || !t) {
        f.cash = t?.cum_profit[0] ?? 0;
        f.coins = [];
        f.truck.phase = "off";
      } else if (!prev || t.tick <= prev.tick) {
        // a replay from the top: start the jar empty again
        f.cash = 0;
        f.coins = [];
        f.pops = [];
        f.visitors = [];
        f.truck.phase = "off";
      } else {
        const o = opts.current;
        if (o.cashMax) {
          const n = Math.max(1, Math.min(10, Math.round(Math.abs(t.profit[0]) / (o.cashMax / 40))));
          for (let i = 0; i < n; i++) f.coins.push({ t: -i * 0.18, up: t.profit[0] >= 0 });
        }
        // stock landed this week: drive the truck in
        if (o.baseCost !== undefined && t.in_transit[0] < prev.in_transit[0] - 0.5 && f.truck.phase === "off" && geoRef.current) {
          f.truck.x = geoRef.current.W + 24;
          f.truck.phase = "in";
        }
      }
      draw();
    };
    fit();
    if (!still) raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // a new week: walk the switchers to their new spots
  useEffect(() => {
    retarget.current?.(false);
  }, [tick]);

  const s = tick?.shares ?? [0, 0, 0];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const cx = (i: 0 | 1) => (geo ? Math.round(geo.W * (i === 0 ? 0.25 : 0.75)) : 0);
  const sw = switchers(tick, twin);
  const cost = costPct(tick, baseCost);
  const costBad = cost > 0.02;
  const lit = Math.max(0, Math.min(8, Math.round(cost / COST_BAR)));
  return (
    <figure className={`ts ${kind}`} aria-label={title}>
      <figcaption className="ts-cap">
        <span className="ts-tag">{title}</span>
        {vivid && tick && (
          <span className={`ts-gauge ${costBad ? "bad" : "ok"}`} title="Your unit cost vs before the news">
            YOUR COST
            <span className="bars" aria-hidden>
              {Array.from({ length: 8 }, (_, k) => <i key={k} className={k < lit ? "on" : ""} />)}
            </span>
            <em>{pctLabel(cost)}</em>
          </span>
        )}
      </figcaption>
      <div className="ts-box" ref={box}>
        <canvas ref={cv} className="ts-cv" aria-hidden />
        {geo &&
          tick &&
          ([0, 1] as const).map((i) => {
            const out = isSoldOut(tick, i);
            const cover = tick.cover_weeks[i];
            const coming = tick.in_transit[i] > 0.5;
            return (
              <div key={i}>
                <div
                  key={vivid ? tick.price[i].toFixed(2) : "p"}
                  className={`ts-price${vivid ? " flip" : ""}`}
                  style={{ left: `${(cx(i) / geo.W) * 100}%`, top: geo.top * geo.P - 6 }}
                >
                  <small>{i === 0 ? you : rival}</small>
                  <b>{formatPrice(tick.price[i])}</b>
                </div>
                <div className="ts-stat" style={{ left: `${(cx(i) / geo.W) * 100}%`, top: (geo.top + 35) * geo.P }}>
                  {out ? <span className="sold">SOLD OUT</span> : <span className="stk">{cover >= 10 ? Math.round(cover) : cover.toFixed(1)} wk stock</span>}
                  {coming && <span className="arr">▲ arriving</span>}
                </div>
              </div>
            );
          })}
        {geo && tick && geo.jar && (
          <div className="ts-jar" style={{ left: `${((geo.jar.x + JAR_W / 2) / geo.W) * 100}%`, top: (geo.jar.y + geo.jar.h + 2) * geo.P }}>
            <small>cash</small>
            <b className={tick.cum_profit[0] < 0 ? "neg" : ""}>{money1(tick.cum_profit[0])}</b>
          </div>
        )}
        {vivid && geo && (
          <div ref={truckTag} className={`ts-truck ${costBad ? "bad" : "ok"}`} style={{ top: (geo.road - 2) * geo.P, opacity: 0 }} aria-hidden>
            COST {pctLabel(cost)}
          </div>
        )}
        {geo && voice && (() => {
          const h = homes(geo)[voice.lean === 1 ? 0 : voice.lean === -1 ? 1 : 2];
          const left = Math.max(38, Math.min(62, (h.x / geo.W) * 100));
          return (
            <div key={voice.text} className="ts-say" style={{ left: `${left}%`, top: (h.y + h.ry * 0.2) * geo.P }} role="note">
              <PixelFace shopper={voice.shopper} mood={voice.mood} size={22} />
              <span><b>{voice.shopper.name}</b> {voice.text}</span>
            </div>
          );
        })()}
      </div>
      <div className="ts-count" aria-live="off">
        <span><i className="y" />You <b>{pct(s[0])}</b></span>
        <span><i className="r" />Rival <b>{pct(s[1])}</b></span>
        <span><i className="n" />Not buying <b>{pct(s[2])}</b></span>
        {twin && kind === "plan" && sw.won > 0 && <span className="won"><i className="w" />Won by the plan <b>{sw.won}</b></span>}
        {twin && kind === "plan" && sw.lost > 0 && <span className="lost"><i className="l" />Lost <b>{sw.lost}</b></span>}
      </div>
    </figure>
  );
}
