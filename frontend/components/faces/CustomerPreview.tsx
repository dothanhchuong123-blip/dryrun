"use client";

import { useEffect, useState } from "react";
import type { CrowdArchetype } from "../../lib/events";
import { reducedMotion } from "../../lib/follow";
import { leanOf, moodOf, shopperOf } from "../../lib/faces";
import { PixelFace } from "./PixelFace";

/**
 * Landing-page preview of the shopper panel: the 12 customers react to three sample plans.
 * Sample reactions in the shape Nemotron Lightning returns (μ toward you, one line each); labelled as an example.
 */
const LABELS = [
  "Low-income · price-hunter · A-loyal", "Low-income · price-hunter · B-loyal", "Low-income · moderate · A-loyal", "Low-income · moderate · B-loyal",
  "Mid-income · price-hunter · A-loyal", "Mid-income · price-hunter · B-loyal", "Mid-income · moderate · A-loyal", "Mid-income · moderate · B-loyal",
  "High-income · price-hunter · A-loyal", "High-income · price-hunter · B-loyal", "High-income · moderate · A-loyal", "High-income · moderate · B-loyal",
];
const PLANS: { name: string; mu: number[]; say: string[] }[] = [
  {
    name: "Raise price 5%",
    mu: [-0.4, -0.8, -0.1, -0.3, 0.1, -0.2, 0.3, -0.2, 0.6, -0.5, 0.8, -0.6],
    say: ["Another 5% hike? I'll check my options.", "You got expensive. I'm staying with the rival.", "Up a bit, but you're familiar. I'll keep coming.", "You cost more now. The rival feels safer.", "5% more. Still cheaper than them if the gap holds.", "I'll wait for the rival to go on sale.", "I'll stretch my budget if you're in stock.", "Price hike again? Habit wins.", "Small rise. I'll wait for a dip.", "The rival is still cheaper. I'm not moving.", "5% is fine, your quality still leads.", "You raised prices, they look more reliable."],
  },
  {
    name: "Do nothing",
    mu: [0.1, 0, 0.2, 0, 0.1, 0, 0.2, -0.1, 0.1, 0, 0.3, -0.1],
    say: ["Same price as always. Fine by me.", "Nothing new. I'll keep going where I go.", "Still my usual place.", "No reason to switch.", "Prices held. Good.", "No change for me.", "Nice that it didn't go up.", "Habit, really.", "Same as last month.", "Nothing to see here.", "Reliable as ever.", "I'm happy where I am."],
  },
  {
    name: "Stock up, price −3%",
    mu: [0.8, 0.4, 0.6, 0.3, 0.7, 0.2, 0.5, 0.1, 0.4, -0.1, 0.5, 0],
    say: ["Cheaper AND in stock? I'm in.", "Okay, that's tempting. Maybe I'll try you.", "Even better than usual!", "3% off… might give you a go.", "Deal. Buying two.", "Worth a look this time.", "In stock when the rival isn't. Nice.", "Not enough to make me switch.", "Small cut, but I'll take it.", "Price doesn't move me much.", "Good to see it in stock.", "I'll stay, but I noticed."],
  },
];

const short = (income: string, hunter: boolean) => `${income.toLowerCase()} · ${hunter ? "deal hunter" : "steady"}`;

export function CustomerPreview() {
  const [pi, setPi] = useState(2);
  const [touched, setTouched] = useState(false);
  // cycles the sample plans until the visitor picks one
  useEffect(() => {
    if (touched || reducedMotion()) return;
    const t = setInterval(() => setPi((i) => (i + 1) % PLANS.length), 5200);
    return () => clearInterval(t);
  }, [touched]);
  const plan = PLANS[pi];
  const arch: CrowdArchetype[] = LABELS.map((label, id) => ({ id, label, mu: [plan.mu[id], -plan.mu[id] / 2], sigma: [0.2, 0.2], bubble: plan.say[id] }));
  const up = arch.filter((a) => leanOf(a) > 0).length;
  const down = arch.filter((a) => leanOf(a) < 0).length;
  const same = arch.length - up - down;
  // the two strongest feelings speak up on their own
  const loud = new Set([...arch].sort((a, b) => Math.abs(b.mu[0]) - Math.abs(a.mu[0])).slice(0, 2).map((a) => a.id));
  return (
    <section className="cp" aria-label="Example: how customers react to a plan">
      <div className="cp-h">
        <div>
          <h2>
            How your customers <em>feel</em> about it
          </h2>
          <p>12 kinds of customer, each played by Nemotron Lightning. The face is their reaction. Hover to hear them.</p>
        </div>
        <div className="cp-plans" role="group" aria-label="Sample plan">
          {PLANS.map((p, i) => (
            <button
              key={p.name}
              type="button"
              className={i === pi ? "on" : undefined}
              aria-pressed={i === pi}
              onClick={() => {
                setTouched(true);
                setPi(i);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="cp-tally" aria-hidden>
        <i className="u" style={{ flexGrow: up }} />
        <i className="z" style={{ flexGrow: same }} />
        <i className="d" style={{ flexGrow: down }} />
      </div>
      <p className="cp-tl">
        <span>
          <b>{up}</b> lean to you
        </span>
        <span>
          <b>{same}</b> don&apos;t mind
        </span>
        <span>
          <b>{down}</b> lean to the rival
        </span>
        <small>Example reactions</small>
      </p>
      <div className="cp-crowd">
        {arch.map((a) => {
          const who = shopperOf(a);
          const l = leanOf(a);
          const tone = l > 0 ? "you" : l < 0 ? "rival" : "none";
          return (
            <div key={a.id} tabIndex={0} className={`cp-p ${tone}${loud.has(a.id) ? " say" : ""}`}>
              <span className="cp-bub" key={`${pi}-${a.id}`}>
                “{a.bubble}”
              </span>
              <span className="disc">
                <PixelFace shopper={who} mood={moodOf(a)} bg={`var(--px-${tone}-soft)`} title={`${who.name}: “${a.bubble}”`} />
                <span className="lean" aria-hidden>
                  {l > 0 ? "↑" : l < 0 ? "↓" : "·"}
                </span>
              </span>
              <b>{who.name}</b>
              <small>{short(who.income, who.hunter)}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
