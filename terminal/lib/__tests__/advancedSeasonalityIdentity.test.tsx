// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedSeasonality } from "../../components/fin/AdvancedSeasonality";
import SeasonalsPage from "../../components/fin/SeasonalsPage";
import * as seasonal from "../seasonal";

// These adjacent panels fetch unrelated forecast data. The seasonal page,
// chart, controls, analytics, deferred computation, and math remain real.
vi.mock("../../components/fin/RegimeOutlook", () => ({ RegimeOutlook: () => null }));
vi.mock("../../components/fin/ForecastPage", () => ({ Disclaimer: () => null }));

function barsFor(pattern: "notable" | "noise") {
  let close = 100;
  return Array.from({ length: 7 }, (_, i) => Array.from({ length: 12 }, (_, m) => {
    close *= 1 + (pattern === "noise" ? 1 : m === 5 ? 25 : -1) / 100;
    return { time: `${2018 + i}-${String(m + 1).padStart(2, "0")}-28`, o: close, h: close, l: close, c: close, v: 1 };
  })).flat();
}

let root: Root;
let container: HTMLDivElement;
let random: ReturnType<typeof vi.spyOn>;
function render(node: React.ReactNode) { act(() => root.render(node)); }
function settle() { act(() => vi.runOnlyPendingTimers()); }
function verdicts() {
  return [...container.querySelectorAll(".fin-adv-card:nth-child(2) .fin-adv-flag, .fin-adv-bestcall .fin-adv-flag")]
    .map((node) => node.textContent);
}
function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === text);
  expect(button, `button ${text}`).toBeDefined();
  act(() => button!.click());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let seed = 1;
  random = vi.spyOn(Math, "random").mockImplementation(() => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296));
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AdvancedSeasonality deferred verdict identity", () => {
  it("defers the real permutation verdict, then shows the same result at both claims", () => {
    const years = seasonal.buildYears(barsFor("notable"));
    const active = new Set(years.map((year) => year.year));
    render(<AdvancedSeasonality years={years} active={active} />);
    expect(verdicts()).toEqual([]);
    settle();
    expect(verdicts()).toEqual(["notable", "notable"]);
    expect(container.querySelectorAll(".fin-adv-panel").length).toBeGreaterThan(3);
  });

  it.each([false, true])("replaces revised prices with identical year labels without showing the old verdict (zh=%s)", (zh) => {
    const oldYears = seasonal.buildYears(barsFor("notable"));
    const newYears = seasonal.buildYears(barsFor("noise"));
    const active = new Set(oldYears.map((year) => year.year));
    expect(newYears.map((year) => year.year)).toEqual(oldYears.map((year) => year.year));
    render(<AdvancedSeasonality years={oldYears} active={active} zh={zh} />);
    settle();
    expect(verdicts()).toEqual(zh ? ["显著", "显著"] : ["notable", "notable"]);
    render(<AdvancedSeasonality years={newYears} active={active} zh={zh} />);
    expect(verdicts()).toEqual([]);
    settle();
    expect(verdicts()).toEqual(zh ? ["疑似噪声", "疑似噪声"] : ["likely noise", "likely noise"]);
  });

  it("updates the actual page on a same-year ticker transition and preserves its Table view", () => {
    render(<SeasonalsPage sym="AAA" bars={barsFor("notable")} />);
    settle();
    click("Table");
    expect(verdicts()).toEqual(["notable", "notable"]);
    render(<SeasonalsPage sym="BBB" bars={barsFor("noise")} />);
    expect(container.querySelector(".fin-seas-grid")).not.toBeNull();
    expect(verdicts()).toEqual([]);
    settle();
    expect(verdicts()).toEqual(["likely noise", "likely noise"]);
    expect(container.querySelector(".fin-seas-grid")).not.toBeNull();
  });

  it("does not rerun a settled computation for stable inputs, locale, or local sort changes", () => {
    const years = seasonal.buildYears(barsFor("notable"));
    const active = new Set(years.map((year) => year.year));
    render(<AdvancedSeasonality years={years} active={active} />);
    settle();
    const count = random.mock.calls.length;
    render(<AdvancedSeasonality years={years} active={active} zh />);
    const sort = container.querySelector<HTMLTableCellElement>(".fin-adv-table th.sortable");
    act(() => sort!.click());
    settle();
    expect(random.mock.calls.length).toBe(count);
    expect(verdicts()).toEqual(["显著", "显著"]);
    expect(sort?.classList.contains("on")).toBe(true);
  });

  it("cancels obsolete queued data before it can replace the latest dataset", () => {
    const compute = vi.spyOn(seasonal, "overfitGuard");
    const oldYears = seasonal.buildYears(barsFor("notable"));
    const newYears = seasonal.buildYears(barsFor("noise"));
    const active = new Set(oldYears.map((year) => year.year));
    render(<AdvancedSeasonality years={oldYears} active={active} />);
    render(<AdvancedSeasonality years={newYears} active={active} />);
    expect(verdicts()).toEqual([]);
    settle();
    expect(verdicts()).toEqual(["likely noise", "likely noise"]);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute.mock.calls[0][0]).toBe(newYears);
  });

  it("withdraws an old result while recomputing a changed selection and keeps thin samples ungraded", () => {
    const years = seasonal.buildYears(barsFor("notable"));
    render(<AdvancedSeasonality years={years} active={new Set(years.map((year) => year.year))} />);
    settle();
    expect(verdicts()).toEqual(["notable", "notable"]);
    render(<AdvancedSeasonality years={years} active={new Set(years.slice(0, 2).map((year) => year.year))} />);
    expect(verdicts()).toEqual([]);
    settle();
    expect(verdicts()).toEqual([]);
    expect(container.textContent).toContain("N=2");
  });

  it("preserves the actual year and lookback controls across empty-selection recovery", () => {
    render(<SeasonalsPage sym="AAA" bars={barsFor("notable")} />);
    settle();
    click("None");
    expect(container.textContent).toContain("Select at least one year");
    expect(verdicts()).toEqual([]);
    settle();
    click("All");
    expect(verdicts()).toEqual([]);
    settle();
    expect(verdicts()).toEqual(["notable", "notable"]);
    click("5Y");
    expect(container.querySelector('[aria-label="Lookback window"] button[aria-pressed="true"]')?.textContent).toBe("5Y");
    expect(verdicts()).toEqual([]);
    settle();
    expect(verdicts()).toEqual(["notable", "notable"]);
    click("Table");
    expect(container.querySelector(".fin-seas-grid")).not.toBeNull();
    expect(container.textContent).toContain("Median");
  });

  it("keeps missing-history input empty and accepts later data without a reload", () => {
    render(<SeasonalsPage sym="AAA" bars={[]} />);
    expect(container.textContent).toContain("No daily price history");
    expect(verdicts()).toEqual([]);
    render(<SeasonalsPage sym="AAA" bars={barsFor("notable")} />);
    expect(verdicts()).toEqual([]);
    settle();
    expect(verdicts()).toEqual(["notable", "notable"]);
    render(<SeasonalsPage sym="AAA" bars={[]} />);
    settle();
    expect(verdicts()).toEqual([]);
    expect(container.textContent).toContain("No daily price history");
  });

  it("cleans up a deferred computation on unmount", () => {
    const years = seasonal.buildYears(barsFor("notable"));
    render(<AdvancedSeasonality years={years} active={new Set(years.map((year) => year.year))} />);
    const count = random.mock.calls.length;
    render(null);
    settle();
    expect(random.mock.calls.length).toBe(count);
    expect(container.textContent).toBe("");
  });
});
