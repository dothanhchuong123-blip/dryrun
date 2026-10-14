import {
  ActiveThoughtBubble,
  ArenaEngineState,
  BUBBLE_DURATION_MS,
  TARGET_FIRM_A,
  TARGET_FIRM_B,
  TARGET_OUTSIDE_BANK,
  ZoneRect,
} from "./types";

const COLOR_BG = "#070b12";
const COLOR_GRID = "rgba(30, 41, 59, 0.35)";

// Consumer choice colours (1 = Firm A purple, 2 = Firm B amber/gold, 0 = Outside Bank slate/cyan)
const CHOICE_FILL_A = "#c084fc";
const CHOICE_HALO_A = "rgba(168, 85, 247, 0.28)";

const CHOICE_FILL_B = "#fbbf24";
const CHOICE_HALO_B = "rgba(245, 158, 11, 0.28)";

const CHOICE_FILL_BANK = "#94a3b8";
const CHOICE_HALO_BANK = "rgba(148, 163, 184, 0.22)";

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawBackgroundGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  const step = 28;
  ctx.beginPath();
  for (let x = step; x < width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = step; y < height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function drawPortZone(
  ctx: CanvasRenderingContext2D,
  port: ZoneRect,
  leadTime: number,
  cRaw: number
): void {
  drawRoundedRect(ctx, port.x, port.y, port.w, port.h, 8);
  ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  // Header badge
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("PORT / SUPPLIERS", port.x + 8, port.y + 16);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`Lead L = ${leadTime}t`, port.x + 8, port.y + 31);
  ctx.fillText(`c_raw = $${cRaw.toFixed(1)}`, port.x + 8, port.y + 44);
  ctx.fillText(
    `v_truck ∝ 1/${leadTime}t`,
    port.x + 8,
    port.y + 57
  );

  // Draw stylised container stacks inside Port
  const stackStartY = port.y + 72;
  const stackBottomY = port.y + port.h - 14;
  const slotH = 18;
  const colors = [
    "rgba(14, 165, 233, 0.25)",
    "rgba(56, 189, 248, 0.18)",
    "rgba(99, 102, 241, 0.22)",
  ];
  let idx = 0;
  for (let sy = stackStartY; sy + slotH < stackBottomY; sy += slotH + 6) {
    drawRoundedRect(ctx, port.x + 10, sy, port.w - 20, slotH, 3);
    ctx.fillStyle = colors[idx % colors.length];
    ctx.fill();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    idx++;
  }
}

