import {
  CrowdArchetype,
  TickEventData,
  decodeChoicesB64,
} from "../../lib/events";
import { ChoicesBufferRef } from "../../lib/store";
import {
  ArenaEngineState,
  ArenaLayout,
  BUBBLE_DURATION_MS,
  DEFAULT_SPRITES,
  MAX_SPRITES,
  NUM_ARCHETYPES,
  SpriteCountOption,
  TARGET_FIRM_A,
  TARGET_FIRM_B,
  TARGET_OUTSIDE_BANK,
  TARGET_SHOPPING_DISTRICT,
  TRUCKS_PER_FIRM,
  TruckEntity,
  ZoneRect,
} from "./types";

/**
 * Deterministic fast PRNG (Mulberry32) so sprite anchor offsets and bubble
 * picks are reproducible and allocation-free.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeZone(x: number, y: number, w: number, h: number): ZoneRect {
  return {
    x,
    y,
    w,
    h,
    cx: x + w * 0.5,
    cy: y + h * 0.5,
  };
}

/**
 * Computes responsive zone rectangles for:
 * - Port / Suppliers (left)
 * - Firm A HQ & Warehouse (centre-left top)
 * - Firm B HQ & Warehouse (centre-left bottom)
 * - Shopping District (right-top/centre)
 * - Outside Good "Bank" (right-bottom)
 */
export function computeArenaLayout(width: number, height: number): ArenaLayout {
  const w = Math.max(320, width);
  const h = Math.max(260, height);
  const pad = Math.max(10, Math.min(18, w * 0.02));
  const topInset = pad;
  const usableH = h - topInset - pad;

  // Column X positions
  const portX = pad;
  const portW = Math.max(84, Math.min(130, w * 0.16));

  const hqX = portX + portW + Math.max(44, w * 0.075);
  const hqW = Math.max(125, Math.min(205, w * 0.25));

  const rightX = hqX + hqW + Math.max(32, w * 0.055);
  const rightW = Math.max(130, w - rightX - pad);

  const gapY = Math.max(12, usableH * 0.045);
  const firmH = (usableH - gapY) * 0.5;

  const shopH = usableH * 0.66 - gapY * 0.5;
  const bankH = usableH - shopH - gapY;

  return {
    width: w,
    height: h,
    port: makeZone(portX, topInset, portW, usableH),
    firmA: makeZone(hqX, topInset, hqW, firmH),
    firmB: makeZone(hqX, topInset + firmH + gapY, hqW, firmH),
    shopping: makeZone(rightX, topInset, rightW, shopH),
    bank: makeZone(rightX, topInset + shopH + gapY, rightW, bankH),
  };
}

