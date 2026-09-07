import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = join(__dirname, "../../components");

function readOwned(rel: string): string {
  return readFileSync(join(COMPONENTS, rel), "utf8");
}

function lineContaining(src: string, needle: string | RegExp, label: string): string {
  const lines = src.split("\n").filter((line) =>
    typeof needle === "string" ? line.includes(needle) : needle.test(line),
  );
  expect(lines.length, `${label}: expected a matching line`).toBeGreaterThan(0);
  return lines[0]!;
}

describe("plain-language call sites — leaky fallbacks gone", () => {
  it("MarketStateCard.tsx: no || state; on the regimeLabel line; helper imported", () => {
    const src = readOwned("gexdesk/MarketStateCard.tsx");
    const regimeLine = lineContaining(src, /const regimeLabel\s*=/, "regimeLabel assignment");
    expect(regimeLine).not.toContain("|| state;");
    expect(src).toMatch(/from ["']@\/lib\/plainLabels["']/);
    expect(src).toMatch(/\bregimeLabel\b/);
    expect(src).toMatch(/(?:regimeLabel|plainRegime)\(/);
  });

  it("StockAnalysis.tsx: no raw trust/regime/macro chips; helpers present", () => {
    const src = readOwned("StockAnalysis.tsx");
    expect(src).not.toContain("|| glance.regime");
    expect(src).not.toContain("cap(dec?.trust_tier)");
    expect(src).not.toContain("{macro.duration_en}");
    expect(src).not.toContain("{macro.regime_en}");
    expect(src).not.toContain("{macro.inflation_en}");
    expect(src).toContain("trustTierLabel(");
    expect(src).toContain("macroChipLabel(");
  });

  it("SurfacePane.tsx: no || glanceRow.regime", () => {
    const src = readOwned("surface/SurfacePane.tsx");
    expect(src).not.toContain("|| glanceRow.regime");
  });

  it("HeatmapTable.tsx: no ?? tile.sector; mappedOrNeutral present", () => {
    const src = readOwned("heatmap/HeatmapTable.tsx");
    expect(src).not.toContain("?? tile.sector");
    expect(src).toContain("mappedOrNeutral(");
  });

  it("IndicatorsModal.tsx: no CAT_TKEY[ / visible SUITE_TIER_LABEL; helpers present", () => {
    const src = readOwned("IndicatorsModal.tsx");
    expect(src).not.toContain("CAT_TKEY[");
    expect(src).not.toContain(">{SUITE_TIER_LABEL[");
    expect(src).toContain("classicCategoryLabel(");
    expect(src).toContain("planTierLabel(");
  });

  it("ScreenerView.tsx: no || r.mscRegime; inline Not classified / 未分类", () => {
    const src = readOwned("ScreenerView.tsx");
    const gexLine = lineContaining(src, "regime${r.mscRegime}", "mscRegime gexT line");
    expect(gexLine).not.toContain("|| r.mscRegime");
    expect(gexLine).toContain("Not classified");
    expect(gexLine).toContain("未分类");
    expect(src).not.toContain("|| r.mscRegime");
  });
});
