"use client";

import { formatDelta, formatMoney, formatRuns } from "../../lib/format";
import { cellKey, useMarketStore } from "../../lib/store";
import { describePlan } from "../memo/MemoScreen";
import { DivBar, sign, useCountUp } from "./parts";

function Kpi({ v, fmt, text, good }: { v: number; fmt: (x: number) => string; text: string; good?: boolean }) {
  const n = useCountUp(v, 1100);
  return (
    <div className={`fl-kpi fl-in${good ? " g" : ""}`}>
      <b className={good ? "pos" : undefined}>{fmt(n)}</b>
      <span>{text}</span>
    </div>
  );
}

export function StageAnswer({ onRestart }: { onRestart: () => void }) {
  const memo = useMarketStore((s) => s.memo);
  const plans = useMarketStore((s) => s.plans);
  const shocks = useMarketStore((s) => s.shocks);
  const cells = useMarketStore((s) => s.cells);
  const telemetry = useMarketStore((s) => s.telemetry);
  const profile = useMarketStore((s) => s.profile);
  const downloadMemo = useMarketStore((s) => s.downloadMemo);
  const openReplay = useMarketStore((s) => s.openReplay);
  if (!memo) return null;

  const n = memo.numbers;
  const plan = plans.find((p) => p.name === memo.plan_name);
  const b = n.bridge;
  const lines: [string, number][] = [
    ["Cheaper stock", b.cost_usd],
    ["Your price change", b.price_usd],
    ["Customers won/lost", b.volume_usd],
    ["Marketing", b.marketing_usd],
    ["Storage & money tied up", b.holding_usd],
  ];
  const shownLines = lines.filter(([l, v]) => l !== "Marketing" || Math.round(v) !== 0);
  const max = Math.max(...lines.map(([, v]) => Math.abs(v)), Math.abs(n.mean_delta_usd), 1);
  const steady = n.steady_rival_delta_usd;
  const futMax = Math.max(1, ...shocks.map((s) => Math.abs(cells[cellKey(memo.plan_name, s.id)]?.mean_delta_usd ?? 0)));
  const calls = telemetry ? telemetry.tiers.ultra.calls + telemetry.tiers.super.calls + telemetry.tiers.fast.calls : 0;
  const notIn = [...memo.not_modelled.fixed, ...memo.not_modelled.found.map((f) => f.text)];

  return (
    <div className="fl-stage" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="fl-card fl-rec" aria-labelledby="fl-rec">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <h3>Our recommendation</h3>
          <span className="fl-pill ok">
            ✓ Checked with {formatRuns(n.n)} runs{n.verified ? " on Nebius" : ""}
          </span>
        </div>
        <h1 id="fl-rec">{memo.headline}</h1>
        <p className="why">{memo.why}</p>
        <div className="fl-kpis">
          <Kpi v={n.mean_delta_usd} fmt={formatDelta} text="more profit than doing nothing, over 6 months" good={n.mean_delta_usd > 0} />
          <Kpi v={n.p5_delta_usd} fmt={formatDelta} text={`${n.p5_delta_usd >= 0 ? "still ahead" : "behind"} in a bad case (worst 1 run in 20)`} />
          <Kpi v={n.p_better * 100} fmt={(x) => `${Math.round(x)}%`} text="of runs beat doing nothing" />
          <Kpi
            v={n.peak_cash_usd}
            fmt={formatMoney}
            text={
              n.peak_cash_usd > 0
                ? `cash up front${n.cash_available > 0 ? ` (you have ${formatMoney(n.cash_available)})` : ""}${n.payback_week != null ? `, back by week ${n.payback_week + 1}` : ""}`
                : "no extra cash needed"
            }
          />
        </div>
      </section>

      <section className="fl-card fl-in" aria-labelledby="fl-todo" style={{ ["--i" as string]: 2 }}>
        <h2 id="fl-todo" style={{ marginBottom: 14 }}>
          What to do
        </h2>
        <ul className="fl-todo">
          <li>
            <small>The plan</small>
            <p>{plan ? describePlan(plan.spec) : memo.plan_name}</p>
          </li>
          <li>
            <small>Watch out for</small>
            <p>{memo.watch_out}</p>
          </li>
          <li>
            <small>Check again when</small>
            <p>{memo.recheck_when}</p>
          </li>
        </ul>
      </section>

      <div className="fl-g2">
        <section className="fl-card fl-in" style={{ ["--i" as string]: 3 }}>
          <h2>Where the {formatDelta(n.mean_delta_usd)} comes from</h2>
          <p className="fl-sub" style={{ marginBottom: 16 }}>
            These add up to the total.
          </p>
          <div className="fl-bridge">
            {shownLines.map(([label, v]) => (
              <div className="br" key={label}>
                <span>{label}</span>
                <DivBar v={v} max={max} />
                <b className={sign(v)}>{formatDelta(v)}</b>
              </div>
            ))}
            <div className="br tot">
              <span>Total vs doing nothing</span>
              <DivBar v={n.mean_delta_usd} max={max} />
              <b className={sign(n.mean_delta_usd)}>{formatDelta(n.mean_delta_usd)}</b>
            </div>
          </div>
          {steady != null && (
            <p className="fl-luck">
              <b>Skill vs luck.</b> Even if {profile?.rival_name || "your rival"} never runs out of stock, this plan makes <b>{formatDelta(steady)}</b>. The other{" "}
              <b>{formatDelta(n.mean_delta_usd - steady)}</b> only comes if they run short.
            </p>
          )}
        </section>

        <section className="fl-card fl-in" style={{ ["--i" as string]: 4 }}>
          <h2>If things turn out differently</h2>
          <p className="fl-sub" style={{ marginBottom: 16 }}>
            This plan in each future we tested.
          </p>
          <div className="fl-bridge">
            {shocks.map((s) => {
              const c = cells[cellKey(memo.plan_name, s.id)];
              if (!c) return null;
              return (
                <div className="br" key={s.id}>
                  <span>{s.label}</span>
                  <DivBar v={c.mean_delta_usd} max={futMax} />
                  <b className={sign(c.mean_delta_usd)}>{formatDelta(c.mean_delta_usd)}</b>
                </div>
              );
            })}
          </div>
          <div className="fl-acts">
            <button type="button" className="fl-btn2" onClick={() => void openReplay(memo.plan_name, n.shock_id)}>
              ▶ Watch one run of this plan
            </button>
          </div>
        </section>
      </div>

      <div className="fl-g2">
        <section className="fl-card fl-in" style={{ ["--i" as string]: 5 }}>
          <h2 style={{ marginBottom: 12 }}>Sources</h2>
          <ul className="fl-srcl">
            {memo.sources.map((s) => (
              <li key={s.url + s.title}>
                {/^https?:\/\//.test(s.url) ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
                {s.quote && <q>{s.quote}</q>}
              </li>
            ))}
          </ul>
          {memo.cost_line && <p className="fl-note">{memo.cost_line}</p>}
        </section>
        <section className="fl-card fl-in" style={{ ["--i" as string]: 6 }}>
          <h2>Not in these numbers</h2>
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 14, lineHeight: 1.6, color: "var(--fl-ink-2)" }}>
            {notIn.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="fl-acts">
            <button type="button" className="fl-btn" onClick={() => void downloadMemo()}>
              Download the memo
            </button>
            <button type="button" className="fl-btn2" onClick={onRestart}>
              Test another business
            </button>
          </div>
        </section>
      </div>

      <p className="fl-sub" style={{ textAlign: "center" }}>
        Plans by NVIDIA Nemotron · every number from our simulator, never from the AI
        {calls > 0 && telemetry && ` · ${calls} AI calls · $${telemetry.cost_usd.toFixed(2)}`}
        {memo.fallback_used && " · some steps used a plain fallback"}
      </p>
    </div>
  );
}
