"use client";

import { useEffect, useState } from "react";
import type { BusinessProfile } from "../../lib/events";
import { mixOf } from "../../lib/mix";
import { useMarketStore } from "../../lib/store";
import { NUM_FIELDS, checkNum, trimNum, type NumField } from "../setup/SetupScreen";

/** the numbers the profile parser may guess (prompts.py _PROFILE_SYSTEM); the customer mix counts as one */
const GUESSABLE = 8;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type TextKey = "business_name" | "rival_name" | "supplier_region" | "country";
const TEXT_FIELDS: { key: TextKey; label: string }[] = [
  { key: "business_name", label: "Business" },
  { key: "rival_name", label: "Main rival" },
  { key: "supplier_region", label: "Supplier region" },
  { key: "country", label: "Country" },
];

/** Is the profile good enough to search with? Mirrors the old setup screen's checks. */
export function profileInvalid(p: BusinessProfile | null): boolean {
  return (
    !p ||
    NUM_FIELDS.some((f) => checkNum(f, f.optional && p[f.key] === 0 ? "" : trimNum(p[f.key] * (f.scale ?? 1)), p)) ||
    !p.business_name.trim() ||
    !p.rival_name.trim() ||
    !p.supplier_region.trim()
  );
}

function NumFact({ f, p, i }: { f: NumField; p: BusinessProfile; i: number }) {
  const set = useMarketStore((s) => s.setProfileField);
  const scale = f.scale ?? 1;
  const stored = p[f.key] * scale;
  const shown = f.optional && stored === 0 ? "" : trimNum(stored);
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);
  const hint = checkNum(f, draft, p);
  const id = `fl-${f.key}`;
  return (
    <div className={`fl-fact fl-in${hint ? " bad" : ""}`} style={{ ["--i" as string]: i }}>
      <label htmlFor={id}>
        {f.label}
        {p.guessed_fields.includes(f.key) && <span className="g">guessed</span>}
      </label>
      <div className="row">
        <input
          id={id}
          inputMode="decimal"
          value={draft}
          placeholder={f.optional ? "not given" : undefined}
          aria-invalid={hint ? true : undefined}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            if (checkNum(f, draft, p)) setDraft(shown);
          }}
          onChange={(e) => {
            const d = e.target.value;
            setDraft(d);
            if (checkNum(f, d, p)) return;
            const v = d.trim() === "" ? 0 : Number(d) / scale;
            if (Math.abs(v - p[f.key]) > 1e-9) set(f.key, v as BusinessProfile[typeof f.key]);
          }}
        />
        <span className="u">{f.unit}</span>
      </div>
      {hint && (
        <span className="h" role="alert">
          {hint}
        </span>
      )}
    </div>
  );
}

function TextFact({ k, label, p, i }: { k: TextKey; label: string; p: BusinessProfile; i: number }) {
  const set = useMarketStore((s) => s.setProfileField);
  const empty = k !== "country" && p[k].trim() === "";
  return (
    <div className={`fl-fact fl-in${empty ? " bad" : ""}`} style={{ ["--i" as string]: i }}>
      <label htmlFor={`fl-${k}`}>{label}</label>
      <div className="row">
        <input id={`fl-${k}`} value={p[k]} aria-invalid={empty ? true : undefined} onChange={(e) => set(k, e.target.value)} />
      </div>
      {empty && <span className="h">Needs a name.</span>}
    </div>
  );
}

/** A 0-100 % box. Commits only valid whole-ish numbers; the parent stores fractions. */
function PctBox({ id, value, onCommit, label }: { id: string; value: number; onCommit: (v: number) => void; label: string }) {
  const shown = String(Math.round(value * 100));
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);
  const v = Number(draft);
  const bad = draft.trim() === "" || !Number.isFinite(v) || v < 0 || v > 100;
  return (
    <span className={`fl-pct${bad ? " bad" : ""}`}>
      <input
        id={id}
        inputMode="numeric"
        aria-label={label}
        aria-invalid={bad ? true : undefined}
        value={draft}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (bad) setDraft(shown);
        }}
        onChange={(e) => {
          const d = e.target.value;
          setDraft(d);
          const n = Number(d);
          if (d.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100) onCommit(n / 100);
        }}
      />
      %
    </span>
  );
}

const INCOME = ["Low", "Mid", "High"] as const;

/** The three customer-mix dials (SPEC §15.3). They set how much each of the 12 shopper types counts. */
function WhoBuys({ p }: { p: BusinessProfile }) {
  const set = useMarketStore((s) => s.setProfileField);
  const m = mixOf(p);
  const raw = p.income_mix && p.income_mix.length === 3 ? p.income_mix : m.income;
  const sum = Math.round(raw.reduce((a, b) => a + b, 0) * 100);
  const guessed = p.guessed_fields.includes("customer_mix") || p.income_mix == null;
  return (
    <div className="fl-card fl-in" style={{ ["--i" as string]: 4 }}>
      <div className="fl-ch">
        <div>
          <h2>Who buys</h2>
          <p className="fl-sub">How many of your buyers are each kind of customer. A plan that upsets a big group costs more.</p>
        </div>
        {guessed && <span className="fl-pill amb">{p.income_mix == null ? "Even split" : "Guessed"}</span>}
      </div>
      <div className="fl-mix">
        <div className="fl-mixrow">
          <span className="k">Income</span>
          <div className="fl-incbar" aria-hidden>
            {m.income.map((x, i) => (
              <i key={INCOME[i]} className={`b${i}`} style={{ flexGrow: x }} />
            ))}
          </div>
        </div>
        <div className="fl-mixrow inc">
          {INCOME.map((name, i) => (
            <label key={name} htmlFor={`fl-inc-${i}`}>
              <i className={`dot b${i}`} aria-hidden /> {name}
              <PctBox
                id={`fl-inc-${i}`}
                label={`${name}-income share of buyers`}
                value={raw[i]}
                onCommit={(v) => set("income_mix", raw.map((x, j) => (j === i ? v : x)))}
              />
            </label>
          ))}
        </div>
        {Math.abs(sum - 100) > 1 && <p className="fl-mixnote">These add up to {sum}%. We scale them to 100%.</p>}
        <div className="fl-mixrow">
          <label htmlFor="fl-hunt" className="k wide">
            Shop mostly on price
          </label>
          <PctBox id="fl-hunt" label="Share of buyers who shop on price" value={m.hunter} onCommit={(v) => set("price_hunter_share", v)} />
        </div>
        <div className="fl-mixrow">
          <label htmlFor="fl-loyal" className="k wide">
            Lean to you over {p.rival_name || "the rival"}
          </label>
          <PctBox id="fl-loyal" label="Share of buyers who lean to you" value={m.loyal} onCommit={(v) => set("loyal_share", v)} />
        </div>
      </div>
      <p className="fl-sub" style={{ marginTop: 8 }}>
        {guessed ? "Nemotron Super guessed these from what you sell. Change any you know, e.g. from your sales records." : "From what you told us."}
      </p>
    </div>
  );
}

