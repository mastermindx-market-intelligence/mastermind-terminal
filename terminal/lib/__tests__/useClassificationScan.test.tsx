// @vitest-environment jsdom
// The Screener's ONE classification-scan read (E03). Pins: a first read that never settles is
// bounded — after CLASSIFICATION_SCAN_TIMEOUT_MS it settles as `error` (so the screen is not held
// on a multi-megabyte fetch), a late answer is still adopted, a read that settled in time is
// never overwritten by the timer, and 404 stays `absent` (never an empty population).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CacheOutcome } from "../dataCache";

const mocks = vi.hoisted(() => ({
  getJSONResult: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("../dataCache", () => ({ getJSONResult: mocks.getJSONResult, invalidate: mocks.invalidate }));

import { CLASSIFICATION_SCAN_TIMEOUT_MS, useClassificationScan } from "../useClassificationScan";
import type { ClassificationScanSource } from "../classificationScan";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOC = JSON.parse(readFileSync(path.join(__dirname, "fixtures/screenerScan/classification.producer.json"), "utf8"));

const seen: { latest: ClassificationScanSource | null } = { latest: null };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Probe() {
  const h = useClassificationScan();
  useLayoutEffect(() => { seen.latest = h.source; });
  return null;
}
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getJSONResult.mockReset();
  mocks.invalidate.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  seen.latest = null;
});
afterEach(() => {
  act(() => root!.unmount());
  host!.remove();
  vi.useRealTimers();
});

describe("useClassificationScan — a bounded first read", () => {
  it("settles a hung read as error after the timeout, and still adopts a late answer", async () => {
    const d = deferred<CacheOutcome>();
    mocks.getJSONResult.mockReturnValue(d.promise);
    act(() => root!.render(<Probe />));
    expect(seen.latest).toBeNull(); // loading is not a population
    await act(async () => { vi.advanceTimersByTime(CLASSIFICATION_SCAN_TIMEOUT_MS - 1); });
    expect(seen.latest).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(seen.latest).toEqual({ kind: "error", error: "timeout" });
    // the read lands later: nothing was held, so it is adopted as the first generation
    d.resolve({ status: "data", data: DOC } as CacheOutcome);
    await flush();
    expect(seen.latest?.kind).toBe("ready");
  });

  it("never lets the timer overwrite a read that settled in time", async () => {
    mocks.getJSONResult.mockResolvedValue({ status: "absent" } as CacheOutcome);
    act(() => root!.render(<Probe />));
    await flush();
    expect(seen.latest).toEqual({ kind: "absent" });
    await act(async () => { vi.advanceTimersByTime(CLASSIFICATION_SCAN_TIMEOUT_MS * 2); });
    expect(seen.latest).toEqual({ kind: "absent" });
  });

  it("clears its timer on unmount", async () => {
    mocks.getJSONResult.mockReturnValue(new Promise(() => {}));
    act(() => root!.render(<Probe />));
    act(() => root!.unmount());
    root = createRoot(host!); // afterEach unmounts again
    expect(vi.getTimerCount()).toBe(0);
  });
});