function drawSupplyCorridorsAndTrucks(
  ctx: CanvasRenderingContext2D,
  engine: ArenaEngineState,
  nowMs: number
): void {
  const { port, firmA, firmB } = engine.layout;
  const w = engine.warehouse;

  const routes: Array<{
    firmIdx: 0 | 1;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    accent: string;
    flashColor: string;
  }> = [
    {
      firmIdx: 0,
      x0: port.x + port.w,
      y0: port.y + port.h * 0.28,
      x1: firmA.x,
      y1: firmA.cy,
      accent: "rgba(168, 85, 247, 0.45)",
      flashColor: "#38bdf8",
    },
    {
      firmIdx: 1,
      x0: port.x + port.w,
      y0: port.y + port.h * 0.72,
      x1: firmB.x,
      y1: firmB.cy,
      accent: "rgba(245, 158, 11, 0.45)",
      flashColor: "#38bdf8",
    },
  ];

  // Draw road lanes
  for (const r of routes) {
    const isFlashing =
      w.orders[r.firmIdx] > 0 || nowMs < w.orderFlashUntilMs[r.firmIdx];
    const pulse = isFlashing ? 0.55 + 0.45 * Math.sin(nowMs * 0.018) : 0;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(r.x0, r.y0);
    ctx.lineTo(r.x1, r.y1);
    ctx.strokeStyle = isFlashing
      ? `rgba(56, 189, 248, ${(0.45 + 0.45 * pulse).toFixed(2)})`
      : "rgba(51, 65, 85, 0.65)";
    ctx.lineWidth = isFlashing ? 11 : 8;
    ctx.lineCap = "round";
    ctx.stroke();

    // Dashed centre line
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(r.x0, r.y0);
    ctx.lineTo(r.x1, r.y1);
    ctx.strokeStyle = r.accent;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  // Draw trucks moving along the lanes
  for (const truck of engine.trucks) {
    const r = routes[truck.firmIdx];
    const isFlashing =
      w.orders[truck.firmIdx] > 0 || nowMs < w.orderFlashUntilMs[truck.firmIdx];
    const pulse = isFlashing
      ? 0.5 + 0.5 * Math.abs(Math.sin(nowMs * 0.022))
      : 0;

    const tx = r.x0 + (r.x1 - r.x0) * truck.progress;
    const ty = r.y0 + (r.y1 - r.y0) * truck.progress + truck.laneOffset;

    ctx.save();
    if (isFlashing) {
      ctx.shadowColor = "#38bdf8";
      ctx.shadowBlur = 10 + pulse * 8;
    }

    // Truck body
    drawRoundedRect(ctx, tx - 8, ty - 4.5, 16, 9, 2.5);
    if (isFlashing) {
      ctx.fillStyle = pulse > 0.5 ? "#e0f2fe" : "#38bdf8";
    } else {
      ctx.fillStyle = truck.firmIdx === 0 ? "#a855f7" : "#f59e0b";
    }
    ctx.fill();

    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Cab window highlight
    const cabX = truck.direction === 1 ? tx + 3 : tx - 6;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(cabX, ty - 2.5, 3, 5);
    ctx.restore();
  }
}

function drawFirmHQAndWarehouse(
  ctx: CanvasRenderingContext2D,
  zone: ZoneRect,
  firmIdx: 0 | 1,
  engine: ArenaEngineState,
  nowMs: number
): void {
  const w = engine.warehouse;
  const isFirmA = firmIdx === 0;
  const inv = w.inventory[firmIdx];
  const unmet = w.unmet[firmIdx];
  const orders = w.orders[firmIdx];
  const rop = w.rop[firmIdx];
  const price = w.price[firmIdx];
  const sharePct = (w.shares[firmIdx + 1] ?? 0) * 100;

  const isStockoutFlashing =
    unmet > 0 || nowMs < w.unmetFlashUntilMs[firmIdx];
  const stockoutPulse = isStockoutFlashing
    ? 0.5 + 0.5 * Math.sin(nowMs * 0.025)
    : 0;

  const isOrderFlashing =
    orders > 0 || nowMs < w.orderFlashUntilMs[firmIdx];

  // Outer HQ box
  drawRoundedRect(ctx, zone.x, zone.y, zone.w, zone.h, 8);
  ctx.fillStyle = isStockoutFlashing
    ? `rgba(69, 10, 26, ${(0.55 + 0.25 * stockoutPulse).toFixed(2)})`
    : isFirmA
    ? "rgba(30, 17, 54, 0.65)"
    : "rgba(45, 27, 10, 0.62)";
  ctx.fill();

  ctx.strokeStyle = isStockoutFlashing
    ? `rgba(244, 63, 94, ${(0.65 + 0.35 * stockoutPulse).toFixed(2)})`
    : isFirmA
    ? "rgba(168, 85, 247, 0.55)"
    : "rgba(245, 158, 11, 0.55)";
  ctx.lineWidth = isStockoutFlashing ? 2 : 1.4;
  ctx.stroke();

  // Firm Title & Price
  ctx.fillStyle = isFirmA ? "#d8b4fe" : "#fde68a";
  ctx.font = "bold 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    isFirmA ? "FIRM A HQ (ULTRA)" : "FIRM B HQ (ULTRA)",
    zone.x + 10,
    zone.y + 17
  );

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `$${price.toFixed(2)} · ${sharePct.toFixed(1)}%`,
    zone.x + 10,
    zone.y + 33
  );

  // Order badge when orders > 0
  if (isOrderFlashing) {
    const badgeW = 68;
    const badgeX = zone.x + zone.w - badgeW - 8;
    const badgeY = zone.y + 7;
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, 15, 3);
    ctx.fillStyle = "rgba(14, 165, 233, 0.3)";
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#bae6fd";
    ctx.font = "bold 9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(
      `+ORD ${orders > 0 ? orders.toFixed(0) : ""}`,
      badgeX + 5,
      badgeY + 11
    );
  }

  // Warehouse Stock Bar (horizontal gauge + ROP marker, flashes red when unmet > 0)
  const barX = zone.x + 10;
  const barY = zone.y + 42;
  const barW = Math.max(60, zone.w - 20);
  const barH = 12;

  drawRoundedRect(ctx, barX, barY, barW, barH, 3);
  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.fill();
  ctx.strokeStyle = isStockoutFlashing
    ? "#f43f5e"
    : "rgba(71, 85, 105, 0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const cap = Math.max(100, w.capacityRef);
  const fillRatio = Math.max(0, Math.min(1, inv / cap));
  const fillW = Math.max(fillRatio > 0 ? 3 : 0, barW * fillRatio);

  if (fillW > 0) {
    drawRoundedRect(ctx, barX, barY, fillW, barH, 3);
    ctx.fillStyle = isStockoutFlashing
      ? "#f43f5e"
      : isFirmA
      ? "#a855f7"
      : "#f59e0b";
    ctx.fill();
  }

  // Flashing red overlay on warehouse stock bar when unmet > 0
  if (isStockoutFlashing) {
    drawRoundedRect(ctx, barX, barY, barW, barH, 3);
    ctx.fillStyle = `rgba(244, 63, 94, ${(0.28 + 0.45 * stockoutPulse).toFixed(2)})`;
    ctx.fill();
  }

  // ROP threshold marker tick on the stock bar
  const ropRatio = Math.max(0, Math.min(1, rop / cap));
  const ropX = barX + barW * ropRatio;
  ctx.beginPath();
  ctx.moveTo(ropX, barY - 2);
  ctx.lineTo(ropX, barY + barH + 2);
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Stock & Unmet labels below bar
  ctx.font = "9.5px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = isStockoutFlashing ? "#fda4af" : "#cbd5e1";
  const stockLabel =
    unmet > 0
      ? `STOCK: ${inv.toFixed(0)}u · UNMET: ${unmet.toFixed(1)}u!`
      : `STOCK: ${inv.toFixed(0)}u · ROP: ${rop.toFixed(0)}u`;
  ctx.fillText(stockLabel, barX, barY + barH + 13);
}

