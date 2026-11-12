import { describe, it, expect } from "vitest";
import { translate, type ChartCommandV2 } from "../chartBus";
import { SUITE_ORDER, suiteDefaults } from "../suites/meta";
import { ensureSuiteRuntime, isSuiteRuntimeLoaded, _resetSuiteRuntime } from "../suites/compute";
import { computeSuite, resolveSuiteColors, type SuiteHostInput } from "../indicator-canvas/host";

const caps = { tfs: ["D"], indicators: ["ema", ...SUITE_ORDER] };
function command(params: unknown, name = "structure"): ChartCommandV2 {
  return { on: true, v: 2, batch_id: "native-settings", seq: 1, op: "chart.set_indicators",
    args: { indicators: [{ name, params }] } };
}
function expectRejected(params: unknown, name = "structure") {
  const result = translate(command(params, name), caps);
  expect(result.ok).toBe(false);
  expect("setIndicators" in result).toBe(false);
}
function bars(): SuiteHostInput["bars"] {
  return Array.from({ length: 420 }, (_, i) => {
    const c = 100 + i * 0.018 + Math.sin(i / 6) * 7 + Math.sin(i / 31) * 3;
    const o = c - Math.sin(i / 3);
    return { time: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
      o, h: Math.max(o, c) + 1.2, l: Math.min(o, c) - 1.2, c, v: 100000 + i * 31 };
  });
}

describe("native suite parameters on the existing Chart Bus", () => {
  it("retains numeric, enum and false boolean values without mutating input", () => {
    const params = { "sr.on": true, "sr.minTouches": 3, "sr.sensitivity": "low", "sr.bufferZone": false, "sr.labels": false };
    const before = structuredClone(params);
    const result = translate(command(params), caps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.setIndicators?.[0].params).toEqual(params);
    expect(params).toEqual(before);
  });
  it.each(SUITE_ORDER)("round-trips the actual %s suite defaults", (suite) => {
    const params = suiteDefaults(suite);
    const result = translate(command(params, suite), caps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.setIndicators?.[0].params).toEqual(params);
  });
  it.each([
    { "sr.sensitivity": "ultra" }, { "sr.bufferZone": "false" }, { "sr.on": 1 },
    { "sr.minTouches": 1 }, { "sr.minTouches": 6 },
    { "sr.minTouches": Number.NaN }, { "sr.minTouches": Number.POSITIVE_INFINITY },
    { "sr.minTouches": null }, { "sr.labels": {} }, { "sr.typo": 3 },
    { "not_a_module.on": true }, { "sr.minTouches": "3" },
  ])("rejects malformed native settings atomically: %j", params => expectRejected(params));
  it.each([null, [], "defaults", 42, true].map(value => ({ value })))("rejects a malformed native parameter map: %j", ({ value }) => expectRejected(value));
  it("does not accept prototype-shaped keys", () => {
    expectRejected(JSON.parse('{"__proto__":{"polluted":true}}'));
    expectRejected({ "constructor.prototype": 2 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("rejects the whole set when a later native entry is invalid", () => {
    const c = command({ "sr.minTouches": 3 });
    c.args = { indicators: [{ name: "ema", params: { len: 21 } }, { name: "structure", params: { "sr.minTouches": "three" } }] };
    const result = translate(c, caps);
    expect(result.ok).toBe(false);
    expect("setIndicators" in result).toBe(false);
  });
  it("accepts omitted native params as an explicit default/preserve-settings request", () => {
    const result = translate(command(undefined), caps);
    expect(result.ok).toBe(true);
  });
  it("treats numeric step as the existing UI increment, not an invented quantization rule", () => {
    const params = { "te.tpFixed1": 2, "te.tpFixed2": 4.25 };
    const result = translate(command(params, "trend"), caps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.setIndicators?.[0].params).toEqual(params);
  });
  it("preserves the existing classic numeric configuration", () => {
    const result = translate(command({ len: 21 }, "ema"), caps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.setIndicators).toEqual([{ name: "ema", params: { len: 21 } }]);
  });
  it("does not admit a suite omitted from the host capability list", () => {
    const result = translate(command({ "sr.on": true }), { tfs: ["D"], indicators: ["ema"] });
    expect(result).toMatchObject({ ok: false, error: "unknown_indicator" });
  });
  it("validates through metadata without loading a suite runtime", () => {
    _resetSuiteRuntime();
    translate(command({ "sr.on": true, "sr.sensitivity": "low" }), caps);
    for (const suite of SUITE_ORDER) expect(isSuiteRuntimeLoaded(suite)).toBe(false);
  });
});

describe("real native kernel configuration parity (synthetic input, no predictive claim)", () => {
  it.each(["structure", "rsix"])("matches manual %s settings on identical bars", async suite => {
    const def = await ensureSuiteRuntime(suite);
    expect(def).not.toBeNull();
    if (!def) return;
    const params = suiteDefaults(suite);
    for (const module of def.modules) params[`${module.key}.on`] = false;
    if (suite === "structure") Object.assign(params, { "sr.on": true, "sr.sensitivity": "low", "sr.minTouches": 2, "sr.bufferZone": false, "sr.labels": false });
    else Object.assign(params, { "eng.on": true, "eng.source": "hl2", "eng.len": 12, "eng.smooth": false, "eng.smoothType": "wma" });
    const result = translate(command(params, suite), caps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const input: SuiteHostInput = { bars: bars(), tf: "D", symbol: "SYNTHETIC", isIntraday: false, lang: "en" };
    const colors = resolveSuiteColors();
    const manual = computeSuite(def, params, input, "pro", colors);
    const fromCommand = computeSuite(def, result.setIndicators?.[0].params, input, "pro", colors);
    expect(manual.prims.length).toBeGreaterThan(0);
    expect(fromCommand.prims).toEqual(manual.prims);
    expect(fromCommand.events).toEqual(manual.events);
    expect(fromCommand.tables).toEqual(manual.tables);
    expect(fromCommand.candlePaint).toEqual(manual.candlePaint);
  });
  it("keeps the native entitlement gate in force", async () => {
    const def = await ensureSuiteRuntime("structure");
    expect(def).not.toBeNull();
    if (!def) return;
    const params = suiteDefaults("structure");
    for (const m of def.modules) params[`${m.key}.on`] = false;
    params["sr.on"] = true;
    const result = translate(command(params), caps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const input: SuiteHostInput = { bars: bars(), tf: "D", symbol: "SYNTHETIC", isIntraday: false, lang: "en" };
    const out = computeSuite(def, result.setIndicators?.[0].params, input, "free", resolveSuiteColors());
    expect(out.lockedModules.some(m => m.key === "sr")).toBe(true);
    expect(out.prims).toEqual([]);
  });
});
