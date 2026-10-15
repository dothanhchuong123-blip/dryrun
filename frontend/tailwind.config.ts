import type { Config } from "tailwindcss";

/** Colours are CSS variables (app/globals.css, DESIGN.md §12.5) so the light/dark switch is one attribute. */
const v = (name: string) => `var(--${name})`;

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./mock/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: v("bg-paper"),
        card: v("bg-card"),
        subtle: v("bg-subtle"),
        sunk: v("bg-sunk"),
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3") },
        line: { DEFAULT: v("line"), strong: v("line-strong") },
        firm: {
          a: v("firm-a"),
          "a-soft": v("firm-a-soft"),
          "a-ink": v("firm-a-ink"),
          b: v("firm-b"),
          "b-soft": v("firm-b-soft"),
        },
        gain: { DEFAULT: v("gain"), soft: v("gain-soft") },
        loss: { DEFAULT: v("loss"), soft: v("loss-soft") },
        nv: { green: v("nv-green"), DEFAULT: v("nv"), soft: v("nv-soft"), ink: v("nv-ink") },
        rule: v("rule"),
        "no-buy": v("no-buy"),
        "on-accent": v("on-accent"),
        "on-ink": v("on-ink"),
      },
      fontFamily: {
        // Inter for everything, numbers included (tabular-nums via the `.num` class)
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: {
        card: "8px",
        ctl: "6px",
        tag: "4px",
      },
      boxShadow: {
        card: "var(--shadow)",
        float: "var(--float)",
      },
    },
  },
  plugins: [],
};

export default config;