export function StageUnderstand() {
  const p = useMarketStore((s) => s.profile);
  const status = useMarketStore((s) => s.profileStatus);
  const fallback = useMarketStore((s) => s.profileFallback);
  const source = useMarketStore((s) => s.profileSource);
  const exampleId = useMarketStore((s) => s.exampleId);
  const started = useMarketStore((s) => s.analysis.status !== "idle");

  if (!p || status === "reading") {
    return (
      <div className="fl-stage">
        <div className="fl-card">
          <div className="fl-ch">
            <div>
              <h2>Reading your business</h2>
              <p className="fl-sub">Nemotron Super pulls out your price, cost, stock and rival.</p>
            </div>
            <span className="fl-pill acc">
              <span className="fl-spin" /> Reading…
            </span>
          </div>
          <div className="fl-facts" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="fl-fact">
                <span className="fl-skel" style={{ width: "55%" }} />
                <span className="fl-skel" style={{ width: "35%", height: 16 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const fields = [TEXT_FIELDS[0], ...NUM_FIELDS.slice(0, 5), TEXT_FIELDS[1], NUM_FIELDS[5], TEXT_FIELDS[2], TEXT_FIELDS[3], NUM_FIELDS[6], NUM_FIELDS[7]];
  const terms = p.search_terms ?? [];
  const local = p.market_terms ?? [];
  const nGuessed = p.guessed_fields.length;
  const domain = source && source.kind !== "file" ? hostOf(source.url) : "";
  return (
    <div className="fl-stage">
      <div className="fl-g2">
        <div className="fl-card">
          <div className="fl-ch">
            <div>
              <h2>What we understood</h2>
              <p className="fl-sub">Check the numbers. Change anything that is off; every plan is tested with these.</p>
            </div>
            <span className="fl-pill ok">Nemotron Super</span>
          </div>
          {source?.kind === "file" && (
            <span className="fl-pill tav fl-src" title={source.name}>
              {source.method === "vision" ? `Read from ${source.name} with Nemotron VL` : `Read from ${source.name}`}
            </span>
          )}
          {source && source.kind !== "file" && (
            <a className="fl-pill tav fl-src" href={source.url} target="_blank" rel="noopener noreferrer" title={source.title || source.url}>
              {source.method === "search" ? `Found with Tavily Search · ${domain}` : `Read from ${domain} with Tavily Extract`}
            </a>
          )}
          {nGuessed > 0 && (
            <p className="fl-guessnote">
              We guessed <b>{nGuessed}</b> of <b>{GUESSABLE}</b> numbers. Change any you know.
            </p>
          )}
          <div className="fl-facts">
            {fields.map((f, i) =>
              "unit" in f ? <NumFact key={f.key} f={f} p={p} i={i} /> : <TextFact key={f.key} k={f.key} label={f.label} p={p} i={i} />,
            )}
          </div>
          {fallback && <p className="fl-note">Nemotron could not read everything, so some values are plain defaults. Check them before you go on.</p>}
          {!exampleId && !started && (
            <p className="fl-note">
              This runs live on Nemotron and Tavily, so it takes about 2 minutes and is limited per day. Examples replay a recorded run instantly.
            </p>
          )}
        </div>
        <div className="fl-col">
          <div className="fl-card fl-in" style={{ ["--i" as string]: 3 }}>
            <div className="fl-ch">
              <div>
                <h2>What we will search for</h2>
                <p className="fl-sub">Tavily looks for this week&apos;s news about your supplies, and about your market in {p.country || "your country"}.</p>
              </div>
              <span className="fl-pill tav">Tavily</span>
            </div>
            <h3 style={{ margin: "4px 0 8px" }}>Your supplies</h3>
            <div className="fl-terms">
              {terms.length ? terms.map((t) => <span key={t} className="fl-term">{t}</span>) : <span className="fl-sub">From your supplier region: {p.supplier_region}</span>}
            </div>
            {local.length > 0 && (
              <>
                <h3 style={{ margin: "14px 0 8px" }}>Your local market</h3>
                <div className="fl-terms">
                  {local.map((t) => (
                    <span key={t} className="fl-term loc">
                      {t}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          <WhoBuys p={p} />
          <div className="fl-card fl-in" style={{ ["--i" as string]: 5 }}>
            <h3>Then</h3>
            <p className="fl-sub" style={{ marginTop: 8 }}>
              Nemotron Ultra picks the futures worth testing and proposes plans. A simulator runs every plan 1,000 times in every future. The AI never makes up a dollar figure.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