function drawShoppingAndBankZones(
  ctx: CanvasRenderingContext2D,
  shopping: ZoneRect,
  bank: ZoneRect,
  engine: ArenaEngineState
): void {
  const w = engine.warehouse;

  // Shopping District
  drawRoundedRect(ctx, shopping.x, shopping.y, shopping.w, shopping.h, 8);
  ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(16, 185, 129, 0.4)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.fillStyle = "#6ee7b7";
  ctx.font = "bold 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `SHOPPING DISTRICT (${engine.spriteCount} CONSUMERS)`,
    shopping.x + 10,
    shopping.y + 16
  );

  ctx.fillStyle = "#94a3b8";
  ctx.font = "9.5px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `Sales A: ${w.sales[0].toFixed(0)}u · Sales B: ${w.sales[1].toFixed(0)}u`,
    shopping.x + 10,
    shopping.y + 30
  );

  // Subtle divider between upper (A-leaning) and lower (B-leaning) shopping concourse
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([3, 5]);
  ctx.moveTo(shopping.x + 10, shopping.cy);
  ctx.lineTo(shopping.x + shopping.w - 10, shopping.cy);
  ctx.strokeStyle = "rgba(100, 116, 139, 0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Outside Good / Bank Zone
  drawRoundedRect(ctx, bank.x, bank.y, bank.w, bank.h, 8);
  ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  const bankSharePct = (w.shares[0] ?? 0) * 100;
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `BANK / OUTSIDE GOOD (${bankSharePct.toFixed(1)}%)`,
    bank.x + 10,
    bank.y + 16
  );

  ctx.fillStyle = "#94a3b8";
  ctx.font = "9.5px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `Hold Cash / Unmet Lost: ${w.lostDemand.toFixed(1)}u`,
    bank.x + 10,
    bank.y + 30
  );
}

