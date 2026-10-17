// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider, applyLang } from "../i18n";
import CompanyThemeContextCard, { type CompanyThemeContextCardProps } from "@/components/fin/CompanyThemeContextCard";

const transport = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/companyThemeExposure", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/companyThemeExposure")>();
  return { ...actual, getCompanyThemeExposure: transport.get };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const generation = "b".repeat(24);
function fixture(ticker = "NVDA", asOf = "2026-08-01") {
  return {
    ok: true, state: "ready",
    context: {
      schema: "company_theme_exposure.v1", authority: "context_only", is_context_only: true,
      generated_at: "2026-08-01T12:00:00Z", generation_id: "a".repeat(24), status: "ready",
      company: { ticker }, company_intelligence: { generation_id: generation, context_sha256: "c".repeat(64), latest_event_id: "latest", latest_event_call_date: "2026-05-28" },
      exposures: [{ theme_id: "ai_infrastructure", name_en: "AI Infrastructure", name_zh: "人工智能基础设施", basket_id: "ai_semiconductors", mapping_qualifier: "proxy" }],
      coverage: { status: "mapped", active_basket_count: 1, mapped_basket_count: 1, unmapped_basket_count: 0 },
      theme_state: { status: "fresh", as_of: asOf, sha256: "d".repeat(64) }, warnings: [],
    },
  };
}
describe("mounted company theme card semantic aging", () => {
  let host: HTMLDivElement, root: Root;
  const props: CompanyThemeContextCardProps = { ticker: "NVDA", selectedEventId: "latest", companyIntelligenceGenerationId: generation, latestEventId: "latest", selectedEventLabel: "Q1 FY2026" };
  const render = async (patch: Partial<CompanyThemeContextCardProps> = {}) => {
    await act(async () => root.render(<LangProvider><CompanyThemeContextCard {...props} {...patch} /></LangProvider>));
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-06T23:59:59Z");
    transport.get.mockReset().mockResolvedValue(fixture());
    document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove(); vi.useRealTimers(); vi.restoreAllMocks();
  });

  it("ages the existing footer and warning at expiry without a fetch or click", async () => {
    await render();
    expect(host.querySelector(".ci-theme-footer")?.textContent).toContain("Fresh");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.querySelector(".ci-theme-footer")?.textContent).toContain("Stale");
    expect(host.querySelector(".ci-theme-header")?.textContent).toContain("Last verified");
    expect(host.querySelector(".ci-theme-warning")?.textContent).toContain("theme-state receipt is stale");
    expect(transport.get).toHaveBeenCalledTimes(1);
  });

  it("discloses a future receipt as partial instead of a Verified header", async () => {
    transport.get.mockResolvedValue(fixture("NVDA", "2026-08-07"));
    await render();
    expect(host.querySelector(".ci-theme-footer")?.textContent).toContain("Future date");
    expect(host.querySelector(".ci-theme-header")?.textContent).toContain("Partial");
    expect(host.querySelector(".ci-theme-header")?.textContent).not.toContain("Verified");
  });

  it.each(["focus", "visibilitychange"])("re-ages on %s after a background clock jump", async event => {
    await render();
    vi.setSystemTime("2026-08-08T12:00:00Z");
    await act(async () => (event === "focus" ? window : document).dispatchEvent(new Event(event)));
    expect(host.querySelector(".ci-theme-footer")?.textContent).toContain("Stale");
    expect(transport.get).toHaveBeenCalledTimes(1);
  });

  it("cancels the old expiry when context identity changes", async () => {
    await render();
    transport.get.mockResolvedValue(fixture("AAPL", "2026-08-06"));
    await render({ ticker: "AAPL" });
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.querySelector(".ci-theme-footer")?.textContent).toContain("Fresh");
    expect(transport.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("quarantines a changed parent and cancels late results", async () => {
    let deliver!: (value: ReturnType<typeof fixture>) => void;
    transport.get.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
    await render();
    transport.get.mockResolvedValue(fixture());
    await render({ companyIntelligenceGenerationId: "7".repeat(24) });
    expect(host.textContent).toContain("Theme context is refreshing");
    await act(async () => deliver(fixture()));
    expect(host.textContent).toContain("Theme context is refreshing");
    expect(host.textContent).not.toContain("AI Infrastructure");
  });

  it("historical quarantine outranks expired receipts and schedules no expiry", async () => {
    await render();
    await render({ selectedEventId: "historical", selectedEventLabel: "Q4 FY2025" });
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.textContent).toContain("Q4 FY2025 is historical");
    expect(host.textContent).not.toContain("AI Infrastructure");
    expect(host.querySelector(".ci-theme-footer")).toBeNull();
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("quarantines retained context until a return-to-latest fetch settles", async () => {
    await render();
    await render({ selectedEventId: "historical" });
    vi.setSystemTime("2026-08-07T00:00:01Z");
    transport.get.mockImplementation(() => new Promise(() => {}));
    await render();
    expect(host.querySelector(".ci-theme-loading")).not.toBeNull();
    expect(host.querySelector(".ci-theme-footer")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("parent quarantine wins even when the sidecar publication clock is future", async () => {
    const future = fixture();
    future.context.generated_at = "2026-08-08T12:00:00Z";
    transport.get.mockResolvedValue(future);
    await render({ companyIntelligenceGenerationId: "7".repeat(24) });
    expect(host.textContent).toContain("Theme context is refreshing");
    expect(host.textContent).not.toContain("AI Infrastructure");
  });

  it("uses current ZH copy on timed expiry without leaking EN status", async () => {
    await render();
    await act(async () => applyLang("zh"));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.querySelector(".ci-theme-footer")?.textContent).toContain("已过期");
    expect(host.querySelector(".ci-theme-warning")?.textContent).toContain("独立主题状态凭证已过期");
    expect(host.querySelector(".ci-theme-footer")?.textContent).not.toContain("Stale");
  });

  it("clears expiry and resume listeners on unmount", async () => {
    await render();
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(transport.get).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });
});
