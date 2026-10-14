"use client";

import React, { useEffect, useRef, useState } from "react";
import { choicesRef, useMarketStore } from "../lib/store";
import { renderArenaFrame } from "./arena/renderer";
import {
  createArenaEngineState,
  stepArenaPhysics,
  syncCrowdBubblesToEngine,
  syncTickToEngine,
  updateArenaDimensions,
} from "./arena/simulation";
import {
  ArenaEngineState,
  DEFAULT_SPRITES,
  SpriteCountOption,
} from "./arena/types";

export interface ArenaProps {
  className?: string;
  initialSpriteCount?: SpriteCountOption;
}

/**
 * 2D Market & Supply-Chain Arena (Task T12).
 * - Uses HTML5 Canvas 2D with its own requestAnimationFrame loop.
 * - All consumer positions/velocities (Float32Array) and targets (Int8Array)
 *   live strictly inside `engineRef` — never in React state.
 * - DPR-aware and responsive via ResizeObserver.
 */
export function Arena({
  className = "",
  initialSpriteCount = DEFAULT_SPRITES,
}: ArenaProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpsBadgeRef = useRef<HTMLSpanElement | null>(null);
  const tickBadgeRef = useRef<HTMLSpanElement | null>(null);
  const leadBadgeRef = useRef<HTMLSpanElement | null>(null);

  // All simulation state lives in a single mutable ref (typed arrays inside)
  const engineRef = useRef<ArenaEngineState | null>(null);
  if (engineRef.current === null) {
    engineRef.current = createArenaEngineState(initialSpriteCount);
  }

  // Only config toggle UI state (200 vs 500 sprites) is mirrored for the button active style
  const [spriteCountOption, setSpriteCountOption] =
    useState<SpriteCountOption>(initialSpriteCount);

  const handleSpriteCountChange = (nextCount: SpriteCountOption) => {
    setSpriteCountOption(nextCount);
    if (engineRef.current) {
      engineRef.current.spriteCount = nextCount;
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!container || !canvas || !engine) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const applyCanvasSize = (widthCss: number, heightCss: number) => {
      const w = Math.max(300, Math.floor(widthCss));
      const h = Math.max(240, Math.floor(heightCss));
      const dpr =
        typeof window !== "undefined"
          ? Math.min(window.devicePixelRatio || 1, 2.5)
          : 1;

      const targetPixelW = Math.floor(w * dpr);
      const targetPixelH = Math.floor(h * dpr);
      if (canvas.width !== targetPixelW || canvas.height !== targetPixelH) {
        canvas.width = targetPixelW;
        canvas.height = targetPixelH;
      }
      updateArenaDimensions(engine, w, h, dpr);
    };

    // Initial size measurement
    const rect = container.getBoundingClientRect();
    applyCanvasSize(rect.width || 720, rect.height || 440);

    // DPR-aware ResizeObserver
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          if (cr.width > 0 && cr.height > 0) {
            applyCanvasSize(cr.width, cr.height);
          }
        }
      });
      resizeObserver.observe(container);
    }

    let rafId = 0;
    let lastHudDomUpdateMs = 0;

    const animate = (nowMs: number) => {
      const storeState = useMarketStore.getState();

      // Sync latest U1 tick choices_b64 & supply chain metrics into typed arrays
      if (storeState.latestU1) {
        syncTickToEngine(engine, storeState.latestU1, choicesRef, nowMs);
      } else if (
        storeState.currentTick === 0 &&
        engine.lastProcessedTick > 0
      ) {
        // Handle run reset cleanly
        engine.lastProcessedTick = 0;
        engine.bubbles.length = 0;
      }

      // Sync crowd archetype thought bubbles (3-5 consumers per archetype for 3s)
      if (storeState.crowd && storeState.crowd.archetypes.length > 0) {
        syncCrowdBubblesToEngine(
          engine,
          storeState.crowd.tick,
          storeState.crowd.archetypes,
          nowMs
        );
      } else if (storeState.archetypes.length > 0 && engine.lastProcessedCrowdTick < 0) {
        syncCrowdBubblesToEngine(
          engine,
          storeState.currentTick,
          storeState.archetypes,
          nowMs
        );
      }

      // Step physics & render Canvas 2D
      stepArenaPhysics(engine, nowMs);
      renderArenaFrame(ctx, engine, nowMs);

      // Update lightweight DOM HUD text via refs every ~250ms (zero React re-renders)
      if (nowMs - lastHudDomUpdateMs >= 250) {
        lastHudDomUpdateMs = nowMs;
        if (fpsBadgeRef.current) {
          fpsBadgeRef.current.textContent = `${engine.fps} FPS`;
          fpsBadgeRef.current.className =
            engine.fps >= 55
              ? "rounded border border-emerald-500/40 bg-emerald-950/50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300"
              : "rounded border border-amber-500/40 bg-amber-950/50 px-1.5 py-0.5 font-mono text-[10px] text-amber-300";
        }
        if (tickBadgeRef.current) {
          tickBadgeRef.current.textContent = `TICK #${storeState.currentTick}`;
        }
        if (leadBadgeRef.current) {
          const w = engine.warehouse;
          leadBadgeRef.current.textContent = `L=${w.leadTime}t · c_raw=$${w.cRaw.toFixed(1)}`;
        }
      }

      rafId = window.requestAnimationFrame(animate);
    };

    rafId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded border border-slate-800/90 bg-[#090d14] ${className}`}
    >
      {/* Top Arena Control & Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0b101b] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-purple-400 shadow-[0_0_6px_#c084fc]" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Market & Supply-Chain Arena
          </h2>
          <span
            ref={tickBadgeRef}
            className="rounded border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
          >
            TICK #0
          </span>
          <span
            ref={leadBadgeRef}
            className="hidden font-mono text-[10px] text-cyan-400 sm:inline"
          >
            L=4t · c_raw=$52.0
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Choice Colour Legend */}
          <div className="hidden items-center gap-2 text-[10px] text-slate-400 md:flex">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              Firm A
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Firm B
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              Bank
            </span>
          </div>

          {/* 200 / 500 Sprites Config Toggle */}
          <div
            role="group"
            aria-label="Consumer sprite count"
            className="inline-flex overflow-hidden rounded border border-slate-700/90 bg-[#070b12] p-0.5 font-mono text-[10px]"
          >
            {([200, 500] as const).map((countOpt) => (
              <button
                key={countOpt}
                type="button"
                onClick={() => handleSpriteCountChange(countOpt)}
                className={`rounded px-1.5 py-0.5 transition ${
                  spriteCountOption === countOpt
                    ? "bg-cyan-500/20 font-semibold text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {countOpt} sprites
              </button>
            ))}
          </div>

          {/* Live FPS Counter Badge */}
          <span
            ref={fpsBadgeRef}
            className="rounded border border-emerald-500/40 bg-emerald-950/50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300"
          >
            60 FPS
          </span>
        </div>
      </div>

      {/* DPR-Aware Canvas Viewport */}
      <div
        ref={containerRef}
        className="relative min-h-[260px] flex-1 w-full overflow-hidden bg-[#070b12]"
      >
        <canvas
          ref={canvasRef}
          aria-label="Market Digital Twin 2D Simulation Arena"
          className="block h-full w-full"
        />
      </div>
    </div>
  );
}

export default Arena;