/**
 * Draws all active consumer sprites batched by choice colour so Canvas state
 * switches are O(1) instead of O(N), keeping 500 sprites well above 55-60 FPS.
 */
function drawConsumerSprites(
  ctx: CanvasRenderingContext2D,
  engine: ArenaEngineState
): void {
  const count = engine.spriteCount;
  const xArr = engine.x;
  const yArr = engine.y;
  const targets = engine.targets;
  const radius = count >= 500 ? 2.8 : 3.5;
  const haloRadius = radius + 2.2;

  const batches: Array<{
    targetCode: number;
    fill: string;
    halo: string;
  }> = [
    {
      targetCode: TARGET_OUTSIDE_BANK,
      fill: CHOICE_FILL_BANK,
      halo: CHOICE_HALO_BANK,
    },
    {
      targetCode: TARGET_FIRM_A,
      fill: CHOICE_FILL_A,
      halo: CHOICE_HALO_A,
    },
    {
      targetCode: TARGET_FIRM_B,
      fill: CHOICE_FILL_B,
      halo: CHOICE_HALO_B,
    },
  ];

  for (const batch of batches) {
    // Halo pass
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      if (targets[i] !== batch.targetCode) continue;
      const sx = xArr[i];
      const sy = yArr[i];
      ctx.moveTo(sx + haloRadius, sy);
      ctx.arc(sx, sy, haloRadius, 0, Math.PI * 2);
    }
    ctx.fillStyle = batch.halo;
    ctx.fill();

    // Core dot pass
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      if (targets[i] !== batch.targetCode) continue;
      const sx = xArr[i];
      const sy = yArr[i];
      ctx.moveTo(sx + radius, sy);
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    }
    ctx.fillStyle = batch.fill;
    ctx.fill();
  }
}

/**
 * Draws thought bubbles above 3-5 consumers per crowd archetype for 3s.
 * To keep the canvas readable while still highlighting all 3-5 consumers of
 * every archetype, each selected sprite gets a bright emerald thought ring +
 * callout stem, and compact text pills are rendered with vertical de-overlap.
 */
