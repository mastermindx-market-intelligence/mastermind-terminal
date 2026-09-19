import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const SECONDARY_SURFACES = [
  ["components/StockAnalysis.tsx", "StockAnalysisImpl"],
  ["components/SeasonalityCard.tsx", "SeasonalityCardImpl"],
  ["components/BrainWidget.tsx", "BrainWidgetImpl"],
] as const;

describe("Terminal startup boundaries", () => {
  for (const [wrapper, impl] of SECONDARY_SURFACES) {
    it(`${wrapper} stays behind a client-only dynamic boundary`, () => {
      const source = read(wrapper);
      expect(source).toContain(`dynamic(() => import("./${impl}")`);
      expect(source).toContain("ssr: false");
      expect(source).not.toMatch(new RegExp(`^import (?!type)[^\\n]*${impl}`, "m"));
    });
  }

  it("keeps Options observatory CSS off the chart route root", () => {
    expect(read("app/layout.tsx")).not.toContain('import "./observatory.css"');
    expect(read("components/chrome/AppShell.tsx")).toContain('import "../../app/observatory.css"');
  });
});
