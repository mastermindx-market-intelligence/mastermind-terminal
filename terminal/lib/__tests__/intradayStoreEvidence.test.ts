import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import type { Bar6 } from "../intradayShared";
import type { IntradayAssemblyTrace } from "../intradayEvidence";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SHA256 = (data: string) => createHash("sha256").update(data).digest("hex");

const storePayload = (bars: Bar6[]): string =>
  JSON.stringify({ bars });

const makeBars = (epochs: number[]): Bar6[] =>
  epochs.map((e, i) => [e, 100 + i, 101 + i, 99 + i, 100.5 + i, 1000 + i] as Bar6);

const REGULAR_SESSION_EPOCHS = (() => {
  // 2026-09-14 is a Monday — regular session 09:30–16:00 ET
  const d = "2026-09-14";
  const base = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 1000;
  const open = base + (9 * 60 + 30) * 60;
  const close = base + 16 * 60 * 60;
  return { open, close, epochs: [open, open + 300, open + 600, close - 300] };
})();

const extPayload5m = makeBars(REGULAR_SESSION_EPOCHS.epochs);
const extPayload1h  = makeBars([REGULAR_SESSION_EPOCHS.open, REGULAR_SESSION_EPOCHS.open + 3600, REGULAR_SESSION_EPOCHS.close - 3600]);

// ── Mutable mock state (module-level so the factory closes over it) ────────────

let mockFiles: Record<string, string | null> = {}; // null = EACCES
const readFileMock = vi.fn(async (path: string) => {
  const match = path.match(/\/([^/]+\.json)$/);
  if (!match) throw Object.assign(new Error("bad path"), { code: "ENOENT" });
  const content = mockFiles[match[1]];
  if (content === undefined) {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    throw err;
  }
  if (content === null) {
    const err = Object.assign(new Error("EACCES"), { code: "EACCES" });
    throw err;
  }
  return Buffer.from(content, "utf8");
});

// ── Static mock of node:fs (hoisted before any imports) ─────────────────────
vi.mock("node:fs", () => ({
  promises: { readFile: readFileMock },
}));

// ── Import withStoredHistory after the mock is registered ─────────────────────
let withStoredHistory: typeof import("../intradayStore").withStoredHistory;

