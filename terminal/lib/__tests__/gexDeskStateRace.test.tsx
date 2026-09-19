// @vitest-environment jsdom
// Mount the real desk; replace transport and presentation leaves only.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GexDeskView } from "@/components/gexdesk/GexDeskView";

const transport = vi.hoisted(() => ({
  frames: [] as Array<{ selected: string; received: string | null }>,
  pending: [] as Array<{ key: string; resolve: (value: unknown) => void; reject: (error: Error) => void }>,
}));
vi.mock("@/lib/flowClientCache", () => ({
  flowGet: (key: string) => key.startsWith("gexstate:")
    ? new Promise((resolve, reject) => transport.pending.push({ key, resolve, reject }))
    : Promise.resolve(null),
}));
vi.mock("@/lib/flowStream", () => ({ useFlowStream: () => ({ data: null, error: null }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: vi.fn() }));
vi.mock("@/components/gexdesk/MarketStateCard", () => ({
  MarketStateCard: ({ statePayload }: { statePayload: { root: string; gamma_flip: number } | null }) =>
    <output data-testid="state">{statePayload ? `${statePayload.root}:${statePayload.gamma_flip}` : "unavailable"}</output>,
}));
vi.mock("@/components/eodcontext/EodContextBelt", () => ({
  EodContextBelt: ({ root, gexState }: { root: string; gexState: { root: string } | null }) => {
    transport.frames.push({ selected: root, received: gexState?.root ?? null });
    return null;
  },
}));
vi.mock("@/components/gexdesk/GexSummaryBar", () => ({ GexSummaryBar: () => null }));
vi.mock("@/components/gexdesk/StrikeLadder", () => ({ StrikeLadder: () => null }));
vi.mock("@/components/gexdesk/GexHistory", () => ({ GexHistory: () => null }));
vi.mock("@/components/gexdesk/ExpiryBars", () => ({ ExpiryBars: () => null }));
vi.mock("@/components/gexdesk/ExposureExpiryDrawer", () => ({ ExposureExpiryDrawer: () => null }));
vi.mock("@/components/gexdesk/ExposureMatrix", () => ({ ExposureMatrix: () => null }));
vi.mock("@/components/gexdesk/HeatSeekerCard", () => ({ HeatSeekerCard: () => null }));

const state = (root: string, gamma_flip: number) => ({
  schema: "options_structure.gex_state/v1", root, gamma_flip,
  asof: "2026-09-15T22:00:00Z",
});
let node: HTMLDivElement;
let root: Root;
let mounted = false;
const shown = () => node.querySelector('[data-testid="state"]')?.textContent;
async function settle(index: number, value: unknown, fail = false) {
  const request = transport.pending[index];
  expect(request).toBeDefined();
  await act(async () => fail ? request.reject(new Error("fixture failure")) : request.resolve(value));
}
async function choose(symbol: string) {
  const button = [...node.querySelectorAll("button")].find((b) => b.textContent === symbol);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  transport.pending.length = 0; transport.frames.length = 0;
  node = document.createElement("div"); document.body.append(node);
  root = createRoot(node); mounted = true;
  await act(async () => root.render(<GexDeskView />));
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  node.remove(); vi.restoreAllMocks();
});

describe("mounted Exposure state ownership", () => {
  it.each([false, true])("retains QQQ when the older SPY request completes (error=%s)", async (fail) => {
    expect(transport.pending[0].key).toBe("gexstate:SPY");
    await choose("QQQ");
    expect(transport.pending[1].key).toBe("gexstate:QQQ");
    await settle(1, state("QQQ", 700));
    expect(shown()).toBe("QQQ:700");
    await settle(0, state("SPY", 760), fail);
    expect(shown()).toBe("QQQ:700");
  });
  it("a newer same-root refresh owns the result", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(transport.pending).toHaveLength(2);
    await settle(1, state("SPY", 770));
    await settle(0, state("SPY", 760));
    expect(shown()).toBe("SPY:770");
  });
  it.each([null, {}, state("QQQ", 700), { ...state("SPY", 760), schema: "wrong/v1" }])(
    "does not publish missing or substituted state (%j)", async (payload) => {
      await settle(0, payload);
      expect(shown()).toBe("unavailable");
    },
  );
});

it("never renders a prior-root context during ticker-change cleanup", async () => {
  await settle(0, state("SPY", 760));
  expect(shown()).toBe("SPY:760");
  transport.frames.length = 0;
  await choose("QQQ");
  expect(transport.frames.some((f) => f.selected === "QQQ")).toBe(true);
  expect(transport.frames.filter((f) => f.received && f.received !== f.selected)).toEqual([]);
  expect(shown()).toBe("unavailable");
});

it("keeps a newer same-root success when an older request fails", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await settle(1, state("SPY", 770));
  await settle(0, null, true);
  expect(shown()).toBe("SPY:770");
});

it("a current missing refresh withdraws previously valid state", async () => {
  await settle(0, state("SPY", 760));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await settle(1, null);
  expect(shown()).toBe("unavailable");
});

it("an A-to-B-to-A selection accepts only the newest A request", async () => {
  await choose("QQQ");
  await choose("SPY");
  expect(transport.pending.map((p) => p.key)).toEqual(["gexstate:SPY", "gexstate:QQQ", "gexstate:SPY"]);
  await settle(2, state("SPY", 780));
  await settle(1, state("QQQ", 700));
  await settle(0, state("SPY", 760));
  expect(shown()).toBe("SPY:780");
});

it("unmount invalidates the pending request before payload admission", async () => {
  const documents = await import("@/components/gexdesk/matrixDoc");
  const admit = vi.spyOn(documents, "readGexStateForRoot");
  await act(async () => root.unmount()); mounted = false;
  await settle(0, state("SPY", 760));
  expect(admit).not.toHaveBeenCalled();
  expect(node.innerHTML).toBe("");
});