export function createArenaEngineState(
  initialSpriteCount: SpriteCountOption = DEFAULT_SPRITES
): ArenaEngineState {
  const rng = mulberry32(0xdecafbad);

  const x = new Float32Array(MAX_SPRITES);
  const y = new Float32Array(MAX_SPRITES);
  const vx = new Float32Array(MAX_SPRITES);
  const vy = new Float32Array(MAX_SPRITES);
  const targets = new Int8Array(MAX_SPRITES);
  const decodedChoices = new Int8Array(MAX_SPRITES);
  const archetypeIds = new Uint8Array(MAX_SPRITES);
  const anchorOffsetX = new Float32Array(MAX_SPRITES);
  const anchorOffsetY = new Float32Array(MAX_SPRITES);
  const phase = new Float32Array(MAX_SPRITES);

  const defaultLayout = computeArenaLayout(760, 480);

  for (let i = 0; i < MAX_SPRITES; i++) {
    // Initial distribution across Shopping District, Firm A, Firm B, and Bank
    const mod = i % 10;
    const initTarget =
      mod < 4
        ? TARGET_FIRM_A
        : mod < 8
        ? TARGET_FIRM_B
        : TARGET_OUTSIDE_BANK;
    targets[i] = initTarget;
    archetypeIds[i] = (i % NUM_ARCHETYPES) + 1;
    anchorOffsetX[i] = (rng() - 0.5) * 0.76;
    anchorOffsetY[i] = (rng() - 0.5) * 0.68;
    phase[i] = rng() * Math.PI * 2;

    // Start inside shopping district so sprites walk smoothly to first targets
    x[i] =
      defaultLayout.shopping.cx +
      anchorOffsetX[i] * defaultLayout.shopping.w * 0.85;
    y[i] =
      defaultLayout.shopping.cy +
      anchorOffsetY[i] * defaultLayout.shopping.h * 0.85;
  }

  const trucks: TruckEntity[] = [];
  for (const firmIdx of [0, 1] as const) {
    for (let k = 0; k < TRUCKS_PER_FIRM; k++) {
      trucks.push({
        firmIdx,
        laneOffset: (k - (TRUCKS_PER_FIRM - 1) * 0.5) * 9,
        progress: (k / TRUCKS_PER_FIRM + firmIdx * 0.17) % 1,
        direction: k % 2 === 0 ? 1 : -1,
      });
    }
  }

  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  return {
    spriteCount: initialSpriteCount,
    initialized: true,
    lastFrameTimeMs: now,
    lastProcessedTick: -1,
    lastProcessedCrowdTick: -1,
    lastCrowdSignature: "",

    x,
    y,
    vx,
    vy,
    targets,
    decodedChoices,
    archetypeIds,
    anchorOffsetX,
    anchorOffsetY,
    phase,

    trucks,
    warehouse: {
      inventory: [180, 180],
      rawInv: [300, 300],
      rop: [220, 220],
      capacityRef: 400,
      unmet: [0, 0],
      orders: [0, 0],
      spillIn: [0, 0],
      price: [94.0, 91.5],
      sales: [0, 0],
      profit: [0, 0],
      leadTime: 4,
      cRaw: 52.0,
      shares: [0.16, 0.46, 0.38],
      lostDemand: 0,
      orderFlashUntilMs: [0, 0],
      unmetFlashUntilMs: [0, 0],
    },

    bubbles: [],
    archetypes: [],

    layout: defaultLayout,
    dpr: 1,

    fps: 60,
    frameCount: 0,
    fpsWindowStartMs: now,
    lastFpsLogMs: now,
  };
}

/**
 * Rescales existing sprite positions proportionally when the canvas resizes
 * so sprites never jump or clip outside bounds.
 */
export function updateArenaDimensions(
  engine: ArenaEngineState,
  width: number,
  height: number,
  dpr: number
): void {
  const prevW = engine.layout.width || width;
  const prevH = engine.layout.height || height;
  const nextLayout = computeArenaLayout(width, height);

  if (prevW > 0 && prevH > 0 && (prevW !== nextLayout.width || prevH !== nextLayout.height)) {
    const scaleX = nextLayout.width / prevW;
    const scaleY = nextLayout.height / prevH;
    for (let i = 0; i < MAX_SPRITES; i++) {
      engine.x[i] *= scaleX;
      engine.y[i] *= scaleY;
    }
  }

  engine.layout = nextLayout;
  engine.dpr = dpr;
}

/**
 * Synchronises consumer targets and warehouse/supply-chain telemetry when a new
 * U1 tick arrives. Supports both direct `choices_b64` decoding and the shared
 * `choicesRef` TypedArray buffer.
 */
