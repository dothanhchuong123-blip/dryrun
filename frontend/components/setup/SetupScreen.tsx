"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BusinessProfile, PlanSpec } from "../../lib/events";
import { follow, now } from "../../lib/follow";
import { useMarketStore } from "../../lib/store";
import { withTransition } from "../../lib/transition";
import { ModelChip } from "../shell/ModelChip";
import "./setup.css";

type NumKey = "price" | "unit_cost" | "weekly_sales" | "lead_time_weeks" | "stock_weeks" | "rival_price" | "exposed_cost_share" | "cash_available";
type TextKey = "business_name" | "rival_name" | "supplier_region" | "country";

export interface NumField {
  key: NumKey;
  label: string;
  unit: string;
  /** shown value = stored value × scale (the share is stored as a fraction, shown as %) */
  scale?: number;
  min: number;
  max?: number;
  int?: boolean;
  /** 0 or empty means "not given" */
  optional?: boolean;
}

// SPEC §15.3 bounds. Order = the order on screen.
export const NUM_FIELDS: NumField[] = [
  { key: "price", label: "Your price", unit: "$ per unit", min: 0.01 },
  { key: "unit_cost", label: "Raw cost per unit", unit: "$ per unit", min: 0.01 },
  { key: "weekly_sales", label: "Sales per week", unit: "units", min: 1 },
  { key: "lead_time_weeks", label: "Supplier lead time", unit: "weeks", min: 1, max: 16, int: true },
  { key: "stock_weeks", label: "Stock on hand", unit: "weeks of sales", min: 0, max: 16 },
  { key: "rival_price", label: "Rival's price", unit: "$ per unit", min: 0.01 },
  { key: "exposed_cost_share", label: "Share of your cost the news moves", unit: "% of cost", scale: 100, min: 5, max: 100 },
  { key: "cash_available", label: "Cash you could put into stock", unit: "$ (empty = not given)", min: 0, optional: true },
];

export function trimNum(x: number): string {
  return String(Math.round(x * 1000) / 1000);
}

/** Returns an inline hint, or null when the draft is fine. */
export function checkNum(f: NumField, draft: string, p: BusinessProfile): string | null {
  const t = draft.trim();
  if (t === "") return f.optional ? null : "Needs a number.";
  const v = Number(t);
  if (!Number.isFinite(v)) return "Needs a number.";
  if (f.int && !Number.isInteger(v)) return "Whole weeks only.";
  if (v < f.min) return f.min <= 0.01 ? "Must be above 0." : `At least ${f.min}.`;
  if (f.max != null && v > f.max) return `At most ${f.max}.`;
  if (f.key === "unit_cost" && v >= p.price) return "Must be below your price.";
  if (f.key === "price" && p.unit_cost >= v) return "Must be above your raw cost.";
  return null;
}

function NumRow({ f, profile, guessed, locked, onBad }: { f: NumField; profile: BusinessProfile; guessed: boolean; locked: boolean; onBad: (key: string, bad: boolean) => void }) {
  const set = useMarketStore((s) => s.setProfileField);
  const scale = f.scale ?? 1;
  const stored = profile[f.key] * scale;
  const shown = f.optional && stored === 0 ? "" : trimNum(stored);
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  // follow outside changes (new parse, example swap) unless the user is typing
  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);
  // no profile yet (locked): the empty form is a placeholder, not a mistake to flag
  const hint = locked ? null : checkNum(f, draft, profile);
  useEffect(() => {
    onBad(f.key, !!hint);
    return () => onBad(f.key, false);
  }, [f.key, hint, onBad]);
  const id = `su-${f.key}`;
  return (
    <div className="su-f">
      <label htmlFor={id}>{f.label}</label>
      <div className="box">
        <input
          id={id}
          className="n"
          inputMode="decimal"
          value={draft}
          disabled={locked}
          aria-invalid={hint ? true : undefined}
          aria-describedby={hint ? `${id}-h` : undefined}
          placeholder={f.optional ? "not given" : undefined}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            if (checkNum(f, draft, profile)) setDraft(shown);
          }}
          onChange={(e) => {
            const d = e.target.value;
            setDraft(d);
            if (checkNum(f, d, profile)) return;
            const v = d.trim() === "" ? 0 : Number(d) / scale;
            if (Math.abs(v - profile[f.key]) > 1e-9) set(f.key, v as BusinessProfile[NumKey]);
          }}
        />
        <span className="unit">{f.unit}</span>
      </div>
      {guessed ? <span className="su-guess">guessed</span> : <span />}
      {hint && (
        <span className="hint" id={`${id}-h`} role="alert">
          {hint}
        </span>
      )}
    </div>
  );
}

