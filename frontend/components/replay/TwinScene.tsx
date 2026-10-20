"use client";

import { useEffect, useRef, useState } from "react";
import type { TickEventData } from "../../lib/events";
import { formatPrice } from "../../lib/format";
import { reducedMotion } from "../../lib/follow";

/**
 * One pixel world (DESIGN §12.6): the blue field, your shop, the rival's shop and 60 pixel customers.
 * Two of these sit side by side (do nothing / with the plan). Both use the same seed, so every person
 * has the same rank and the same spot in both worlds; they only stand in different places where the
 * futures differ. Customers are split by the week's `shares`; the people who switch walk over in whole
 * pixels and flash amber on the way. Everything that moves lives in refs; React only re-renders the tags.
 */
const NC = 60;
const FLASH = "#FFE066";
const RIVAL_FAN = "#F5A25D";
const STEP_PX = 4; // whole pixels per frame
const FRAME_MS = 60;

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

interface Person {
  g: Group;
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
}
interface Geo {
  P: number;
  W: number;
  H: number;
  top: number; // shop top row
}

const isSoldOut = (t: TickEventData, i: 0 | 1) => t.unmet[i] > 0.5 || t.cover_weeks[i] < 0.05;

export interface TwinSceneProps {
  tick: TickEventData | undefined;
  title: string;
  /** "plan" or "none": only styles the header tag */
  kind: "plan" | "none";
  you: string;
  rival: string;
}

export function TwinScene({ tick, title, kind, you, rival }: TwinSceneProps) {
  const cv = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const tickRef = useRef<TickEventData | undefined>(tick);
  const geoRef = useRef<Geo | null>(null);
  const people = useRef<Person[]>([]);
  const retarget = useRef<((snap: boolean) => void) | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  tickRef.current = tick;

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

    const homes = (g: Geo): Record<Group, { x: number; y: number; rx: number; ry: number }> => {
      const y0 = g.top + 46;
      const cy = (y0 + g.H - 3) / 2;
      const ry = Math.max(4, (g.H - 3 - y0) / 2);
      return {
        0: { x: g.W * 0.25, y: cy, rx: g.W * 0.17, ry },
        1: { x: g.W * 0.75, y: cy, rx: g.W * 0.17, ry },
        2: { x: g.W * 0.5, y: cy, rx: g.W * 0.1, ry },
      };
    };

    const aim = (snap: boolean) => {
      const g = geoRef.current;
      const t = tickRef.current;
      if (!g) return;
      const h = homes(g);
      const s: [number, number, number] = t ? t.shares : [0.4, 0.4, 0.2];
      if (people.current.length !== NC) {
        people.current = PEOPLE.map(() => ({ g: 2, x: 0, y: 0, tx: 0, ty: 0, t: 0 }));
        snap = true;
      }
      PEOPLE.forEach((p, i) => {
        const q = people.current[i];
        q.g = groupOf(p.rank, s);
        const home = h[q.g];
        q.tx = Math.round(home.x + p.u * home.rx);
        q.ty = Math.round(home.y + p.v * home.ry);
        if (snap) {
          q.x = q.tx;
          q.y = q.ty;
        }
      });
    };

    const fit = () => {
      const cw = wrap.clientWidth;
      if (cw < 40) return;
      const P = cw >= 420 ? 3 : 2;
      const W = Math.floor(cw / P);
      const H = Math.round(W * (cw >= 560 ? 0.5 : cw >= 360 ? 0.7 : 0.85)); // narrow worlds need room under the shops for the crowd
      c.width = W;
      c.height = H;
      c.style.height = `${H * P}px`;
      const g: Geo = { P, W, H, top: Math.max(20, Math.round(H * 0.18)) };
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
    };

    function draw() {
      const g = geoRef.current;
      if (!g) return;
      const t = tickRef.current;
      const css = getComputedStyle(c as HTMLCanvasElement);
      const field = css.getPropertyValue("--px-field").trim() || "#3B4BDB";
      const ink = css.getPropertyValue("--px-field-ink").trim() || "#1E2A9C";
      const riv = css.getPropertyValue("--px-rival").trim() || "#D9822B";
      ctx!.fillStyle = field;
      ctx!.fillRect(0, 0, g.W, g.H);
      // faint pixel grain, fixed (same in both worlds)
      ctx!.fillStyle = "rgba(255,255,255,.10)";
      for (let i = 0; i < 70; i++) ctx!.fillRect((i * 53 + 7) % g.W, (i * 29 + 11) % g.H, 1, 1);
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
      for (const p of people.current) {
        const moving = p.x !== p.tx || p.y !== p.ty;
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        ctx!.fillStyle = moving ? FLASH : p.g === 2 ? "rgba(255,255,255,.32)" : p.g === 1 ? RIVAL_FAN : "#fff";
        ctx!.fillRect(x + 1, y, 1, 1);
        ctx!.fillRect(x, y + 1, 3, 2);
        const step = moving ? Math.floor(p.t) % 2 : 0;
        ctx!.fillRect(x + (step ? 0 : 2), y + 3, 1, 1);
        ctx!.fillRect(x + 1, y + 3, 1, 1);
      }
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      frame++;
      for (const p of people.current) {
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        if (dx === 0 && dy === 0) continue;
        p.t += 1;
        p.x += Math.abs(dx) <= STEP_PX ? dx : Math.sign(dx) * STEP_PX;
        p.y += Math.abs(dy) <= STEP_PX ? dy : Math.sign(dy) * STEP_PX;
      }
      draw();
    };

    retarget.current = (snap) => {
      aim(snap || still);
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
  return (
    <figure className={`ts ${kind}`} aria-label={title}>
      <figcaption className="ts-tag">{title}</figcaption>
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
                <div className="ts-price" style={{ left: `${(cx(i) / geo.W) * 100}%`, top: geo.top * geo.P - 6 }}>
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
      </div>
      <div className="ts-count" aria-live="off">
        <span><i className="y" />You <b>{pct(s[0])}</b></span>
        <span><i className="r" />Rival <b>{pct(s[1])}</b></span>
        <span><i className="n" />Not buying <b>{pct(s[2])}</b></span>
      </div>
    </figure>
  );
}
