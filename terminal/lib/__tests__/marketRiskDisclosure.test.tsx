// @vitest-environment jsdom
// Synthetic source-native states; no prediction, policy or production data.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/fin/FinCharts", () => ({ LineSeries: () => null }));
import { MarketRiskChip } from "@/components/fin/OracleDash";
import { normalizeMarketRisk, riskEnvelopeCopy } from "../marketRisk";
import { MARKET_RISK_NOW as NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "./marketRiskFixture";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function envelope(stage: string | null = "NONE", contradiction = false): Record<string, unknown> {
  return {
    ...riskEnvelopeFixture(),
    hazard_summary: { stage, display_only: true, unreadable_sources: [], unmapped_required_sources: [] },
    coherence: { state: contradiction ? "CONTRADICTORY" : "ALIGNED", contradiction_count: contradiction ? 1 : 0 },
    coverage: { required: ["market-state-latest", "leadership-crack-latest"], optional: ["optional-context"],
      stale: [], missing: ["optional-context"], fresh: ["market-state-latest", "leadership-crack-latest"] },
  };
}
function bridge(env: Record<string, unknown> | null = envelope()): Record<string, unknown> {
  return { ...marketRiskSourceFixture(), schema: "market_risk/v1", risk_envelope: env };
}
function staleRequired(): Record<string, unknown> {
  const env = envelope(null);
  return {
    ...env, data_state: "DEGRADED",
    hazard_summary: { stage: null, unreadable_sources: ["leadership-crack-latest"], unmapped_required_sources: [], display_only: true },
    coverage: { required: ["market-state-latest", "leadership-crack-latest"], optional: [],
      fresh: ["market-state-latest"], stale: ["leadership-crack-latest"], missing: [] },
    freshness: { source_session: "2026-10-07", per_source: {
      "leadership-crack-latest": { as_of: "2026-10-06", state: "STALE", matches_session: false },
    } },
  };
}

describe("visible source-native risk disclosure", () => {
  let root: Root, host: HTMLDivElement, fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function render(raw: unknown, zh = false) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => raw });
    await act(async () => root.render(<MarketRiskChip zh={zh} />));
    return host.querySelector("summary")!.textContent!;
  }
  it("makes qualified fragility visible without relabeling the measured market", async () => {
    const raw = bridge(envelope("FRAGILE")), before = structuredClone(raw);
    const summary = await render(raw);
    expect(summary).toContain("Mixed"); expect(summary).toContain("51/100");
    expect(summary).toContain("Hazard: Fragile"); expect(summary).toContain("US market risk");
    expect(summary).not.toContain("Risk off");
    expect((host.querySelector("details") as HTMLDetailsElement).open).toBe(false);
    expect(raw).toEqual(before);
    expect(host.querySelector('[data-testid="market-risk-attention"]')?.getAttribute("aria-live")).toBe("polite");
  });
  it("does not turn missing optional context into unavailable required hazard", async () => {
    const summary = await render(bridge(envelope("NONE")));
    expect(summary).toContain("51/100"); expect(summary).not.toMatch(/Fragile|Hazard unavailable|Conflicting signals/);
  });
  it("names stale required evidence and its own older date", async () => {
    const raw = bridge(staleRequired());
    expect(normalizeMarketRisk(raw, NOW)?.risk_envelope_freshness.qualified).toBe(true);
    const summary = await render(raw);
    expect(summary).toContain("51/100"); expect(summary).toContain("Hazard unavailable");
    const details = host.querySelector('[data-testid="market-risk-details"]')!.textContent!;
    expect(details).toContain("leadership-crack-latest"); expect(details).toContain("2026-10-06");
    expect(details).toContain("Required source unavailable"); expect(details).toContain("Stale");
  });
  it("shows a source-reported contradiction separately from its unchanged score", async () => {
    const summary = await render({ ...bridge(envelope("FRAGILE", true)), verdict: "RISK_ON", score: 65,
      label_en: "Risk on", color: "green" });
    expect(summary).toContain("Risk on"); expect(summary).toContain("65/100");
    expect(summary).toContain("Hazard: Fragile"); expect(summary).toContain("Conflicting signals");
    expect(host.textContent).toContain("The source reports disagreement between measured market state and hazard evidence");
  });
  it("does not infer a contradiction or risk-off from two independently supplied readings", async () => {
    const summary = await render({ ...bridge(envelope("FRAGILE")), verdict: "RISK_ON", score: 65, label_en: "Risk on" });
    expect(summary).toContain("Hazard: Fragile"); expect(summary).not.toContain("Conflicting signals");
    expect(summary).not.toContain("Risk off");
  });
  it.each([null, { ...envelope("FRAGILE", true), source_session: "2026-10-06", as_of: "2026-10-06" }])(
    "keeps absent or rejected envelope unavailable instead of projecting its hazard", async env => {
      const summary = await render(bridge(env));
      expect(summary).toContain("51/100"); expect(summary).toContain("Hazard unavailable");
      expect(summary).not.toMatch(/Hazard: Fragile|Conflicting signals/);
    });
  it.each([{ schema: "unknown" }, { ...bridge(envelope("FRAGILE")), asof: "2026-09-01" }])(
    "does not display a current hazard or score when its measured base is unavailable", async raw => {
      const summary = await render(raw);
      expect(summary).toContain("Market risk unavailable"); expect(summary).not.toContain("/100");
      expect(summary).not.toContain("Hazard: Fragile");
    });
  it("updates the compact warning on the existing refresh path without opening the panel", async () => {
    await render(bridge(envelope("NONE")));
    expect(host.querySelector("summary")!.textContent).not.toContain("Fragile");
    fetchMock.mockResolvedValue({ ok: true, json: async () => bridge(envelope("FRAGILE")) });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector("summary")!.textContent).toContain("Hazard: Fragile");
    expect(host.querySelector("summary")!.textContent).toContain("51/100");
    expect((host.querySelector("details") as HTMLDetailsElement).open).toBe(false);
    expect(fetchMock.mock.calls.every(call => call[1].cache === "no-store")).toBe(true);
  });
  it("uses Chinese disclosure while preserving the original source identity and date", async () => {
    const summary = await render(bridge(staleRequired()), true);
    expect(summary).toContain("风险阶段不可用"); expect(summary).toContain("美国市场风险");
    expect(summary).not.toMatch(/Hazard|US market risk|Conflicting signals/);
    expect(host.textContent).toContain("leadership-crack-latest"); expect(host.textContent).toContain("2026-10-06");
  });
  it("labels a Chinese source-native conflict without English warning copy", async () => {
    const summary = await render(bridge(envelope("FRAGILE", true)), true);
    expect(summary).toContain("风险阶段：脆弱"); expect(summary).toContain("信号存在分歧");
    expect(summary).not.toMatch(/Hazard|Conflicting signals/);
  });
  it("uses unknown rather than the current session for a malformed per-source date", async () => {
    const env = staleRequired();
    env.freshness = { per_source: { "leadership-crack-latest": { as_of: "not-a-date", state: "STALE" } } };
    await render(bridge(env));
    expect(host.textContent).toContain("Observation session: unavailable");
    expect(host.textContent).not.toContain("not-a-date");
  });
  it.each(["constructor", "__proto__", "unrecognized-stage"])("keeps unknown hazard labels unavailable: %s", async stage => {
    const summary = await render(bridge(envelope(stage)));
    expect(summary).toContain("Hazard unavailable");
    expect(summary).not.toMatch(/undefined|Hazard: constructor|Hazard: __proto__/);
  });
  it("labels live provisional hazard by its own source revision", async () => {
    const env = { ...envelope("FRAGILE"), revision: "live_provisional", stale_after: "2026-10-08T12:05:00Z" };
    const summary = await render(bridge(env));
    expect(summary).toContain("Hazard: Fragile (provisional)");
    expect(host.textContent).toContain("This hazard reading is live and provisional, not a settled confirmation");
  });
  it("does not call a settled hazard provisional merely because the measured label is pending", async () => {
    const summary = await render({ ...bridge(envelope("FRAGILE")), display_pending: { verdict: "MIXED" } });
    expect(summary).toContain("Hazard: Fragile"); expect(summary).not.toContain("provisional");
  });
  it("discloses required data gaps even when the source stage is NONE", async () => {
    const env = staleRequired();
    env.hazard_summary = { stage: "NONE", unreadable_sources: ["leadership-crack-latest"], display_only: true };
    const summary = await render(bridge(env));
    expect(summary).toContain("Required data unavailable"); expect(summary).toContain("51/100");
    expect(summary).not.toContain("Hazard: Fragile");
  });
  it("keeps the existing live-region node mounted across a new warning", async () => {
    await render(bridge(envelope("NONE")));
    const live = host.querySelector('[data-testid="market-risk-attention"]');
    expect(live).not.toBeNull(); expect(live?.textContent).toBe("");
    fetchMock.mockResolvedValue({ ok: true, json: async () => bridge(envelope("FRAGILE")) });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector('[data-testid="market-risk-attention"]')).toBe(live);
    expect(live?.textContent).toContain("Hazard: Fragile");
  });
  it("cannot represent a future per-source date as a past settled observation", async () => {
    const env = staleRequired();
    env.freshness = { per_source: { "leadership-crack-latest": { as_of: "2999-12-31", state: "STALE" } } };
    await render(bridge(env));
    expect(host.textContent).toContain("Observation session: unavailable"); expect(host.textContent).not.toContain("2999-12-31");
  });
  it("keeps different long source IDs distinguishable and avoids duplicate React keys", async () => {
    const one = "source-" + "x".repeat(100) + "-one", two = "source-" + "x".repeat(100) + "-two";
    const env = staleRequired();
    env.coverage = { required: [one, two], stale: [one, two], missing: [] };
    env.hazard_summary = { stage: null, unreadable_sources: [one, two], display_only: true };
    env.freshness = { per_source: { [one]: { as_of: "2026-10-06", state: "STALE" }, [two]: { as_of: "2026-10-06", state: "STALE" } } };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await render(bridge(env));
    expect(host.textContent).toContain(one); expect(host.textContent).toContain(two);
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
  });
  it.each([{ stage: ["FRAGILE"] }, { stage: { toString: null } }])("does not coerce a nonstring hazard into a sourced claim", async ({ stage }) => {
    const env = envelope(); env.hazard_summary = { stage, display_only: true };
    const summary = await render(bridge(env));
    expect(summary).toContain("Hazard unavailable"); expect(summary).not.toContain("Hazard: Fragile");
  });
  it("renders Chinese provisional and missing-required-data qualifications", async () => {
    const env = staleRequired();
    env.revision = "live_provisional"; env.stale_after = "2026-10-08T12:05:00Z";
    env.hazard_summary = { stage: "FRAGILE", unreadable_sources: ["leadership-crack-latest"], display_only: true };
    const summary = await render(bridge(env), true);
    expect(summary).toContain("风险阶段：脆弱（临时观测）"); expect(summary).toContain("必要数据不可用");
    expect(summary).not.toMatch(/provisional|Required data/);
  });
  it("never relabels a non-US source as US in pure disclosure copy", () => {
    const copy = riskEnvelopeCopy({ ...envelope(), market: "HK" }, false);
    expect(copy).toHaveProperty("scope", null);
  });
});
