import { describe, expect, it } from "vitest";
import * as presets from "../suites/presets";
import { SUITE_DEFS } from "../suites/registry";

type State = { active: Set<string>; hidden: Set<string>; params: Record<string, Record<string, unknown>> };
const initial = (): State => ({ active: new Set(["ema", "macdx", "pine:personal", "cmp:SPY"]), hidden: new Set(["rsix", "suite:rsix/div", "suite:rsix/chan", "unrelated"]), params: {
  rsix: { "eng.len": 21, "eng.smoothLen": 9, "div.on": false, "future.field": { a: 1 } },
  trend: { "te.sensitivity": 8, "te.autoOpt": true }, ema: { len: 120 }, unknown: { keep: true },
} });
const classic = new Set(["ema", "gaps"]);
function apply(s = initial(), id = "reversal-reclaim"): State | null {
  const fn = (presets as unknown as Record<string, unknown>).applyChartWorkflowPreset;
  expect(fn).toBeTypeOf("function");
  return (fn as (id: string, state: State, classic: Set<string>) => State | null)(id, s, classic);
}
function same(a: State, b: State): boolean {
  const fn = (presets as unknown as Record<string, unknown>).sameChartWorkflowState;
  expect(fn).toBeTypeOf("function");
  return (fn as (a: State, b: State) => boolean)(a, b);
}

describe("one workflow composes the existing module owners", () => {
  it("replaces built-ins/suites without deleting scripts or comparisons", () => {
    expect([...apply()!.active].sort()).toEqual(["cmp:SPY", "gaps", "pine:personal", "rsix", "structure", "trend"]);
  });
  it("preserves input objects and non-display calculations", () => {
    const before = initial(), copy = JSON.stringify(before.params), active = [...before.active], hidden = [...before.hidden];
    const after = apply(before)!;
    expect(before.params && JSON.stringify(before.params)).toBe(copy);
    expect([...before.active]).toEqual(active); expect([...before.hidden]).toEqual(hidden);
    expect(after.params.rsix["eng.len"]).toBe(21);
    expect(after.params.trend["te.sensitivity"]).toBe(8);
    expect(after.params.rsix["future.field"]).toEqual({ a: 1 });
    expect(after.params.unknown).toEqual({ keep: true });
  });
  it("explicitly turns historical optimization off and applies only the focused selection", () => {
    const after = apply()!;
    expect(after.params.trend).toMatchObject({ "te.autoOpt": false, "te.on": true, "cp.on": true, "fb.on": false, "vb.on": false, "te.tpMode": "off" });
    expect(after.params.rsix).toMatchObject({ "eng.on": true, "sig.on": true, "div.on": true, "chan.on": false, "mtf.on": false });
    expect(after.params.structure["sfp.showInvalid"]).toBe(true);
  });
  it("restores selected hidden surfaces without deleting unrelated saved visibility", () => {
    const after = apply()!;
    expect(after.hidden.has("rsix")).toBe(false);
    expect(after.hidden.has("suite:rsix/div")).toBe(false);
    expect(after.hidden.has("suite:rsix/chan")).toBe(true);
    expect(after.hidden.has("unrelated")).toBe(true);
  });
  it("declines an unknown recipe instead of clearing a chart", () => { expect(apply(initial(), "not-a-workflow")).toBeNull(); });
  it("references only actual module identities in the existing registry", () => {
    const after = apply()!;
    for (const suite of ["rsix", "trend", "structure"]) {
      const keys = new Set(SUITE_DEFS[suite].modules.map(m => m.key));
      for (const key of Object.keys(after.params[suite]).filter(k => k.endsWith(".on"))) expect(keys.has(key.split(".")[0])).toBe(true);
    }
  });
  it("compares exact applied state for undo, independent of Set insertion order", () => {
    const a = apply()!;
    const b = { active: new Set([...a.active].reverse()), hidden: new Set([...a.hidden].reverse()), params: JSON.parse(JSON.stringify(a.params)) };
    expect(same(a, b)).toBe(true);
    b.params.rsix["eng.len"] = 7;
    expect(same(a, b)).toBe(false);
  });
});