export function syncTickToEngine(
  engine: ArenaEngineState,
  u1: TickEventData | null,
  sharedChoicesRef: ChoicesBufferRef,
  nowMs: number
): void {
  if (!u1) return;
  if (u1.tick === engine.lastProcessedTick) return;
  engine.lastProcessedTick = u1.tick;

  const w = engine.warehouse;
  w.inventory = [u1.inventory?.[0] ?? 0, u1.inventory?.[1] ?? 0];
  w.rawInv = [u1.raw_inv?.[0] ?? 0, u1.raw_inv?.[1] ?? 0];
  w.rop = [u1.rop?.[0] ?? 200, u1.rop?.[1] ?? 200];
  w.unmet = [u1.unmet?.[0] ?? 0, u1.unmet?.[1] ?? 0];
  w.orders = [u1.orders?.[0] ?? 0, u1.orders?.[1] ?? 0];
  w.spillIn = [u1.spill_in?.[0] ?? 0, u1.spill_in?.[1] ?? 0];
  w.price = [u1.price?.[0] ?? 94, u1.price?.[1] ?? 91.5];
  w.sales = [u1.sales?.[0] ?? 0, u1.sales?.[1] ?? 0];
  w.profit = [u1.profit?.[0] ?? 0, u1.profit?.[1] ?? 0];
  w.leadTime = Math.max(1, u1.lead_time ?? 4);
  w.cRaw = u1.c_raw ?? 52;
  w.shares = [
    u1.shares?.[0] ?? 0.16,
    u1.shares?.[1] ?? 0.46,
    u1.shares?.[2] ?? 0.38,
  ];
  w.lostDemand = u1.lost ?? 0;

  const maxStockSeen = Math.max(
    w.capacityRef,
    w.inventory[0],
    w.inventory[1],
    w.rop[0] * 1.35,
    w.rop[1] * 1.35,
    250
  );
  w.capacityRef = maxStockSeen;

  // Trigger order flash when orders > 0
  if (w.orders[0] > 0) {
    w.orderFlashUntilMs[0] = nowMs + 1350;
  }
  if (w.orders[1] > 0) {
    w.orderFlashUntilMs[1] = nowMs + 1350;
  }

  // Trigger warehouse red stockout flash when unmet > 0
  if (w.unmet[0] > 0) {
    w.unmetFlashUntilMs[0] = nowMs + 1450;
  }
  if (w.unmet[1] > 0) {
    w.unmetFlashUntilMs[1] = nowMs + 1450;
  }

  // Decode choices_b64 into each consumer's target zone (0=Bank, 1=Firm A, 2=Firm B)
  let sourceArray: Int8Array | null = null;
  if (u1.choices_b64) {
    engine.decodedChoices = decodeChoicesB64(
      u1.choices_b64,
      engine.decodedChoices
    );
    sourceArray = engine.decodedChoices;
  } else if (
    sharedChoicesRef.tick === u1.tick &&
    sharedChoicesRef.current.length > 0
  ) {
    sourceArray = sharedChoicesRef.current;
  }

  const srcLen = sourceArray ? sourceArray.length : 0;
  if (sourceArray && srcLen > 0) {
    for (let i = 0; i < MAX_SPRITES; i++) {
      const rawChoice = sourceArray[i % srcLen];
      const clampedChoice =
        rawChoice === TARGET_FIRM_A || rawChoice === TARGET_FIRM_B
          ? rawChoice
          : TARGET_OUTSIDE_BANK;
      engine.targets[i] = clampedChoice;
    }
  } else {
    // Fallback deterministic target allocation from shares if choices_b64 is absent
    const cut0 = w.shares[0];
    const cut1 = cut0 + w.shares[1];
    for (let i = 0; i < MAX_SPRITES; i++) {
      const frac = (i + 0.5) / MAX_SPRITES;
      engine.targets[i] =
        frac < cut0
          ? TARGET_OUTSIDE_BANK
          : frac < cut1
          ? TARGET_FIRM_A
          : TARGET_FIRM_B;
    }
  }
}

/**
 * Schedules thought bubbles when crowd archetype updates arrive.
 * For each crowd archetype bubble, assigns it to 3-5 consumers of that
 * archetype for 3 seconds (3,000 ms).
 */
