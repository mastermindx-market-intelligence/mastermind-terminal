// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdmittedOptionsResearchLab } from "@/components/researchlab/AdmittedOptionsResearchLab";
import type { EntitlementSnapshot } from "@/lib/entitlementStore";
const authority = vi.hoisted(() => ({ current: null as EntitlementSnapshot | null }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "account", userId: "one", email: "fixture@example.test" }) }));
vi.mock("@/lib/entitlementStore", () => ({ useEntitlementSnapshot: () => authority.current }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const matrix = { schema: "options_structure.matrix/v1", root: "SPY", cells: [{ strike: 785, expiry: "2026-10-09", call_vol: 243000 }] };
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  authority.current = { owner: "account:one", state: "VERIFIED_PAID", plan: { tier: "pro", features: ["terminal_live_options"] }, verifiedAt: 1 };
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
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
