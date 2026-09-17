// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceView } from "@/components/surface/SurfaceView";
import { flowInvalidate } from "@/lib/flowClientCache";

// Keep the real view, pane, provider, replay bar, reducer and HTTP cache. Only
// canvas plumbing and unrelated presentation leaves are replaced in this DOM test.
vi.mock("@/lib/flowStream", () => ({ useFlowStream: () => ({ data: null }) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/surface/SurfaceStylePopover", () => ({ SurfaceStylePopover: () => null }));
vi.mock("@/components/surface/SessionFlowPane", () => ({ SessionFlowPane: () => null }));
vi.mock("@/components/surface/StrikeEvolutionModal", () => ({ StrikeEvolutionModal: () => null }));
vi.mock("@/components/surface/EodReplayTag", () => ({ EodReplayTag: () => null }));
vi.mock("lightweight-charts", async (original) => {
  const actual = await original<typeof import("lightweight-charts")>();
  const scale = {
    setVisibleRange() {}, setAutoScale() {}, getVisibleRange: () => ({ from: 99, to: 105 }),
    width: () => 50, applyOptions() {},
  };
  const series = () => ({
    setData() {}, applyOptions() {}, coordinateToPrice: () => null,
    priceToCoordinate: () => null, createPriceLine: () => ({}), removePriceLine() {},
    priceScale: () => scale,
  });
  return { ...actual, createChart: () => ({
    addCustomSeries: series, addSeries: series, priceScale: () => scale,
    timeScale: () => ({ setVisibleRange() {}, fitContent() {}, getVisibleRange: () => null, subscribeVisibleTimeRangeChange() {}, unsubscribeVisibleTimeRangeChange() {} }),
    subscribeCrosshairMove() {}, subscribeClick() {}, remove() {}, applyOptions() {},
    setCrosshairPosition() {}, clearCrosshairPosition() {},
  }) };
});

let root: Root;
let host: HTMLDivElement;
let stamps: string[];
let calls: string[];
let failIndex: boolean;
let delayedIndex: Promise<Response> | null;
const date = "2026-09-17";
const payload = () => ({ root: "SPY", date, stamps: [...stamps], latest: stamps.at(-1) ?? null, cadenceSec: 60 });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T14:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  flowInvalidate();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => storage.clear(),
  });
  stamps = ["0930", "0931"];
  calls = [];
  failIndex = false;
  delayedIndex = null;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), "http://localhost");
    const f = url.searchParams.get("f") ?? url.pathname;
    calls.push(f);
    if (f.startsWith("surface_idx:")) {
      if (delayedIndex) return delayedIndex;
      if (failIndex) return new Response("unavailable", { status: 503 });
      return json({ ...payload(), root: f.split(":")[1] });
    }
    if (f.startsWith("surface_idx_at:")) {
      return json({ ...payload(), root: f.split(":")[1], date: f.split(":")[2] });
    }
    if (f.startsWith("surface_dates:")) return json({ root: f.split(":")[1], dates: [date, "2026-09-16"], latest: date, cadenceSec: 60 });
    return json(null);
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  flowInvalidate();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => { root.render(<SurfaceView />); });
  expect(rail().getAttribute("aria-valuemax")).toBe("2");
}
function rail() {
  const found = host.querySelector<HTMLElement>(".obs-surf-frame-rail");
  if (!found) throw new Error("real replay rail failed to mount");
  return found;
}
async function first() {
  await act(async () => { host.querySelector<HTMLButtonElement>(".obs-surf-replay-transport button")!.click(); });
  expect(rail().getAttribute("aria-valuenow")).toBe("1");
}
async function advance() {
  await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
}

describe("Surface workspace replay through its actual mounted consumer", () => {
  it("loads an initial index into the real replay rail", async () => {
    await mount();
    expect(rail().getAttribute("aria-valuenow")).toBe("2");
  });

  it("admits an expanding live index without changing root or reloading", async () => {
    await mount();
    stamps.push("0932");
    await advance();
    expect(rail().getAttribute("aria-valuemax")).toBe("3");
    expect(rail().getAttribute("aria-valuenow")).toBe("3");
  });

  it("does not pull a paused historical cursor to the new head", async () => {
    await mount();
    await first();
    stamps.push("0932");
    await advance();
    expect(rail().getAttribute("aria-valuemax")).toBe("3");
    expect(rail().getAttribute("aria-valuetext")).toContain("09:30");
  });

  it("preserves the selected time when single changes to quad", async () => {
    await mount();
    await first();
    const group = host.querySelector(".obs-surf-head-tools [role=group]")!;
    await act(async () => { group.querySelectorAll<HTMLButtonElement>("button")[1].click(); });
    expect(rail().getAttribute("aria-valuetext")).toContain("09:30");
  });

  it("refreshes only one index for a four-panel group", async () => {
    await mount();
    const group = host.querySelector(".obs-surf-head-tools [role=group]")!;
    await act(async () => { group.querySelectorAll<HTMLButtonElement>("button")[1].click(); });
    const before = calls.filter((f) => f === "surface_idx:SPY").length;
    stamps.push("0932");
    await advance();
    expect(calls.filter((f) => f === "surface_idx:SPY").length - before).toBe(1);
    expect(rail().getAttribute("aria-valuemax")).toBe("3");
  });

  it("keeps the last usable frames when an index refresh fails", async () => {
    await mount();
    failIndex = true;
    await advance();
    expect(calls.filter((f) => f === "surface_idx:SPY").length).toBeGreaterThan(1);
    expect(rail().getAttribute("aria-valuemax")).toBe("2");
  });

  it("stops index refreshes when the workspace unmounts", async () => {
    await mount();
    await act(async () => { root.unmount(); });
    const count = calls.length;
    await advance();
    expect(calls.length).toBe(count);
    root = createRoot(host);
  });
});
