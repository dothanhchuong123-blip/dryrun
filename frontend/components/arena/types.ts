import { CrowdArchetype, FirmPair, ShareTriple } from "../../lib/events";

export type SpriteCountOption = 200 | 500;

/**
 * Consumer choice / target zone indices (matches choices_b64 Int8 encoding):
 * 0 = Outside Good / Bank
 * 1 = Firm A HQ / Storefront
 * 2 = Firm B HQ / Storefront
 * 3 = Shopping District (neutral concourse before/between ticks)
 */
export const TARGET_OUTSIDE_BANK = 0;
export const TARGET_FIRM_A = 1;
export const TARGET_FIRM_B = 2;
export const TARGET_SHOPPING_DISTRICT = 3;

export const MAX_SPRITES = 500;
export const DEFAULT_SPRITES: SpriteCountOption = 200;
export const NUM_ARCHETYPES = 12;
export const BUBBLE_DURATION_MS = 3000;
export const TRUCKS_PER_FIRM = 3;

export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface ArenaLayout {
  width: number;
  height: number;
  port: ZoneRect;
  firmA: ZoneRect;
  firmB: ZoneRect;
  shopping: ZoneRect;
  bank: ZoneRect;
}

export interface TruckEntity {
  firmIdx: 0 | 1;
  laneOffset: number;
  /** Progress along route 0..1 from Port (0) to Firm HQ (1) */
  progress: number;
  direction: 1 | -1;
}

export interface ActiveThoughtBubble {
  spriteIndex: number;
  archetypeId: number;
  label: string;
  text: string;
  expiresAtMs: number;
  createdAtMs: number;
}

export interface WarehouseVisualState {
  inventory: FirmPair<number>;
  rawInv: FirmPair<number>;
  rop: FirmPair<number>;
  capacityRef: number;
  unmet: FirmPair<number>;
  orders: FirmPair<number>;
  spillIn: FirmPair<number>;
  price: FirmPair<number>;
  sales: FirmPair<number>;
  profit: FirmPair<number>;
  leadTime: number;
  cRaw: number;
  shares: ShareTriple<number>;
  lostDemand: number;
  /** Timestamp until which the order dispatch flash stays active per firm */
  orderFlashUntilMs: FirmPair<number>;
  /** Timestamp until which the stockout red flash stays active per firm */
  unmetFlashUntilMs: FirmPair<number>;
}

/**
 * All mutable simulation state held strictly inside a single ref object.
 * Sprite kinematics use typed arrays (Float32Array & Int8Array) to guarantee
 * zero garbage-collection pauses and zero React re-renders on the 60 FPS loop.
 */
export interface ArenaEngineState {
  spriteCount: SpriteCountOption;
  initialized: boolean;
  lastFrameTimeMs: number;
  lastProcessedTick: number;
  lastProcessedCrowdTick: number;
  lastCrowdSignature: string;

  // TypedArray sprite buffers (allocated to MAX_SPRITES = 500)
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Target zone per consumer: 0 = Bank/Outside, 1 = Firm A, 2 = Firm B */
  targets: Int8Array;
  /** Decoded raw choices buffer (reused across U1 ticks) */
  decodedChoices: Int8Array;
  /** Assigned archetype ID (1..12) per consumer sprite */
  archetypeIds: Uint8Array;
  /** Deterministic per-sprite jitter/anchor offsets (-0.5..0.5) inside target zone */
  anchorOffsetX: Float32Array;
  anchorOffsetY: Float32Array;
  /** Phase offset for subtle walking bob */
  phase: Float32Array;

  // Supply chain trucks & warehouse state
  trucks: TruckEntity[];
  warehouse: WarehouseVisualState;

  // Active crowd thought bubbles (3-5 sprites per archetype for 3s)
  bubbles: ActiveThoughtBubble[];
  archetypes: CrowdArchetype[];

  // Canvas geometry
  layout: ArenaLayout;
  dpr: number;

  // FPS monitoring
  fps: number;
  frameCount: number;
  fpsWindowStartMs: number;
  lastFpsLogMs: number;
}

