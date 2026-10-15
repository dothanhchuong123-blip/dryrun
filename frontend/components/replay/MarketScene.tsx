"use client";

import { useEffect, useRef } from "react";
import type { MarkerData, TickEventData } from "../../lib/events";
import { formatPrice } from "../../lib/format";
import { choicesRef, useMarketStore } from "../../lib/store";

/**
 * The market scene (DESIGN §12.5, §12.3a): one canvas, 900×340 logical, drawn with the theme tokens.
 * Supplier → your shop + the rival → 60 customer dots. Everything that moves lives in refs
 * (dots, parcels, price pops); React state is never touched inside the frame loop.
 */
const SW = 900;
const SH = 340;
const NC = 60;
const MINUS = "−";

type Group = "A" | "B" | "O";
interface Dot {
  g: Group;
  x: number;
  y: number;
  c: string;
  fly: number;
  tw: null | { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number; fc: string; tc: string; arc: boolean };
  mv?: number;
}
interface Parcel {
  g: "A" | "B";
  t: number;
  big?: boolean;
}

const VARS: Record<string, string> = {
  A: "--firm-a", B: "--firm-b", O: "--no-buy", ink: "--ink", ink2: "--ink-2", ink3: "--ink-3", line: "--line",
  loss: "--loss", gain: "--gain", subtle: "--bg-subtle", asoft: "--firm-a-soft", bsoft: "--firm-b-soft",
  lsoft: "--loss-soft", card: "--bg-card", strong: "--line-strong",
};
const ZONE: Record<Group, { x: number; y: number; cols: number }> = {
  A: { x: 612, y: 44, cols: 10 },
  B: { x: 612, y: 212, cols: 10 },
  O: { x: 822, y: 122, cols: 3 },
};
const SHOP = { A: { y: 22 }, B: { y: 184 } };
const SHOP_X = 324;
const SHOP_W = 244;
const SHOP_H = 134;
const ROUTE: Record<"A" | "B", [number, number][]> = {
  A: [[200, 170], [262, 170], [262, 80], [324, 80]],
  B: [[200, 170], [262, 170], [262, 242], [324, 242]],
};
const FONT = {
  b: "600 13.5px Inter, sans-serif",
  s: "500 12px Inter, sans-serif",
  t: "600 11px Inter, sans-serif",
  n: "600 22px Inter, sans-serif",
};

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function mix(a: string, b: string, t: number): string {
  if (a[0] !== "#" || b[0] !== "#" || a.length < 7 || b.length < 7) return t < 0.5 ? a : b;
  const A = hex(a);
  const B = hex(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
const easeIO = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
function bez(P: [number, number][], t: number): [number, number] {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]) as [number, number];
}

function shortName(name: string): string {
  const w = name.trim().split(/\s+/);
  return w.length > 1 && name.length > 14 ? w[0] : name;
}

/** ≤ 6-word bubble for a marker (DESIGN §12.5). */
function bubbleFor(m: MarkerData, you: string, rival: string): string {
  switch (m.kind) {
    case "shock":
      return /deliver|lead|slow/i.test(m.text) ? "Deliveries slow down" : "Supplier costs jumped";
    case "price_change":
      return m.firm === "B" ? `${rival} changed its price` : `${you} changed price`;
    case "stock_ordered":
      return "Extra stock ordered";
    case "stock_arrives":
      return "Extra stock arrived";
    case "sold_out":
      return m.firm === "B" ? `${rival} is out. Buying from ${you}` : `${you} ran out`;
    case "rival_move":
    case "rival_price":
      return `${rival} moved its price`;
    case "new_player":
      return "A new shop opened nearby";
  }
}

