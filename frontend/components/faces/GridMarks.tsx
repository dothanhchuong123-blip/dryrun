import type { ShockCase } from "../../lib/events";
import { METER_MAX, futureChips, type Meter } from "../../lib/gridmarks";

const WORD = { up: "profit", down: "loss", even: "about even" } as const;

/** A column of square blocks: green stacked up for a profit, coral stacked down for a loss, one grey dash for about even. */
export function BlockMeter({ meter }: { meter: Meter }) {
  const rows = Array.from({ length: meter.blocks }, (_, i) => i);
  return (
    <svg className="gm-meter" viewBox="0 0 11 22" shapeRendering="crispEdges" role="img" aria-label={`${WORD[meter.dir]}${meter.dir === "even" ? "" : `, ${meter.blocks} of ${METER_MAX} blocks`}`}>
      {meter.dir === "even" && <rect className="gm-ev" x="2" y="10" width="7" height="2" />}
      {rows.map((i) => (
        <rect key={i} className={meter.dir === "up" ? "gm-up" : "gm-dn"} x="2" width="7" height="3" y={meter.dir === "up" ? 18 - i * 4 : 1 + i * 4} />
      ))}
    </svg>
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
