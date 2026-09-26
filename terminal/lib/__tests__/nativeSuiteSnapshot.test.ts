import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { suiteDefaults, getSuiteMeta, SUITE_ORDER } from "../suites/meta";
import { ensureSuiteRuntime } from "../suites/compute";
import { computeSuite, resolveSuiteColors } from "../indicator-canvas/host";
import * as kernelHost from "../indicator-canvas/host";
import { suiteEventTiming } from "../suiteAlerts";

const modulePath = resolve(process.cwd(), "../ingest/native_suite_snapshot.ts");
async function api() {
  expect(existsSync(modulePath), "native research snapshot implementation is missing").toBe(true);
  return await vi.importActual<any>(modulePath);
}
const HOST = { tier: "pro", code_sha256: "a".repeat(64) };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function request(suite = "structure", count = 420) {
  const params = suiteDefaults(suite);
  for (const m of getSuiteMeta(suite)!.modules) params[`${m.key}.on`] = false;
  if (suite === "structure") Object.assign(params, { "sr.on": true, "sr.sensitivity": "low", "sr.minTouches": 2 });
  if (suite === "rsix") Object.assign(params, { "eng.on": true, "eng.len": 12, "eng.source": "hl2" });
  return { schema: "chart.native_snapshot_request.v1", suite, symbol: "SYNTHETIC",
    timeframe: "D", data_revision: "synthetic-fixture-v1", bar_state: "declared_closed", params,
    bars: Array.from({ length: count }, (_, i) => {
      const c = 100 + i * 0.018 + Math.sin(i / 6) * 7 + Math.sin(i / 31) * 3;
      const o = c - Math.sin(i / 3);
      return { time: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10), o, h: Math.max(o, c) + 1.2, l: Math.min(o, c) - 1.2, c, v: 100000 + i * 31 };
    }) };
}
describe("native snapshot real-kernel research consumer", () => {
  it.each(["structure", "rsix"])("matches real manual %s render output", async suite => {
    const { nativeSuiteSnapshot, stableNativeJson } = await api(); const q = request(suite);
    const before = JSON.stringify(q); const result = await nativeSuiteSnapshot(q, HOST);
    expect(result.status).toBe("observed");
    const def = (await ensureSuiteRuntime(suite))!;
    const manual = computeSuite(def, q.params, { bars: q.bars, symbol: q.symbol, tf: "D", isIntraday: false, lang: "en" }, "pro", resolveSuiteColors());
    expect(result.bundle).toEqual(JSON.parse(stableNativeJson(manual)));
    expect(result.fingerprints.result_sha256).toBe(sha(stableNativeJson(manual)));
    expect(JSON.stringify(q)).toBe(before);
    expect(result.basis).toMatchObject({ scope: "native_renderer_bundle", module_health: "unknown", warmup: "unknown", knowledge_time: null, closed_bars: "caller_asserted", predictive_validation: false });
    expect(result.bundle.prims.length).toBeGreaterThan(0);
  });
  it.each(SUITE_ORDER)("does not force-enable %s or override the host tier", async suite => {
    const { nativeSuiteSnapshot } = await api(); const q = request(suite);
    for (const m of getSuiteMeta(suite)!.modules) q.params[`${m.key}.on`] = false;
    const result = await nativeSuiteSnapshot(q, HOST);
    expect(result.status).toBe("observed"); expect(result.bundle.prims).toEqual([]); expect(result.bundle.events).toEqual([]);
  });
  it("retains locked modules at free host tier", async () => {
    const { nativeSuiteSnapshot } = await api(); const result = await nativeSuiteSnapshot(request(), { ...HOST, tier: "free" });
    expect(result.status).toBe("observed"); expect(result.bundle.prims).toEqual([]);
    expect(result.bundle.lockedModules.some((x: any) => x.key === "sr")).toBe(true);
  });
  it("has stable settings fingerprints and detects corrected history", async () => {
    const { nativeSuiteSnapshot } = await api(); const q = request();
    const first = await nativeSuiteSnapshot(q, HOST);
    const reordered = { ...q, params: Object.fromEntries(Object.entries(q.params).reverse()) };
    expect((await nativeSuiteSnapshot(reordered, HOST)).fingerprints).toEqual(first.fingerprints);
    q.bars[10].v += 1;
    const next = await nativeSuiteSnapshot(q, HOST);
    expect(next.fingerprints.input_sha256).not.toBe(first.fingerprints.input_sha256);
    expect(next.fingerprints.settings_sha256).toBe(first.fingerprints.settings_sha256);
  });
  it("detaches output from shared memoized native objects", async () => {
    const { nativeSuiteSnapshot } = await api(); const q = request();
    const first = await nativeSuiteSnapshot(q, HOST); const count = first.bundle.prims.length;
    first.bundle.prims.length = 0;
    const second = await nativeSuiteSnapshot(q, HOST);
    expect(second.bundle.prims).toHaveLength(count);
  });
  const invalid: Array<[string, (q: any) => void]> = [
    ["unknown suite", q => q.suite = "imagined"], ["intraday", q => q.timeframe = "15m"],
    ["open bar", q => q.bar_state = "live"], ["invalid calendar", q => q.bars[0].time = "2024-02-30"],
    ["out of order", q => q.bars.reverse()], ["duplicate", q => q.bars[1].time = q.bars[0].time],
    ["string price", q => q.bars[0].c = "100"], ["nonfinite", q => q.bars[0].v = Infinity],
    ["negative volume", q => q.bars[0].v = -1], ["bad OHLC", q => q.bars[0].h = 1],
    ["extra field", q => q.url = "https://example.invalid/"], ["tier injection", q => q.tier = "pro"],
    ["code injection", q => q.code_sha256 = "b".repeat(64)], ["empty", q => q.bars = []],
    ["too many", q => q.bars = Array(2001).fill(q.bars[0])], ["invalid parameter", q => q.params["sr.on"] = "true"],
  ];
  it.each(invalid)("refuses %s rather than fabricating a result", async (_, alter) => {
    const { nativeSuiteSnapshot } = await api(); const q = request(); alter(q);
    const result = await nativeSuiteSnapshot(q, HOST); expect(result.status).toBe("refused"); expect(result.bundle).toBeUndefined();
  });
  it.each([{}, { ...HOST, tier: "admin" }, { ...HOST, code_sha256: "unverified" }])("rejects an unbound host context", async host => {
    const { nativeSuiteSnapshot } = await api(); expect((await nativeSuiteSnapshot(request(), host)).status).toBe("refused");
  });
  it("serializes missing visual numbers as disclosed nulls, never zero", async () => {
    const { stableNativeJson } = await api();
    expect(JSON.parse(stableNativeJson({ x: new Float64Array([1, NaN]), m: new Map([["z", Infinity]]) }))).toEqual({ m: { z: null }, x: [1, null] });
  });
});

