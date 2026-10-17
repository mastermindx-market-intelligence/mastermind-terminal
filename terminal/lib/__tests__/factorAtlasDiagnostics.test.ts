import { describe, expect, it } from "vitest";
import original from "./fixtures/factorAtlasNativeSynthetic.json";
import { prepareFactorHistory, formatFactorShare } from "../factorAtlasHistory";

const fixture = () => structuredClone(original);
const options = { basketId: "mag7", audience: "synthetic-preview" as const };
const project = (raw: unknown) => prepareFactorHistory(raw, options);
function valid() {
  const r = project(fixture());
  expect(r.kind).toBe("synthetic-preview");
  expect(r.history).not.toBeNull();
  return r.history!;
}

describe("native S1 coverage/breadth/concentration diagnostics", () => {
  it.each([[0, "0.0%"], [1/3, "33.3%"], [0.5, "50.0%"], [1, "100.0%"],
    [null, "—"], [Infinity, "—"], [-0.25, "—"]])(
    "formats unsigned participation and coverage fraction %s as %s", (value, expected) => {
      expect(formatFactorShare(value)).toBe(expected);
    });
  it("preserves interval-native measurement and actual denominators without recomputing", () => {
    const h = valid();
    expect(h.points[0].diagnostics).toBeNull();
    const d = h.points[1].diagnostics;
    expect(d?.coverage).toMatchObject({ validCount:3, eligibleCount:3, countFraction:1,
      weightFraction:1, weightBasis:"declared_start_weights" });
    expect(d?.breadth).toMatchObject({ status:"READY", validCount:3, eligibleCount:3,
      advanceFraction:1/3 });
    expect(d?.concentration).toMatchObject({ basis:"end_of_interval_security_weights",
      hhi:0.375, largestWeight:0.5, effectiveN:2.6666666666666665,
      top5Weight:1, securityCount:3 });
  });
  it("rejects a weighted-coverage number outside the unit interval", () => {
    const d=fixture();d.points[0].coverage.weight=1.2;
    expect(project(d).history).toBeNull();
  });
  it("rejects a count-coverage number contradictory to its native denominator", () => {
    const d=fixture();d.points[0].coverage.count=0.5;
    expect(project(d).history).toBeNull();
  });
  it("rejects valid members greater than eligible members", () => {
    const d=fixture();d.points[0].coverage.valid_count=4;
    expect(project(d).history).toBeNull();
  });
  it("rejects a declared-weight basis that misrepresents drifted holdings", () => {
    const d=fixture();d.points[0].coverage.weight_basis="end_of_interval_security_weights";
    expect(project(d).history).toBeNull();
  });
  it("rejects non-finite concentration and preserves the separate HHI ratio", () => {
    const d=fixture();d.points[0].concentration!.hhi=Infinity;
    expect(project(d).history).toBeNull();
  });
  it("refuses breadth denominators that disagree with the same source interval coverage", () => {
    const d=fixture();d.points[0].breadth.eligible_count=50;
    expect(project(d).history).toBeNull();
  });
  it("refuses effective N that contradicts source HHI", () => {
    const d=fixture();d.points[0].concentration!.effective_n=2.1;
    expect(project(d).history).toBeNull();
  });
  it("refuses zero HHI for a nonempty concentration object", () => {
    const d=fixture();d.points[0].concentration!.hhi=0;
    expect(project(d).history).toBeNull();
  });
  it("rejects an unsupported concentration weight basis", () => {
    const d=fixture();d.points[0].concentration!.basis="equal_rebalanced_daily";
    expect(project(d).history).toBeNull();
  });
  it("rejects impossible effective security count", () => {
    const d=fixture();d.points[0].concentration!.effective_n=10;
    expect(project(d).history).toBeNull();
  });
  it("rejects unsupported breadth readiness", () => {
    const d=fixture();d.points[0].breadth.status="UNKNOWN";
    expect(project(d).history).toBeNull();
  });
  it("rejects a READY breadth point with no finite participation fraction", () => {
    const d=fixture();Object.assign(d.points[0].breadth,{advance_fraction:null});
    expect(project(d).history).toBeNull();
  });
  it("accepts nullable native concentration instead of inventing an equal-weight default", () => {
    const d=fixture();Object.assign(d.points[0],{concentration:null});
    const p=project(d);
    expect(p.history?.points[1].diagnostics?.concentration).toBeNull();
  });
  it("withholds misleading breadth percentages when its native status is only PARTIAL", () => {
    const d=fixture();d.points[0].breadth.status="PARTIAL";
    const p=project(d);
    expect(p.history?.points[1].diagnostics?.breadth).toMatchObject({
      status:"PARTIAL", advanceFraction:null, eligibleCount:3, validCount:3
    });
  });
  it("does not calculate diagnostics for a missing held valuation", () => {
    const d=fixture();d.status="PARTIAL";
    // A missing final observation is still a valid partial source. Breaking the
    // first interval while retaining a later NAV correctly rejects the whole
    // source as a forbidden broken-chain reconnection.
    Object.assign(d.points[1],{ index_level:null,return:null,reasons:["MISSING_OR_INVALID_HELD_PRICE"] });
    const p=project(d);
    expect(p.history?.points[2].diagnostics).toBeNull();
    expect(p.history?.points[2].level).toBeNull();
  });
});
