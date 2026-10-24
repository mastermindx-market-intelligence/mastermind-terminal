// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ExposureOriginStrip from "@/components/exposure-map/ExposureOriginStrip";
import type { ExposureOriginRoster } from "@/components/exposure-map/useExposureOriginRoster";
import type { ExposureOrigin } from "@/lib/exposureOrigin";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const origin: ExposureOrigin = {
  v: 1, kind: "sector", returnHref: "/discover?tab=sectors&sector=technology&group=semiconductors&sectorSort=return&sectorCompany=MSFT",
  sector: "technology", group: "semiconductors", company: "MSFT", index: 1, count: 3, sort: "return", query: "",
  asOf: "2026-10-20", contentHash: "hash12345678", method: "incumbent_rs_63_21/v1", benchmark: "SPX",
};
const rosterExact = (): ExposureOriginRoster => ({
  state: "exact", tickers: ["AAPL", "MSFT", "NVDA"], asOf: "2026-10-20", contentHash: "hash12345678", groupLabel: "Semiconductors",
});
const rosterLoading = (): ExposureOriginRoster => ({ state: "loading", tickers: null, asOf: null, contentHash: null, groupLabel: null });
const rosterChanged = (): ExposureOriginRoster => ({
  state: "changed", tickers: ["AAPL", "META", "NVDA"], asOf: "2026-10-21", contentHash: "other1234567", groupLabel: "Semiconductors",
});
const rosterUnavailable = (): ExposureOriginRoster => ({ state: "unavailable", tickers: null, asOf: null, contentHash: null, groupLabel: null });

let container: HTMLDivElement;
let root: Root;
let stepped: { company: string; index: number }[];

function render(lang: "en" | "zh", roster: ExposureOriginRoster) {
  act(() => {
    root.render(<ExposureOriginStrip origin={origin} lang={lang} roster={roster}
      onStep={next => { stepped.push(next); }} />);
  });
}
const button = (testid: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!;
const click = (testid: string) => {
  act(() => { button(testid).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  stepped = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("ExposureOriginStrip", () => {
  it("renders the back link to returnHref with English and Chinese labels", () => {
    render("en", rosterExact());
    let back = document.querySelector<HTMLAnchorElement>('[data-testid="exposure-origin-back"]')!;
    expect(back.getAttribute("href")).toBe(origin.returnHref);
    expect(back.textContent).toBe("← Back to Sector Central");
    render("zh", rosterExact());
    back = document.querySelector<HTMLAnchorElement>('[data-testid="exposure-origin-back"]')!;
    expect(back.getAttribute("href")).toBe(origin.returnHref);
    expect(back.textContent).toBe("← 返回板块中心");
  });

  it("disables stepping while the roster is loading, changed or unavailable", () => {
    for (const roster of [rosterLoading(), rosterChanged(), rosterUnavailable()]) {
      render("en", roster);
      expect(button("exposure-origin-prev").hasAttribute("disabled")).toBe(true);
      expect(button("exposure-origin-next").hasAttribute("disabled")).toBe(true);
    }
    render("en", rosterExact());
    expect(button("exposure-origin-prev").hasAttribute("disabled")).toBe(false);
    expect(button("exposure-origin-next").hasAttribute("disabled")).toBe(false);
  });

  it("steps to the previous and next company when the roster is exact and calls onStep with the ticker and index", () => {
    render("en", rosterExact());
    expect(button("exposure-origin-prev").textContent).toBe("‹ AAPL");
    expect(button("exposure-origin-next").textContent).toBe("NVDA ›");
    click("exposure-origin-prev");
    click("exposure-origin-next");
    expect(stepped).toEqual([{ company: "AAPL", index: 0 }, { company: "NVDA", index: 2 }]);
  });

  it("shows the position, date and method line from the origin", () => {
    render("en", rosterExact());
    let strip = document.querySelector('[data-testid="exposure-origin-strip"]')!.textContent!;
    expect(strip).toContain("2 of 3");
    expect(strip).toContain("as of 2026-10-20");
    expect(strip).toContain("Relative strength, 63-day and 21-day · relative to SPX");
    render("zh", rosterExact());
    strip = document.querySelector('[data-testid="exposure-origin-strip"]')!.textContent!;
    expect(strip).toContain("第 2/3 家");
    expect(strip).toContain("截至 2026-10-20");
  });

  it("exposes data-state and an aria-labelled navigation landmark", () => {
    render("en", rosterExact());
    const nav = document.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe("Sector origin");
    expect(nav.getAttribute("data-testid")).toBe("exposure-origin-strip");
    expect(nav.getAttribute("data-state")).toBe("exact");
    render("en", rosterLoading());
    expect(nav.getAttribute("data-state")).toBe("loading");
    expect(document.querySelector("[role=status]")!.textContent).toBe("Checking the sector roster…");
    render("zh", rosterUnavailable());
    expect(document.querySelector("[role=status]")!.textContent).toBe("暂时无法核对板块名单，仍可返回。");
  });
});
