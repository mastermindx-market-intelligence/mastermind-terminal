import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = join(__dirname, "../../components");

function readComponent(rel: string): string {
  return readFileSync(join(COMPONENTS, rel), "utf8");
}

describe("trader-facing copy stays human-readable", () => {
  it("flow freshness uses user-facing timing labels and hides transport-contract tooltips", () => {
    const src = readComponent("flowdesk/FlowFreshnessReceipt.tsx");
    expect(src).toContain('updated: ["Updated", "更新"]');
    expect(src).toContain('sourceData: ["Source data", "源数据"]');
    expect(src).toContain('refreshCycle: ["Refresh cycle", "更新周期"]');
    expect(src).not.toContain('sourceResponses: ["Source responses"');
    expect(src).not.toContain('observedCycle: ["Observed cycle"');
    expect(src).not.toContain('"live_flow.meta/v2 timing clocks unavailable"');
  });

  it("flow inspector reuses the same plain-language direction caveat as filters", () => {
    const src = readComponent("flowdesk/InspectorPane.tsx");
    expect(src).toContain("FD.leanHeuristic.en");
    expect(src).toContain("FD.leanHeuristic.zh");
    expect(src).not.toContain("Display-only; forward ledger accruing");
  });

  it("Prophet chrome describes missing data and performance without payload or ledger jargon", () => {
    const src = readComponent("prophet/prophetStrings.ts");
    expect(src).toContain('authorityLabel:   ["Research view — performance history building"');
    expect(src).toContain('perfPlaceholderTitle:  ["Performance History"');
    expect(src).toContain('"Performance will appear here after enough plans have closed."');
    expect(src).not.toContain('noPlans:          ["No active prophecies — ledger accruing."');
    expect(src).not.toContain('thesisCaption:    ["Machine-generated from engine fields — display only"');
    expect(src).not.toContain('"No intraday price in this payload');
    expect(src).not.toContain('"No management score in this payload.');
  });

  it("EOD helper copy says data and options ladder instead of implementation artifacts", () => {
    const src = readComponent("eodcontext/eodStrings.ts");
    expect(src).toContain('"from the options ladder"');
    expect(src).toContain('"Dark-pool data for the latest settled close isn\'t available yet.');
    expect(src).toContain('"Volatility-regime data for the latest settled close isn\'t available yet.');
    expect(src).not.toContain('"The settled dark-pool artifact hasn\'t published yet.');
    expect(src).not.toContain('"Published by the structure snapshot; display-only."');
  });
});
