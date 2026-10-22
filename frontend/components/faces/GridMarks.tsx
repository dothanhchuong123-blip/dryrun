import type { ShockCase } from "../../lib/events";
import { METER_MAX, futureChips, type Meter, type Wins } from "../../lib/gridmarks";

const WORD = { up: "profit", down: "loss", even: "about even" } as const;

/** A column of square blocks: green stacked up for a profit, coral stacked down for a loss, one grey dash for about even. */
export function BlockMeter({ meter }: { meter: Meter }) {
  const rows = Array.from({ length: meter.blocks }, (_, i) => i);
  return (
    <svg className="gm-meter" viewBox="0 0 10 26" shapeRendering="crispEdges" role="img" aria-label={`${WORD[meter.dir]}${meter.dir === "even" ? "" : `, ${meter.blocks} of ${METER_MAX} blocks`}`}>
      {meter.dir === "even" && <rect className="gm-ev" x="3" y="12" width="4" height="2" />}
      {rows.map((i) => (
        <rect key={i} className={meter.dir === "up" ? "gm-up" : "gm-dn"} x="3" width="4" height="4" y={meter.dir === "up" ? 21 - i * 5 : 1 + i * 5} />
      ))}
    </svg>
  );
}

/** "Wins in 4 of 5 futures": one square tag per plan row. Green when it wins everywhere, plain ink when it wins in some, coral when it wins nowhere. */
export function WinBadge({ wins }: { wins: Wins | null }) {
  if (!wins) return null;
  return (
    <span className={`gm-win ${wins.tone}`} title="Futures where this plan beats doing nothing">
      Wins in <b>{wins.wins}</b> of <b>{wins.total}</b> {wins.total === 1 ? "future" : "futures"}
    </span>
  );
}

/** A 5×5 pixel triangle. */
function Arrow({ up }: { up: boolean }) {
  const rows = up ? [[2], [1, 2, 3], [0, 1, 2, 3, 4]] : [[0, 1, 2, 3, 4], [1, 2, 3], [2]];
  return (
    <svg className="gm-arrow" width="10" height="6" viewBox="0 0 5 3" shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((xs, y) => xs.map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />))}
    </svg>
  );
}

/** Column header content for a future: one square chip per driver (up to two), plus a NEWS tag on today's headline. */
export function FutureHead({ shock }: { shock: ShockCase }) {
  return (
    <span className="gm-fh">
      {shock.id === "news" && <span className="gm-news">News</span>}
      {futureChips(shock).map((c) => (
        <span key={c.label} className={`gm-chip ${c.tone}`}>
          <span>{c.label}</span>
          {c.arrow && <Arrow up={c.arrow === "up"} />}
          {c.text && <span>{c.text}</span>}
        </span>
      ))}
    </span>
  );
}