function TextRow({ k, label, profile, guessed, locked }: { k: TextKey; label: string; profile: BusinessProfile; guessed: boolean; locked: boolean }) {
  const set = useMarketStore((s) => s.setProfileField);
  const id = `su-${k}`;
  const empty = !locked && k !== "country" && profile[k].trim() === "";
  return (
    <div className="su-f">
      <label htmlFor={id}>{label}</label>
      <div className="box">
        <input
          id={id}
          value={profile[k]}
          disabled={locked}
          aria-invalid={empty ? true : undefined}
          onChange={(e) => set(k, e.target.value as BusinessProfile[TextKey])}
        />
      </div>
      {guessed ? <span className="su-guess">guessed</span> : <span />}
      {empty && <span className="hint">Needs a name.</span>}
    </div>
  );
}

const EMPTY: BusinessProfile = {
  business_name: "", product_unit: "", price: 0, unit_cost: 0, weekly_sales: 0, lead_time_weeks: 0, stock_weeks: 0,
  rival_name: "", rival_price: 0, supplier_region: "", customers: "", search_terms: [], country: "", market_terms: [],
  exposed_cost_share: 0, cash_available: 0, guessed_fields: [],
};

let prefilled = false;

/** Screen 1, "Your business". Reads the store; takes no props. */
export function SetupScreen() {
  const s = useMarketStore();
  const [gut, setGut] = useState<string | null>(null);
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const onBad = useCallback((k: string, b: boolean) => setBad((o) => (o[k] === b ? o : { ...o, [k]: b })), []);
  const reading = s.profileStatus === "reading";
  const p = s.profile;

  // Example replay mode: the coffee example is ready on load, guessed tags and all.
  const pre = useRef(false);
  useEffect(() => {
    if (pre.current || prefilled || s.examples.length === 0) return;
    pre.current = true;
    prefilled = true;
    const cur = useMarketStore.getState();
    if (cur.profileText.trim() || cur.profile) return;
    const ex = cur.examples.find((e) => e.id.startsWith("coffee")) ?? cur.examples[0];
    cur.pickExample(ex.id);
    void cur.parseProfile(ex.text);
  }, [s.examples]);

  // After Nemotron fills the form: let the rows fade up, then glide to the button and nudge it once.
  const ctaRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const prevStatus = useRef(s.profileStatus);
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = s.profileStatus;
    if (was !== "reading" || s.profileStatus === "reading" || !s.profile) return;
    const since = now();
    const t1 = window.setTimeout(() => follow(fieldsRef.current, since, "start"), 250);
    const t2 = window.setTimeout(() => {
      follow(ctaRef.current, since, "center");
      setNudge(true);
    }, 1500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [s.profileStatus, s.profile]);
  const stage = !p || reading ? 1 : 2;
  const goTo = (el: Element | null) => el?.scrollIntoView({ block: "start", behavior: "smooth" });

  const gutPlans = ((s.examples.find((e) => e.id === s.exampleId) as unknown as { gut_plans?: PlanSpec[] } | undefined)?.gut_plans) ?? [];

  const invalid =
    !p ||
    Object.values(bad).some(Boolean) ||
    NUM_FIELDS.some((f) => checkNum(f, f.optional && p[f.key] === 0 ? "" : trimNum(p[f.key] * (f.scale ?? 1)), p)) ||
    !p.business_name.trim() ||
    !p.rival_name.trim() ||
    !p.supplier_region.trim();

  return (
    <section className="screen" data-slot="SetupScreen">
      <div className="wrap">
        <ol className="su-guide fu" aria-label="How this works">
          <li className={stage === 1 ? "on" : "done"}>
            <span className="n">{stage > 1 ? "✓" : "1"}</span>
            <span>
              <b>Describe your business</b>
              <small>or pick an example</small>
            </span>
          </li>
          <li className={stage === 2 ? "on" : ""}>
            <button type="button" onClick={() => goTo(fieldsRef.current)} disabled={!p}>
              <span className="n">2</span>
              <span>
                <b>Check what Nemotron understood</b>
                <small>edit any number</small>
              </span>
            </button>
          </li>
          <li>
            <button type="button" onClick={() => ctaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })} disabled={!p}>
              <span className="n">3</span>
              <span>
                <b>Find the news that hits it</b>
                <small>then Nemotron tests plans</small>
              </span>
            </button>
          </li>
        </ol>
        <div className="su-two">
          <div className={`card su-pane liquid${reading ? " on" : ""} fu${stage === 1 ? " su-live" : ""}`} style={{ ["--i" as string]: 1 }}>
            <div className="su-title">
              <span className="su-n">1</span>
              <h1>Describe your business</h1>
            </div>
            <textarea
              className="su-text"
              aria-label="Describe your business"
              value={s.profileText}
              onChange={(e) => s.setProfileText(e.target.value)}
              placeholder="Describe it like you would to a friend…"
            />
            <div className="su-examples">
              Or try one:
              {s.examples.map((e) => (
                <button key={e.id} className={`su-ex${s.exampleId === e.id ? " on" : ""}`} title={e.subtitle} onClick={() => s.pickExample(e.id)}>
                  {e.title}
                </button>
              ))}
            </div>
            <div className="su-act">
              <button className="btn" disabled={!s.profileText.trim() || reading} onClick={() => void s.parseProfile(s.profileText)}>
                Read my business →
              </button>
              <ModelChip tier="super" job="reads your business" />
              {reading && (
                <span className="su-status" role="status">
                  <span className="su-spin" /> Nemotron Super is reading it…
                </span>
              )}
              {s.profileError && !reading && (
                <span className="su-status err" role="alert">
                  {s.profileError}
                </span>
              )}
            </div>
          </div>

          <div className={`card su-pane liquid${reading ? " on" : ""} fu${stage === 2 ? " su-live" : ""}`} style={{ ["--i" as string]: 2 }} ref={fieldsRef}>
            <div className="su-head">
              <div className="l su-title">
                <span className="su-n">2</span>
                <h2>What Nemotron understood</h2>
                {p && <span className="biz">{p.business_name}</span>}
              </div>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {p ? "Edit anything" : ""}
              </span>
            </div>
            {reading ? (
              <div className="su-fields" aria-hidden>
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="su-f">
                    <span className="su-skel" style={{ width: "70%" }} />
                    <span className="su-skel" style={{ width: "40%" }} />
                    <span />
                  </div>
                ))}
              </div>
            ) : (
              <div className={`su-fields${p ? " reveal" : " empty"}`} key={p ? "filled" : "empty"}>
                <TextRow k="business_name" label="Business" profile={p ?? EMPTY} guessed={false} locked={!p} />
                <NumRow f={NUM_FIELDS[0]} profile={p ?? EMPTY} guessed={!!p?.guessed_fields.includes("price")} locked={!p} onBad={onBad} />
                <NumRow f={NUM_FIELDS[1]} profile={p ?? EMPTY} guessed={!!p?.guessed_fields.includes("unit_cost")} locked={!p} onBad={onBad} />
                <NumRow f={NUM_FIELDS[2]} profile={p ?? EMPTY} guessed={!!p?.guessed_fields.includes("weekly_sales")} locked={!p} onBad={onBad} />
                <NumRow f={NUM_FIELDS[3]} profile={p ?? EMPTY} guessed={!!p?.guessed_fields.includes("lead_time_weeks")} locked={!p} onBad={onBad} />
                <NumRow f={NUM_FIELDS[4]} profile={p ?? EMPTY} guessed={!!p?.guessed_fields.includes("stock_weeks")} locked={!p} onBad={onBad} />
                <TextRow k="rival_name" label="Main rival" profile={p ?? EMPTY} guessed={false} locked={!p} />
                <NumRow f={NUM_FIELDS[5]} profile={p ?? EMPTY} guessed={!!p?.guessed_fields.includes("rival_price")} locked={!p} onBad={onBad} />
                <TextRow k="supplier_region" label="Supplier region" profile={p ?? EMPTY} guessed={false} locked={!p} />
                <TextRow k="country" label="Country" profile={p ?? EMPTY} guessed={false} locked={!p} />
                <NumRow f={NUM_FIELDS[6]} profile={p ?? EMPTY} guessed={!!p?.guessed_fields.includes("exposed_cost_share")} locked={!p} onBad={onBad} />
                <NumRow f={NUM_FIELDS[7]} profile={p ?? EMPTY} guessed={false} locked={!p} onBad={onBad} />
              </div>
            )}
            {!p && !reading && <p className="su-empty">Nemotron fills these in. You can change any of them.</p>}
            {p && s.profileFallback && (
              <p className="su-empty">Nemotron could not read everything, so some values are plain defaults. Check them before you go on.</p>
            )}
            {p && gutPlans.length > 0 && (
              <div className="su-gut fu" style={{ ["--i" as string]: 13 }} role="group" aria-label="What would you do?">
                <h3>What would you do?</h3>
                <div className="row">
                  {gutPlans.map((g) => (
                    <button key={g.name} aria-pressed={gut === g.name} onClick={() => setGut(gut === g.name ? null : g.name)}>
                      {g.name}
                    </button>
                  ))}
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  Optional. Your pick is tested next to the AI&apos;s plans.
                </span>
              </div>
            )}
            <div className={`su-act su-go${p ? " fu" : ""}`} style={{ ["--i" as string]: 14 }} ref={ctaRef}>
              <span className="su-n" aria-hidden>3</span>
              <button
                className={`btn${nudge ? " nudge" : ""}`}
                onAnimationEnd={() => setNudge(false)}
                disabled={invalid || reading || s.analysis.status === "starting"}
                onClick={() => withTransition(() => void s.startAnalysis())}
              >
                Looks right → find news
              </button>
              {p && (
                <span className="nextline">
                  Next: Tavily searches this week&apos;s news for {p.supplier_region || "your supplier"} and your market
                </span>
              )}
              {s.analysis.status === "error" && s.analysis.note && (
                <span className="su-status err" role="alert">
                  {s.analysis.note}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default SetupScreen;
