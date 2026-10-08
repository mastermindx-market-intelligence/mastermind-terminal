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
