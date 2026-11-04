// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VolTermPanel } from "@/components/vol/VolTermPanel";
import type { VolTermRow } from "@/components/vol/volTypes";

let host: HTMLDivElement, root: Root;
const exp = "2027-05-01";
const term = (): VolTermRow[] => [
  { exp: "2026-11-09", dte: 7, atm_iv: 17 },
  { exp: "2026-12-02", dte: 30, atm_iv: 18 },
  { exp: "2027-01-31", dte: 90, atm_iv: 20 },
  { exp, dte: 180, atm_iv: 25.1234567890123 },
];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
function button(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`); return found;
}
async function open() { await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click()); }
function selected() { return host.querySelector('[data-testid="term-exact-selected"]')!; }
function row(expiry: string) { return [...host.querySelectorAll("tbody tr")].find(el => el.querySelector("th")?.textContent === expiry); }

describe("Exact term-expiry investigation", () => {
  it.each(["2027-01-31", exp])("locates a selected connected long expiry %s without relying on gap isolation", async expiry => {
    await render(<VolTermPanel term={term()} lang="en" selectedExp={expiry} />);
    const marker = host.querySelector(`[data-selected-expiry="${expiry}"]`)!;
    const guide = host.querySelector('[data-testid="term-selected-guide"]')!;
    expect(marker).not.toBeNull(); expect(marker.getAttribute("r")).toBe("5");
    expect(guide.getAttribute("data-expiry")).toBe(expiry);
    expect(guide.getAttribute("x1")).toBe(marker.getAttribute("cx"));
    expect(host.querySelectorAll('path[stroke="var(--brand-2)"]')).toHaveLength(1);
    expect(host.querySelector('path[stroke="var(--brand-2)"]')?.getAttribute("d")?.match(/L/g)).toHaveLength(3);
    expect(selected().textContent).toContain(expiry);
  });

  it("preserves exact supplied days and IV precision in the selected read and table", async () => {
    await render(<VolTermPanel term={term()} lang="en" selectedExp={exp} />);
    expect(selected().textContent).toContain("180"); expect(selected().textContent).toContain("25.1234567890123%");
    await open(); expect([...row(exp)!.querySelectorAll("td")].map(el => el.textContent)).toEqual(["180", "25.1234567890123"]);
    expect(host.querySelectorAll('thead th[scope="col"]')).toHaveLength(3);
    expect(host.querySelectorAll('tbody th[scope="row"]')).toHaveLength(4);
    expect(host.querySelector("caption")?.textContent).toBe("Supplied expiry observations");
  });

  it("distinguishes a selected real zero from unavailable IV without moving either coordinate", async () => {
    const rows = term(); rows[3].atm_iv = 0;
    await render(<VolTermPanel term={rows} lang="en" selectedExp={exp} />);
    expect(selected().textContent).toContain("0%"); expect(host.querySelector('[data-selected-expiry]')).not.toBeNull();
    const x = host.querySelector('[data-testid="term-selected-guide"]')?.getAttribute("x1");
    const missing = rows.map(point => ({ ...point, atm_iv: point.exp === exp ? null : point.atm_iv }));
    await render(<VolTermPanel term={missing} lang="en" selectedExp={exp} />);
    expect(selected().textContent).toContain("Unavailable"); expect(selected().textContent).toContain("180");
    expect(host.querySelector('[data-selected-expiry]')).toBeNull();
    expect(host.querySelector('[data-testid="term-selected-guide"]')?.getAttribute("x1")).toBe(x);
    await open(); expect(row(exp)?.querySelector('td[data-state="unavailable"]')?.textContent).toBe("Unavailable");
  });

  it("keeps a same-DTE conflict as a known gap, withholding the selected value", async () => {
    const rows = term(); rows.push({ exp, dte: 180, atm_iv: 99 });
    await render(<VolTermPanel term={rows} lang="en" selectedExp={exp} />);
    expect(selected().textContent).toContain("180"); expect(selected().textContent).toContain("Conflicting records");
    expect(host.querySelector('[data-testid="term-selected-guide"]')).not.toBeNull();
    expect(host.querySelector('[data-selected-expiry]')).toBeNull();
    await open(); expect(row(exp)?.querySelector('td[data-state="conflict"]')?.textContent).toBe("Conflicting records");
    expect(host.querySelector("table")?.textContent).not.toContain("99");
  });

  it("does not invent a day coordinate or substitute another expiry when duplicate DTEs disagree", async () => {
    const rows = term(); rows.push({ exp, dte: 181, atm_iv: 99 });
    await render(<VolTermPanel term={rows} lang="en" selectedExp={exp} onSelectExp={() => undefined} />);
    expect(selected().textContent).toContain(exp); expect(selected().textContent).toContain("Unavailable");
    expect(selected().textContent).toContain("Conflicting records");
    expect(selected().textContent).not.toMatch(/\b180\b|\b181\b/);
    expect(host.querySelector('[data-testid="term-selected-guide"]')).toBeNull();
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe(exp);
    await open(); expect(row(exp)).toBeUndefined(); expect(host.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("routes exact table selection through the existing parent callback and waits for its selected identity", async () => {
    const onSelectExp = vi.fn();
    await render(<VolTermPanel term={term()} lang="en" selectedExp="2026-11-09" onSelectExp={onSelectExp} />);
    await open(); await act(async () => button(exp).click());
    expect(onSelectExp).toHaveBeenCalledTimes(1); expect(onSelectExp).toHaveBeenCalledWith(exp);
    expect(selected().textContent).toContain("2026-11-09"); expect(button(exp).getAttribute("aria-pressed")).toBe("false");
    await render(<VolTermPanel term={term()} lang="en" selectedExp={exp} onSelectExp={onSelectExp} />);
    expect(button(exp).getAttribute("aria-pressed")).toBe("true"); expect(selected().textContent).toContain("25.1234567890123%");
  });

  it("clears the source values while retaining an explicit unavailable expiry when input disappears", async () => {
    await render(<VolTermPanel term={term()} lang="en" selectedExp={exp} onSelectExp={() => undefined} />); await open();
    await render(<VolTermPanel term={undefined} lang="en" selectedExp={exp} onSelectExp={() => undefined} />);
    expect(host.querySelector("table")).toBeNull(); expect(host.querySelector("svg")).toBeNull();
    expect(selected().textContent).toContain(exp); expect(selected().textContent).not.toContain("25.1234567890123");
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe(exp);
  });

  it("offers exact unavailable rows even when the chart cannot meet its finite-observation gate", async () => {
    await render(<VolTermPanel term={term().map(point => ({ ...point, atm_iv: null }))} lang="en" selectedExp={exp} />);
    expect(host.querySelector("svg")).toBeNull(); await open();
    expect(host.querySelectorAll('td[data-state="unavailable"]')).toHaveLength(4);
    expect(host.querySelector("table")?.textContent).not.toMatch(/NaN|Infinity/);
  });

  it.each(["en", "zh"] as const)("keeps exact read-only values and source labels localized in %s", async lang => {
    await render(<VolTermPanel term={[{ exp, dte: 0, atm_iv: 1e-9 }]} lang={lang} selectedExp={exp} />); await open();
    expect(selected().textContent).toContain("1e-9%"); expect(row(exp)?.querySelector("button")).toBeNull();
    expect(row(exp)?.textContent).toContain("1e-9");
    if (lang === "en") expect(host.textContent).not.toMatch(/[\u3400-\u9fff]/);
    else expect(host.textContent).not.toMatch(/Exact expiry values|Unavailable|Reported ATM IV/);
  });
});
