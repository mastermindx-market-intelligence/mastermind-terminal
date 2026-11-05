import { describe, expect, it } from "vitest";
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
