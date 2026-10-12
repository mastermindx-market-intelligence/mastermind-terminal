// Wave B3 — product-law token pins (G6/G10): no direction colour anywhere in the
// news-flow strip or the live dot, no data-theme in any owned file, and no CSS
// rule may select the data-comparison attribute.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const DIRECTION_TOKENS = ["--up", "--down", "--buy", "--sell", "--signal"] as const;
const noDirectionToken = (css: string) =>
  DIRECTION_TOKENS.map((token) => [token, css.match(new RegExp(`${token}(?![\\w-])`))?.[0] ?? null] as const)
    .filter(([, hit]) => hit !== null)
    .map(([token]) => token);

const OWNED = [
  "lib/newsTypes.ts",
  "lib/newsValidation.ts",
  "lib/newsContract.ts",
  "lib/newsDisplay.ts",
  "lib/newsFlowLex.ts",
  "lib/newsCatchupLex.ts",
  "components/news/NewsFlowStrip.tsx",
  "components/news/NewsFlowStrip.module.css",
  "components/news/NewsFlowTally.tsx",
  "components/news/NewsLiveDot.tsx",
  "components/news/NewsCatchup.tsx",
  "components/news/TickerNewsPanel.tsx",
  "components/news/TickerNewsPanel.module.css",
  "docs/specimens/news-flow.light.css",
  "docs/specimens/news-flow.html",
] as const;

describe("newsFlowTokens — direction colour is absent (G6/G10)", () => {
  it("NewsFlowStrip.module.css references none of --up/--down/--buy/--sell/--signal", () => {
    expect(noDirectionToken(read("components/news/NewsFlowStrip.module.css"))).toEqual([]);
  });

  it("the .liveDot rule references none of --up/--down/--buy/--sell/--signal (status is never buy)", () => {
    const css = read("components/news/TickerNewsPanel.module.css");
    const rule = css.match(/\.liveDot\{[^}]*\}/);
    expect(rule, ".liveDot rule not found").toBeTruthy();
    expect(noDirectionToken(rule![0])).toEqual([]);
  });
});

describe("newsFlowTokens — structural laws", () => {
  it("the strip module never selects [data-comparison", () => {
    expect(read("components/news/NewsFlowStrip.module.css")).not.toContain("[data-comparison");
  });

  it("no owned file contains data-theme (D-W1: dark ships, light is specimen-only)", () => {
    for (const rel of OWNED) {
      expect(read(rel), rel).not.toContain("data-theme");
    }
  });
});
