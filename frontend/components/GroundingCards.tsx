"use client";

import React, { useEffect, useState } from "react";
import { NewsCheckResponse, ShockResponse } from "../lib/events";
import {
  extractDomain,
  formatShockDelta,
  formatTimestamp,
} from "../lib/format";
import { useMarketStore } from "../lib/store";
import { getApiBase, getStreamClient } from "../lib/stream";

export interface GroundingCardsProps {
  className?: string;
  showShockInput?: boolean;
}

const NEWS_CHECK_COOLDOWN_SECONDS = 60;

async function postNewsCheckRequest(
  runId: string | null,
  usingMock: boolean,
  storeTrigger: () => Promise<NewsCheckResponse>
): Promise<NewsCheckResponse> {
  getStreamClient();
  const res = await storeTrigger();

  if (
    !res.accepted &&
    !usingMock &&
    (res.reason === "No active run." ||
      res.reason === "Stream client not initialized.")
  ) {
    const apiBase = getApiBase();
    const endpoint = runId
      ? `${apiBase}/api/runs/${encodeURIComponent(runId)}/news-check`
      : `${apiBase}/news-check`;
    try {
      const httpRes = await fetch(endpoint, { method: "POST" });
      if (!httpRes.ok) {
        return { accepted: false, reason: `HTTP ${httpRes.status}` };
      }
      return (await httpRes.json()) as NewsCheckResponse;
    } catch {
      return res;
    }
  }
  return res;
}

async function postCustomShockRequest(
  text: string,
  runId: string | null,
  usingMock: boolean,
  storeSubmit: (t: string) => Promise<ShockResponse>
): Promise<ShockResponse> {
  getStreamClient();
  const res = await storeSubmit(text);

  if (
    !res.accepted &&
    !usingMock &&
    (res.reason === "No active run." ||
      res.reason === "Stream client not initialized.")
  ) {
    const apiBase = getApiBase();
    const endpoint = runId
      ? `${apiBase}/api/runs/${encodeURIComponent(runId)}/shock`
      : `${apiBase}/shock`;
    try {
      const httpRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!httpRes.ok) {
        return { accepted: false, reason: `HTTP ${httpRes.status}` };
      }
      return (await httpRes.json()) as ShockResponse;
    } catch {
      return res;
    }
  }
  return res;
}

/**
 * Left-pane Tavily Grounding Proof Cards, "Check live news" button (with 60s cooldown),
 * and custom shock input (disabled in REPLAY mode).
 */
