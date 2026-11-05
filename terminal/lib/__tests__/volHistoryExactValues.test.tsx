// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VolHistoryPanel } from "@/components/vol/VolHistoryPanel";
import type { VolHistoryRow } from "@/components/vol/volTypes";

let host: HTMLDivElement, root: Root;
const point = (date: string, atm_iv: number | null): VolHistoryRow => ({ date, atm_iv, close: null, iv_rank: null });
const history = () => Array.from({ length: 12 }, (_, i) => point(`2026-10-${String(i + 1).padStart(2, "0")}`, 15 + i / 10));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function render(rows: VolHistoryRow[] | undefined, lang: "en" | "zh" = "en", hi: number | null = null, lo: number | null = null) {
  await act(async () => root.render(<VolHistoryPanel history={rows} lang={lang} iv52wHi={hi} iv52wLo={lo} />));
}
async function view(mode: "chart" | "table", lang: "en" | "zh" = "en") {
  const label = mode === "chart" ? (lang === "en" ? "Chart" : "图表") : (lang === "en" ? "Exact history values" : "精确历史数值");
  const group = host.querySelector('[data-testid="history-view-controls"]');
  const button = [...(group?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(el => el.textContent === label);
  if (!button) throw new Error(`Missing persistent view button: ${label}`);
  await act(async () => button.click());
  return button;
}
function row(date: string) {
  return [...host.querySelectorAll("tbody tr")].find(el => el.querySelector("th")?.textContent === date);
}
function dates() { return [...host.querySelectorAll("tbody th")].map(el => el.textContent); }
function paths() { return [...host.querySelectorAll('path[stroke="var(--brand-2)"]')].map(el => el.getAttribute("d")); }
function references() { return [...host.querySelectorAll('line[stroke-dasharray="4 3"]')].map(el => el.getAttribute("y1")); }

describe("Exact IV history investigation", () => {
  it("makes sparse source values inspectable without changing the ten-observation chart threshold", async () => {
    const rows = history().slice(0, 9);
    await render(rows);
    expect(host.querySelector("svg")).toBeNull();
    expect(host.textContent).toContain("The history line needs at least 10 sessions");
    const exact = await view("table");
    expect(exact.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(9);
    expect(host.querySelector('[data-testid="history-values-status"]')?.textContent).toBe("9 IV observations · 9 supplied dates");
    await view("chart");
    expect(host.querySelector("table")).toBeNull(); expect(host.querySelector("svg")).toBeNull();
    await render(history().slice(0, 10));
    expect(host.querySelector("svg")).not.toBeNull();
    expect(host.querySelector("svg")?.getAttribute("height")).toBe("250");
  });

  it("preserves full dates and unrounded percentage numbers including zero and tiny nonzero IV", async () => {
    await render([point("2026-01-02", 0), point("2026-01-05", 17.1234567890123), point("2026-01-06", 1e-9), point("2026-01-07", null)]);
    await view("table");
    expect(dates()).toEqual(["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"]);
    expect([...host.querySelectorAll("tbody td")].map(el => el.textContent)).toEqual(["0", "17.1234567890123", "1e-9", "Unavailable"]);
    expect(host.querySelector("thead")?.textContent).toContain("ATM IV (%)");
    expect(host.querySelector("caption")?.textContent).toBe("Reported ATM IV by observation date");
    expect(host.querySelectorAll('thead th[scope="col"]')).toHaveLength(2);
    expect(host.querySelectorAll('tbody th[scope="row"]')).toHaveLength(4);
    expect(host.querySelector("table")?.querySelector("button,a,input,select,[tabindex]")).toBeNull();
  });

  it("withholds duplicate dates in both views and preserves the chart's original gap geometry", async () => {
    const rows = [...history(), point("2026-10-05", 99)];
    await render(rows);
    const before = paths();
    expect(before).toHaveLength(2);
    expect(host.querySelector('[data-testid="history-conflict-status"]')?.textContent).toContain("1 conflicting date unavailable");
    await view("table");
    expect(dates()).toHaveLength(12);
    expect(row("2026-10-05")?.querySelector("td")?.textContent).toBe("Conflicting records");
    expect(row("2026-10-05")?.querySelector("td")?.getAttribute("data-state")).toBe("conflict");
    expect(host.querySelector("table")?.textContent).not.toContain("99");
    expect(host.querySelector('[data-testid="history-values-status"]')?.textContent).toBe("11 IV observations · 12 supplied dates");
    await view("chart"); expect(paths()).toEqual(before);
  });

  it("does not coerce invalid observations to numbers or erase their valid date coordinates", async () => {
    const values = [null, -1, Number.NaN, Infinity, "12", false] as unknown as (number | null)[];
    await render(values.map((v, i) => point(`2026-10-${String(i + 1).padStart(2, "0")}`, v)));
    await view("table");
    expect(host.querySelectorAll('td[data-state="unavailable"]')).toHaveLength(6);
    expect(host.querySelector('[data-testid="history-values-status"]')?.textContent).toBe("0 IV observations · 6 supplied dates");
    expect(host.querySelector("table")?.textContent).not.toMatch(/NaN|Infinity|false/);
  });

  it("uses the original date admission and chronological order instead of inventing rejected coordinates", async () => {
    await render([
      point("2026-01-02", 20), point("2026-02-30", 88), point("2025-12-31", 19),
      point("2026-13-01", 77), point("2026-01-02T00:00:00Z", 66),
    ]);
    await view("table");
    expect(dates()).toEqual(["2025-12-31", "2026-01-02"]);
    expect([...host.querySelectorAll("tbody td")].map(el => el.textContent)).toEqual(["19", "20"]);
    expect(host.querySelector('[data-testid="history-values-status"]')?.textContent).toBe("2 IV observations · 2 supplied dates");
  });

  it("provides every valid date when all reported IV observations are unavailable", async () => {
    await render([point("2026-10-01", null), point("2026-10-02", null)]);
    expect(host.querySelector("svg")).toBeNull(); await view("table");
    expect(dates()).toEqual(["2026-10-01", "2026-10-02"]);
    expect(host.querySelectorAll('td[data-state="unavailable"]')).toHaveLength(2);
    expect(host.querySelector("table")).not.toBeNull();
  });

  it("removes stale values when source history disappears and retains only the view preference on recovery", async () => {
    await render([point("2026-10-01", 17.1234567890123)]); await view("table");
    await render(undefined);
    expect(host.querySelector("table")).toBeNull(); expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector('[data-testid="history-view-controls"]')).toBeNull();
    expect(host.textContent).not.toMatch(/2026-10-01|17\.1234567890123/);
    await render([point("2026-11-02", 21)]);
    expect(dates()).toEqual(["2026-11-02"]);
    expect(host.querySelector("table")?.textContent).not.toMatch(/2026-10-01|17\.1234567890123/);
  });

  it("retains the existing curve and in-domain-only 52-week references across view changes", async () => {
    await render(history(), "en", 16, 15);
    const before = paths(), referenceBefore = references();
    expect(referenceBefore).toHaveLength(2);
    await view("table"); await view("chart");
    expect(paths()).toEqual(before); expect(references()).toEqual(referenceBefore);
    await render(history(), "en", 99, 1);
    expect(references()).toHaveLength(0); expect(paths()).toEqual(before);
  });

  it("describes chart gaps and offers the exact route without adding history rank, close or replay state", async () => {
    await render(history());
    expect(host.querySelector("desc")?.textContent).toContain("Choose Exact history values");
    await view("table");
    expect(host.querySelector("details")?.textContent).toContain("Its availability timestamp is not supplied here");
    expect(host.querySelectorAll("thead th")).toHaveLength(2);
    expect(host.querySelector("thead")?.textContent).not.toMatch(/Rank|Close/);
    expect(host.querySelector("table")?.querySelector("[aria-selected],[aria-pressed],input,button")).toBeNull();
  });

  it.each(["en", "zh"] as const)("keeps the exact table and unavailable/conflict explanation localized in %s", async lang => {
    await render([point("2026-10-01", 0), point("2026-10-02", null), point("2026-10-03", 20), point("2026-10-03", 21)], lang);
    await view("table", lang);
    expect([...host.querySelectorAll("tbody td")].map(el => el.textContent)).toEqual(lang === "en"
      ? ["0", "Unavailable", "Conflicting records"] : ["0", "不可用", "记录冲突"]);
    if (lang === "en") expect(host.textContent).not.toMatch(/[\u3400-\u9fff]/);
    else expect(host.textContent).not.toMatch(/Observation date|Unavailable|Conflicting records|Exact history values|availability timestamp/);
  });
});
