// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VolSkewPanel } from "@/components/vol/VolSkewPanel";
import type { VolSmileExp, VolSmilePoint } from "@/components/vol/volTypes";

vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
let host: HTMLDivElement, root: Root;
const point = (strike: number, call_iv: number | null, put_iv: number | null): VolSmilePoint => ({ strike, call_iv, put_iv });
const smile = (points: VolSmilePoint[], exp = "2026-11-20"): VolSmileExp[] => [{ exp, points }];
const both = [point(90, 22, 23), point(100, 20, 20), point(110, 21, 22)];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
function button(label: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(label: string) { await act(async () => button(label).click()); }
function cells(strike: number) {
  const row = [...host.querySelectorAll("tbody tr")].find(el => el.querySelector("th")?.textContent === String(strike));
  if (!row) throw new Error(`Missing strike: ${strike}`);
  return [...row.querySelectorAll("td")];
}
function strikes() { return [...host.querySelectorAll("tbody th")].map(el => el.textContent); }

describe("Smile exact IV investigation", () => {
  it("preserves numeric precision and percentage units, and separates genuine zero from unavailable inputs", async () => {
    const points = [point(95, 0, null), point(100.00000001, 17.1234567890123, 1e-9), point(105, 20, 20),
      point(110, null, -1), point(115, "12" as unknown as number, true as unknown as number), point(120, NaN, Infinity)];
    await render(<VolSkewPanel smile={smile(points)} lang="en" />); await click("Exact IV");
    expect(cells(95).map(el => el.textContent)).toEqual(["0", "Unavailable"]);
    expect(cells(100.00000001).map(el => el.textContent)).toEqual(["17.1234567890123", "1e-9"]);
    for (const strike of [110, 115, 120]) expect(cells(strike).map(el => el.dataset.state)).toEqual(["unavailable", "unavailable"]);
    expect(host.querySelector("caption")?.textContent).toBe("2026-11-20 · reported IV by strike");
    expect(host.querySelectorAll('thead th[scope="col"]')).toHaveLength(3);
    expect(host.querySelectorAll('tbody th[scope="row"]')).toHaveLength(6);
    expect(host.textContent).toContain("Call IV (%)");
    expect(host.textContent).toContain("Quote inputs and IV method are not supplied");
    expect(host.innerHTML).not.toMatch(/(?:NaN|Infinity)/);
  });

  it("shares the exact chart range and makes full supplied range reversible in either view", async () => {
    const points = [point(50, 40, 45), ...both, point(150, 30, 35)];
    await render(<VolSkewPanel smile={smile(points)} lang="en" />);
    expect(host.querySelectorAll('[data-vol-leg="call"]')).toHaveLength(3);
    await click("Exact IV"); expect(strikes()).toEqual(["90", "100", "110"]);
    expect(host.querySelector('[data-testid="smile-range-status"]')?.textContent).toContain("3 / 5");
    await click("Full supplied range"); expect(strikes()).toEqual(["50", "90", "100", "110", "150"]);
    await click("Chart"); expect(host.querySelectorAll('[data-vol-leg="call"]')).toHaveLength(5);
    await click("Full supplied range"); expect(host.querySelectorAll('[data-vol-leg="call"]')).toHaveLength(3);
    await click("Exact IV"); expect(strikes()).toEqual(["90", "100", "110"]);
  });

  it("withholds both legs at duplicate strike coordinates instead of choosing a source winner", async () => {
    await render(<VolSkewPanel smile={smile([point(90, 22, 23), point(100, 20, 20), point(100, 88, 89), point(110, 21, 22)])} lang="en" />);
    await click("Full supplied range"); await click("Exact IV");
    expect(strikes()).toEqual(["90", "100", "110"]);
    expect(cells(100).map(el => el.textContent)).toEqual(["Conflicting records", "Conflicting records"]);
    expect(cells(100).map(el => el.dataset.state)).toEqual(["conflict", "conflict"]);
    expect(host.textContent).not.toMatch(/\b88\b|\b89\b/);
    expect(host.textContent).toContain("1 conflicting strike unavailable");
  });

  it("exposes valid coordinates even when every leg is unavailable and no chart can be drawn", async () => {
    await render(<VolSkewPanel smile={smile([point(90, null, null), point(100, null, null)])} lang="en" />);
    expect(host.querySelector("svg")).toBeNull();
    await click("Exact IV"); expect(strikes()).toEqual(["90", "100"]);
    expect([...host.querySelectorAll("td")].map(el => el.textContent)).toEqual(Array(4).fill("Unavailable"));
  });

  it("retains the parent's missing expiry and resumes the same table only after an explicit available selection", async () => {
    const onSelectExp = vi.fn();
    await render(<VolSkewPanel smile={smile(both)} lang="en" selectedExp="2026-11-20" onSelectExp={onSelectExp} />);
    await click("Exact IV");
    await render(<VolSkewPanel smile={smile(both)} lang="en" selectedExp="2026-11-13" onSelectExp={onSelectExp} />);
    expect(host.querySelector("table")).toBeNull(); expect(host.querySelector("svg")).toBeNull();
    expect(host.textContent).toContain("2026-11-13 has no supplied per-strike IV series");
    await click("2026-11-20"); expect(onSelectExp).toHaveBeenCalledTimes(1); expect(onSelectExp).toHaveBeenCalledWith("2026-11-20");
    expect(host.querySelector("table")).toBeNull();
    await render(<VolSkewPanel smile={smile(both)} lang="en" selectedExp="2026-11-20" onSelectExp={onSelectExp} />);
    expect(strikes()).toEqual(["90", "100", "110"]);
  });

  it("does not leave a stale table behind when the supplied expiry conflicts or the source disappears", async () => {
    const rows = smile(both);
    await render(<VolSkewPanel smile={rows} lang="en" selectedExp="2026-11-20" />); await click("Exact IV");
    await render(<VolSkewPanel smile={[...rows, ...rows]} lang="en" selectedExp="2026-11-20" />);
    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector('[data-testid="smile-conflict-status"]')?.textContent).toContain("2026-11-20");
    await render(<VolSkewPanel smile={undefined} lang="en" selectedExp="2026-11-20" />);
    expect(host.querySelector("table")).toBeNull(); expect(host.textContent).not.toContain("22");
  });

  it("preserves standalone expiry selection without adding a second owner for the controlled path", async () => {
    const rows = [...smile(both), ...smile([point(200, 31, 32)], "2026-12-18")];
    await render(<VolSkewPanel smile={rows} lang="en" />); await click("Exact IV"); await click("2026-12-18");
    expect(strikes()).toEqual(["200"]); expect(cells(200).map(el => el.textContent)).toEqual(["31", "32"]);
    expect(button("2026-12-18").getAttribute("aria-pressed")).toBe("true");
  });

  it("distinguishes legs by geometry, retains missing-side gaps, and describes the exact-value route", async () => {
    await render(<VolSkewPanel smile={smile([...both, point(115, null, 23), point(120, 24, 25)])} lang="en" />);
    expect(host.querySelectorAll('circle[data-vol-leg="call"]')).toHaveLength(4);
    expect(host.querySelectorAll('polygon[data-vol-leg="put"]')).toHaveLength(5);
    const callPaths = [...host.querySelectorAll('path[stroke="var(--brand-2)"]')];
    const putPaths = [...host.querySelectorAll('path[stroke="var(--ai)"]')];
    expect(callPaths).toHaveLength(2); expect(putPaths).toHaveLength(1);
    expect(callPaths.every(el => !el.hasAttribute("stroke-dasharray"))).toBe(true);
    expect(putPaths[0].getAttribute("stroke-dasharray")).toBe("5 4");
    expect(host.querySelector("desc")?.textContent).toContain("Choose Exact IV");
  });

  it.each(["en", "zh"] as const)("provides semantic table headers and unavailable/conflict copy in %s", async lang => {
    await render(<VolSkewPanel smile={smile([point(100, 0, null)])} lang={lang} />);
    await click(lang === "en" ? "Exact IV" : "精确 IV");
    expect(cells(100).map(el => el.textContent)).toEqual(["0", lang === "en" ? "Unavailable" : "不可用"]);
    expect(host.querySelector("thead")?.textContent).toContain(lang === "en" ? "Call IV (%)" : "认购 IV（%）");
    if (lang === "en") expect(host.textContent).not.toMatch(/[\u3400-\u9fff]/);
    else expect(host.textContent).not.toMatch(/Unavailable|Conflicting records|Exact IV|Quote inputs/);
  });
});