export function GroundingCards({
  className = "",
  // app/page.tsx already renders a shock form; pass true once that one is removed.
  showShockInput = false,
}: GroundingCardsProps) {
  const groundings = useMarketStore((s) => s.groundings);
  const mode = useMarketStore((s) => s.mode);
  const runId = useMarketStore((s) => s.runId);
  const usingMock = useMarketStore((s) => s.usingMock);
  const triggerNewsCheck = useMarketStore((s) => s.triggerNewsCheck);
  const submitShock = useMarketStore((s) => s.submitShock);

  const [checkingNews, setCheckingNews] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [rejectReason, setRejectReason] = useState<string | null>(null);

  const [shockInput, setShockInput] = useState("");
  const [submittingShock, setSubmittingShock] = useState(false);
  const [shockNotice, setShockNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timer = setInterval(() => {
      setCooldownLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownLeft]);

  const handleCheckLiveNews = async () => {
    if (checkingNews || cooldownLeft > 0) return;
    setCheckingNews(true);
    setRejectReason(null);

    try {
      const res = await postNewsCheckRequest(
        runId,
        usingMock,
        triggerNewsCheck
      );
      setCooldownLeft(NEWS_CHECK_COOLDOWN_SECONDS);
      if (!res.accepted) {
        setRejectReason(
          res.reason || "Live news check rejected by rate or credit guard."
        );
      }
    } catch {
      setCooldownLeft(NEWS_CHECK_COOLDOWN_SECONDS);
      setRejectReason("Unable to reach /news-check endpoint.");
    } finally {
      setCheckingNews(false);
    }
  };

  const handleCustomShockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = shockInput.trim();
    if (!trimmed || mode === "replay" || submittingShock) return;

    setSubmittingShock(true);
    setShockNotice(null);
    try {
      const res = await postCustomShockRequest(
        trimmed,
        runId,
        usingMock,
        submitShock
      );
      if (res.accepted) {
        setShockInput("");
        setShockNotice({
          ok: true,
          text: "Custom shock sent to Super parser.",
        });
      } else {
        setShockNotice({
          ok: false,
          text: res.reason || "Custom shock rejected.",
        });
      }
    } finally {
      setSubmittingShock(false);
    }
  };

  const isReplay = mode === "replay";

  return (
    <div
      data-testid="grounding-cards-pane"
      className={`flex h-full w-full flex-col overflow-hidden rounded border border-slate-800/90 bg-[#0b0f17] p-2 text-xs ${className}`}
    >
      {/* Header Row + "Check live news" Button (Enabled in BOTH LIVE & REPLAY) */}
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-1.5 border-b border-slate-800/80 pb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-cyan-400" />
          <span className="truncate font-bold uppercase tracking-wider text-slate-200">
            Tavily Grounding
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 tabular-nums">
            {groundings.length}
          </span>
        </div>

        <button
          type="button"
          data-testid="check-live-news-btn"
          onClick={handleCheckLiveNews}
          disabled={checkingNews || cooldownLeft > 0}
          className="shrink-0 rounded border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-200 transition hover:border-cyan-400 hover:bg-cyan-900/60 disabled:cursor-not-allowed disabled:opacity-50 tabular-nums"
        >
          {checkingNews
            ? "Scouting…"
            : cooldownLeft > 0
            ? `Check live news (${cooldownLeft}s)`
            : "Check live news"}
        </button>
      </div>

      {/* Custom Shock Input (POSTs to /shock; disabled in REPLAY mode) */}
      {showShockInput && (
        <form
          onSubmit={handleCustomShockSubmit}
          data-testid="custom-shock-form"
          className="mb-1.5 shrink-0"
        >
          <div className="flex gap-1">
            <input
              type="text"
              data-testid="custom-shock-input"
              value={shockInput}
              onChange={(e) => setShockInput(e.target.value)}
              disabled={isReplay || submittingShock}
              placeholder={
                isReplay
                  ? "Custom shock disabled in REPLAY mode"
                  : "Custom shock (e.g. +25% tariff, +3t lead time)…"
              }
              className="min-w-0 flex-1 rounded border border-slate-800 bg-[#07090e] px-2 py-0.5 text-[11px] text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500/60 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="submit"
              data-testid="custom-shock-submit"
              disabled={isReplay || submittingShock || !shockInput.trim()}
              className="shrink-0 rounded border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 transition hover:bg-cyan-900/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Shock
            </button>
          </div>
          {shockNotice && (
            <div
              className={`mt-1 text-[10px] ${
                shockNotice.ok ? "text-emerald-300" : "text-amber-300"
              }`}
            >
              {shockNotice.text}
            </div>
          )}
        </form>
      )}

      {/* Rejection Reason Banner */}
      {rejectReason && (
        <div
          role="alert"
          data-testid="news-check-reject-reason"
          className="mb-1.5 shrink-0 rounded border border-amber-500/40 bg-amber-950/50 px-2 py-1 text-[10px] text-amber-200"
        >
          {rejectReason}
        </div>
      )}

      {/* Grounding Proof Cards Feed */}
      <div className="flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {groundings.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[11px] text-slate-500">
            Awaiting Tavily shock grounding proof cards…
          </div>
        ) : (
          groundings.map((card) => {
            const domain = extractDomain(card.url);
            const paramDelta = formatShockDelta(card.param, card.value);
            const timeStr = formatTimestamp(card.ts);

            return (
              <article
                key={card.id}
                data-testid="grounding-proof-card"
                className="rounded border border-slate-800/90 bg-[#0f1522] p-2 transition hover:border-cyan-500/40"
              >
                {/* Badges & Source Domain Header */}
                <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                  <div className="flex items-center gap-1 min-w-0">
                    {card.live && (
                      <span
                        data-testid="grounding-live-badge"
                        className="shrink-0 rounded border border-emerald-500/50 bg-emerald-950/80 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300"
                      >
                        LIVE
                      </span>
                    )}
                    {!card.applied && (
                      <span
                        data-testid="grounding-not-applied-badge"
                        className="shrink-0 rounded border border-amber-500/50 bg-amber-950/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-300"
                      >
                        not applied (replay)
                      </span>
                    )}
                    <span className="truncate font-mono text-[10px] font-semibold text-slate-300">
                      {domain}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px]">
                    {timeStr && (
                      <span className="font-mono text-[9px] text-slate-500 tabular-nums">
                        {timeStr}
                      </span>
                    )}
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] font-medium text-cyan-300 underline decoration-cyan-500/50 hover:text-cyan-200"
                    >
                      {domain} ↗
                    </a>
                  </div>
                </div>

                {/* Verbatim Quote -> Parameter Change */}
                <p className="mb-1.5 line-clamp-2 text-[11px] italic leading-snug text-slate-200">
                  “{card.quote}”
                </p>

                <div className="flex items-center justify-between gap-1.5 font-mono text-[10px] tabular-nums">
                  <span className="truncate text-[10px] text-slate-400">
                    {card.title}
                  </span>
                  <span className="shrink-0 rounded border border-cyan-500/40 bg-cyan-950/70 px-1.5 py-0.5 font-bold text-cyan-200">
                    → {paramDelta}
                  </span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

export default GroundingCards;