export function MarketScene() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sx: CanvasRenderingContext2D = ctx;
    const cv: HTMLCanvasElement = canvas;

    const COL: Record<string, string> = {};
    const readCol = () => {
      const cs = getComputedStyle(document.documentElement);
      for (const k in VARS) COL[k] = cs.getPropertyValue(VARS[k]).trim() || "#888888";
      for (const d of dots) if (!d.tw) d.c = COL[d.g];
    };
    let dots: Dot[] = [];
    let parcels: Parcel[] = [];
    let spawnAcc = { A: 0.6, B: 0.2 };
    let pop: Record<"A" | "B", null | { from: number; to: number; t0: number; until: number }> = { A: null, B: null };
    let bubbles: { text: string; x: number; y: number }[] = [];
    let lastWeek = -1;
    let lastTs = 0;
    let frames = 0;
    let raf = 0;
    let prevSig = "";

    const size = () => {
      const w = canvas.getBoundingClientRect().width;
      const d = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.max(1, Math.round(w * d));
      const ph = Math.max(1, Math.round((w * SH) / SW * d));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
    ro?.observe(canvas);
    size();

    // ---- customer dots -------------------------------------------------------------------------
    const slot = (g: Group, k: number) => {
      const z = ZONE[g];
      const s = g === "O" ? 20 : 18;
      return { x: z.x + (k % z.cols) * s, y: z.y + Math.floor(k / z.cols) * 17 };
    };
    function counts(wk: number): Record<Group, number> {
      const s = useMarketStore.getState().replay;
      const ch = choicesRef.current;
      let a = 0;
      let b = 0;
      if (ch.length > 0) {
        let na = 0;
        let nb = 0;
        for (let i = 0; i < ch.length; i++) {
          if (ch[i] === 1) na++;
          else if (ch[i] === 2) nb++;
        }
        a = Math.round((na / ch.length) * NC);
        b = Math.round((nb / ch.length) * NC);
      } else {
        const t = s.u1[wk];
        if (t) {
          a = Math.round(t.shares[1] * NC);
          b = Math.round(t.shares[2] * NC);
        }
      }
      b = Math.min(b, NC - a);
      return { A: a, B: b, O: NC - a - b };
    }
    function seedDots(wk: number) {
      const n = counts(wk);
      dots = Array.from({ length: NC }, (_, i) => {
        const g: Group = i < n.A ? "A" : i < n.A + n.B ? "B" : "O";
        return { g, x: 0, y: 0, c: COL[g], fly: 0, tw: null };
      });
      for (const g of ["A", "B", "O"] as Group[]) {
        dots.filter((d) => d.g === g).forEach((d, k) => {
          const p = slot(g, k);
          d.x = p.x;
          d.y = p.y;
        });
      }
    }
    function assignDots(wk: number, now: number) {
      const tgt = counts(wk);
      const lists: Record<Group, Dot[]> = { A: [], B: [], O: [] };
      const spare: Dot[] = [];
      dots.forEach((d) => lists[d.g].push(d));
      for (const g of ["A", "B", "O"] as Group[]) while (lists[g].length > tgt[g]) spare.push(lists[g].pop()!);
      let n = 0;
      for (const g of ["A", "B", "O"] as Group[]) {
        while (lists[g].length < tgt[g] && spare.length) {
          const d = spare.shift()!;
          d.g = g;
          d.mv = n++;
          lists[g].push(d);
        }
      }
      for (const g of ["A", "B", "O"] as Group[]) {
        lists[g].forEach((d, k) => {
          const p = slot(g, k);
          const moved = d.mv !== undefined;
          if (moved || Math.abs(p.x - d.x) > 0.5 || Math.abs(p.y - d.y) > 0.5) {
            d.tw = { fx: d.x, fy: d.y, tx: p.x, ty: p.y, t0: now + (moved ? d.mv! * 55 : 0), dur: moved ? 1150 : 450, fc: d.c, tc: COL[g], arc: moved };
          }
          delete d.mv;
        });
      }
    }
    function stepDot(d: Dot, now: number) {
      const tw = d.tw;
      if (!tw) return;
      let k = (now - tw.t0) / tw.dur;
      if (k < 0) return;
      k = Math.min(1, k);
      const e = easeIO(k);
      const lift = tw.arc ? Math.sin(Math.PI * e) : 0;
      d.x = tw.fx + (tw.tx - tw.fx) * e - lift * 46;
      d.y = tw.fy + (tw.ty - tw.fy) * e;
      d.c = mix(tw.fc, tw.tc, e);
      d.fly = lift;
      if (k >= 1) {
        d.tw = null;
        d.fly = 0;
      }
    }

    // ---- drawing helpers -----------------------------------------------------------------------
    const rr = (x: number, y: number, w: number, h: number, r: number, fill?: string, stroke?: string) => {
      sx.beginPath();
      sx.roundRect(x, y, w, h, r);
      if (fill) {
        sx.fillStyle = fill;
        sx.fill();
      }
      if (stroke) {
        sx.strokeStyle = stroke;
        sx.lineWidth = 1;
        sx.stroke();
      }
    };
    const tx = (s: string, x: number, y: number, font: string, col: string, align: CanvasTextAlign = "left") => {
      sx.font = font;
      sx.fillStyle = col;
      sx.textAlign = align;
      sx.fillText(s, x, y);
      return sx.measureText(s).width;
    };
    const card = (x: number, y: number, w: number, h: number) => {
      sx.save();
      sx.shadowColor = "rgba(16,24,40,.08)";
      sx.shadowBlur = 8;
      sx.shadowOffsetY = 2;
      rr(x, y, w, h, 8, COL.card);
      sx.restore();
      rr(x + 0.5, y + 0.5, w - 1, h - 1, 8, undefined, COL.line);
    };
    const pill = (s: string, x: number, y: number, bg: string, fg: string, font = FONT.t) => {
      sx.font = font;
      const w = sx.measureText(s).width + 14;
      rr(x, y - 12, w, 17, 4, bg);
      tx(s, x + 7, y, font, fg);
      return w;
    };
    const fit = (s: string, maxW: number, font: string) => {
      sx.font = font;
      if (sx.measureText(s).width <= maxW) return s;
      let t = s;
      while (t.length > 1 && sx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      return t + "…";
    };

    function drawSupplier(t: TickEventData | undefined, t0: TickEventData | undefined, region: string) {
      const x = 20;
      const y = 100;
      card(x, y, 180, 140);
      rr(x + 16, y + 16, 26, 26, 6, COL.subtle);
      sx.strokeStyle = COL.ink2;
      sx.lineWidth = 1.6;
      sx.lineJoin = "round";
      sx.beginPath();
      sx.moveTo(x + 22, y + 25); sx.lineTo(x + 29, y + 21); sx.lineTo(x + 36, y + 25); sx.lineTo(x + 36, y + 34); sx.lineTo(x + 29, y + 38); sx.lineTo(x + 22, y + 34);
      sx.closePath();
      sx.stroke();
      sx.beginPath();
      sx.moveTo(x + 22, y + 25); sx.lineTo(x + 29, y + 29); sx.lineTo(x + 36, y + 25); sx.moveTo(x + 29, y + 29); sx.lineTo(x + 29, y + 38);
      sx.stroke();
      tx("Supplier", x + 52, y + 27, FONT.b, COL.ink);
      tx(fit(region || "Your supplier", 118, FONT.s), x + 52, y + 43, FONT.s, COL.ink3);
      const base = t0?.c_raw ?? 0;
      const c = t && base > 0 ? t.c_raw / base - 1 : 0;
      tx("Raw cost", x + 16, y + 78, FONT.s, COL.ink3);
      tx((c > 0.004 ? "+" : c < -0.004 ? MINUS : "") + Math.round(Math.abs(c) * 100) + "%", x + 16, y + 104, FONT.n, c > 0.004 ? COL.loss : c < -0.004 ? COL.gain : COL.ink);
      tx(`Lead time ${t ? Math.round(t.lead_time) : "–"} wk`, x + 16, y + 126, FONT.s, COL.ink3);
    }

    function drawShop(g: "A" | "B", t: TickEventData | undefined, name: string, tag: string, now: number, arrivesSoon: boolean) {
      const i = g === "A" ? 0 : 1;
      const x = SHOP_X;
      const y = SHOP[g].y;
      const col = COL[g];
      card(x, y, SHOP_W, SHOP_H);
      sx.beginPath();
      sx.arc(x + 20, y + 22, 5, 0, Math.PI * 2);
      sx.fillStyle = col;
      sx.fill();
      tx(fit(name, 120, FONT.b), x + 32, y + 27, FONT.b, COL.ink);
      pill(tag, x + SHOP_W - 54, y + 26, g === "A" ? COL.asoft : COL.bsoft, col);
      const price = t?.price[i] ?? 0;
      const p = pop[g];
      if (p && now < p.until) {
        const k = Math.min(1, (now - p.t0) / 350);
        const s2 = 1 + 0.12 * Math.sin(Math.PI * k);
        sx.save();
        sx.translate(x + 16, y + 58);
        sx.scale(s2, s2);
        rr(-6, -21, 200, 30, 6, g === "A" ? COL.asoft : COL.bsoft);
        tx(`${formatPrice(p.from)} → ${formatPrice(p.to)}`, 0, 0, "600 18px Inter, sans-serif", col);
        sx.restore();
      } else {
        tx(formatPrice(price), x + 16, y + 58, FONT.n, COL.ink);
      }
      const transit = t?.in_transit[i] ?? 0;
      if (transit > 0.5) tx(`${Math.round(transit)} on the way`, x + SHOP_W - 14, y + 58, FONT.s, g === "A" ? COL.A : COL.ink3, "right");
      else if (arrivesSoon) tx("stock arriving", x + SHOP_W - 14, y + 58, FONT.s, COL.A, "right");

      // stock bar, split by "bought at the old cost" vs "bought at the new cost"
      const cover = t?.cover_weeks[i] ?? 0;
      const oldShare = Math.max(0, Math.min(1, t?.old_cost_share?.[i] ?? 1));
      const BX = x + 58;
      const BW = 120;
      tx("Stock", x + 16, y + 88, FONT.s, COL.ink3);
      rr(BX, y + 80, BW, 8, 4, COL.subtle);
      if (cover > 0.05) {
        const full = Math.max(8, BW * Math.min(1, cover / 8));
        sx.save();
        sx.beginPath();
        sx.roundRect(BX, y + 80, full, 8, 4);
        sx.clip();
        sx.fillStyle = col; // old-cost stock
        sx.fillRect(BX, y + 80, full * oldShare, 8);
        sx.fillStyle = mix(col, COL.card, 0.55); // new-cost stock
        sx.fillRect(BX + full * oldShare, y + 80, full * (1 - oldShare), 8);
        sx.restore();
        tx(`${cover.toFixed(1)} wk`, x + SHOP_W - 14, y + 89, FONT.s, COL.ink2, "right");
      } else {
        pill("Sold out", x + SHOP_W - 14 - 62, y + 92, COL.lsoft, COL.loss);
      }
      const cost = t?.unit_cost[i] ?? 0;
      const margin = price - cost;
      const spot = t?.spot_cost?.[i];
      tx(`Cost ${formatPrice(cost)} · margin ${formatPrice(margin)}`, x + 16, y + 112, "600 12px Inter, sans-serif", margin < 0 ? COL.loss : COL.ink2);
      if (spot != null && oldShare > 0.02 && oldShare < 0.98) {
        tx(`${Math.round(oldShare * 100)}% bought at the old cost`, x + 16, y + 126, "500 11px Inter, sans-serif", COL.ink3);
      } else if (spot != null && Math.abs(spot - cost) > 0.04) {
        tx(`Buying now at ${formatPrice(spot)}`, x + 16, y + 126, "500 11px Inter, sans-serif", COL.ink3);
      }
    }

    function drawZones(wk: number, you: string, rival: string, dnA: number, now: number) {
      const n = counts(wk);
      const d = n.A - dnA;
      let w = tx(`${n.A}`, ZONE.A.x - 4, 28, "600 15px Inter, sans-serif", COL.A);
      w += tx(" customers buy from you", ZONE.A.x - 4 + w, 28, FONT.b, COL.ink);
      if (d !== 0) tx(`${d > 0 ? "+" : MINUS}${Math.abs(d)} vs do nothing`, ZONE.A.x + w + 6, 28, FONT.s, d > 0 ? COL.gain : COL.loss);
      w = tx(`${n.B}`, ZONE.B.x - 4, 196, "600 15px Inter, sans-serif", COL.B);
      tx(" buy from " + fit(rival, 120, FONT.b), ZONE.B.x - 4 + w, 196, FONT.b, COL.ink);
      tx("Not buying", ZONE.O.x - 4, 106, FONT.s, COL.ink3);
      void you;
      sx.strokeStyle = COL.line;
      sx.lineWidth = 1.5;
      sx.setLineDash([3, 4]);
      for (const g of ["A", "B"] as const) {
        const yy = SHOP[g].y + 62;
        sx.beginPath();
        sx.moveTo(SHOP_X + SHOP_W, yy);
        sx.lineTo(598, yy);
        sx.stroke();
      }
      sx.setLineDash([]);
      const flying: Dot[] = [];
      for (const dd of dots) {
        stepDot(dd, now);
        if (dd.fly) {
          flying.push(dd);
          continue;
        }
        sx.beginPath();
        sx.arc(dd.x + 6, dd.y + 6, 6, 0, Math.PI * 2);
        sx.fillStyle = dd.c;
        sx.fill();
      }
      for (const dd of flying) {
        sx.beginPath();
        sx.arc(dd.x + 6, dd.y + 6, 6 + dd.fly * 1.5, 0, Math.PI * 2);
        sx.fillStyle = dd.c;
        sx.fill();
        sx.strokeStyle = COL.card;
        sx.lineWidth = 2;
        sx.stroke();
      }
    }

    function drawRoutes(dt: number, playing: boolean, slow: boolean, stockOut: Record<"A" | "B", boolean>) {
      sx.strokeStyle = COL.strong;
      sx.lineWidth = 1.5;
      sx.setLineDash([2, 5]);
      for (const g of ["A", "B"] as const) {
        const P = ROUTE[g];
        sx.beginPath();
        sx.moveTo(P[0][0], P[0][1]);
        sx.bezierCurveTo(P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1]);
        sx.stroke();
      }
      sx.setLineDash([]);
      if (playing) {
        for (const g of ["A", "B"] as const) {
          const rate = stockOut[g] ? 0 : slow ? 0.75 : 1.0;
          spawnAcc[g] += (rate * dt) / 1000;
          while (spawnAcc[g] >= 1) {
            spawnAcc[g]--;
            parcels.push({ g, t: 0 });
          }
        }
      }
      parcels = parcels.filter((p) => p.t < 1);
      for (const p of parcels) {
        if (playing) p.t += dt / (slow ? 1700 : 1300);
        if (p.t < 0) continue;
        const [px, py] = bez(ROUTE[p.g], p.t);
        const big = p.big ? 1.35 : 1;
        rr(px - 6 * big, py - 5 * big, 12 * big, 10 * big, 3, p.big ? COL.A : COL.ink3);
      }
    }

    function drawBubbles() {
      for (const b of bubbles.slice(0, 2)) {
        sx.font = "500 12.5px Inter, sans-serif";
        const w = sx.measureText(b.text).width + 20;
        const x = Math.max(4, Math.min(SW - w - 4, b.x - w / 2));
        sx.save();
        sx.shadowColor = "rgba(16,24,40,.14)";
        sx.shadowBlur = 8;
        sx.shadowOffsetY = 2;
        rr(x, b.y - 13, w, 26, 8, COL.card);
        sx.restore();
        rr(x + 0.5, b.y - 12.5, w - 1, 25, 8, undefined, COL.line);
        tx(b.text, x + 10, b.y + 4.5, "500 12.5px Inter, sans-serif", COL.ink2);
      }
    }

    function frame(ts: number) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(64, ts - (lastTs || ts));
      lastTs = ts;
      if (frames++ % 60 === 0) readCol();
      const st = useMarketStore.getState();
      const r = st.replay;
      const profile = st.profile;
      const you = shortName(profile?.business_name ?? "You");
      const rival = shortName(profile?.rival_name ?? "Rival");
      const wk = Math.min(r.week, Math.max(0, r.u1.length - 1));
      const t = r.u1[wk];
      const t0 = r.u1[0];
      const u2 = r.u2[wk];

      // reset when a different replay is loaded
      const sig = `${r.planName}|${r.shockId}|${r.u1.length === 0 ? "empty" : "data"}`;
      if (sig !== prevSig) {
        prevSig = sig;
        lastWeek = -1;
        parcels = [];
        pop = { A: null, B: null };
        spawnAcc = { A: 0.6, B: 0.2 };
      }

      if (t && wk !== lastWeek) {
        const jumped = lastWeek < 0 || Math.abs(wk - lastWeek) > 1;
        if (jumped) seedDots(wk);
        else assignDots(wk, ts);
        for (const g of ["A", "B"] as const) {
          const i = g === "A" ? 0 : 1;
          const prev = r.u1[Math.max(0, wk - 1)]?.price[i] ?? t.price[i];
          pop[g] = !jumped && Math.abs(t.price[i] - prev) > 0.001 ? { from: prev, to: t.price[i], t0: ts, until: ts + 1900 } : null;
        }
        const here = r.markers.filter((m) => m.week === wk);
        if (!jumped && here.some((m) => m.kind === "stock_arrives" && m.firm !== "B")) {
          for (let i = 0; i < 5; i++) parcels.push({ g: "A", t: -i * 0.12, big: true });
        }
        // at most two bubbles, above/below the dot groups so they never cover the group labels
        const recent = r.markers.filter((m) => m.week === wk || (m.week === wk - 1 && here.length === 0)).slice(0, 2);
        const spots = [{ x: 706, y: 162 }, { x: 110, y: 70 }];
        bubbles = recent.map((m, k) => ({ text: bubbleFor(m, you, rival), ...spots[k] }));
        lastWeek = wk;
      }
      if (!t) lastWeek = -1;

      sx.setTransform(cv.width / SW, 0, 0, cv.height / SH, 0, 0);
      sx.clearRect(0, 0, SW, SH);
      if (!COL.card) readCol();
      const slow = !!t && !!t0 && t.lead_time > t0.lead_time;
      const out: Record<"A" | "B", boolean> = { A: !!t && t.cover_weeks[0] <= 0.05, B: !!t && t.cover_weeks[1] <= 0.05 };
      drawRoutes(dt, r.playing, slow, out);
      drawSupplier(t, t0, profile?.supplier_region ?? "");
      const arrives = !!t && t.in_transit[0] > 0.5 && r.markers.some((m) => m.kind === "stock_arrives" && m.week === wk + 1);
      drawShop("A", t, profile?.business_name ?? "You", "You", ts, arrives);
      drawShop("B", t, profile?.rival_name ?? "Rival", "Rival", ts, false);
      const dnA = u2 ? Math.round(u2.shares[1] * NC) : counts(wk).A;
      if (t) drawZones(wk, you, rival, dnA, ts);
      else tx("Simulating this plan week by week…", SW / 2, SH / 2, FONT.b, COL.ink3, "center");
      drawBubbles();
    }
    readCol();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className="rp-scene" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="Market scene: supplier, your shop, the rival and customers" />
    </div>
  );
}

export default MarketScene;