beforeEach(async () => {
  mockFiles = {};
  readFileMock.mockReset().mockImplementation(async (path: string) => {
    const match = path.match(/\/([^/]+\.json)$/);
    if (!match) throw Object.assign(new Error("bad path"), { code: "ENOENT" });
    const content = mockFiles[match[1]];
    if (content === undefined) {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      throw err;
    }
    if (content === null) {
      const err = Object.assign(new Error("EACCES"), { code: "EACCES" });
      throw err;
    }
    return Buffer.from(content, "utf8");
  });
  vi.resetModules();
  const mod = await import("../intradayStore");
  withStoredHistory = mod.withStoredHistory;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("withStoredHistory — store read errors", () => {
  it("ENOENT returns live-only with status missing", async () => {
    mockFiles = {};
    const liveBars = makeBars([100, 200]);
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL", "5m", false, liveBars, (trace) => { captured = trace; });
    expect(result).toEqual(liveBars);
    expect(captured.storeReads).toContainEqual(expect.objectContaining({ base: "5m", status: "missing" }));
  });

  it("EACCES / unreadable returns live-only with status unreadable", async () => {
    mockFiles = { "AAPL.5m.json": null };
    const liveBars = makeBars([100, 200]);
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL", "5m", false, liveBars, (trace) => { captured = trace; });
    expect(result).toEqual(liveBars);
    expect(captured.storeReads).toContainEqual(expect.objectContaining({ base: "5m", status: "unreadable" }));
  });

  it("malformed JSON returns live-only with status malformed", async () => {
    mockFiles = { "AAPL.5m.json": "not json {" };
    const liveBars = makeBars([100, 200]);
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL", "5m", false, liveBars, (trace) => { captured = trace; });
    expect(result).toEqual(liveBars);
    expect(captured.storeReads).toContainEqual(expect.objectContaining({ base: "5m", status: "malformed" }));
  });

  it("empty bars array returns status empty", async () => {
    mockFiles = { "AAPL.5m.json": storePayload([]) };
    const liveBars = makeBars([100, 200]);
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL", "5m", false, liveBars, (trace) => { captured = trace; });
    expect(result).toEqual(liveBars);
    expect(captured.storeReads).toContainEqual(expect.objectContaining({ base: "5m", status: "empty" }));
  });
});

describe("withStoredHistory — content identity", () => {
  it("hash equals actual input bytes, no second read", async () => {
    const stored = makeBars(REGULAR_SESSION_EPOCHS.epochs);
    const payload = storePayload(stored);
    mockFiles = { "AAPL.5m.json": payload };
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    await withStoredHistory("AAPL", "5m", false, [], (trace) => { captured = trace; });
    expect(captured.storeReads[0].content_sha256).toBe(SHA256(payload));
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });
});

describe("withStoredHistory — source selection", () => {
  it("Prefers5m for regular4h, falls back to 1h when 5m absent", async () => {
    mockFiles = { "AAPL.1h.json": storePayload(extPayload1h) };
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL", "4h", false, [], (trace) => { captured = trace; });
    expect(captured.origins.map((o) => o[1])).toContain("stored_1h");
    expect(result.length).toBeGreaterThan(0);
  });

  it("Uses 5m when available for regular4h (prefer5m)", async () => {
    mockFiles = {
      "AAPL.5m.json": storePayload(extPayload5m),
      "AAPL.1h.json": storePayload(extPayload1h),
    };
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL", "4h", false, [], (trace) => { captured = trace; });
    expect(captured.origins.map((o) => o[1])).toContain("stored_5m");
    expect(result.length).toBeGreaterThan(0);
  });

  it("live duplicate wins (live over stored for same epoch)", async () => {
    const storedEpoch = REGULAR_SESSION_EPOCHS.open;
    const stored = makeBars([storedEpoch]);
    const live = makeBars([storedEpoch]);
    mockFiles = { "AAPL.5m.json": storePayload(stored) };
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL", "5m", false, live, (trace) => { captured = trace; });
    expect(captured.origins.find((o) => o[0] === storedEpoch)?.[1]).toBe("live_tail");
    expect(result).toHaveLength(1);
  });
});

describe("withStoredHistory — output contract", () => {
  it("returns six-element [epoch,open,high,low,close,vol] bars", async () => {
    mockFiles = { "AAPL.5m.json": storePayload(extPayload5m) };
    const result = await withStoredHistory("AAPL", "5m", false, []);
    expect(result.length).toBeGreaterThan(0);
    for (const bar of result) {
      expect(bar).toHaveLength(6);
      expect(typeof bar[0]).toBe("number"); // epoch
      expect(typeof bar[1]).toBe("number"); // open
      expect(typeof bar[2]).toBe("number"); // high
      expect(typeof bar[3]).toBe("number"); // low
      expect(typeof bar[4]).toBe("number"); // close
      expect(typeof bar[5]).toBe("number"); // vol
    }
  });

  it("output is ascending unique epochs", async () => {
    mockFiles = { "AAPL.5m.json": storePayload(extPayload5m) };
    const result = await withStoredHistory("AAPL", "5m", false, []);
    const epochs = result.map((b: Bar6) => b[0]);
    for (let i = 1; i < epochs.length; i++) {
      expect(epochs[i]).toBeGreaterThan(epochs[i - 1]);
    }
    const unique = new Set(epochs);
    expect(unique.size).toBe(epochs.length);
  });

  it("caps at 20000 bars", async () => {
    const manyBars: Bar6[] = Array.from({ length: 25000 }, (_, i) =>
      [REGULAR_SESSION_EPOCHS.open + i * 300, 100, 101, 99, 100.5, 1000] as Bar6,
    );
    mockFiles = { "AAPL.5m.json": storePayload(manyBars) };
    const result = await withStoredHistory("AAPL", "5m", false, []);
    expect(result.length).toBeLessThanOrEqual(20000);
  });

  it("truncated result origins exactly match retained bars", async () => {
    const manyBars: Bar6[] = Array.from({ length: 100 }, (_, i) =>
      [REGULAR_SESSION_EPOCHS.open + i * 300, 100, 101, 99, 100.5, 1000] as Bar6,
    );
    mockFiles = { "AAPL.5m.json": storePayload(manyBars) };
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL", "5m", false, [], (t) => { captured = t; });
    const resultEpochs = new Set(result.map((b: Bar6) => b[0]));
    for (const [epoch, origin] of captured.origins) {
      if (resultEpochs.has(epoch)) {
        expect(["stored_5m", "stored_1h", "live_tail"]).toContain(origin);
      }
    }
  });
});

describe("withStoredHistory — nonUS / sub5m", () => {
  it("non-US symbol returns live-only", async () => {
    mockFiles = {};
    const liveBars = makeBars([100, 200]);
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL.HK", "5m", false, liveBars, (trace) => { captured = trace; });
    expect(result).toEqual(liveBars);
    expect(captured.storeReads).toHaveLength(0);
  });

  it("sub-5m timeframe returns live-only", async () => {
    mockFiles = {};
    const liveBars = makeBars([100, 200]);
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    const result = await withStoredHistory("AAPL", "1m", false, liveBars, (trace) => { captured = trace; });
    expect(result).toEqual(liveBars);
    expect(captured.storeReads).toHaveLength(0);
  });
});

describe("withStoredHistory — no capture callback", () => {
  it("returns bars without error when no capture provided", async () => {
    mockFiles = { "AAPL.5m.json": storePayload(extPayload5m) };
    const result = await withStoredHistory("AAPL", "5m", false, []);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("withStoredHistory — extended session", () => {
  it("extended=true uses extended session filtering", async () => {
    mockFiles = { "AAPL.5m.json": storePayload(extPayload5m) };
    let captured: IntradayAssemblyTrace = { origins: [], storeReads: [] };
    await withStoredHistory("AAPL", "5m", true, [], (t) => { captured = t; });
    expect(captured.origins.some((o) => o[1] === "stored_5m")).toBe(true);
  });
});
