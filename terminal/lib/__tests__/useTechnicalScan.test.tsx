// @vitest-environment jsdom
// The Screener's ONE technical-scan read (E01). Pins: nothing is fetched until the screen is
// opened (manifest-only compatibility path), absent ≠ error, Retry clears the negative cache, a
// newer INCOMPLETE generation never replaces a held complete one (AC-E01-03), and a stale copy
// whose refresh failed is labelled rather than painted as current.
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

import { REFRESH_FAILED, sourceFromOutcome, useTechnicalScan, type TechnicalScanState } from "../useTechnicalScan";
import { TECHNICAL_SCAN_URL } from "../technicalScan";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE = path.join(__dirname, "fixtures/screenerScan/technical.producer.json");
const doc = (p: { complete?: boolean; generation?: number } = {}) => {
  const d = JSON.parse(readFileSync(FIXTURE, "utf8"));
  if (p.complete !== undefined) d.complete = p.complete;
  if (p.generation !== undefined) {
    d.generation = p.generation;
    d.generated_at = new Date(p.generation * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return d;
};
const G = doc().generation as number;

type Hook = TechnicalScanState & { retry: () => void };
/** Box, not a reassigned module binding: the probe writes the hook's latest return into it. */
const seen: { latest: Hook | null } = { latest: null };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Reports every committed hook value (a layout effect flushes inside act, before it returns). */
function Probe({ enabled, report }: { enabled: boolean; report: (h: Hook) => void }) {
  const h = useTechnicalScan(enabled);
  useLayoutEffect(() => report(h));
  return null;
}
const record = (h: Hook) => { seen.latest = h; };
function render(enabled: boolean) {
  act(() => root!.render(<Probe enabled={enabled} report={record} />));
}
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
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
});

const settled = () => {
  if (!seen.latest || seen.latest.phase !== "settled") throw new Error(`not settled: ${seen.latest?.phase}`);
  return seen.latest;
};
const readyScan = () => {
  const s = settled().source;
  if (s.kind !== "ready") throw new Error(`not ready: ${s.kind}`);
  return s;
};

describe("sourceFromOutcome", () => {
  it("keeps absent and unavailable apart", () => {
    expect(sourceFromOutcome({ status: "absent" })).toEqual({ kind: "absent" });
    expect(sourceFromOutcome({ status: "unavailable", reason: "server", httpStatus: 503 } as CacheOutcome)).toEqual({ kind: "error", error: "http_503" });
    expect(sourceFromOutcome({ status: "unavailable", reason: "network" } as CacheOutcome)).toEqual({ kind: "error", error: "network" });
    expect(sourceFromOutcome({ status: "data", data: { not: "a scan" } } as CacheOutcome).kind).toBe("error");
    expect(sourceFromOutcome({ status: "data", data: doc() } as CacheOutcome).kind).toBe("ready");
  });
});

describe("useTechnicalScan", () => {
  it("reads nothing until the technical screen is opened", async () => {
    render(false);
    await flush();
    expect(mocks.getJSONResult).not.toHaveBeenCalled();
    expect(seen.latest!.phase).toBe("idle");
  });

  it("one bounded read of the scan URL; a complete generation is adopted", async () => {
    mocks.getJSONResult.mockResolvedValue({ status: "data", data: doc() });
    render(true);
    expect(seen.latest!.phase).toBe("loading");
    await flush();
    expect(mocks.getJSONResult).toHaveBeenCalledTimes(1);
    expect(mocks.getJSONResult.mock.calls[0][0]).toBe(TECHNICAL_SCAN_URL);
    expect(readyScan().scan.generation).toBe(G);
    expect(settled().decision?.reason).toBe("first");
  });

  it("absent stays absent; Retry invalidates the negative cache and reads again", async () => {
    mocks.getJSONResult.mockResolvedValueOnce({ status: "absent" });
    render(true);
    await flush();
    expect(settled().source).toEqual({ kind: "absent" });
    mocks.getJSONResult.mockResolvedValueOnce({ status: "data", data: doc() });
    act(() => seen.latest!.retry());
    await flush();
    expect(mocks.invalidate).toHaveBeenCalledWith(TECHNICAL_SCAN_URL);
    expect(mocks.getJSONResult).toHaveBeenCalledTimes(2);
    expect(readyScan().scan.complete).toBe(true);
  });

  it("an unreadable scan is an error, not an empty result", async () => {
    mocks.getJSONResult.mockResolvedValueOnce({ status: "unavailable", reason: "server", httpStatus: 500 });
    render(true);
    await flush();
    expect(settled().source).toEqual({ kind: "error", error: "http_500" });
  });

  it("AC-E01-03: a newer INCOMPLETE generation never replaces the held complete one", async () => {
    let onRevalidate: ((d: unknown) => void) | undefined;
    const reval = deferred<"ok" | "failed" | "superseded">();
    mocks.getJSONResult.mockImplementation((_u: string, opts: { onRevalidate?: (d: unknown) => void }) => {
      onRevalidate = opts.onRevalidate;
      return Promise.resolve({ status: "data", data: doc(), stale: { ageMs: 120_000, source: "disk", revalidation: reval.promise } });
    });
    render(true);
    await flush();
    expect(readyScan().scan.complete).toBe(true);

    act(() => onRevalidate!(doc({ complete: false, generation: G + 3600 })));
    expect(readyScan().scan.generation).toBe(G);     // still the complete generation
    expect(readyScan().scan.complete).toBe(true);
    expect(settled().decision).toEqual({ adopt: false, reason: "incomplete_over_complete" });

    // a newer COMPLETE generation is adopted
    act(() => onRevalidate!(doc({ complete: true, generation: G + 7200 })));
    expect(readyScan().scan.generation).toBe(G + 7200);
    expect(settled().decision?.reason).toBe("newer_complete");
    reval.resolve("ok");
    await flush();
    expect(readyScan().refreshFailed).toBeUndefined();
  });

  it("an incomplete first read is shown AS incomplete (adopted, never claimed complete)", async () => {
    mocks.getJSONResult.mockResolvedValueOnce({ status: "data", data: doc({ complete: false }) });
    render(true);
    await flush();
    expect(readyScan().scan.complete).toBe(false);
  });

  it("a stale copy whose refresh failed is kept and labelled refreshFailed", async () => {
    const reval = deferred<"ok" | "failed" | "superseded">();
    mocks.getJSONResult.mockResolvedValueOnce({ status: "data", data: doc(), stale: { ageMs: 3_600_000, source: "disk", revalidation: reval.promise } });
    render(true);
    await flush();
    expect(readyScan().refreshFailed).toBeUndefined();
    reval.resolve("failed");
    await flush();
    expect(readyScan().refreshFailed).toBe(true);
    expect(readyScan().scan.generation).toBe(G);
    expect(REFRESH_FAILED.kind).toBe("error");
  });

  it("a failed Retry never erases a held scan", async () => {
    mocks.getJSONResult.mockResolvedValueOnce({ status: "data", data: doc() });
    render(true);
    await flush();
    mocks.getJSONResult.mockResolvedValueOnce({ status: "unavailable", reason: "network" });
    act(() => seen.latest!.retry());
    await flush();
    expect(readyScan().scan.generation).toBe(G);
    expect(readyScan().refreshFailed).toBe(true);
  });
});