export function syncCrowdBubblesToEngine(
  engine: ArenaEngineState,
  crowdTick: number,
  archetypes: CrowdArchetype[],
  nowMs: number
): void {
  if (!archetypes || archetypes.length === 0) return;

  const signature = `${crowdTick}:${archetypes
    .map((a) => `${a.id}:${a.bubble}`)
    .join("|")}`;
  if (signature === engine.lastCrowdSignature) return;

  engine.lastProcessedCrowdTick = crowdTick;
  engine.lastCrowdSignature = signature;
  engine.archetypes = archetypes;

  const activeCount = engine.spriteCount;
  const rng = mulberry32((crowdTick + 1) * 0x9e3779b9);
  const nextBubbles = [];

  for (let aIdx = 0; aIdx < archetypes.length; aIdx++) {
    const arch = archetypes[aIdx];
    const bubbleText = (arch.bubble || "").trim();
    if (!bubbleText) continue;

    const archId = ((arch.id - 1 + NUM_ARCHETYPES) % NUM_ARCHETYPES) + 1;

    // Collect candidate sprite indices belonging to this archetype within active spriteCount
    const candidates: number[] = [];
    for (let s = 0; s < activeCount; s++) {
      if (engine.archetypeIds[s] === archId) {
        candidates.push(s);
      }
    }
    if (candidates.length === 0) continue;

    // Deterministically pick 3 to 5 consumers of this archetype
    const desiredCount = 3 + (Math.floor(rng() * 3) % 3); // 3, 4, or 5
    const pickCount = Math.min(desiredCount, candidates.length);

    // Partial Fisher-Yates shuffle on candidates
    for (let k = 0; k < pickCount; k++) {
      const swapIdx = k + Math.floor(rng() * (candidates.length - k));
      const tmp = candidates[k];
      candidates[k] = candidates[swapIdx];
      candidates[swapIdx] = tmp;

      nextBubbles.push({
        spriteIndex: candidates[k],
        archetypeId: archId,
        label: arch.label || `Arch #${archId}`,
        text:
          bubbleText.length > 60 ? `${bubbleText.slice(0, 57)}…` : bubbleText,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + BUBBLE_DURATION_MS,
      });
    }
  }

  engine.bubbles = nextBubbles;
}

// Reused output slot so the per-frame physics loop allocates nothing.
const destScratch = { tx: 0, ty: 0 };

function setDest(tx: number, ty: number): { tx: number; ty: number } {
  destScratch.tx = tx;
  destScratch.ty = ty;
  return destScratch;
}

/**
 * Resolves the target coordinate for consumer `i` inside its destination zone.
 * Consumers pass through / fan around the Shopping District and settle into
 * Firm A store zone, Firm B store zone, or the Outside Good Bank.
 */
function resolveConsumerDestination(
  engine: ArenaEngineState,
  i: number
): { tx: number; ty: number } {
  const target = engine.targets[i];
  const { firmA, firmB, bank, shopping } = engine.layout;
  const ox = engine.anchorOffsetX[i];
  const oy = engine.anchorOffsetY[i];

  if (target === TARGET_FIRM_A) {
    // Cluster between Firm A storefront right half and upper Shopping District
    const useStorefront = (i & 1) === 0;
    if (useStorefront) {
      return setDest(
      firmA.x + firmA.w * 0.62 + ox * firmA.w * 0.58,
      firmA.y + firmA.h * 0.56 + oy * firmA.h * 0.55
    );
    }
    return setDest(
      shopping.x + shopping.w * 0.48 + ox * shopping.w * 0.78,
      shopping.y + shopping.h * 0.3 + oy * shopping.h * 0.36
    );
  }

  if (target === TARGET_FIRM_B) {
    // Cluster between Firm B storefront right half and lower Shopping District
    const useStorefront = (i & 1) === 0;
    if (useStorefront) {
      return setDest(
      firmB.x + firmB.w * 0.62 + ox * firmB.w * 0.58,
      firmB.y + firmB.h * 0.56 + oy * firmB.h * 0.55
    );
    }
    return setDest(
      shopping.x + shopping.w * 0.48 + ox * shopping.w * 0.78,
      shopping.y + shopping.h * 0.72 + oy * shopping.h * 0.36
    );
  }

  if (target === TARGET_SHOPPING_DISTRICT) {
    return setDest(
      shopping.cx + ox * shopping.w * 0.8,
      shopping.cy + oy * shopping.h * 0.8
    );
  }

  // TARGET_OUTSIDE_BANK (0)
  return setDest(
      bank.cx + ox * bank.w * 0.78,
      bank.cy + oy * bank.h * 0.66
    );
}

