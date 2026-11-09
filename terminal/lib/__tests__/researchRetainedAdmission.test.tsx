// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AdmittedOptionsResearchLab } from "@/components/researchlab/AdmittedOptionsResearchLab";
const state = vi.hoisted(() => ({ identity: "account:one", entitlement: { owner: "account:one", state: "VERIFIED_PAID", plan: { features: ["terminal_live_options"] } } }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => state.identity }));
vi.mock("@/lib/accountIdentity", () => ({ identityOwnerKey: (identity: string) => identity }));
vi.mock("@/lib/entitlementStore", () => ({ useEntitlementSnapshot: () => state.entitlement }));
vi.mock("@/components/researchlab/useResearchAppearance", () => ({ useResearchAppearance: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => <span>3D renderer</span> }));
const wire = readFileSync("lib/__tests__/fixtures/retained-options/matrix-wire.json", "utf8");
const matrix = { schema: "options_structure.matrix/v1", root: "SPY", _build_meta: { asof_date: "2026-10-19" }, cells: [{ strike: 100, expiry: "2026-10-30", call_oi: 1 }] };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.stubGlobal("crypto", webcrypto); state.identity = "account:one"; state.entitlement = { owner: "account:one", state: "VERIFIED_PAID", plan: { features: ["terminal_live_options"] } }; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<AdmittedOptionsResearchLab root="SPY" matrix={matrix} lang="en" onClose={() => {}} questionOwnerKey="forged-caller-owner" retainedSelection={{ root: "SPY", session: "2026-10-19", ownerKey: "account:one", wire }} />)); }
async function ready() { for (let i = 0; i < 40 && !host.textContent?.includes("9007199254740993"); i++) await act(async () => new Promise(r => setTimeout(r, 5))); expect(host.textContent).toContain("9007199254740993"); }
it("binds supplied data to the incumbent shell identity, overriding caller owner props", async () => { await mount(); await ready(); });
it.each(["pending", "feature withdrawn", "account changed"])("withdraws supplied retained data when %s", async reason => {
  await mount(); await ready();
  if (reason === "pending") state.entitlement.state = "LOADING";
  else if (reason === "feature withdrawn") state.entitlement.plan.features = [];
  else { state.identity = "account:two"; state.entitlement.owner = "account:two"; }
  await mount(); expect(host.textContent).not.toContain("9007199254740993");
});
