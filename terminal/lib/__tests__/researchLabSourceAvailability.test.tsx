// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdmittedOptionsResearchLab } from "@/components/researchlab/AdmittedOptionsResearchLab";
import { flowGetResult } from "@/lib/flowClientCache";
import { reportedGammaBook } from "./fixtures/reportedGammaBooks";

vi.mock("@/components/chrome/AppShell", () => ({
  useShellIdentity: () => ({ kind: "account", userId: "source-test", email: "source@example.test" }),
}));
vi.mock("@/lib/entitlementStore", () => ({
  useEntitlementSnapshot: () => ({
    owner: "account:source-test", state: "VERIFIED_PAID",
    plan: { tier: "pro", features: ["terminal_live_options"] }, verifiedAt: 1,
  }),
}));
vi.mock("@/components/researchlab/useResearchAppearance", () => ({ useResearchAppearance: () => {} }));
vi.mock("next/dynamic", () => ({ default: () => () => <span>3D renderer</span> }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: vi.fn() }));
const load = vi.mocked(flowGetResult);
const SESSION = "2026-10-19", PRIOR = "2026-10-16", EXPIRY = "2026-10-23";
const NOW = Date.parse("2026-10-21T12:00:00Z");
const retainedBook = reportedGammaBook(SESSION);
const matrix = {
  schema: "options_structure.matrix/v1", root: "SPY", asof: "2026-10-20T02:00:00Z",
  _build_meta: { asof_date: SESSION },
  cells: [
    { strike: 100, expiry: EXPIRY, gex: -100, call_vol: 243, call_oi: 110, put_vol: 0, put_oi: 9 },
    { strike: 103, expiry: EXPIRY, gex: 40, call_vol: 12, call_oi: 30, put_vol: 4, put_oi: 8 },
  ],
};
let host: HTMLDivElement, root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubGlobal("crypto", webcrypto);
  load.mockReset().mockImplementation(async key =>
    key === "gex_dates:SPY"
      ? { status: "data", data: { root: "SPY", dates: [SESSION, PRIOR], latest: SESSION } }
      : key === `gex_at:SPY:${PRIOR}`
        ? { status: "data", data: reportedGammaBook(PRIOR, 2) }
        : { status: "absent", httpStatus: 404 });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const memoryStatus = () => host.querySelector("[data-memory-status]")?.getAttribute("data-memory-status");
const panel = () => host.querySelector('[data-testid="research-reported-gamma"]');
async function render(available?: boolean) {
  await act(async () => root.render(<AdmittedOptionsResearchLab root="SPY" matrix={matrix} lang="en"
    onClose={() => {}} currentGexSnapshot={retainedBook} currentGexSourceAvailable={available} />));
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function ready() {
  for (let n = 0; n < 60 && memoryStatus() !== "ready"; n++)
    await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  expect(memoryStatus()).toBe("ready");
  expect(panel()?.getAttribute("data-comparison-state")).toBe("data");
}

it.each([false, undefined])("refuses retained bytes without explicit current availability (%s)", async available => {
  await render(available);
  await click("Replay & change");
  expect(memoryStatus()).toBeUndefined();
  expect(panel()).toBeNull();
  expect(host.textContent).toContain("No current all-expiry GEX source is supplied");
  expect(load).not.toHaveBeenCalled();
});

it("withdraws and restores the same retained book as host availability changes", async () => {
  await render(true);
  await click("103 Put · 2026-10-23");
  await click("Replay & change");
  await ready();
  expect(host.querySelector('[data-testid="research-reported-gamma-pin"]')?.getAttribute("data-pin-state")).toBe("pinned");
  const priorReads = load.mock.calls.length;

  await render(false);
  expect(panel()).toBeNull();
  expect(memoryStatus()).toBeUndefined();
  expect(host.textContent).toContain("No current all-expiry GEX source is supplied");
  expect(load.mock.calls.length).toBe(priorReads);

  await render(true);
  await ready();
  expect(host.querySelector('[data-testid="research-reported-gamma-pin"]')?.textContent).toContain("103 Put");
  expect(load.mock.calls.every(([key]) => key === "gex_dates:SPY" || key === `gex_at:SPY:${PRIOR}`)).toBe(true);
});
