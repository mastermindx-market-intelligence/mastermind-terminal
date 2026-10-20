import { describe, expect, it } from "vitest";
import { exposureNodes, type ExposureNodeInput } from "../marketStructure";

const cancellation: ExposureNodeInput[] = [
  { strike: 100, netMn: 1, callMn: 10, putMn: -9 },
  { strike: 110, netMn: 5, callMn: 6, putMn: -1 },
];
describe("selected exposure population", () => {
  it("separates cancelling gross concentration from signed-net concentration", () => {
    const s = exposureNodes(cancellation, 105, 10);
    expect(s.grossLeader?.strike).toBe(100);
    expect(s.netLeader?.strike).toBe(110);
    expect(s.grossTotalMn).toBe(26);
    expect(s.netTotalMn).toBe(6);
    expect(s.grossLeader?.grossShare).toBe(19 / 26);
    expect(s.population).toBe("window");
    expect(exposureNodes(cancellation, 105).population).toBe("unknown");
  });
  it("withholds missing-side ranking without suppressing qualified net", () => {
    const s = exposureNodes([{ ...cancellation[0], putMn: null }, cancellation[1]], 105);
    expect(s.grossKnown).toBe(1);
    expect(s.grossTotalMn).toBeNull();
    expect(s.grossLeader).toBeNull();
    expect(s.nodes.map((n) => n.grossShare)).toEqual([null, null]);
    expect(s.netLeader?.strike).toBe(110);
    const missingNet = exposureNodes([{ ...cancellation[0], netMn: undefined }, cancellation[1]], 105);
    expect(missingNet.netTotalMn).toBeNull();
    expect(missingNet.netLeader).toBeNull();
    expect(missingNet.grossLeader?.strike).toBe(100);
  });
  it("keeps measured zero distinct from absent and tiny nonzero", () => {
    const zero = exposureNodes([{ strike: 100, netMn: -0, callMn: 0, putMn: 0 }], 100, 1);
    expect(zero.netTotalMn).toBe(0); expect(zero.grossTotalMn).toBe(0);
    expect(zero.netLeader).toBeNull(); expect(zero.grossLeader).toBeNull();
    expect(zero.nodes[0].grossShare).toBeNull();
    expect(exposureNodes([], 100).netTotalMn).toBeNull();
    expect(exposureNodes(null, 100).netTotalMn).toBeNull();
    expect(exposureNodes([{ strike: 100, netMn: 1e-12 }], 100).netLeader?.netMn).toBe(1e-12);
  });
  it("labels a measured subset and preserves unknown nodes and share denominators", () => {
    const rows = [{ strike: 100, netMn: 3, grossMn: 5 }, { strike: 110, netMn: null, grossMn: null },
      { strike: 120, netMn: -1, grossMn: 3 }];
    expect(exposureNodes(rows, 105).netTotalMn).toBeNull();
    const partial = exposureNodes(rows, 105, null, "covered");
    expect(partial).toMatchObject({ coveredOnly: true, netTotalMn: 2, grossTotalMn: 8,
      netKnown: 2, grossKnown: 2, offered: 3 });
    expect(partial.netLeader?.strike).toBe(100);
    expect(partial.nodes[1]).toEqual({ strike: 110, netMn: null, grossMn: null, grossShare: null });
    expect(partial.nodes[0].grossShare).toBe(5 / 8);
    // The missing contribution can overturn the provisional leader.
    const filled = exposureNodes([rows[0], { strike: 110, netMn: 20, grossMn: 20 }, rows[2]], 105);
    expect(filled.netLeader?.strike).toBe(110);
    expect(filled.coveredOnly).toBeUndefined();
    expect(exposureNodes([rows[1]], 105, null, "covered").netTotalMn).toBeNull();
  });
  it("retains exact ties and resolves nearest spot then lowest strike independent of input order", () => {
    const rows = [100, 110, 120].map((strike) => ({ strike, netMn: -4, callMn: 5, putMn: -1 }));
    const s = exposureNodes(rows, 115, 3);
    expect(s.netLeader?.strike).toBe(110);
    expect(s.netTies).toEqual([100, 110, 120]);
    expect(exposureNodes([...rows].reverse(), 115, 3)).toEqual(s);
    expect(exposureNodes(rows, null).grossLeader?.strike).toBe(100);
    expect(exposureNodes(rows, 119).grossLeader?.strike).toBe(120);
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid strike %s", (strike) => {
    const s = exposureNodes([{ strike, netMn: 2 }], 100);
    expect(s.invalid).toBe(true); expect(s.netLeader).toBeNull();
  });
  it("rejects duplicate economic nodes and numerical overflow", () => {
    expect(exposureNodes([cancellation[0], cancellation[0]], 100).invalid).toBe(true);
    const s = exposureNodes([100, 110].map((strike) => ({ strike, netMn: 1e308, callMn: 1e308, putMn: -1e308 })), 100);
    expect(s.netTotalMn).toBeNull(); expect(s.netLeader).toBeNull();
    expect(s.grossTotalMn).toBeNull(); expect(s.grossLeader).toBeNull();
    expect(exposureNodes([{ strike: 100, netMn: NaN }], 100).netKnown).toBe(0);
  });
  it.each([null, undefined, 1, -1, 2.5, Infinity])("does not invent a full denominator from %s", (n) => {
    expect(exposureNodes(cancellation, 100, n).population).toBe("unknown");
    expect(exposureNodes(cancellation, 100, n).netTotalMn).toBe(6);
  });
});
