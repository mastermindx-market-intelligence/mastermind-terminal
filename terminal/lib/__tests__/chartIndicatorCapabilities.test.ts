import { describe, expect, it } from "vitest";
import { IND_ORDER } from "../indicators";
import { translate, type IndicatorSpec } from "../chartBus";
import * as native from "../chartIndicatorParams";
import { getSuiteMeta, SUITE_ORDER, suiteDefaults } from "../suites/meta";

// This tests the metadata used by the existing command validator, not another catalog.
function discovery(keys: readonly string[], settings: Record<string, Record<string, unknown>> = {}) {
  const fn = (native as Record<string, unknown>).describeNativeSuiteCapabilities;
  expect(fn, "Brain must be able to discover actual native settings").toBeTypeOf("function");
  return (fn as (keys: readonly string[], settings: Record<string, Record<string, unknown>>) => any)(keys, settings);
}
function enableOnly(suite: string, module: string) {
  const params = suiteDefaults(suite);
  for (const m of getSuiteMeta(suite)!.modules) params[`${m.key}.on`] = m.key === module;
  return { [suite]: params };
}

describe("native indicator capability descriptions", () => {
  it("adds no packet for classic indicators or unknown suite names", () => {
    expect(discovery(["ema", "unknown", "constructor"])).toBeNull();
  });
  it("describes Smart S/R using canonical names, defaults and scalar types", () => {
    const packet = discovery(["structure"], enableOnly("structure", "sr"));
    expect(packet.schema).toBe("chart.native_parameters.v1");
    expect(packet.authority).toBe("configuration_description_only");
    expect(packet.semantics).toMatchObject({ membership: "replace_set", parameters: "merge_existing", entitlements: "renderer_enforced" });
    const sr = packet.modules.find((m: any) => m.id === "structure/sr");
    expect(sr).toMatchObject({ suite: "structure", module: "sr", tier: "essential" });
    expect(sr.parameters["sr.on"]).toEqual({ type: "boolean", default: false });
    expect(sr.parameters["sr.bufferZone"]).toEqual({ type: "boolean", default: false });
    expect(sr.parameters["sr.sensitivity"]).toEqual({ type: "string", enum: ["high", "medium", "low"], default: "medium" });
    expect(sr.parameters["sr.minTouches"]).toEqual({ type: "number", minimum: 2, maximum: 5, default: 2 });
    expect(sr.additional_parameters).toBe(false);
  });
  it("does not recast numeric UI increments as quantization rules", () => {
    const packet = discovery(["trend"], enableOnly("trend", "te"));
    const te = packet.modules.find((m: any) => m.id === "trend/te");
    expect(te.parameters["te.tpFixed1"].default).toBe(2);
    expect(te.parameters["te.tpFixed1"]).not.toHaveProperty("multipleOf");
    expect(native.readNativeSuiteParams("trend", { "te.tpFixed1": 4.25 }).ok).toBe(true);
  });
  it("prioritizes the active module and names whole omitted modules within 4096 UTF-8 bytes", () => {
    const packet = discovery(SUITE_ORDER, enableOnly("structure", "sr"));
    expect(packet.modules[0].id).toBe("structure/sr");
    expect(new TextEncoder().encode(JSON.stringify(packet)).byteLength).toBeLessThanOrEqual(4096);
    const ids = [...packet.modules.map((m: any) => m.id), ...packet.omitted_modules];
    const expected = SUITE_ORDER.flatMap(k => getSuiteMeta(k)!.modules.map(m => `${k}/${m.key}`));
    expect(ids.sort()).toEqual(expected.sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(packet.status).toBe(packet.omitted_modules.length ? "partial" : "complete");
  });
  it("normalizes suite membership without copying current settings or arbitrary input into descriptions", () => {
    const settings = enableOnly("structure", "sr");
    (settings.structure as Record<string, unknown>).privateNote = "do not expose";
    expect(discovery(["structure", "structure", "invented"], settings)).toEqual(discovery(["structure"], settings));
    expect(JSON.stringify(discovery(["structure"], settings))).not.toContain("do not expose");
    expect(JSON.stringify(discovery(["structure"], settings))).not.toContain("invented");
  });
  it("publishes only values accepted by the native validator for every catalog module", () => {
    for (const suite of SUITE_ORDER) {
      for (const module of getSuiteMeta(suite)!.modules) {
        const packet = discovery([suite], enableOnly(suite, module.key));
        const row = packet.modules.find((m: any) => m.id === `${suite}/${module.key}`);
        expect(row, `${suite}/${module.key} should fit when selected`).toBeDefined();
        for (const [key, field] of Object.entries(row.parameters) as Array<[string, any]>) {
          expect(native.readNativeSuiteParams(suite, { [key]: field.default }).ok, key).toBe(true);
          for (const option of field.enum ?? []) expect(native.readNativeSuiteParams(suite, { [key]: option }).ok, key).toBe(true);
        }
        for (const key of row.unsupported_parameters) expect(row.parameters).not.toHaveProperty(key);
      }
    }
  });
  it("does not allow a consumer to mutate canonical metadata through a returned enum", () => {
    const settings = enableOnly("structure", "sr");
    const first = discovery(["structure"], settings);
    first.modules.find((m: any) => m.id === "structure/sr").parameters["sr.sensitivity"].enum.push("invented");
    const second = discovery(["structure"], settings);
    expect(second.modules.find((m: any) => m.id === "structure/sr").parameters["sr.sensitivity"].enum).toEqual(["high", "medium", "low"]);
  });
  it("bounds actual UTF-8 bytes and omits rather than cuts a large module", () => {
    const module = getSuiteMeta("structure")!.modules.find(m => m.key === "sr")!;
    const original = module.label;
    try {
      module.label = "研究".repeat(1000);
      const packet = discovery(["structure"], enableOnly("structure", "sr"));
      expect(new TextEncoder().encode(JSON.stringify(packet)).byteLength).toBeLessThanOrEqual(4096);
      expect(packet.omitted_modules).toContain("structure/sr");
      expect(packet.modules.some((m: any) => m.id === "structure/sr")).toBe(false);
    } finally { module.label = original; }
  });
});

describe("built-in settings describe the values the renderer actually consumes", () => {
  it("names real RSI and moving-average inputs and keeps instance identity separate from type", () => {
    const packet = native.describeBuiltinIndicatorCapabilities(["ema", "rsi", "rsi__pair01"])!;
    expect(packet.instances).toContainEqual({ name: "rsi__pair01", type: "rsi" });
    expect(packet.types.filter(row => row.name === "rsi")).toHaveLength(1);
    expect(packet.types.find(row => row.name === "rsi")?.parameters.length).toEqual({
      type: "number", default: 14, minimum: 2, maximum: 100,
    });
    expect(packet.types.find(row => row.name === "ema")?.parameters.ma1Len.default).toBe(20);
    expect(packet.types.find(row => row.name === "rsi")?.parameters).not.toHaveProperty("len");
  });
  it("accepts actual scalar controls, including false and translucent colors", () => {
    const params = { length: 21, showLevels: false, col: "rgba(77,130,255,0.5)", width: 1.2 };
    expect(native.readBuiltinIndicatorParams("rsi", params)).toEqual({ ok: true, params });
    expect(native.readBuiltinIndicatorParams("rsi__pair01", { length: 7 })).toEqual({ ok: true, params: { length: 7 } });
    expect(native.readBuiltinIndicatorParams("ema", { ma1Len: 37, ma2On: false }).ok).toBe(true);
  });
  it.each([
    { len: 21 }, { period: 21 }, { length: 1 }, { length: 101 }, { length: "21" },
    { length: NaN }, { length: Infinity }, { showLevels: 0 }, { col: "not a color" },
    { col: "rgba(300,0,0,0.5)" }, { col: "rgba(10,20,30,2)" }, { col: "url(https://example.com)" },
  ])("refuses an unknown, ignored or malformed requested setting: %j", params => {
    expect(native.readBuiltinIndicatorParams("rsi", params).ok).toBe(false);
  });
  it("does not evaluate accessors or accept prototype keys", () => {
    let called = false;
    const params = Object.defineProperty({}, "length", { enumerable: true, get() { called = true; return 21; } });
    expect(native.readBuiltinIndicatorParams("rsi", params).ok).toBe(false);
    expect(called).toBe(false);
    expect(native.readBuiltinIndicatorParams("rsi", JSON.parse('{"__proto__":21}')).ok).toBe(false);
  });
  it("uses the same metadata for every advertised default and honors its own byte bound", () => {
    for (const key of IND_ORDER) {
      const packet = native.describeBuiltinIndicatorCapabilities([key])!;
      expect(new TextEncoder().encode(JSON.stringify(packet)).byteLength).toBeLessThanOrEqual(4096);
      for (const row of packet.types) for (const [name, schema] of Object.entries(row.parameters))
        expect(native.readBuiltinIndicatorParams(key, { [name]: schema.default }).ok, key + "." + name).toBe(true);
    }
    const packet = native.describeBuiltinIndicatorCapabilities(IND_ORDER)!;
    expect(new TextEncoder().encode(JSON.stringify(packet)).byteLength).toBeLessThanOrEqual(4096);
    expect([...packet.types.map(row => row.name), ...packet.omitted_types].sort()).toEqual([...IND_ORDER].sort());
  });
  it("rejects a typo atomically in both patch and replacement while preserving old unmentioned data", () => {
    const current: IndicatorSpec[] = [{ name: "rsi", params: { length: 14, legacyNote: "keep" } }, { name: "rsi__pair01", params: { length: 7 } }];
    const caps = { tfs: ["D"], indicators: ["rsi", "rsi__pair01", "bb"] };
    for (const mode of ["patch", "replace"]) {
      const result = translate({ on: true, v: 2, batch_id: "bad-setting", seq: 0, op: "chart.set_indicators",
        args: { mode, indicators: [{ name: "bb", params: { length: 25 } }, { name: "rsi", params: { len: 21 } }] } }, caps, current);
      expect(result).toMatchObject({ ok: false, error: "unknown_indicator_setting" });
      expect(result).not.toHaveProperty("setIndicators");
    }
    const result = translate({ on: true, v: 2, batch_id: "good-setting", seq: 0, op: "chart.set_indicators",
      args: { mode: "patch", indicators: [{ name: "rsi", params: { length: 21 } }] } }, caps, current);
    expect(result).toMatchObject({ ok: true, setIndicators: [
      { name: "rsi", params: { length: 21, legacyNote: "keep" } }, current[1],
    ] });
    expect(current[0].params?.length).toBe(14);
  });
  it("refuses adding a primary that would displace a rendered sibling, and permits an explicit slot removal", () => {
    const current = ["aaaa", "bbbb", "cccc", "dddd"].map(token => ({ name: "rsi__" + token, params: { length: 7 } }));
    const caps = { tfs: ["D"], indicators: ["rsi", ...current.map(spec => spec.name)] };
    const command = { on: true as const, v: 2 as const, batch_id: "slots", seq: 0, op: "chart.set_indicators" as const,
      args: { mode: "patch", indicators: [{ name: "rsi", params: { length: 21 } }] } };
    expect(translate(command, caps, current)).toMatchObject({ ok: false, error: "indicator_instance_limit" });
    expect(translate({ ...command, args: { ...command.args, remove: ["rsi__dddd"] } }, caps, current)).toMatchObject({
      ok: true, setIndicators: [...current.slice(0, 3), { name: "rsi", params: { length: 21 } }],
    });
  });
});
