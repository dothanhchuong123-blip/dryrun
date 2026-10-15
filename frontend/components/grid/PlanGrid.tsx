"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { GridCellData, PlanSource, ShockCase } from "../../lib/events";
import { formatDelta, formatMoney } from "../../lib/format";
import { DO_NOTHING, labels, overCash } from "../../lib/labels";
import { cellKey, useMarketStore } from "../../lib/store";
import { withTransition } from "../../lib/transition";
import { AddPlanPanel } from "./AddPlanPanel";
import { BaselineTipBody, CellTipBody, CrowdTipBody, HeaderTipBody, likelihoodLabel } from "./tips";
import "./grid.css";

const SOURCE_TAG: Record<PlanSource, string> = { seed: "Seed", ai: "AI", user: "Yours" };
const TIP_W = 292;

interface Tip {
  key: string;
  rect: DOMRect;
  body: ReactNode;
  /** touch: a bottom sheet; the second tap on the same cell opens the replay */
  sheet?: boolean;
  replay?: () => void;
}

/** Colour step relative to the biggest swing on the grid, so the scale works for any business size. */
function heat(v: number, max: number): string {
  if (max <= 0) return "z";
  const r = v / max;
  if (r >= 0.6) return "g3";
  if (r >= 0.25) return "g2";
  if (r >= 0.05) return "g1";
  if (r > -0.05) return "z";
  if (r > -0.25) return "r1";
  return "r2";
}

const JOB_WORDS: Record<string, string> = {
  idle: "",
  queued: "Waiting for a Nebius machine…",
  running: "Running 10,000 simulated runs on Nebius…",
  verified: "✓ Checked with 10,000 runs",
  failed: "Could not verify. Showing the 1,000-run results.",
};