/**
 * Advances one frame of the Arena simulation (consumer easing kinematics,
 * lead-time proportional trucks, bubble expiry, and dev FPS logging).
 */
export function stepArenaPhysics(
  engine: ArenaEngineState,
  nowMs: number
): void {
  const rawDt = (nowMs - engine.lastFrameTimeMs) / 1000;
  const dt = Math.min(0.05, Math.max(0.001, rawDt || 1 / 60));
  engine.lastFrameTimeMs = nowMs;

  // Update FPS counter (rolling 500ms window)
  engine.frameCount += 1;
  const elapsedFpsMs = nowMs - engine.fpsWindowStartMs;
  if (elapsedFpsMs >= 500) {
    engine.fps = Math.round((engine.frameCount * 1000) / elapsedFpsMs);
    engine.frameCount = 0;
    engine.fpsWindowStartMs = nowMs;

    if (
      process.env.NODE_ENV !== "production" &&
      nowMs - engine.lastFpsLogMs >= 4000
    ) {
      engine.lastFpsLogMs = nowMs;
      // Log FPS in dev as required by T12 spec
      console.debug(
        `[Arena T12] ${engine.fps} FPS @ ${engine.spriteCount} sprites (tick #${engine.lastProcessedTick})`
      );
    }
  }

  // Prune expired thought bubbles (3-second lifetime)
  if (engine.bubbles.length > 0) {
    let writeIdx = 0;
    for (let i = 0; i < engine.bubbles.length; i++) {
      const b = engine.bubbles[i];
      if (b.expiresAtMs > nowMs && b.spriteIndex < engine.spriteCount) {
        engine.bubbles[writeIdx++] = b;
      }
    }
    engine.bubbles.length = writeIdx;
  }

  // Advance supply-chain trucks: speed is strictly proportional to 1 / lead_time
  const leadTime = Math.max(1, engine.warehouse.leadTime || 4);
  const baseTruckSpeed = 1.45 / leadTime; // full corridor traversal per second at L=1 is 1.45x
  for (let t = 0; t < engine.trucks.length; t++) {
    const truck = engine.trucks[t];
    const orderBoost =
      nowMs < engine.warehouse.orderFlashUntilMs[truck.firmIdx] ? 1.25 : 1.0;
    truck.progress += truck.direction * baseTruckSpeed * orderBoost * dt;
    if (truck.progress >= 1) {
      truck.progress = 1;
      truck.direction = -1;
    } else if (truck.progress <= 0) {
      truck.progress = 0;
      truck.direction = 1;
    }
  }

  // Advance consumer sprites with damped spring-easing toward target zones
  const count = engine.spriteCount;
  const xArr = engine.x;
  const yArr = engine.y;
  const vxArr = engine.vx;
  const vyArr = engine.vy;
  const phaseArr = engine.phase;

  const springK = 5.2;
  const damping = Math.exp(-6.5 * dt);
  const timeSec = nowMs * 0.003;

  for (let i = 0; i < count; i++) {
    const { tx, ty } = resolveConsumerDestination(engine, i);
    const dx = tx - xArr[i];
    const dy = ty - yArr[i];

    // Subtle organic micro-motion when settled in zone
    const ph = phaseArr[i];
    const swayX = Math.cos(timeSec + ph) * 1.8;
    const swayY = Math.sin(timeSec * 1.15 + ph) * 1.8;

    vxArr[i] = (vxArr[i] + (dx + swayX) * springK * dt) * damping;
    vyArr[i] = (vyArr[i] + (dy + swayY) * springK * dt) * damping;

    xArr[i] += vxArr[i] * dt * 60 * 0.12 + dx * (1 - Math.exp(-3.4 * dt));
    yArr[i] += vyArr[i] * dt * 60 * 0.12 + dy * (1 - Math.exp(-3.4 * dt));
  }
}

