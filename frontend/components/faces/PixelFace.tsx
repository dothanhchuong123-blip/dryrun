"use client";

import { memo, useEffect, useRef } from "react";
import { FACE_N, drawFace, type Px, type Shopper } from "../../lib/faces";
import { reducedMotion } from "../../lib/follow";
import "./faces.css";

const rects = (list: Px[]) => list.map((p, i) => <rect key={i} x={p.x} y={p.y} width={p.w} height={1} fill={p.c} />);

/** One pixel customer. The face pops (in whole steps) when the mood changes. */
export const PixelFace = memo(function PixelFace({
  shopper,
  mood,
  bg = "var(--px-disc)",
  size,
  title,
}: {
  shopper: Shopper;
  mood: number;
  bg?: string;
  size?: number;
  title?: string;
}) {
  const art = drawFace(shopper, mood, bg);
  const ref = useRef<SVGSVGElement>(null);
  const first = useRef(true);
  // only the coarse expression matters for the pop, not tiny μ changes
  const band = mood > 0.55 ? 2 : mood > 0.15 ? 1 : mood < -0.55 ? -2 : mood < -0.15 ? -1 : 0;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el || reducedMotion()) return;
    el.classList.remove("pop");
    void el.getBoundingClientRect();
    el.classList.add("pop");
  }, [band, bg]);
  return (
    <svg
      ref={ref}
      className="pxf"
      viewBox={`0 0 ${FACE_N} ${FACE_N}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g className="bob" style={{ animationDelay: `-${(shopper.slot * 0.37).toFixed(2)}s` }}>
        {rects(art.px)}
        {art.eyes && (
          <>
            <g className="eo">{rects(art.eyes.open)}</g>
            <g className="ec">{rects(art.eyes.shut)}</g>
          </>
        )}
      </g>
    </svg>
  );
});

const LOGO = [
  "..........",
  ".##.......",
  "......##..",
  "..........",
  "..#....#..",
  "..#....#..",
  "..........",
  ".......#..",
  "..#####...",
  "..........",
];

/** Dry Run's mark: a pixel customer raising one eyebrow, "what if?". */
export function PixelLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden className="pxlogo">
      <rect width="12" height="12" fill="var(--px-field)" />
      {LOGO.flatMap((row, y) => [...row].map((ch, x) => (ch === "#" ? <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill="#fff" /> : null)))}
    </svg>
  );
}

/** The landing field: 200 pixel customers around two shops; now and then one walks across. */
export function PixelCrowd({ youShare = 0.41, rivalShare = 0.39 }: { youShare?: number; rivalShare?: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    let P = 3;
    let W = 0,
      H = 0,
      raf = 0,
      last = 0;
    type Person = { side: number; ox: number; oy: number; x: number; y: number; t: number; sw: number };
    let people: Person[] = [];
    const fit = () => {
      P = c.clientWidth < 640 ? 2 : 3; // finer pixels on phones so the shops still fit
      W = Math.max(1, Math.floor(c.clientWidth / P));
      H = Math.max(1, Math.floor(c.clientHeight / P));
      c.width = W;
      c.height = H;
      const nA = Math.round(200 * youShare),
        nB = Math.round(200 * rivalShare);
      people = Array.from({ length: 200 }, (_, i) => {
        const ang = Math.random() * 6.28,
          rad = Math.sqrt(Math.random());
        return { side: i < nA ? 0 : i < nA + nB ? 1 : 2, ox: Math.cos(ang) * rad * Math.min(62, W * 0.12), oy: 14 + Math.sin(ang) * rad * Math.min(20, H * 0.18), x: Math.random() * W, y: Math.random() * H, t: Math.random() * 9, sw: 0 };
      });
    };
    const shop = (x: number, y: number, aw: string) => {
      x = Math.round(x - 18);
      y = Math.round(y - 26);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y + 8, 36, 18);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? "#fff" : aw;
        ctx.fillRect(Math.round(x - 2 + i * 6.66), y + 2, 7, 6);
      }
      ctx.fillStyle = aw;
      ctx.fillRect(x + 4, y + 12, 12, 8);
      ctx.fillRect(x + 22, y + 14, 8, 12);
    };
    const draw = (move: boolean) => {
      const css = getComputedStyle(c);
      ctx.fillStyle = css.getPropertyValue("--px-field").trim() || "#3B4BDB";
      ctx.fillRect(0, 0, W, H);
      const S = [[W * 0.22, H * 0.42], [W * 0.78, H * 0.42], [W * 0.5, H * 0.2]];
      shop(S[0][0], S[0][1], css.getPropertyValue("--px-field-ink").trim() || "#1E2A9C");
      shop(S[1][0], S[1][1], css.getPropertyValue("--px-rival").trim() || "#D9822B");
      if (move && Math.random() < 0.08) {
        const p = people[Math.floor(Math.random() * people.length)];
        p.side = p.side === 1 ? 0 : p.side === 0 ? (Math.random() < 0.5 ? 1 : 2) : 0;
        p.sw = 40;
      }
      for (const p of people) {
        const [hx, hy] = S[p.side];
        const tx = hx + p.ox * (p.side === 2 ? 0.6 : 1) + Math.sin(p.t * 0.4) * 2;
        const ty = hy + p.oy * (p.side === 2 ? 0.4 : 1);
        if (move) {
          p.t += 0.15;
          const k = p.sw > 0 ? 0.05 : 0.12;
          p.x += (tx - p.x) * k;
          p.y += (ty - p.y) * k - (p.sw > 0 ? Math.sin(((40 - p.sw) / 40) * Math.PI) * 0.6 : 0);
          p.sw--;
        } else {
          p.x = tx;
          p.y = ty;
        }
        const x = Math.round(p.x),
          y = Math.round(p.y);
        ctx.fillStyle = p.sw > 0 ? "#FFB566" : p.side === 2 ? "rgba(255,255,255,.4)" : "#fff";
        ctx.fillRect(x + 1, y, 1, 1);
        ctx.fillRect(x, y + 1, 3, 2);
        const step = Math.floor(p.t) % 2;
        ctx.fillRect(x + (step ? 0 : 2), y + 3, 1, 1);
        ctx.fillRect(x + 1, y + 3, 1, 1);
      }
      ctx.fillStyle = "rgba(255,255,255,.14)";
      for (let i = 0; i < 160; i++) ctx.fillRect(Math.floor(Math.random() * W), Math.floor(Math.random() * H), 1, 1);
    };
    const still = reducedMotion();
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 70) return;
      last = t;
      draw(true);
    };
    // paint at once (and after every resize, which clears the canvas) so the field is never an empty block
    fit();
    draw(false);
    if (!still) raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => {
      fit();
      draw(false);
    });
    ro.observe(c);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [youShare, rivalShare]);
  return <canvas ref={cv} className="pxcrowd" aria-hidden />;
}
