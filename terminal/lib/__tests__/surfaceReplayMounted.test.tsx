// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceView } from "@/components/surface/SurfaceView";
import { flowInvalidate } from "@/lib/flowClientCache";

const chartWrites = vi.hoisted(() => ({ ranges: [] as unknown[] }));

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
    setVisibleRange(range: unknown) { chartWrites.ranges.push(range); }, setAutoScale() {}, getVisibleRange: () => ({ from: 99, to: 105 }),
    width: () => 50, applyOptions() {},
  };
  return { ...actual, createChart: () => {
    const counts: number[] = [];
    const series = () => {
      const index = counts.push(0) - 1;
      return {
        setData(rows: unknown[]) { counts[index] = rows.length; },
        applyOptions() {}, coordinateToPrice: () => null, priceToCoordinate: () => null,
        createPriceLine: () => ({}), removePriceLine() {}, priceScale: () => scale,
      };
    };
    const hasPoints = () => counts.some(count => count > 0);
    return {
      addCustomSeries: series, addSeries: series, priceScale: () => scale,
      timeScale: () => ({
        setVisibleRange() { if (!hasPoints()) throw new Error("Value is null: empty chart time scale"); },
        fitContent() {}, getVisibleRange: () => hasPoints() ? ({ from: 100, to: 200 }) : null,
        subscribeVisibleTimeRangeChange() {}, unsubscribeVisibleTimeRangeChange() {},
      }),
      subscribeCrosshairMove() {}, subscribeClick() {}, remove() {}, applyOptions() {},
      setCrosshairPosition() {}, clearCrosshairPosition() {},
    };
  } };
});

let root: Root;
let host: HTMLDivElement;
let stamps: string[];
let calls: string[];
let failIndex: boolean;
let delayedIndex: Promise<Response> | null;
let indexRootOverride: string | null;
let sourceDate: string;
let customStamps: string[] | null;
let emitFrames: boolean;
let frameRevision: number;
let delayedFrame: Promise<Response> | null;
let emitGreek: boolean;
let emitCandles: boolean;
let frameStampOverride: string | null;
const date = "2026-09-17";
const payload = () => ({ root: "SPY", date: sourceDate, stamps: [...(customStamps ?? stamps)], latest: (customStamps ?? stamps).at(-1) ?? null, cadenceSec: 60 });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T14:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  flowInvalidate();
  chartWrites.ranges.length = 0;
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
  indexRootOverride = null; sourceDate = date; customStamps = null; emitFrames = false; frameRevision = 0; delayedFrame = null; emitGreek = false; emitCandles = true; frameStampOverride = null;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), "http://localhost");
    const f = url.searchParams.get("f") ?? url.pathname;
    calls.push(f);
    if (f.startsWith("surface_idx:")) {
      if (delayedIndex) return delayedIndex;
      if (failIndex) return new Response("unavailable", { status: 503 });
      return json({ ...payload(), root: indexRootOverride ?? f.split(":")[1] });
    }
    if (f.startsWith("surface_idx_at:")) {
      return json({ ...payload(), root: f.split(":")[1], date: f.split(":")[2] });
    }
    if (f.startsWith("surface_dates:")) return json({ root: f.split(":")[1], dates: [date, "2026-09-16"], latest: date, cadenceSec: 60 });
    if (emitFrames && emitCandles && f === "/api/intraday") return json({ bars:
      Array.from({ length: frameRevision > 0 ? 3 : 2 }, (_, i) =>
        [Date.UTC(2026,8,17,9,30) / 1000 + i * 300, 100, 100.5 + i, 99.5, 100.2, 10]) });
    if (emitFrames && (f.startsWith("surface:") || f.startsWith("surface_at:"))) {
      if (delayedFrame) return delayedFrame;
      const bits = f.split(":");
      const selectedDate = bits[0] === "surface_at" ? bits[2] : sourceDate;
      const requestedStamp = bits.at(-1)!;
      const timeSteps = frameStampOverride != null
        ? ["09:30", frameStampOverride]
        : requestedStamp === "0930" ? ["09:30"] : ["09:30", "09:31"];
      const row = (value: number) => Array(timeSteps.length).fill(value);
      return json({ root: bits[1], session_date: selectedDate, spot: 100.2,
        price_levels: [100, 105], time_steps: timeSteps,
        grids: { netprem: [row(100), row(200)], ...(emitGreek ? { gex: [row(1), row(2)] } : {}) },
        asof: `${selectedDate}T13:31:${String(frameRevision).padStart(2,"0")}Z`, cadence: "1-min" });
    }
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


