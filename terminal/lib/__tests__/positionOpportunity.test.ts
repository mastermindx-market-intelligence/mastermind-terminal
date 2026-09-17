import { describe, expect, it } from "vitest";
import * as settings from "../drawing-engine/settings";
import type { Pt } from "../drawings";

type Opportunity = { originalR: number | null; remainingR: number | null; state: string; referencePrice: number | null };
const points = (entry = 2.90, target = 3.88, stop = 2.55): Pt[] => [entry, target, stop].map((p, i) => ({ t: String(i), p }));
function calculate(kind: "longposition" | "shortposition", p: Pt[], reference?: number | null): Opportunity {
  const fn = (settings as unknown as Record<string, unknown>).calculatePositionOpportunity;
  expect(fn, "existing drawing math must expose inspectable remaining opportunity").toBeTypeOf("function");
  return (fn as (kind: string, points: Pt[], ref?: number | null) => Opportunity)(kind, p, reference);
}

describe("position opportunity uses original geometry and last chart price separately", () => {
  it("does not advertise the screenshot's 2.8R as the 1.18R still available", () => {
    const r = calculate("longposition", points(), 3.16);
    expect(r.originalR).toBeCloseTo(2.8, 12);
    expect(r.remainingR).toBeCloseTo(.72 / .61, 12);
    expect(r.state).toBe("after_entry");
    expect(r.referencePrice).toBe(3.16);
  });
  it("mirrors the same geometry for a short without absolute-value direction mistakes", () => {
    const r = calculate("shortposition", points(10, 8, 11), 9);
    expect(r.originalR).toBe(2);
    expect(r.remainingR).toBe(.5);
    expect(r.state).toBe("after_entry");
  });
  it("identifies a reference before or at entry without calling it an actual fill", () => {
    expect(calculate("longposition", points(), 2.8).state).toBe("before_entry");
    expect(calculate("shortposition", points(10, 8, 11), 10.5).state).toBe("before_entry");
    const r = calculate("longposition", points(), 2.90);
    expect(r.state).toBe("at_entry");
    expect(r.remainingR).toBeCloseTo(r.originalR!, 12);
  });
  it.each([3.88, 4.1])("does not manufacture remaining reward beyond the long target at %s", price => {
    const r = calculate("longposition", points(), price);
    expect(r.originalR).toBeCloseTo(2.8, 12);
    expect(r).toMatchObject({ remainingR: null, state: "at_target" });
  });
  it.each([2.55, 2.4])("does not divide by zero or call a past stop an outcome at %s", price => {
    expect(calculate("longposition", points(), price)).toMatchObject({ remainingR: null, state: "beyond_stop" });
  });
  it("handles the short-side boundaries in the correct order", () => {
    expect(calculate("shortposition", points(10, 8, 11), 7).state).toBe("at_target");
    expect(calculate("shortposition", points(10, 8, 11), 12).state).toBe("beyond_stop");
  });
  it.each([undefined, null, NaN, Infinity, 0, -1])("retains planned R but no remaining number for missing/invalid reference %s", ref => {
    const r = calculate("longposition", points(), ref);
    expect(r.originalR).toBeCloseTo(2.8, 12);
    expect(r).toMatchObject({ state: "missing_reference", remainingR: null, referencePrice: null });
  });
  it.each([[10, 9, 8], [10, 12, 11], [10, 12, 10], [0, 2, -1], [NaN, 12, 9]])("refuses invalid long geometry %s", (e, t, s) => {
    expect(calculate("longposition", points(e, t, s), 10)).toMatchObject({ originalR: null, remainingR: null, state: "invalid_geometry" });
  });
  it("does not lose low-priced crypto precision", () => {
    const r = calculate("longposition", points(.000029, .0000388, .0000255), .0000316);
    expect(r.originalR).toBeCloseTo(2.8, 12);
    expect(r.remainingR).toBeCloseTo(.72 / .61, 12);
  });
  it("keeps original drawings and their fixed-risk sizing untouched", () => {
    const p = points(); const before = JSON.stringify(p);
    const old = settings.calculatePositionMetrics(p, { accountSize: 25000, riskPercent: 2 });
    calculate("longposition", p, 3.16);
    expect(JSON.stringify(p)).toBe(before);
    expect(settings.calculatePositionMetrics(p, { accountSize: 25000, riskPercent: 2 })).toEqual(old);
  });
});
