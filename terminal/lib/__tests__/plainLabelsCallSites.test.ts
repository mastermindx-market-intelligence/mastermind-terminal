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

  it("ScreenerView.tsx: no || r.mscRegime; notClassified helper on the regime line", () => {
    const src = readOwned("ScreenerView.tsx");
    const gexLine = lineContaining(src, "regime${r.mscRegime}", "mscRegime gexT line");
    expect(gexLine).not.toContain("|| r.mscRegime");
    expect(gexLine).toContain("notClassified(lang)");
    expect(gexLine).not.toContain("Not classified");
    expect(src).not.toContain("|| r.mscRegime");
    expect(src).toContain("verdictLabel(");
  });

  it("StockAnalysis.tsx: AnalystGauge ratingVerdict uses lang, never hardcoded English", () => {
    const src = readOwned("StockAnalysis.tsx");
    const line = lineContaining(src, "ratingVerdict(", "ratingVerdict call");
    expect(line).not.toMatch(/ratingVerdict\([^)]*,\s*false\s*\)/);
    expect(line).toMatch(/lang\s*===\s*["']zh["']/);
  });

  it("StockAnalysis.tsx: entry chip tries urgency then falls through to status", () => {
    const src = readOwned("StockAnalysis.tsx");
    const line = lineContaining(src, "entryStatusLabel(", "entry chip");
    expect(line).not.toContain("entry.urgency || entry.status");
    expect(line).toMatch(/entryStatusLabel\(\s*entry\.urgency/);
    expect(line).toContain("entry.status");
  });

  it("OptionsHubView.tsx: ZH premium column is 总权利金, never 总保费", () => {
    const src = readOwned("OptionsHubView.tsx");
    expect(src).not.toContain("总保费");
    expect(src).toContain("总权利金");
  });

  it("i18n.tsx: ohNightlyPending English names the symbol, not a root", () => {
    const src = readFileSync(join(__dirname, "../i18n.tsx"), "utf8");
    expect(src).toContain('ohNightlyPending: ["Nightly data pending for this symbol."');
    expect(src).not.toContain('ohNightlyPending: ["Nightly data pending for this root"');
  });

  it("ChartPanel.tsx: oracle chip routes glance text through verdictLabel", () => {
    const src = readOwned("ChartPanel.tsx");
    expect(src).toContain('from "@/lib/plainLabels"');
    const chip = src.match(/const vLabel[\s\S]*?verdictRef\.current\.textContent/);
    expect(chip, "vLabel assignment").not.toBeNull();
    expect(chip![0]).toContain("verdictLabel(");
    expect(chip![0]).not.toContain("LIQUIDITY RECLAIM");
    expect(chip![0]).not.toContain("RE-ENTRY");
    expect(chip![0]).not.toMatch(/=\s*"STOP"/);
    expect(chip![0]).not.toMatch(/\?\s*"EARLY"/);
  });
});

describe("plain-language call sites — batch 2", () => {
  it("ChartConductor.tsx: live-steps titles route through t(), never English-only", () => {
    const src = readOwned("ChartConductor.tsx");
    expect(src).not.toContain('title={railOpen ? "Hide live steps" : "Show live steps"}');
    expect(src).not.toContain('title="Skip animations"');
    const toggle = lineContaining(src, "cmxHideSteps", "hide-steps");
    expect(toggle).toMatch(/\bt\(/);
  });

  it("IndicatorSource.tsx: read-only footnote routes through tPlain", () => {
    const src = readOwned("IndicatorSource.tsx");
    expect(src).not.toContain("Built-in indicators are read-only");
    expect(src).toMatch(/\btPlain\(/);
  });

  it("DiscoverWorkspace.tsx: tablist aria-label routes through t()", () => {
    const src = readOwned("workspaces/DiscoverWorkspace.tsx");
    expect(src).not.toContain('"Discover tabs"');
    expect(src).toContain('t("wtDiscoverTabs")');
  });

  it("ThesisWorkspace.tsx: subject kind routes through subjectKindLabel", () => {
    const src = readOwned("workspaces/ThesisWorkspace.tsx");
    expect(src).not.toContain("{entry.subject.kind}");
    expect(src).toContain("subjectKindLabel(");
  });

  it("OptionsPaywall.tsx: plan chip routes through t()", () => {
    const src = readOwned("OptionsPaywall.tsx");
    expect(src).not.toMatch(/>Essential · Pro</);
    expect(src).toContain('t("opwPlans")');
  });

  it("LoginFormLegacy.tsx: signup pitch routes through t()", () => {
    const src = readFileSync(join(__dirname, "../../app/login/LoginFormLegacy.tsx"), "utf8");
    expect(src).not.toContain("Free access to charts; Pro unlocks custom + proprietary indicators.");
    expect(src).toContain('t("lgSignupPitch")');
  });

  it("GuidePanel.tsx: academy chrome and teaching labels route through t(); tier uses planTierLabel", () => {
    const src = readOwned("GuidePanel.tsx");
    expect(src).not.toContain('"Indicator Academy"');
    expect(src).not.toContain('"At a glance"');
    expect(src).not.toContain("{candidate.tier}");
    expect(src).toContain('t("gpAcademy")');
    expect(src).toContain("planTierLabel(");
  });

  it("LevelsView.tsx: board chrome routes through t()", () => {
    const src = readOwned("levels/LevelsView.tsx");
    expect(src).not.toContain("No levels for this root yet");
    expect(src).not.toContain("Reading the gamma map");
    expect(src).not.toContain("New here? Learn the board");
    expect(src).toContain('t("lvNoLevels")');
    expect(src).toContain('t("lvLearnCta")');
  });

  it("LevelsLearn.tsx: teaching copy routes through t(), never English-only JSX", () => {
    const src = readOwned("levels/LevelsLearn.tsx");
    expect(src).not.toContain("Why price gets sticky or slippery");
    expect(src).not.toContain("The gamma weather map, in six reads");
    expect(src).not.toContain("leans against");
    expect(src).toContain('t("llHeroTitle")');
    expect(src).toContain('t("ll1title")');
  });
});