/** Screen 4: the plans × futures grid. Fills in cell by cell as the engine finishes. */
export function PlanGrid() {
  const plans = useMarketStore((s) => s.plans);
  const shocks = useMarketStore((s) => s.shocks);
  const cells = useMarketStore((s) => s.cells);
  const summary = useMarketStore((s) => s.summary);
  const memo = useMarketStore((s) => s.memo);
  const profile = useMarketStore((s) => s.profile);
  const crowd = useMarketStore((s) => s.crowdByPlan);
  const job = useMarketStore((s) => s.telemetry?.job.status ?? "idle");
  const analysis = useMarketStore((s) => s.analysis);
  const open = useMarketStore((s) => s.openReplay);
  const setStep = useMarketStore((s) => s.setStep);
  const verify = useMarketStore((s) => s.verify);

  const cash0 = profile?.cash_available ?? 0;
  const [cashPick, setCashPick] = useState<number | null>(null);
  const cash = cashPick ?? cash0;
  const [adding, setAdding] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const rival = profile?.rival_name ?? "";

  const cellList = useMemo(() => Object.values(cells), [cells]);
  const maxAbs = useMemo(() => Math.max(0, ...cellList.map((c) => Math.abs(c.mean_delta_usd))), [cellList]);
  const cashMax = useMemo(() => {
    const peak = Math.max(0, ...cellList.map((c) => c.peak_cash_usd));
    return Math.max(1000, Math.ceil(Math.max(cash0 * 2, peak * 1.2) / 1000) * 1000);
  }, [cellList, cash0]);

  const moved = cashPick !== null && cashPick !== cash0;
  const isOver = (c: GridCellData) => (moved ? overCash(c, cash) : c.over_cash);
  const { bestToday, safest } = useMemo(() => {
    if (!moved && summary) return { bestToday: summary.best_today, safest: summary.safest };
    if (!moved) return { bestToday: "", safest: "" };
    return labels(cellList, shocks, cash);
  }, [moved, summary, cellList, shocks, cash]);

  const baseline = summary?.baseline_profit_usd ?? {};
  const isTouch = (e: React.MouseEvent) =>
    (e.nativeEvent as PointerEvent).pointerType === "touch" || !!window.matchMedia?.("(hover: none)").matches;

  const show = (key: string, el: Element, body: ReactNode, extra?: Partial<Tip>) =>
    setTip({ key, rect: el.getBoundingClientRect(), body, ...extra });
  const hide = (key?: string) => setTip((t) => (t && !t.sheet && (!key || t.key === key) ? null : t));

  const onCell = (e: React.MouseEvent<HTMLButtonElement>, c: GridCellData, s: ShockCase) => {
    const replay = () => {
      setTip(null);
      void open(c.plan_name, s.id);
    };
    if (isTouch(e) && tip?.key !== `c:${c.plan_name}|${s.id}`) {
      show(`c:${c.plan_name}|${s.id}`, e.currentTarget, cellBody(c, s), { sheet: true, replay });
    } else replay();
  };
  const cellBody = (c: GridCellData, s: ShockCase) => (
    <CellTipBody cell={c} shock={s} rival={rival} cashAvailable={cash} over={isOver(c)} />
  );

  const bestName = memo?.plan_name;
  const verifying = job === "queued" || job === "running";
  const verifyDisabled = plans.length === 0 || verifying || summary?.verified === true || !(analysis.status === "done" || memo);
  const allCellsIn = plans.length > 0 && shocks.length > 0;

  return (
    <div className="card pg" data-slot="PlanGrid">
      <div className="pg-head">
        <div>
          <h2>Which plan holds up?</h2>
          <p>
            Gross profit over 6 months, compared with doing nothing · {cellList[0] ? cellList[0].n.toLocaleString("en-US") : "1,000"} runs per cell · click a cell to replay it
          </p>
        </div>
        {cash0 > 0 && (
          <label className="pg-cash-sl">
            <span>
              Cash you could put in: <b className="num">{formatMoney(cash)}</b>
            </span>
            <input
              type="range"
              min={0}
              max={cashMax}
              step={500}
              value={cash}
              onChange={(e) => setCashPick(+e.target.value)}
              aria-label="Cash you could put in"
            />
          </label>
        )}
      </div>

      <div className="pg-box">
        {shocks.length === 0 ? (
          <div className="empty">Nemotron will test plans here. Each cell = 1,000 simulated runs.</div>
        ) : (
          <table className="pg-t">
            <thead>
              <tr>
                <th className="pg-first">Plan</th>
                {shocks.map((s) => (
                  <th
                    key={s.id}
                    className={s.id === "news" ? "today" : ""}
                    tabIndex={0}
                    onMouseEnter={(e) => show(`h:${s.id}`, e.currentTarget, <HeaderTipBody shock={s} />)}
                    onMouseLeave={() => hide(`h:${s.id}`)}
                    onFocus={(e) => show(`h:${s.id}`, e.currentTarget, <HeaderTipBody shock={s} />)}
                    onBlur={() => hide(`h:${s.id}`)}
                  >
                    <span className="pg-hc">{s.label}</span>
                    <small>
                      {s.id === "news" ? "today's news · " : ""}
                      <span className={`pg-lk ${s.likelihood}`}>{likelihoodLabel(s.likelihood)}</span>
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="base">
                <th scope="row" className="pg-first">
                  <div className="pg-pl">
                    <span className="nm">{DO_NOTHING}</span>
                    <small className="muted">the yardstick</small>
                  </div>
                </th>
                {shocks.map((s) => {
                  const b = baseline[s.id];
                  return (
                    <td key={s.id} className={s.id === "news" ? "today" : ""}>
                      {b === undefined ? (
                        <div className="pg-cell wait" aria-label="Waiting" />
                      ) : (
                        <div
                          className="pg-cell basec"
                          tabIndex={0}
                          onMouseEnter={(e) => show(`b:${s.id}`, e.currentTarget, <BaselineTipBody profit={b} />)}
                          onMouseLeave={() => hide(`b:${s.id}`)}
                          onFocus={(e) => show(`b:${s.id}`, e.currentTarget, <BaselineTipBody profit={b} />)}
                          onBlur={() => hide(`b:${s.id}`)}
                        >
                          <span className="v num">{formatMoney(b)}</span>
                          <span className="p">gross profit</span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
              {plans.map((p) => {
                const arch = crowd[p.name];
                const rowTip = arch?.length ? () => <CrowdTipBody plan={p.name} archetypes={arch} /> : null;
                return (
                  <tr key={p.name} className={p.name === bestName ? "pick" : ""}>
                    <th
                      scope="row"
                      className="pg-first"
                      tabIndex={rowTip ? 0 : undefined}
                      onMouseEnter={(e) => rowTip && show(`r:${p.name}`, e.currentTarget, rowTip())}
                      onMouseLeave={() => hide(`r:${p.name}`)}
                      onFocus={(e) => rowTip && show(`r:${p.name}`, e.currentTarget, rowTip())}
                      onBlur={() => hide(`r:${p.name}`)}
                    >
                      <div className="pg-pl">
                        <span className="nm">{p.name}</span>
                        <div className="bd">
                          <span className={`pg-src ${p.source}`}>{SOURCE_TAG[p.source]}</span>
                          {bestToday === p.name && <span className="pg-badge best">Best today</span>}
                          {safest === p.name && <span className="pg-badge safe">Safest</span>}
                        </div>
                      </div>
                    </th>
                    {shocks.map((s) => {
                      const c = cells[cellKey(p.name, s.id)];
                      const today = s.id === "news" ? "today" : "";
                      if (!c)
                        return (
                          <td key={s.id} className={today}>
                            <div className="pg-cell wait" aria-label={`${p.name}, ${s.label}: calculating`} />
                          </td>
                        );
                      const over = isOver(c);
                      return (
                        <td key={s.id} className={today}>
                          <button
                            className={`pg-cell ${heat(c.mean_delta_usd, maxAbs)}${over ? " over" : ""}${
                              p.name === bestName && s.id === "news" ? " sel" : ""
                            }`}
                            aria-label={`${p.name}, ${s.label}: ${formatDelta(c.mean_delta_usd)}, bad case ${formatDelta(c.p5_delta_usd)}${over ? ", over your cash" : ""}. Replay`}
                            onMouseEnter={(e) => show(`c:${p.name}|${s.id}`, e.currentTarget, cellBody(c, s))}
                            onMouseLeave={() => hide(`c:${p.name}|${s.id}`)}
                            onFocus={(e) => show(`c:${p.name}|${s.id}`, e.currentTarget, cellBody(c, s))}
                            onBlur={() => hide(`c:${p.name}|${s.id}`)}
                            onClick={(e) => onCell(e, c, s)}
                          >
                            <span className="v num">
                              {formatDelta(c.mean_delta_usd)}
                              {(over || c.source === "cloud") && (
                                <span className="pg-marks">
                                  {c.source === "cloud" && (
                                    <span className="pg-ck" title={`Checked with ${c.n.toLocaleString("en-US")} runs on Nebius`}>
                                      ✓<span className="pg-ckn"> {c.n.toLocaleString("en-US")} runs</span>
                                    </span>
                                  )}
                                  {over && <span className="pg-ovtag">Over cash</span>}
                                </span>
                              )}
                            </span>
                            <span className="p">
                              bad case <span className="num">{formatDelta(c.p5_delta_usd)}</span>
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="pg-legend">
        <span><i style={{ background: "var(--g3)" }} />much better</span>
        <span><i style={{ background: "var(--g1)" }} />a bit better</span>
        <span><i style={{ background: "var(--z)", border: "1px solid var(--line)" }} />about the same</span>
        <span><i style={{ background: "var(--r1)" }} />worse</span>
        <span>“bad case”: 1 run in 20 is worse than this</span>
      </div>

      {memo && (
        <div className="pg-reco" role="status">
          <span>
            Nemotron recommends: <b>{memo.plan_name}</b>
          </span>
          <button className="btn sm" onClick={() => withTransition(() => setStep("memo"))}>
            See the memo →
          </button>
        </div>
      )}

      <div className="pg-acts">
        <button className="btn ghost sm" disabled={!allCellsIn || !summary} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          + Add your own plan
        </button>
        <div className="pg-ver">
          {JOB_WORDS[job] && <span className={`pg-jobs ${job}`} role="status">{JOB_WORDS[job]}</span>}
          <button className="btn ghost sm" onClick={() => void verify()} disabled={verifyDisabled} title="Re-runs every cell with 10,000 simulated paths on a Nebius Serverless Job">
            Verify with 10,000 runs on Nebius
          </button>
        </div>
      </div>

      {adding && profile && <AddPlanPanel profile={profile} onClose={() => setAdding(false)} />}

      {tip && !tip.sheet && <FloatingTip tip={tip} />}
      {tip?.sheet && (
        <>
          <div className="pg-scrim" onClick={() => setTip(null)} />
          <div className="pg-sheet" role="dialog" aria-label="Cell details">
            {tip.body}
            <div className="pg-sheeta">
              <button className="btn sm" onClick={tip.replay}>Replay this</button>
              <button className="btn ghost sm" onClick={() => setTip(null)}>Close</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FloatingTip({ tip }: { tip: Tip }) {
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const r = tip.rect;
  const left = r.right + 10 + TIP_W < vw ? r.right + 10 : Math.max(8, r.left - TIP_W - 10);
  const top = Math.max(8, Math.min(r.top - 8, vh - 380));
  return (
    <div className="pg-tip" style={{ left, top, width: TIP_W }} role="tooltip">
      {tip.body}
    </div>
  );
}

export default PlanGrid;
