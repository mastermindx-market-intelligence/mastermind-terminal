import { describe, expect, it } from "vitest";
import { parseFuturesSampleView } from "../futuresSampleView";

// SYNTHETIC shape-only test fixture. No vendor market rows are committed here.
const baseMs = 1791547200000, endMs = baseMs + 60000;
const ns = (ms: number) => (BigInt(ms) * BigInt(1000000)).toString();
const bar = { startNs: ns(baseMs), endNs: ns(endMs), availableAtNs: ns(endMs - 1),
  openTicks: 30000, highTicks: 30001, lowTicks: 30000, closeTicks: 30001,
  total: 5, buy: 3, sell: 2, unknown: 0, deltaKnown: 1, cvdKnown: 1,
  cells: [{ priceTicks: 30000, buy: 3, sell: 2, unknown: 0, total: 5 }] };
function input() {
  return { schema: "terminal.futures_public_sample_view/v1", live: false, synthetic: false, contract: "ESZ6", source: "synthetic unit-test shape",
    availabilityBasis: "vendor_capture_retrospective", referenceDefinition: "diagnostic_sample_window_only",
    gammaAvailability: "not_in_source_sample", subscriberDisplayRights: "not_established", depthSampling: "every_completed_source_event",
    baseMs, lowTick: 29980, highTick: 30020, sourceRawSha256: "a".repeat(64), referenceRawSha256: "b".repeat(64),
    comparison: { compared: 2, exact: 2, mismatches: 0, unmatched: 0, tradeConservation: true },
    framesByCutoff: [[{ endMs, bar: structuredClone(bar), depth: { startNs: bar.startNs, endNs: bar.endNs,
      coverage: "full", coverageFraction: 1, levels: [{ priceTicks: 30000, bidMean: 10, askMean: 0 }] },
      gex: { status: "unavailable", reason: "source_unavailable" } }]] };
}
describe("historical diagnostic bundle boundary", () => {
  it("accepts a complete, disclosed, hash-identified historical shape", () => {
    expect(parseFuturesSampleView(input())?.contract).toBe("ESZ6");
  });
  for (const patch of [{ live: true }, { synthetic: true }, { subscriberDisplayRights: "granted" },
    { gammaAvailability: "live" }, { referenceDefinition: "verified" }, { contract: "ES=F" },
    { sourceRawSha256: "invented" }, { depthSampling: "one_second_samples" }])
    it(`refuses inconsistent provenance ${JSON.stringify(patch)}`, () => expect(parseFuturesSampleView({ ...input(), ...patch })).toBeNull());
  it("does not let a future available record cross the cutoff through rounding", () => {
    const x = input(); x.framesByCutoff[0][0].bar.availableAtNs = (BigInt(ns(endMs)) + BigInt(1)).toString();
    expect(parseFuturesSampleView(x)).toBeNull();
  });
  it("does not accept an arbitrary gamma estimate alongside the real sample", () => {
    const x = input(); x.framesByCutoff[0][0].gex.status = "ok";
    expect(parseFuturesSampleView(x)).toBeNull();
  });
  it("rejects failed comparisons or incomplete execution conservation", () => {
    for (const patch of [{ exact: 1 }, { unmatched: 1 }, { tradeConservation: false }])
      expect(parseFuturesSampleView({ ...input(), comparison: { ...input().comparison, ...patch } })).toBeNull();
  });
  it("enforces volume arithmetic and matching chart/depth time boundaries", () => {
    const a = input(); a.framesByCutoff[0][0].bar.cells[0].total = 10; expect(parseFuturesSampleView(a)).toBeNull();
    const b = input(); b.framesByCutoff[0][0].depth.startNs = ns(baseMs + 1); expect(parseFuturesSampleView(b)).toBeNull();
    const c = input(); c.framesByCutoff[0][0].endMs++; expect(parseFuturesSampleView(c)).toBeNull();
  });
  it("rejects malformed, oversized or unordered frames", () => {
    expect(parseFuturesSampleView(null)).toBeNull();
    expect(parseFuturesSampleView({ ...input(), framesByCutoff: new Array(16).fill([]) })).toBeNull();
    const x = input(); x.framesByCutoff[0].push(x.framesByCutoff[0][0]); expect(parseFuturesSampleView(x)).toBeNull();
  });
});
