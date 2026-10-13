// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/fin/FinCharts", () => ({ LineSeries: () => null }));
import { MarketRiskChip } from "@/components/fin/OracleDash";
import { MARKET_RISK_NOW as NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "./marketRiskFixture";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the actual Oracle market-risk reader", () => {
  let root: Root, host: HTMLDivElement, fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ...marketRiskSourceFixture(), schema: "market_risk/v1", risk_envelope: riskEnvelopeFixture(),
    }) });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const render = async (zh = false) => { await act(async () => root.render(<MarketRiskChip zh={zh} />)); };

  it("renders the flat bridge and exposes native context through the existing chip", async () => {
    await render();
    expect(host.querySelector("summary")?.textContent).toContain("Mixed");
    expect(host.querySelector("summary")?.textContent).toContain("51/100");
    expect(host.querySelector('[data-testid="market-risk-details"]')?.textContent).toContain("Defensive relative strength");
    expect(host.textContent).toContain("2026-09-29 → 2026-09-30");
    expect(host.textContent).toContain("Statistical independence is unproven");
    const disclosure = host.querySelector("details")!;
    await act(async () => (host.querySelector("summary") as HTMLElement).click());
    expect(disclosure.open).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
  it("refreshes on focus and removes a now-expired visible reading", async () => {
    await render();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-13T12:00:00Z"));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.querySelector("summary")?.textContent).toContain("Market risk unavailable");
    expect(host.querySelector("summary")?.textContent).not.toContain("51/100");
    expect(host.textContent).toContain("2026-10-07");
  });
  it("does not turn failed or malformed reads into a calm score", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ schema: "unknown", display: {} }) });
    await render();
    expect(host.querySelector("summary")?.textContent).toContain("Market risk unavailable");
    expect(host.textContent).not.toContain("/100");
  });
  it("discloses a held risk label separately from its current live score", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      ...marketRiskSourceFixture(), schema: "market_risk/v1", asof: "2026-10-08",
      verdict: "RISK_ON", label_en: "Risk on", score: 50, raw_score: 78, capped: true,
      source_basis: "live_display", source_verdict: "MIXED", cause_basis: "live_score_pending_band",
      built: "2026-10-08T11:59:00Z", source_event_time: "2026-10-08T11:58:00Z",
      stale_after: "2026-10-08T12:05:00Z", display_pending: { verdict: "MIXED", ticks: 1, needs: 2 },
      headline_en: "Owner display projection",
    }) });
    await render();
    expect(host.querySelector("summary")?.textContent).toContain("Risk on");
    expect(host.querySelector("summary")?.textContent).toContain("50/100");
    expect(host.textContent).toContain("Owner display projection");
    expect(host.textContent).toContain("The numerical score is live; the risk label is held");
  });
  it("renders native context and absence in Chinese", async () => {
    await render(true);
    expect(host.textContent).toContain("防御板块相对走强");
    expect(host.textContent).toContain("未确立统计独立性");
    fetchMock.mockRejectedValue(new Error("test unavailable"));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector("summary")?.textContent).toContain("市场风险不可用");
  });
});
