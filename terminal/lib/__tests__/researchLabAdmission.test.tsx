// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdmittedOptionsResearchLab } from "@/components/researchlab/AdmittedOptionsResearchLab";
import type { EntitlementSnapshot } from "@/lib/entitlementStore";
const preferences = vi.hoisted(() => ({ owner: "account:one", metaPrefs: {} as { theme?: "light" | "dark"; themeAuto?: "1" | "0" } }));
vi.mock("@/lib/useMarketPrefs", () => ({ useAccountPrefs: vi.fn(() => preferences) }));
const authority = vi.hoisted(() => ({ current: null as EntitlementSnapshot | null }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "account", userId: "one", email: "fixture@example.test" }) }));
vi.mock("@/lib/entitlementStore", () => ({ useEntitlementSnapshot: () => authority.current }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const matrix = { schema: "options_structure.matrix/v1", root: "SPY", cells: [{ strike: 785, expiry: "2026-10-09", call_vol: 243000 }] };
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  preferences.owner = "account:one"; preferences.metaPrefs = {};
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.removeAttribute("data-research-appearance");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  authority.current = { owner: "account:one", state: "VERIFIED_PAID", plan: { tier: "pro", features: ["terminal_live_options"] }, verifiedAt: 1 };
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); document.documentElement.removeAttribute("data-research-appearance"); });
const render = () => act(async () => root.render(<AdmittedOptionsResearchLab root="SPY" matrix={matrix} lang="en" onClose={() => {}} />));
it.each(["VERIFIED_FREE", "STALE_LAST_GOOD", "UNAVAILABLE", "LOADING"] as const)("withdraws cached data on %s", async state => {
  await render(); expect(node.textContent).toContain("243,000");
  authority.current = { ...authority.current!, state, plan: { tier: "free", features: [] } };
  await render(); expect(node.textContent).not.toContain("243,000");
});
it("refuses cross-owner cached authority and does not treat ordinary Pro as a feature grant", async () => {
  authority.current = { ...authority.current!, owner: "account:other" };
  await render(); expect(node.textContent).not.toContain("243,000");
  authority.current = { ...authority.current!, owner: "account:one", plan: { tier: "pro", features: [] } };
  await render(); expect(node.textContent).not.toContain("243,000");
});
it("preserves the exact verified unlimited operator overlay", async () => {
  authority.current = { ...authority.current!, plan: { tier: "unlimited", features: [] } };
  await render(); expect(node.textContent).toContain("243,000");
});

it("applies the existing preference to the real root and restores the host on close", async () => {
  preferences.metaPrefs = { theme: "light", themeAuto: "0" };
  await render();
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.dataset.researchAppearance).toBe("lab");
  preferences.metaPrefs = { theme: "dark", themeAuto: "0" };
  await render(); expect(document.documentElement.dataset.theme).toBe("dark");
  preferences.metaPrefs = { theme: "light", themeAuto: "0" };
  await render();
  await act(async () => root.render(null));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.hasAttribute("data-research-appearance")).toBe(false);
});
it("does not apply another account's preference and uses the resolved shell identity", async () => {
  const { useAccountPrefs } = await import("@/lib/useMarketPrefs");
  preferences.metaPrefs = { theme: "light" };
  await render(); expect(document.documentElement.dataset.theme).toBe("light");
  preferences.owner = "account:other";
  await render(); expect(document.documentElement.dataset.theme).toBe("dark");
  expect(useAccountPrefs).toHaveBeenLastCalledWith({ kind: "account", userId: "one", email: "fixture@example.test" });
});
it("uses Dashboard Auto hours and updates at the boundary and on visibility return", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 8, 6, 59, 30));
  preferences.metaPrefs = { theme: "light", themeAuto: "1" };
  await render(); expect(document.documentElement.dataset.theme).toBe("dark");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(document.documentElement.dataset.theme).toBe("light");
  vi.setSystemTime(new Date(2026, 9, 8, 19, 0, 0));
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(document.documentElement.dataset.theme).toBe("dark");
  await act(async () => root.render(null));
  vi.setSystemTime(new Date(2026, 9, 9, 12, 0, 0));
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(vi.getTimerCount()).toBe(0);
});
it("keeps the light permission state truthful after the data grant is withdrawn", async () => {
  preferences.metaPrefs = { theme: "light" };
  await render(); expect(node.textContent).toContain("243,000");
  authority.current = { ...authority.current!, state: "UNAVAILABLE", plan: null };
  await render();
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(node.textContent).not.toContain("243,000");
  expect(node.textContent).toContain("Options access is unavailable");
});
it("restores an absent host theme and survives React strict effect replay", async () => {
  document.documentElement.removeAttribute("data-theme");
  preferences.metaPrefs = { theme: "light" };
  await act(async () => root.render(<React.StrictMode><AdmittedOptionsResearchLab root="SPY" matrix={matrix} lang="en" onClose={() => {}} /></React.StrictMode>));
  expect(document.documentElement.dataset.theme).toBe("light");
  await act(async () => root.render(null));
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(document.documentElement.hasAttribute("data-research-appearance")).toBe(false);
});
