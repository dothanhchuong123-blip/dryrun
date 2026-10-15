"use client";

import { formatDelta } from "../../lib/format";
import { useMarketStore } from "../../lib/store";
import { withTransition } from "../../lib/transition";

/** STUB (F1 replaces this): screen 6, the decision memo. */
export function MemoScreen() {
  const memo = useMarketStore((s) => s.memo);
  const download = useMarketStore((s) => s.downloadMemo);
  const reset = useMarketStore((s) => s.reset);
  return (
    <section className="screen" data-slot="MemoScreen">
      <div className="wrap">
        <div className="card" style={{ padding: 28, display: "grid", gap: 14 }}>
          <span className="slot-note" style={{ justifySelf: "start" }}>MemoScreen · F1 builds this</span>
          {!memo ? (
            <div className="empty">The memo appears when the analysis finishes.</div>
          ) : (
            <>
              <h1>{memo.headline}</h1>
              <div className="num">
                {formatDelta(memo.numbers.mean_delta_usd)} vs do nothing · bad case {formatDelta(memo.numbers.p5_delta_usd)} · {memo.numbers.n.toLocaleString("en-US")} runs
                {memo.numbers.verified ? " · Nebius-verified" : ""}
              </div>
              <p>{memo.why}</p>
              <p>{memo.watch_out}</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn ghost" onClick={() => void download()}>Download .md</button>
                <button className="btn" onClick={() => withTransition(reset, "back")}>Try another business</button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default MemoScreen;
