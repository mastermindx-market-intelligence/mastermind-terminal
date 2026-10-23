// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorIntradayComparison, { useSectorPresentationClock } from "@/components/sector-intelligence/SectorIntradayComparison";
import { LangProvider, applyLang } from "@/lib/i18n";
import {
  FRESH_NOW, REFERENCE_ASOF, SOURCE_ASOF, basket, basketPulse, mixedPulse,
  observedComparison, qualifiedBasketComparison, unavailableComparison,
} from "./sectorIntradayFixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ClockedPanel({ data }: { data: unknown }) {
  const nowMs = useSectorPresentationClock(FRESH_NOW);
  return <SectorIntradayComparison data={data} status="ready" asOf={SOURCE_ASOF} nowMs={nowMs} />;
}

describe("Sector intraday comparison — the mounted overview section", () => {
  let root: Root, host: HTMLDivElement;
  const render = async (props: { data?: unknown; status?: Parameters<typeof SectorIntradayComparison>[0]["status"]; asOf?: string | null; nowMs?: number } = {}) => {
    await act(async () => root.render(<LangProvider>
      <SectorIntradayComparison data={mixedPulse()} status="ready" asOf={SOURCE_ASOF} nowMs={FRESH_NOW} {...props} />
    </LangProvider>));
  };
  const panel = () => host.querySelector('[data-testid="sector-intraday"]')!;
  const baskets = () => [...host.querySelectorAll('[data-testid="sector-intraday-basket"]')] as HTMLDetailsElement[];
  const unqualified = () => [...host.querySelectorAll('[data-testid="sector-intraday-unqualified"]')] as HTMLElement[];
  const byId = (id: string) => baskets().find(row => row.getAttribute("data-basket") === id)!;

  beforeEach(() => {
    vi.clearAllMocks(); applyLang("en"); document.documentElement.setAttribute("data-lang", "en");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    if (vi.isFakeTimers()) { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); }
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("renders an observed new interval as the owner's own identity, metrics and coverage", async () => {
    await render();
    expect(panel().querySelector("h2")!.textContent).toBe("Intraday relative moves");
    const row = byId("ai_infra"), text = row.textContent!;
    expect(text).toContain("ai_infra");
    expect(text).toContain("+2.00%");          // observed interval change
    expect(text).toContain("+1.49%");          // interval versus SPY, the owner's own relative value
    expect(text).toContain("62.50%");          // positive relative breadth
    expect(text).toContain("−1.25%");          // the day change, on its own clock and clearly separate
    expect(row.querySelector("details")).toBeNull();
    expect(unqualified().map(row => row.querySelector("summary")!.textContent)).toEqual([
      "ai_softwareWaiting for another observation.",
      "clean_energyComparable observations are unavailable.",
    ]);
  });

  it("keeps the day change visibly separate from the observed interval", async () => {
    await render();
    const labels = [...byId("ai_infra").querySelectorAll("[data-intraday-label]")].map(node => node.textContent);
    expect(labels).toEqual(["Observed interval", "Interval vs SPY", "Positive relative breadth", "Day"]);
    const basket = byId("ai_infra").querySelector("summary")!.firstElementChild!;
    expect(basket.textContent).toBe("ai_infra");
  });

  it("marks a retained settled close as the same observation rather than a new one", async () => {
    await render();
    const row = byId("mag7");
    expect(row.textContent).toContain("mag7");
    expect(row.textContent).toContain("+3.50%");
    expect(row.open).toBe(false);
    await act(async () => { row.open = true; });
    expect(row.textContent).toContain("Retained — same observation, not a new one");
    expect(row.textContent).toContain("Settled closing observation");
    // Redelivery must not restate the measurement as fresh: the endpoint clock is unchanged.
    expect(row.textContent).toContain(SOURCE_ASOF);
  });

  it("discloses both exact source clocks, the interval, the benchmark, the method and the exclusions", async () => {
    await render();
    const row = byId("ai_infra");
    await act(async () => { row.open = true; });
    const text = row.textContent!;
    expect(text).toContain(REFERENCE_ASOF);
    expect(text).toContain(SOURCE_ASOF);
    expect(text).toContain("3600 s");
    expect(text).toContain("2026-10-22");
    expect(text).toContain("SPY");
    expect(text).toContain("matched_member_equal_weight");
    expect(text).toContain("8 / 10 (80.0%)");
    expect(text).toContain("missing_observation ×2");
    // A delivered observation is not a redelivery, so no retained banner appears.
    expect(text).not.toContain("not a new one");
  });

  it("renders a qualified row with a reason and never with a number standing in for one", async () => {
    await render({ data: basketPulse([basket("ai_infra", unavailableComparison("baseline_corrected"))]) });
    expect(baskets()).toHaveLength(0);
    const text = unqualified()[0].textContent!;
    expect(text).toContain("ai_infra");
    expect(text).toContain("Comparison reset after a source change.");
    expect(text).not.toMatch(/[+−-]\d/);
  });

  it("keeps a qualified row's real coverage visible instead of rounding it to zero", async () => {
    await render({ data: basketPulse([basket("clean_energy", qualifiedBasketComparison("insufficient_matched_coverage"))]) });
    expect(unqualified()[0].textContent).toContain("Comparable observations are unavailable.");
    // The coverage that the owner did state stays reachable; it is never shown as 0%.
    expect(unqualified()[0].textContent).not.toContain("0 / 10");
  });

  it("reports the feed's own source clock and never a transport receipt", async () => {
    await render();
    const clock = host.querySelector('[data-testid="sector-intraday-clock"]')!;
    expect(clock.textContent).toBe(SOURCE_ASOF);
    expect(clock.getAttribute("dateTime")).toBe(SOURCE_ASOF);
  });

  it.each([
    ["loading", "loading", "Loading observed intervals…"],
    ["access", "access", "Sign in with access to view these observations."],
    ["unavailable", "unavailable", "Interval observations could not be loaded."],
    ["error", "error", "Interval observations could not be loaded."],
    ["invalid", "invalid", "Interval observations could not be verified."],
  ])("bounds the %s state to one message and no figures", async (_label, status, message) => {
    await render({ status: status as "loading" });
    expect(panel().textContent).toContain(message);
    expect(baskets()).toHaveLength(0);
    expect(unqualified()).toHaveLength(0);
  });

  it("distinguishes a build with no comparisons from a broken one", async () => {
    await render({ data: basketPulse([basket("ai_infra", undefined)]) });
    expect(panel().textContent).toContain("This source has not published interval comparisons yet.");
    expect(panel().textContent).not.toContain("could not be verified");
  });

  it("fails closed on an unreadable envelope without taking the rest of the overview with it", async () => {
    await render({ data: { schema: "basket_pulse.v2", baskets: [] } });
    expect(panel().textContent).toContain("Interval observations could not be verified.");
    expect(baskets()).toHaveLength(0);
  });

  it("drops only the basket that fails its own gate", async () => {
    await render({ data: basketPulse([basket("ai_infra", observedComparison()),
      basket("broken", { schema: "wrong" }), basket("mag7", observedComparison())]) });
    expect(baskets().map(row => row.getAttribute("data-basket"))).toEqual(["ai_infra", "mag7"]);
  });

  it("localizes every label and reason, and never leaks one language into the other view", async () => {
    applyLang("zh"); document.documentElement.setAttribute("data-lang", "zh");
    await render();
    const text = panel().textContent!;
    expect(text).toContain("盘中相对走势");
    expect(text).toContain("观测区间");
    expect(text).toContain("区间相对SPY");
    expect(text).toContain("等待新的观测。");
    // Owner basket identity is the owner's own token in both languages — never translated here.
    expect(text).toContain("ai_infra");
    expect(text).not.toContain("Intraday relative moves");
    expect(text).not.toContain("Waiting for another observation.");
  });

  it("uses a native keyboard-operable disclosure with no extra positive tab stops", async () => {
    await render();
    const row = byId("ai_infra");
    // A real <details>/<summary> pair: the browser owns expand/collapse and its keyboard
    // semantics, so no custom key handling can strand a keyboard or screen-reader user.
    expect(row.tagName).toBe("DETAILS");
    const summary = row.querySelector("summary")!;
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).toBe(row);
    expect(summary.getAttribute("tabindex")).toBeNull();
    summary.focus();
    expect(document.activeElement).toBe(summary);
    // The panel adds no focusable control a keyboard reader would have to step through.
    expect(host.querySelectorAll("button, input, select, a[href]")).toHaveLength(0);
  });

  it("repair contract preserves producer order instead of ranking relative changes", async () => {
    await render({ data: basketPulse([
      basket("zeta", observedComparison()),
      basket("alpha", observedComparison({ absolute_change_pct: 3, relative_change_pct: 2.487562 })),
    ]) });
    expect(baskets().map(row => row.getAttribute("data-basket"))).toEqual(["zeta", "alpha"]);
  });

  it("repair contract exposes validated evidence when financial figures are withheld", async () => {
    await render({ data: basketPulse([basket("clean_energy",
      qualifiedBasketComparison("insufficient_matched_coverage"))]) });
    const row = unqualified()[0];
    expect(row.tagName).toBe("DETAILS");
    expect(row.textContent).toContain(REFERENCE_ASOF);
    expect(row.textContent).toContain(SOURCE_ASOF);
    expect(row.textContent).toContain("2 / 10 (20.0%)");
    expect(row.textContent).toContain("missing_observation ×8");
    expect(row.textContent).toContain("insufficient_matched_coverage");
    expect(row.querySelectorAll("[data-intraday-value]")).toHaveLength(0);
  });

  it("repair contract displays quote time separately from evaluation time", async () => {
    const built = "2026-10-22T19:04:00.123456Z";
    await render({ data: basketPulse([basket("ai_infra", observedComparison())],
      { as_of_utc: built, as_of_quotes: SOURCE_ASOF }) });
    expect(host.querySelector('[data-testid="sector-intraday-clock"]')?.textContent).toBe(SOURCE_ASOF);
    expect(host.querySelector('[data-testid="sector-intraday-evaluation-clock"]')?.textContent).toBe(built);
  });

  it("repair contract leaves a missing quote clock unavailable rather than borrowing build or receipt", async () => {
    await render({ data: basketPulse([basket("ai_infra", observedComparison())],
      { as_of_utc: "2026-10-22T19:04:00Z", as_of_quotes: undefined, source_asof: undefined }) });
    expect(host.querySelector('[data-testid="sector-intraday-clock"]')).toBeNull();
  });

  it("repair contract reports missing and malformed comparisons in a mixed feed", async () => {
    await render({ data: basketPulse([basket("valid", observedComparison()),
      basket("missing", undefined), basket("broken", { schema: "wrong" })]) });
    expect([...panel().querySelectorAll("[data-basket]")].map(row => row.getAttribute("data-basket")))
      .toEqual(["valid", "missing", "broken"]);
    expect(unqualified()).toHaveLength(2);
    expect(unqualified()[0].textContent).toContain("No interval comparison was supplied.");
    expect(unqualified()[1].textContent).toContain("Observation could not be verified.");
    for (const row of unqualified()) expect(row.querySelectorAll("[data-intraday-value]")).toHaveLength(0);
  });
  it("keeps an idle received observation honest as the device clock advances", async () => {
    vi.useFakeTimers(); vi.setSystemTime(FRESH_NOW);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => root.render(<LangProvider><ClockedPanel data={mixedPulse()} /></LangProvider>));
    expect(baskets()).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(41 * 60_000); });
    expect(baskets()).toHaveLength(0);
    expect(panel().querySelectorAll("[data-intraday-value]")).toHaveLength(0);
    const retained = unqualified().find(row => row.dataset.basket === "mag7")!;
    expect(retained.textContent).toContain("Observation is no longer current.");
    expect(retained.textContent).toContain("Retained — same observation, not a new one");
    expect(retained.textContent).toContain(SOURCE_ASOF);
    expect(retained.textContent).toContain("8 / 10 (80.0%)");
  });

  it("pauses the timer while hidden and requalifies immediately on visibility return", async () => {
    vi.useFakeTimers(); vi.setSystemTime(FRESH_NOW);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => root.render(<LangProvider><ClockedPanel data={mixedPulse()} /></LangProvider>));
    visibility.mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(FRESH_NOW + 41 * 60_000);
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(baskets()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
    expect(panel().textContent).toContain("Observation is no longer current.");
  });

  it("requalifies immediately on window focus without awaiting a timer tick", async () => {
    vi.useFakeTimers(); vi.setSystemTime(FRESH_NOW);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => root.render(<LangProvider><ClockedPanel data={mixedPulse()} /></LangProvider>));
    vi.setSystemTime(FRESH_NOW + 41 * 60_000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(baskets()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("labels a date-only quote bar without pretending it is an observation instant", async () => {
    await render({ data: basketPulse([basket("ai_infra", observedComparison())], { as_of_quotes: "2026-10-22" }) });
    expect(host.querySelector('[data-testid="sector-intraday-clock"]')).toBeNull();
    expect(host.querySelector('[data-testid="sector-intraday-bar-date"]')?.textContent).toBe("2026-10-22");
    expect(panel().textContent).toContain("Quote bar date");
    expect(panel().textContent).toContain("Source time unavailable");
  });

});
