"use client";

import React from "react";
import { FirmPair } from "../../lib/events";
import { isValidNumber } from "../../lib/format";

export interface BullwhipGaugeProps {
  bullwhip: FirmPair<number | null> | null | undefined;
  currentTick?: number;
}

interface SingleFirmGaugeProps {
  firmLabel: string;
  accentClass: string;
  value: number | null;
}

function getBullwhipStatus(val: number): {
  label: string;
  strokeColor: string;
  badgeClass: string;
} {
  if (val < 1.25) {
    return {
      label: "Damped",
      strokeColor: "#10b981",
      badgeClass: "border-emerald-500/40 bg-emerald-950/60 text-emerald-300",
    };
  }
  if (val < 2.0) {
    return {
      label: "Amplified",
      strokeColor: "#f59e0b",
      badgeClass: "border-amber-500/40 bg-amber-950/60 text-amber-300",
    };
  }
  return {
    label: "Whip Surge",
    strokeColor: "#f43f5e",
    badgeClass: "border-rose-500/40 bg-rose-950/60 text-rose-300",
  };
}

function SingleFirmGauge({
  firmLabel,
  accentClass,
  value,
}: SingleFirmGaugeProps) {
  const hasValue = isValidNumber(value);
  // Gauge scale: 0.0 to 4.0x
  const clamped = hasValue ? Math.max(0, Math.min(4, value)) : 0;
  const fraction = clamped / 4;

  // Semi-circle geometry (center 50,44, radius 34)
  const radius = 34;
  const circumference = Math.PI * radius;
  const dashOffset = circumference * (1 - fraction);
  const status = hasValue ? getBullwhipStatus(value) : null;

  return (
    <div
      data-testid={`bullwhip-gauge-${firmLabel}`}
      className="flex flex-col justify-between rounded border border-slate-800/90 bg-[#0b101b] p-2"
    >
      <div className="flex items-center justify-between">
        <span className={`font-mono text-[10px] font-bold ${accentClass}`}>
          {firmLabel}
        </span>
        <span
          className={`min-h-[18px] rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
            status
              ? status.badgeClass
              : "border-transparent bg-transparent text-transparent"
          }`}
        >
          {status ? status.label : ""}
        </span>
      </div>

      {/* Semi-circular SVG Arc Gauge (Blank while value is null) */}
      <div className="relative mx-auto my-0.5 flex h-[54px] w-[112px] items-end justify-center">
        <svg viewBox="0 0 100 52" className="h-full w-full overflow-visible">
          {/* Background Track */}
          <path
            d="M 16 44 A 34 34 0 0 1 84 44"
            fill="none"
            stroke="#1e293b"
            strokeWidth="7"
            strokeLinecap="round"
          />
          {/* Active Arc — rendered ONLY when value is non-null */}
          {hasValue && status && (
            <path
              d="M 16 44 A 34 34 0 0 1 84 44"
              fill="none"
              stroke={status.strokeColor}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          )}
        </svg>

        {/* Numeric Readout inside Arc (Strictly blank while null) */}
        <div
          data-testid={`bullwhip-value-${firmLabel}`}
          className="absolute bottom-0.5 text-center font-mono text-xs font-bold text-slate-100 tabular-nums"
        >
          {hasValue ? `${value.toFixed(2)}×` : ""}
        </div>
      </div>

      <div className="flex items-center justify-between font-mono text-[9px] text-slate-500">
        <span>0×</span>
        <span>Var(O)/Var(D)</span>
        <span>4×</span>
      </div>
    </div>
  );
}

export function BullwhipGauge({ bullwhip }: BullwhipGaugeProps) {
  const valA =
    Array.isArray(bullwhip) && isValidNumber(bullwhip[0]) ? bullwhip[0] : null;
  const valB =
    Array.isArray(bullwhip) && isValidNumber(bullwhip[1]) ? bullwhip[1] : null;

  return (
    <section
      aria-label="Bullwhip Effect Gauges"
      className="rounded border border-slate-800/90 bg-[#0f1522] p-2.5"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
            Bullwhip Ratio Gauge
          </h3>
        </div>
        <span className="font-mono text-[10px] text-slate-400 tabular-nums">
          {valA === null && valB === null ? "8-tick window" : "Rolling ≥8t"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SingleFirmGauge
          firmLabel="Firm A"
          accentClass="text-purple-300"
          value={valA}
        />
        <SingleFirmGauge
          firmLabel="Firm B"
          accentClass="text-amber-300"
          value={valB}
        />
      </div>
    </section>
  );
}

export default BullwhipGauge;