describe("shared replay read boundaries", () => {
  it("rejects a substituted instrument index", async () => {
    indexRootOverride = "QQQ";
    await act(async () => { root.render(<SurfaceView />); });
    expect(rail().getAttribute("aria-valuetext")).not.toContain("09:31");
  });

  it("rejects malformed or unordered frame identities", async () => {
    customStamps = ["0931", "2561", "0930"];
    await act(async () => { root.render(<SurfaceView />); });
    expect(rail().getAttribute("aria-valuetext")).not.toContain("09:30");
  });

  it("does not request today's index while selecting an archived session", async () => {
    await mount();
    const picker = host.querySelector<HTMLSelectElement>(".obs-surf-replay-session")!;
    await act(async () => { picker.value = "2026-09-16"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
    const liveReads = calls.filter(f => f === "surface_idx:SPY").length;
    await advance();
    expect(calls.filter(f => f === "surface_idx:SPY")).toHaveLength(liveReads);
    expect(calls).toContain("surface_idx_at:SPY:2026-09-16");
    expect(host.querySelector(".obs-surf-replay")!.textContent).toContain("2026-09-16");
  });

  it("rejects a late prior-root completion after the new root has loaded", async () => {
    await mount();
    let finish!: (value: Response) => void;
    delayedIndex = new Promise(resolve => { finish = resolve; });
    await advance();
    delayedIndex = null;
    stamps = ["0940", "0941", "0942"];
    const qqq = [...host.querySelectorAll<HTMLButtonElement>(".obs-surf-head-tools button")].find(b => b.textContent === "QQQ")!;
    await act(async () => { qqq.click(); });
    expect(rail().getAttribute("aria-valuetext")).toContain("09:42");
    await act(async () => { finish(json({ root: "SPY", date, stamps: ["0930"], latest: "0930", cadenceSec: 60 })); });
    expect(rail().getAttribute("aria-valuetext")).toContain("09:42");
  });

  it("shows a read failure without erasing the last usable frame index", async () => {
    await mount(); failIndex = true; await advance();
    expect(rail().getAttribute("aria-valuemax")).toBe("2");
    expect(host.querySelector(".obs-surf-replay")!.textContent).toContain("Refresh unavailable");
    expect(host.querySelector(".obs-surf-replay .obs-live-dot")).toBeNull();
  });

  it("does not use a LIVE badge as a synonym for the latest stored frame", async () => {
    await mount();
    expect(host.querySelector(".obs-surf-replay")!.textContent).toContain("LATEST STORED");
    expect(host.querySelector(".obs-surf-replay")!.textContent).not.toMatch(/\bLIVE\b/);
  });

  it("refreshes the current frame and candles when the index stamp has not changed", async () => {
    emitFrames = true;
    await mount();
    const frames = calls.filter(f => f === "surface:SPY:0931").length;
    const candles = calls.filter(f => f === "/api/intraday").length;
    frameRevision = 10;
    await advance();
    expect(calls.filter(f => f === "surface:SPY:0931").length).toBeGreaterThan(frames);
    expect(calls.filter(f => f === "/api/intraday").length).toBeGreaterThan(candles);
  });

  it("does not relabel a retained old-session frame when the live index rolls over", async () => {
    emitFrames = true;
    await mount();
    expect(host.querySelector(".obs-surf-data-strip")!.textContent).toContain(date);
    sourceDate = "2026-09-18";
    await advance();
    expect(host.querySelector(".obs-surf-data-strip")!.textContent).toContain("2026-09-18");
    expect(host.querySelector(".obs-surf-data-strip")!.textContent).not.toContain(date);
  });
});


it("withdraws the old field while a different selected frame is still loading", async () => {
  emitFrames = true;
  await mount();
  expect(host.querySelector(".obs-surf-data-strip")).not.toBeNull();
  let finish!: (value: Response) => void;
  delayedFrame = new Promise(resolve => { finish = resolve; });
  await first();
  expect(host.querySelector(".obs-surf-data-strip")?.textContent ?? "").not.toContain("2 observed frames");
  await act(async () => { finish(json(null)); });
});

it("keeps Gamma selected when the next snapshot does not carry Gamma", async () => {
  emitFrames = true; emitGreek = true;
  await mount();
  const gamma = [...host.querySelectorAll<HTMLButtonElement>(".obs-surf-controls button")].find(b => b.textContent === "Gamma")!;
  await act(async () => { gamma.click(); });
  expect(gamma.classList.contains("on")).toBe(true);
  emitGreek = false; await advance();
  expect(gamma.classList.contains("on")).toBe(true);
  const premium = [...host.querySelectorAll<HTMLButtonElement>(".obs-surf-controls button")].find(b => b.textContent === "Net Prem")!;
  expect(premium.classList.contains("on")).toBe(false);
});


it("does not refetch the whole candle session just because the replay selection changes", async () => {
  emitFrames = true; await mount();
  const before = calls.filter(f => f === "/api/intraday").length;
  await first();
  expect(calls.filter(f => f === "/api/intraday")).toHaveLength(before);
});

it("does not refit the price axis each time a new candle arrives", async () => {
  emitFrames = true; await mount();
  const before = chartWrites.ranges.length;
  expect(before).toBeGreaterThan(0);
  frameRevision = 10; await advance();
  expect(chartWrites.ranges).toHaveLength(before);
});


it("preserves the session picker when the already selected root is clicked", async () => {
  await mount();
  expect(host.querySelector(".obs-surf-replay-session")).not.toBeNull();
  const spy = [...host.querySelectorAll<HTMLButtonElement>(".obs-surf-head-tools button")].find(b => b.textContent === "SPY")!;
  await act(async () => { spy.click(); });
  expect(host.querySelector(".obs-surf-replay-session")).not.toBeNull();
});


it("keeps an unavailable Greek mounted when neither field nor candle time points remain", async () => {
  emitFrames = true; emitGreek = true; emitCandles = false;
  await mount();
  const gamma = [...host.querySelectorAll<HTMLButtonElement>(".obs-surf-controls button")].find(b => b.textContent === "Gamma")!;
  await act(async () => { gamma.click(); });
  emitGreek = false;
  await advance();
  expect(rail().getAttribute("aria-valuemax")).toBe("2");
  expect(gamma.classList.contains("on")).toBe(true);
});

it("rejects a same-session frame whose last observed time does not match the selected stamp", async () => {
  emitFrames = true;
  frameStampOverride = "09:32";
  await mount();
  expect(rail().getAttribute("aria-valuetext")).toContain("09:31");
  expect(host.querySelector(".obs-surf-data-strip")).toBeNull();
});