describe("native research snapshot evidence boundaries", () => {
  it("uses locale-independent key ordering for fingerprints", async () => {
    const { stableNativeJson } = await api();
    expect(stableNativeJson({ z: 1, "ä": 2, a: 3 })).toBe('{"a":3,"z":1,"ä":2}');
  });
  it("preserves the canonical event confirmation clock without claiming arrival time", async () => {
    const { nativeSuiteSnapshot } = await api(); const q = request();
    const out = await nativeSuiteSnapshot(q, HOST);
    const times = q.bars.map(row => Date.parse(row.time + "T00:00:00Z") / 1000);
    expect(out.bundle.events.length).toBeGreaterThan(0);
    expect(out.event_timing).toEqual(out.bundle.events.map((e: any, event_index: number) => ({ event_index, timing: suiteEventTiming(e, times) })));
    expect(out.basis.event_time).toBe("source_bar_identity_not_wall_clock_arrival");
  });
  it("rejects oversized output whole instead of returning truncated evidence", async () => {
    const { nativeSuiteSnapshot } = await api();
    const spy = vi.spyOn(kernelHost, "computeSuite").mockReturnValue({ prims: [], events: [], tables: [], candlePaint: [], lockedModules: [], tooltips: new Map([["large", { id: "large", title: "界".repeat(100000), rows: [] }]]) });
    try { expect(await nativeSuiteSnapshot(request(), HOST)).toMatchObject({ status: "refused", error: "output_too_large" }); }
    finally { spy.mockRestore(); }
  });
  it("reports a host failure rather than a no-signal judgment", async () => {
    const { nativeSuiteSnapshot } = await api(); const spy = vi.spyOn(kernelHost, "computeSuite").mockImplementation(() => { throw new Error("internal detail must not leak"); });
    try { expect(await nativeSuiteSnapshot(request(), HOST)).toEqual({ schema: "chart.native_snapshot.v1", status: "refused", error: "native_observation_failed" }); }
    finally { spy.mockRestore(); }
  });
  it("does not execute request accessors", async () => {
    const { nativeSuiteSnapshot } = await api(); const q = request(); let read = false;
    Object.defineProperty(q, "symbol", { get() { read = true; return "SYNTHETIC"; } });
    expect((await nativeSuiteSnapshot(q, HOST)).status).toBe("refused"); expect(read).toBe(false);
  });
});

// Boundary probes from final direct scrutiny; unknown names must never reach metadata prototypes.
describe("native snapshot inherited-property and revision boundaries", () => {
  it.each(["__proto__", "constructor", "toString"])("returns a typed refusal for inherited suite name %s", async suite => {
    const { nativeSuiteSnapshot } = await api(); const q = request(); q.suite = suite;
    expect(await nativeSuiteSnapshot(q, HOST)).toMatchObject({ status: "refused", error: "unknown_suite" });
  });
  it.each(["revision\n2", "revision\u00002"])("rejects control-bearing input revisions", async revision => {
    const { nativeSuiteSnapshot } = await api(); const q = request(); q.data_revision = revision;
    expect(await nativeSuiteSnapshot(q, HOST)).toMatchObject({ status: "refused", error: "bad_data_revision" });
  });
});
