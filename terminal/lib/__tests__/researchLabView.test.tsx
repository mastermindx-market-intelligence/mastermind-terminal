// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OptionsResearchLab } from "@/components/researchlab/OptionsResearchLab";
vi.mock("next/dynamic", () => ({ default: () => () => <span>3D renderer</span> }));
const matrix = { schema: "options_structure.matrix/v1", root: "SPY", asof: "2026-10-06T02:00:00Z", _build_meta: { asof_date: "2026-10-05" }, cells: [{ strike: 785, expiry: "2026-10-09", gex: -100, call_vol: 243000, call_oi: 110000, put_vol: 0, put_oi: null }] };
let node: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); node = document.createElement("div"); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const mount = async (instrument = "SPY", data: unknown = matrix) => act(async () => root.render(<OptionsResearchLab root={instrument} matrix={data} lang="en" onClose={() => {}} />));
async function click(text: string) { const button = [...node.querySelectorAll("button")].find(b => b.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()); }
it("shows exact zeros and unknowns, keeps pin when changing lenses, then clears wrong-root detail", async () => {
  await mount();
  await click("785 Call · 2026-10-09");
  expect(node.querySelector('[data-testid="research-inspector"]')?.textContent).toContain("243,000");
  await click("Flow & packages");
  expect(node.querySelector('[data-testid="research-inspector"]')?.textContent).toContain("243,000");
  expect(node.textContent).toContain("Package identity and dated quotes are not in this snapshot");
  await mount("QQQ");
  expect(node.querySelector('[data-testid="research-inspector"]')?.textContent).not.toContain("243,000");
});
it("withdraws cached values when the parent removes the admitted source", async () => {
  await mount(); await click("785 Call · 2026-10-09"); await mount("SPY", null);
  expect(node.textContent).not.toContain("243,000");
  expect(node.textContent).toContain("Matrix unavailable");
});
it("keeps save unavailable without inventing an options persistence owner", async () => {
  await mount();
  expect([...node.querySelectorAll("button")].find(b => b.textContent === "Save investigation")?.disabled).toBe(true);
  expect(node.textContent).toContain("Options evidence is not yet admitted by Saved Research");
});
it("preserves comparison insertion order through removal, re-addition and source withdrawal", async () => {
  const data = { ...matrix, cells: [785, 786, 787].map(strike => ({ ...matrix.cells[0], strike })) };
  await mount("SPY", data);
  const comparisonLabels = () => [...node.querySelectorAll('[data-testid="research-inspector"] li button')].map(b => b.textContent);
  for (const strike of [787, 785, 786]) {
    await click(`${strike} Call · 2026-10-09`); await click("Compare selection");
  }
  expect(comparisonLabels()).toEqual([787, 785, 786].map(s => `${s} Call · 2026-10-09`));
  await click("785 Call · 2026-10-09"); await click("Remove comparison"); await click("Compare selection");
  expect(comparisonLabels()).toEqual([787, 786, 785].map(s => `${s} Call · 2026-10-09`));
  await mount("SPY", { ...data, cells: data.cells.filter(c => c.strike !== 786) });
  expect(comparisonLabels()).toEqual([787, 785].map(s => `${s} Call · 2026-10-09`));
});
it("returns focus to the comparison button after dismissing its selected coordinate", async () => {
  await mount(); await click("785 Call · 2026-10-09"); await click("Compare selection");
  await click("785 Put · 2026-10-09");
  const comparison = node.querySelector<HTMLButtonElement>('[data-testid="research-inspector"] li button')!;
  await act(async () => comparison.click());
  await click("Dismiss selection");
  expect(document.activeElement).toBe(comparison);
});
it("joins IV only on the same known source session and withdraws it on mismatch", async () => {
  const volatility = { schema: "options_hub.vol/v1", root: "SPY", asof: "2026-10-05", smile: [
    { exp: "2026-10-09", points: [{ strike: 785, call_iv: 58.2, put_iv: 0 }] },
  ] };
  const render = (data: unknown) => act(async () => root.render(<OptionsResearchLab root="SPY" matrix={matrix} volatility={data} lang="en" onClose={() => {}} />));
  await render(volatility); await click("785 Call · 2026-10-09");
  expect(node.querySelector('[data-testid="research-inspector"]')?.textContent).toContain("58.2%");
  await click("Volatility terrain");
  expect(node.textContent).toContain("Published IV observations");
  await render({ ...volatility, asof: "2026-10-02" });
  expect(node.querySelector('[data-testid="research-inspector"]')?.textContent).not.toContain("58.2%");
  const volSection = node.querySelector('section[aria-label="Published IV observations"]');
  expect(volSection?.textContent).toContain("58.2%");
  expect(volSection?.querySelector("tbody button")?.hasAttribute("disabled")).toBe(true);
  await render({ ...volatility, root: "QQQ" });
  expect(volSection?.textContent).not.toContain("58.2%");
});
it("joins top-level matrix sessions and immediately withdraws conflicting source selections", async () => {
  const volatility = { schema: "options_hub.vol/v1", root: "SPY", asof: "2026-10-05", smile: [
    { exp: "2026-10-09", points: [{ strike: 785, call_iv: 58.2, put_iv: 0 }] },
  ] };
  const render = (data: unknown) => act(async () => root.render(<OptionsResearchLab root="SPY" matrix={data} volatility={volatility} lang="en" onClose={() => {}} />));
  await render({ ...matrix, session: "2026-10-05", _build_meta: null });
  await click("785 Call · 2026-10-09"); await click("Compare selection");
  const inspector = () => node.querySelector('[data-testid="research-inspector"]');
  expect(inspector()?.textContent).toContain("58.2%");
  await click("Volatility terrain");
  await render({ ...matrix, session: "2026-10-04" });
  expect(node.textContent).toContain("Matrix unavailable");
  expect(inspector()?.textContent).not.toContain("58.2%");
  expect(inspector()?.textContent).not.toContain("243,000");
  expect(inspector()?.querySelectorAll("li")).toHaveLength(0);
  const observations = node.querySelector('section[aria-label="Published IV observations"]');
  expect(observations?.textContent).toContain("58.2%");
  expect(observations?.querySelector("tbody button")?.hasAttribute("disabled")).toBe(true);
});