function drawThoughtBubbles(
  ctx: CanvasRenderingContext2D,
  engine: ArenaEngineState,
  nowMs: number
): void {
  const bubbles = engine.bubbles;
  if (bubbles.length === 0) return;

  const xArr = engine.x;
  const yArr = engine.y;
  const { width, height } = engine.layout;

  // 1. Highlight all 3-5 consumer sprites per archetype that currently hold a thought bubble
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const sx = xArr[b.spriteIndex];
    const sy = yArr[b.spriteIndex];
    ctx.moveTo(sx + 6.5, sy);
    ctx.arc(sx, sy, 6.5, 0, Math.PI * 2);
  }
  ctx.strokeStyle = "rgba(52, 211, 153, 0.85)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();

  // 2. Render floating thought bubble pills above the sprites
  // Cap simultaneous full text boxes if canvas is small while always showing compact mini-dots/pills
  ctx.save();
  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";

  const occupiedBoxes: Array<{ x: number; y: number; w: number; h: number }> =
    [];
  let labelledArchMask = 0;

  for (let i = 0; i < bubbles.length; i++) {
    const b: ActiveThoughtBubble = bubbles[i];
    const age = nowMs - b.createdAtMs;
    const remaining = b.expiresAtMs - nowMs;
    if (remaining <= 0) continue;

    const fadeIn = Math.min(1, age / 180);
    const fadeOut = Math.min(1, remaining / 350);
    const alpha = Math.max(0.15, Math.min(fadeIn, fadeOut));

    const sx = xArr[b.spriteIndex];
    const sy = yArr[b.spriteIndex];

    const snippet =
      b.text.length > 28 ? `${b.text.slice(0, 26)}…` : b.text;
    const labelText = `A${b.archetypeId}: ${snippet}`;
    const textW = Math.min(168, ctx.measureText(labelText).width + 10);
    const boxH = 15;

    let bx = Math.max(6, Math.min(width - textW - 6, sx - textW * 0.5));
    let by = Math.max(6, sy - 22);

    // Lightweight overlap avoidance so 3-5 bubbles per archetype stack cleanly
    let overlapping = false;
    for (let j = 0; j < occupiedBoxes.length; j++) {
      const ob = occupiedBoxes[j];
      if (
        bx < ob.x + ob.w + 2 &&
        bx + textW + 2 > ob.x &&
        by < ob.y + ob.h + 2 &&
        by + boxH + 2 > ob.y
      ) {
        by = ob.y - boxH - 3;
        if (by < 6) {
          overlapping = true;
          break;
        }
      }
    }

    // One text pill per archetype; its other 3-5 consumers get the compact marker
    const archBit = 1 << b.archetypeId;
    const archAlreadyLabelled = (labelledArchMask & archBit) !== 0;

    if (archAlreadyLabelled || overlapping || by > height - boxH - 4) {
      // Draw compact thought-bubble ellipsis indicator directly above the consumer sprite
      ctx.globalAlpha = alpha;
      drawRoundedRect(ctx, sx - 7, sy - 14, 14, 9, 4);
      ctx.fillStyle = "rgba(6, 78, 59, 0.9)";
      ctx.fill();
      ctx.strokeStyle = "rgba(52, 211, 153, 0.85)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#a7f3d0";
      ctx.fillText("•••", sx - 5, sy - 7);
      continue;
    }

    labelledArchMask |= archBit;
    occupiedBoxes.push({ x: bx, y: by, w: textW, h: boxH });

    ctx.globalAlpha = alpha;

    // Leader line from sprite to bubble
    ctx.beginPath();
    ctx.moveTo(sx, sy - 5);
    ctx.lineTo(
      Math.max(bx + 4, Math.min(bx + textW - 4, sx)),
      by + boxH
    );
    ctx.strokeStyle = "rgba(52, 211, 153, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pill box
    drawRoundedRect(ctx, bx, by, textW, boxH, 4);
    ctx.fillStyle = "rgba(6, 46, 38, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(52, 211, 153, 0.75)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#ecfdf5";
    ctx.fillText(labelText, bx + 5, by + 10.5);
  }

  ctx.restore();
}

export function renderArenaFrame(
  ctx: CanvasRenderingContext2D,
  engine: ArenaEngineState,
  nowMs: number
): void {
  const { width, height, port, firmA, firmB, shopping, bank } = engine.layout;

  ctx.save();
  ctx.setTransform(engine.dpr, 0, 0, engine.dpr, 0, 0);

  // 1. Background grid
  drawBackgroundGrid(ctx, width, height);

  // 2. Supply roads & animated trucks (Port -> Firm A / Firm B)
  drawSupplyCorridorsAndTrucks(ctx, engine, nowMs);

  // 3. Port / Suppliers zone (left)
  drawPortZone(ctx, port, engine.warehouse.leadTime, engine.warehouse.cRaw);

  // 4. Firm A HQ & Firm B HQ with warehouse stock bars
  drawFirmHQAndWarehouse(ctx, firmA, 0, engine, nowMs);
  drawFirmHQAndWarehouse(ctx, firmB, 1, engine, nowMs);

  // 5. Shopping District & Outside-Good Bank
  drawShoppingAndBankZones(ctx, shopping, bank, engine);

  // 6. Consumer sprites coloured by choice (batched typed-array draw)
  drawConsumerSprites(ctx, engine);

  // 7. Crowd archetype thought bubbles (3-5 consumers per archetype for 3s)
  drawThoughtBubbles(ctx, engine, nowMs);

  ctx.restore();
}

