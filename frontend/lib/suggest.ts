import type { MissingItem } from "./events";

// Ghost-text autocomplete for the "describe your business" box. Pure and offline: it looks for the four
// facts the parser needs (what you sell, where, price, cost) and proposes the phrase for the first one
// still missing. Accepting it (Tab) changes the text, so the next call proposes the next fact.

const HAS: Record<MissingItem, RegExp> = {
  what_you_sell: /\b(sell|sells|selling|run|runs|running|own|owns|make|makes|bake|bakes|brew|roast|bakery|caf[eé]|shop|store|restaurant|stall|salon|studio)\b/i,
  where: /\b(in|near|around|at|from)\s+[a-zÀ-ỹ]{2,}/i,
  price: /[$€£đ]\s?\d|\d\s?(usd|eur|vnd|dollars?|euros?|đ)\b|\b(pric(e|ed)|charge|charges)\b/i,
  cost: /\b(cost|costs|costing|margin|wholesale)\b/i,
};

const PHRASE: Record<MissingItem, string> = {
  what_you_sell: " that sells ",
  where: " in ",
  price: ", priced at $",
  cost: ", costing me about $",
};

const ORDER: MissingItem[] = ["what_you_sell", "where", "price", "cost"];

// the user stopped right after a lead-in ("…in ", "…at $"): propose the value itself
function guessCity(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop() ?? "";
    const city = z.replace(/_/g, " ");
    return city && city !== "UTC" ? (city === "Saigon" ? "Ho Chi Minh City" : city) : "Austin, Texas";
  } catch {
    return "Austin, Texas";
  }
}

const VALUE: [RegExp, () => string][] = [
  [/\b(in|near|at|from)\s*$/i, guessCity],
  [/\b(sells?|selling)\s*$/i, () => "coffee and pastries"],
  [/\b(priced at|price)\s*\$$/i, () => "5"],
  [/\b(costing me about|cost)\s*\$$/i, () => "2"],
];

export function suggest(text: string): { add: string; item: MissingItem } | null {
  if (text.trim().length < 3) return null;
  const sp = /\s$/.test(text);
  for (const [re, val] of VALUE) {
    if (re.test(text)) {
      const item: MissingItem = /\$$/.test(text) ? (/cost/i.test(text.slice(-24)) ? "cost" : "price") : /in|near|at|from/i.test(text.trim().split(/\s+/).pop() ?? "") ? "where" : "what_you_sell";
      return { add: (re === VALUE[0][0] || re === VALUE[1][0]) && !sp ? " " + val() : val(), item };
    }
  }
  const item = ORDER.find((k) => !HAS[k].test(text));
  if (!item) return null;
  let add = PHRASE[item];
  if (/[.!?]\s*$/.test(text)) add = " " + add.replace(/^[,\s]+/, "");
  if (sp) add = add.replace(/^\s+/, "");
  return { add, item };
}
