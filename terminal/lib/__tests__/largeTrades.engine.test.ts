import { describe, expect, it } from "vitest";
import { buildLargeTradesSnapshot, settingsFromParams, validateLargeTradesEnvelope } from "../largeTrades/engine";
import { makeLargeTradesFixture } from "../largeTrades/fixtures";
import type { LargeTradesEnvelope, TradePrint } from "../largeTrades/types";

const NS = BigInt(1000000);
const ORIGIN = BigInt(Date.parse("2026-10-05T13:30:00.000Z")) * NS;
const at = (ms: number) => (ORIGIN + BigInt(ms) * NS).toString();
const clock = (marketMs = 300000, knownMs = marketMs) => ({
  marketCutoffNs: at(marketMs), knowledgeCutoffNs: at(knownMs),
});
const run = (e = makeLargeTradesFixture(), settings = {}, c = clock()) =>
  buildLargeTradesSnapshot(e, settings, c);
const print = (id: string, ms: number, quantity = 100, changes: Partial<TradePrint> = {}): TradePrint => ({
  id, kind: "trade", eventNs: at(ms), availableNs: at(ms), sourceSequence: String(ms),
  session: "2026-10-05", priceInt: 2250000, quantity, side: "buy", sideMethod: "exchange",
  eligible: true, conditions: [], sourceRecordType: "T", ...changes,
});
function only(prints: TradePrint[]): LargeTradesEnvelope {
  return { ...makeLargeTradesFixture(), prints, responses: [], responseCoverage: "unavailable", responseKnownAtNs: null };
}
function historical(e = makeLargeTradesFixture()): LargeTradesEnvelope {
  const acquired = at(2 * 86400000);
  return {
    ...e,
    provenance: {
      ...e.provenance, dataMode: "historical", evidenceMode: "HISTORICAL_REPLAY",
      receiptBasis: "archive_acquisition", acquiredAtNs: acquired, generatedAtNs: acquired,
    },
    prints: e.prints.map(p => ({ ...p, availableNs: acquired })),
    responses: e.responses.map(r => ({ ...r, availableNs: acquired })),
    responseKnownAtNs: acquired,
  };
}
describe("transaction-only admission and exact accounting", () => {
  it("shows 1,301 executed shares from three reports and never invents an order count", () => {
    const s = run();
    expect(s.clusters[0]).toMatchObject({
      quantity: 1301, tradeCount: 3, buyQuantity: 1301, sellQuantity: 0, unknownQuantity: 0, orderCount: null,
      minPriceInt: 2250000, maxPriceInt: 2250100, notionalNumerator: "2927280000",
    });
    expect(s.diagnostics.eligibleQuantity).toBe(6201);
    expect(s.clusters.reduce((n, c) => n + c.quantity, 0)).toBe(6201);
  });
  it.each(["BAR", "Q", "CME_FILL", "DEPTH", "ESTIMATED_VOLUME"])("rejects %s as an execution source", type => {
    const e = only([print("a", 10000, 1301, { sourceRecordType: type })]);
    expect(validateLargeTradesEnvelope(e)).toBe(false);
    expect(() => run(e)).toThrow("INVALID_TRANSACTION_ENVELOPE");
  });
  it("rejects fractional, zero, unsafe, and invented known sides", () => {
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateLargeTradesEnvelope(only([print("a", 10000, quantity)]))).toBe(false);
    }
    expect(validateLargeTradesEnvelope(only([print("a", 10000, 100, { side: "unknown", sideMethod: "exchange" })]))).toBe(false);
    expect(validateLargeTradesEnvelope(only([print("a", 10000, 100, { side: "buy", sideMethod: "unknown" })]))).toBe(false);
  });
  it("keeps unknown executed quantity separate without signing it", () => {
    const s = run(only([print("unknown", 10000, 1301, { side: "unknown", sideMethod: "unknown" })]));
    expect(s.clusters[0]).toMatchObject({ quantity: 1301, unknownQuantity: 1301, buyQuantity: 0, sellQuantity: 0, side: "unknown" });
    expect(s.diagnostics.unknownQuantity).toBe(1301);
    expect(s.clusters[0].response.state).toBe("unobservable");
  });
  it("deduplicates repeated reports but quarantines conflicting economic IDs", () => {
    const a = print("a", 10000, 1301);
    const repeated = { ...a, availableNs: at(11000), sourceSequence: "11000" };
    const s = run(only([a, repeated]));
    expect(s.diagnostics).toMatchObject({ eligibleQuantity: 1301, eligibleTrades: 1, duplicateRecords: 1 });
    const conflict = run(only([a, { ...repeated, quantity: 1302 }, print("b", 20000, 100)]));
    expect(conflict.diagnostics).toMatchObject({ eligibleQuantity: 100, conflictingIds: 1, excludedRecords: 1 });
    expect(conflict.visiblePrints.map(p => p.id)).toEqual(["b"]);
  });
  it("applies full trade breaks at their receipt time and refuses mismatched bust quantities", () => {
    const a = print("a", 10000, 1301);
    const cancel = print("break-a", 20000, 1301, {
      kind: "cancel", targetId: "a", sourceRecordType: "B", availableNs: at(30000),
    });
    expect(run(only([a, cancel]), {}, clock(25000)).diagnostics.eligibleQuantity).toBe(1301);
    expect(run(only([a, cancel]), {}, clock(30000)).diagnostics).toMatchObject({
      eligibleQuantity: 0, cancellations: 1, unmatchedCancels: 0, excludedRecords: 1,
    });
    expect(run(only([a, { ...cancel, quantity: 1300 }])).diagnostics).toMatchObject({
      eligibleQuantity: 1301, unmatchedCancels: 1,
    });
  });
  it("does not round price-times-quantity products to floating point", () => {
    const a = print("large", 10000, 999999, { priceInt: 900719925 });
    const s = run(only([a]));
    expect(s.clusters[0].notionalNumerator).toBe((BigInt(a.priceInt) * BigInt(a.quantity)).toString());
    expect(s.clusters[0].orderCount).toBeNull();
  });
  it("rejects a total quantity that exceeds exact integer representation", () => {
    expect(() => run(only([
      print("a", 10000, Number.MAX_SAFE_INTEGER), print("b", 20000, 1),
    ]))).toThrow("QUANTITY_OVERFLOW");
  });
});
describe("bounded clustering and prior-only calibration", () => {
  it("honors time-gap, total-duration, price-span, side, session, and side-method boundaries", () => {
    const e = only([
      print("a", 10000), print("b", 10100),
      print("gap", 11000), print("price", 11100, 100, { priceInt: 2251000 }),
      print("side", 11200, 100, { priceInt: 2251000, side: "sell" }),
      print("method", 11300, 100, { priceInt: 2251000, side: "sell", sideMethod: "resting_order" }),
      print("session", 11400, 100, { priceInt: 2251000, side: "sell", sideMethod: "resting_order", session: "another-session" }),
    ]);
    expect(run(e).clusters.map(c => c.quantity)).toEqual([200, 100, 100, 100, 100, 100]);
    const duration = only(Array.from({ length: 8 }, (_, i) => print(String(i), 10000 + 200 * i)));
    expect(run(duration, { maxDurationMs: 500 }).clusters.map(c => c.quantity)).toEqual([300, 300, 200]);
  });
  it("aggregates at identical prices only when no tick-size evidence exists", () => {
    const e = only([print("a", 10000), print("b", 10100), print("c", 10200, 100, { priceInt: 2250001 })]);
    e.instrument.tickSizeInt = null;
    expect(run(e).clusters.map(c => c.quantity)).toEqual([200, 100]);
  });
  it("never includes the current cluster in its own adaptive percentile", () => {
    const e = only([print("a", 10000, 100), print("b", 20000, 200), print("c", 30000, 1000)]);
    const s = run(e, { adaptive: true, minBaseline: 2, percentile: 100, aggregate: false });
    expect(s.diagnostics.calibrationPending).toBe(2);
    expect(s.clusters).toHaveLength(1);
    expect(s.clusters[0]).toMatchObject({ quantity: 1000, threshold: 200, baselineSamples: 2 });
  });
  it("keeps prior feature values invariant when valid future trades and quotes are appended", () => {
    const prefix = only([print("a", 10000, 100), print("b", 20000, 200), print("c", 30000, 1000)]);
    const extended = { ...prefix, prints: [...prefix.prints, print("future", 40000, 100000)] };
    const settings = { adaptive: true, minBaseline: 2, aggregate: false };
    expect(run(prefix, settings, clock(35000))).toEqual(run(extended, settings, clock(35000)));
  });
  it("excludes late prior reports and simultaneous groups from earlier feature calibration", () => {
    const e = only([
      print("late", 10000, 900000, { availableNs: at(100000) }),
      print("a", 20000, 100), print("b", 30000, 200), print("c", 40000, 1000),
    ]);
    const s = run(e, { adaptive: true, minBaseline: 2, percentile: 100, aggregate: false });
    expect(s.clusters.find(c => c.sourceIds[0] === "c")).toMatchObject({ threshold: 200, baselineSamples: 2 });
    const simultaneous = only([print("a", 10000), print("b", 10000, 200), print("c", 10000, 1000)]);
    expect(run(simultaneous, { adaptive: true, minBaseline: 2, aggregate: false }).clusters).toHaveLength(0);
  });
  it("bounds trailing calibration and resets the baseline at a new session", () => {
    const e = only([
      ...Array.from({ length: 12 }, (_, i) => print(String(i), 1000 + i * 2000, i ? 100 : 999999)),
      print("new-session", 40000, 1000, { session: "2026-10-06" }),
    ]);
    const s = run(e, { adaptive: true, baselineCount: 10, minBaseline: 2, percentile: 100, aggregate: false });
    expect(s.clusters.find(c => c.sourceIds[0] === "11")).toMatchObject({ baselineSamples: 10, threshold: 100 });
    expect(s.clusters.some(c => c.sourceIds[0] === "new-session")).toBe(false);
  });
  it("limits display markers explicitly without changing retained quantities or source totals", () => {
    const e = only([print("a", 10000, 100), print("b", 20000, 500), print("c", 30000, 300)]);
    const s = run(e, { maxMarkers: 2 });
    expect(s.clusters.map(c => c.quantity)).toEqual([500, 300]);
    expect(s.diagnostics).toMatchObject({ eligibleQuantity: 900, qualifyingClusters: 3, markerLimitApplied: true });
  });
  it("handles a large single cluster without variadic argument limits", () => {
    const e = only(Array.from({ length: 50000 }, (_, i) => print("p" + i, 10000, 1, { sourceSequence: String(i + 1) })));
    const s = run(e);
    expect(s.clusters[0]).toMatchObject({ quantity: 50000, tradeCount: 50000, minPriceInt: 2250000 });
    expect(s.diagnostics.eligibleQuantity).toBe(50000);
  }, 10000);
});
describe("evidence-qualified response and adverse market cases", () => {
  it("keeps limited-response candidates, failed continuation, unknown side, and continued selling distinct", () => {
    const s = run();
    expect(s.clusters.map(c => c.response.state)).toEqual([
      "limited_response", "failed_continuation", "unobservable", "continued",
    ]);
    expect(s.clusters[0].response.absorption).toBe("candidate");
    expect(s.clusters[1].response.absorption).toBe("unavailable");
    expect(s.clusters[3].response.absorption).toBe("unavailable");
    expect(s.clusters.every(c => c.response.predictiveSignal === false)).toBe(true);
  });
  it("cannot mature a future outcome before its fixed market-time deadline", () => {
    const e = makeLargeTradesFixture();
    const before = run(e, {}, clock(40199, 300000));
    expect(before.clusters[0].response.state).toBe("pending");
    const after = run(e, {}, clock(40200, 300000));
    expect(after.clusters[0].response.state).toBe("limited_response");
    expect(BigInt(after.clusters[0].response.knownAtNs!)).toBeGreaterThanOrEqual(BigInt(at(40200)));
  });
  it("holds a matured market outcome until the evidence receipt is available", () => {
    const e = makeLargeTradesFixture();
    expect(run(e, {}, clock(50000)).clusters[0].response.state).toBe("pending");
    expect(run(e, {}, clock(50000, 300000)).clusters[0].response.state).toBe("limited_response");
  });
  it("never derives quote response from execution prices or candle prices", () => {
    const e = makeLargeTradesFixture();
    e.responses = []; e.responseCoverage = "unavailable"; e.responseKnownAtNs = null;
    expect(run(e).clusters.every(c => c.response.state === "unobservable")).toBe(true);
    expect(run(e).clusters.every(c => c.response.absorption === "unavailable")).toBe(true);
  });
  it("requires strict-prior, fresh, untied, qualified quote observations", () => {
    for (const variant of ["same-time", "stale", "invalid-latest", "tie"] as const) {
      const e = makeLargeTradesFixture();
      if (variant === "same-time") e.responses[0] = { ...e.responses[0], eventNs: at(10000), availableNs: at(10000) };
      if (variant === "stale") e.responses[0].quoteAgeMs = 5001;
      if (variant === "invalid-latest") e.responses.push({
        ...e.responses[0], id: "bad-latest", eventNs: at(9999), availableNs: at(9999), eligible: false,
      });
      if (variant === "tie") e.responses.push({ ...e.responses[0], id: "same-clock" });
      expect(run(e).clusters[0].response.state, variant).toBe("unobservable");
    }
  });
  it("refuses a convenient older endpoint after a newer invalid observation", () => {
    const e = makeLargeTradesFixture();
    e.responses[1].eventNs = at(40199); e.responses[1].availableNs = at(40199);
    e.responses.push({ ...e.responses[1], id: "bad-endpoint", eventNs: at(40200), availableNs: at(40200), eligible: false });
    expect(run(e).clusters[0].response.state).toBe("unobservable");
  });
  it("does not overclaim response when sequence integrity, corrections, or coverage are incomplete", () => {
    for (const variant of ["gap", "partial", "unmatched-break", "tick"] as const) {
      const e = makeLargeTradesFixture();
      if (variant === "gap") e.provenance.sequenceGaps = 1;
      if (variant === "partial") e.responseCoverage = "partial";
      if (variant === "tick") e.instrument.tickSizeInt = null;
      if (variant === "unmatched-break") e.prints.push(print("break-missing", 12000, 100, {
        kind: "cancel", targetId: "absent", sourceRecordType: "B",
      }));
      expect(run(e).clusters[0].response.state, variant).toBe("unobservable");
      expect(run(e).diagnostics.eligibleQuantity).toBe(6201);
    }
  });
});
describe("provenance and two-clock replay", () => {
  it("requires acquisition knowledge for historical replay and never relabels it as live", () => {
    const e = historical();
    expect(run(e).clusters).toHaveLength(0);
    const s = run(e, {}, clock(300000, 2 * 86400000));
    expect(s.clusters[0].quantity).toBe(1301);
    expect(s.dataMode).toBe("historical");
    expect(s.evidenceMode).toBe("HISTORICAL_REPLAY");
    expect(s.clusters[0].knownAtNs).toBe(e.provenance.acquiredAtNs);
  });
  it("rejects delayed/fixture/historical provenance masquerading as live", () => {
    for (const dataMode of ["live", "delayed"] as const) {
      const e = makeLargeTradesFixture(); e.provenance.dataMode = dataMode;
      expect(validateLargeTradesEnvelope(e)).toBe(false);
    }
    const e = historical(); e.prints[0].availableNs = e.prints[0].eventNs;
    expect(validateLargeTradesEnvelope(e)).toBe(false);
  });
  it("requires truthful event, receipt, acquisition and publication ordering", () => {
    const beforeEvent = makeLargeTradesFixture(); beforeEvent.prints[0].availableNs = at(9999);
    expect(validateLargeTradesEnvelope(beforeEvent)).toBe(false);
    const beforeReceive = makeLargeTradesFixture(); beforeReceive.provenance.generatedAtNs = at(0);
    expect(validateLargeTradesEnvelope(beforeReceive)).toBe(false);
    const beforeAcquisition = historical(); beforeAcquisition.provenance.acquiredAtNs = at(0);
    expect(validateLargeTradesEnvelope(beforeAcquisition)).toBe(false);
  });
  it("preserves nanosecond cutoffs and does not round a future report into view", () => {
    const p = print("nano", 10000);
    p.eventNs = (BigInt(p.eventNs) + BigInt(1)).toString(); p.availableNs = p.eventNs;
    expect(run(only([p]), {}, clock(10000)).clusters).toHaveLength(0);
    expect(run(only([p]), {}, { marketCutoffNs: p.eventNs, knowledgeCutoffNs: p.availableNs }).clusters).toHaveLength(1);
  });
  it("rejects a market cutoff ahead of contemporaneous knowledge", () => {
    const e = makeLargeTradesFixture();
    e.provenance = { ...e.provenance, dataMode: "live", evidenceMode: "ACTUAL_AS_SEEN", receiptBasis: "original_receive", delayMs: 0 };
    expect(() => run(e, {}, clock(20000, 10000))).toThrow("MARKET_TIME_AFTER_KNOWLEDGE");
  });
  it("sanitizes externally supplied numeric settings without accepting NaN", () => {
    expect(settingsFromParams({ minQuantity: NaN, maxMarkers: 9000, maxGapMs: -1, aggregate: false }))
      .toMatchObject({ minQuantity: 100, maxMarkers: 1000, maxGapMs: 0, aggregate: false });
  });
});

describe("independent-review causal regressions", () => {
  it("never creates an earlier adaptive marker from a later baseline break", () => {
    const e = only([
      print("a", 10000, 100), print("b", 20000, 200), print("d", 30000, 150), print("c", 40000, 180),
      print("break-b", 100000, 200, { kind: "cancel", targetId: "b", sourceRecordType: "B" }),
      print("future", 110000, 1000),
    ]);
    const settings = { aggregate: false, adaptive: true, percentile: 100, minBaseline: 2 };
    const before = run(e, settings, clock(50000));
    const after = run(e, settings, clock(120000));
    expect(before.clusters.some(c => c.sourceIds.includes("c"))).toBe(false);
    expect(after.clusters.some(c => c.sourceIds.includes("c"))).toBe(false);
    expect(after.clusters.find(c => c.sourceIds.includes("future"))).toMatchObject({
      threshold: 180, baselineSamples: 3, thresholdKnownAtNs: at(110000), knownAtNs: at(110000),
    });
  });
  it("does not reopen a closed prior group when an earlier-event print arrives late", () => {
    const e = only([
      print("a", 10000, 100),
      print("late-a", 10100, 900000, { availableNs: at(100000) }),
      print("b", 20000, 200), print("c", 30000, 1000),
    ]);
    const settings = { aggregate: true, adaptive: true, percentile: 100, minBaseline: 2 };
    const before = run(e, settings, clock(40000)).clusters.find(c => c.sourceIds.includes("c"));
    const after = run(e, settings, clock(110000)).clusters.find(c => c.sourceIds.includes("c"));
    expect(before).toMatchObject({ threshold: 200, baselineSamples: 2, knownAtNs: at(30000) });
    expect(after).toMatchObject({ threshold: 200, baselineSamples: 2, knownAtNs: at(30000) });
  });
  it("preserves declared response origins and records the direct correction knowledge", () => {
    const e = only([
      print("a", 10000, 100), print("b", 10100, 200), print("next", 20000, 1000),
      print("break-b", 25000, 200, { kind: "cancel", targetId: "b", sourceRecordType: "B", availableNs: at(40000) }),
    ]);
    const before = run(e, {}, clock(21000)).clusters[0];
    const after = run(e, {}, clock(50000)).clusters[0];
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({
      quantity: 100, startNs: at(10000), endNs: at(10000), knownAtNs: at(40000),
      formationStartNs: at(10000), formationEndNs: at(10100), correctionIds: ["break-b"],
    });
  });
  it("resolves a pending break before admitting its late original to a baseline", () => {
    const e = only([
      print("late-original", 10000, 500, { availableNs: at(50000) }),
      print("early-break", 20000, 500, { kind: "cancel", targetId: "late-original", sourceRecordType: "B", availableNs: at(30000) }),
      print("future", 60000, 1000),
    ]);
    const s = run(e, { adaptive: true, minBaseline: 2, aggregate: false });
    expect(s.diagnostics).toMatchObject({ eligibleQuantity: 1000, unmatchedCancels: 0, excludedRecords: 1 });
    expect(s.clusters).toHaveLength(0);
  });
  it("applies separate break reports idempotently", () => {
    const e = only([
      print("a", 10000, 500),
      print("break1", 20000, 500, { kind: "cancel", targetId: "a", sourceRecordType: "B" }),
      print("break2", 30000, 500, { kind: "cancel", targetId: "a", sourceRecordType: "B" }),
    ]);
    expect(run(e).diagnostics).toMatchObject({ eligibleQuantity: 0, cancellations: 2, unmatchedCancels: 0 });
  });
  it("waits for causal cluster closure when the grouping horizon exceeds the response window", () => {
    const e = makeLargeTradesFixture();
    e.prints = [print("a", 10000, 1000)];
    e.responses = [
      { ...e.responses[0], priceInt: 2250000 },
      { ...e.responses[1], eventNs: at(11000), availableNs: at(11000), priceInt: 2250000 },
    ];
    e.responseKnownAtNs = at(11000);
    const settings = { maxGapMs: 10000, maxDurationMs: 60000, responseWindowMs: 1000 };
    expect(run(e, settings, clock(12000, 300000)).clusters[0].response.state).toBe("pending");
    const closed = run(e, settings, clock(20000, 300000)).clusters[0];
    expect(closed.response.state).toBe("limited_response");
    expect(closed.closedAtNs).toBe(at(20000));
    expect(BigInt(closed.response.knownAtNs!)).toBeGreaterThanOrEqual(BigInt(at(20000)));
  });
  it.each(["partial", "unknown"] as const)("keeps observed volume but refuses absorption on %s transaction coverage", coverage => {
    const e = makeLargeTradesFixture(); e.provenance.coverage = coverage;
    const s = run(e);
    expect(s.diagnostics.eligibleQuantity).toBe(6201);
    expect(s.clusters[0].response).toMatchObject({ state: "unobservable", absorption: "unavailable" });
  });
  it("does not call a fifty-tick continuation and round trip absorption", () => {
    const e = makeLargeTradesFixture();
    e.responses.push({ ...e.responses[0], id: "round-trip", eventNs: at(20000), availableNs: at(20000), priceInt: 2255000 });
    expect(run(e).clusters[0].response).toMatchObject({
      state: "limited_response", responseTicks: 1, maxExcursionTicks: 50, absorption: "unavailable",
    });
  });
  it("records the availability of a late intermediate path observation", () => {
    const e = makeLargeTradesFixture();
    e.responses.push({ ...e.responses[0], id: "late-path", eventNs: at(20000), availableNs: at(250000), priceInt: 2255000 });
    expect(run(e, {}, clock(50000, 240000)).clusters[0].response.absorption).toBe("candidate");
    const later = run(e, {}, clock(50000, 260000)).clusters[0].response;
    expect(later.absorption).toBe("unavailable");
    expect(later.knownAtNs).toBe(at(250000));
  });
  it("adds observation age and elapsed time when qualifying the underlying quote", () => {
    const e = makeLargeTradesFixture();
    e.responses[1] = { ...e.responses[1], eventNs: at(35200), availableNs: at(35200), quoteAgeMs: 5000 };
    expect(run(e).clusters[0].response.state).toBe("unobservable");
    const anchor = makeLargeTradesFixture(); anchor.responses[0].quoteAgeMs = 5000;
    expect(run(anchor).clusters[0].response.state).toBe("unobservable");
  });
  it("scopes equal-acquisition sequence resets by session", () => {
    const e = only([
      print("a1", 10000, 100, { session: "A", sourceSequence: "1", availableNs: at(100000) }),
      print("b1", 20000, 100, { session: "B", sourceSequence: "1", availableNs: at(100000) }),
      print("a2", 10100, 100, { session: "A", sourceSequence: "2", availableNs: at(100000) }),
      print("b2", 20100, 100, { session: "B", sourceSequence: "2", availableNs: at(100000) }),
    ]);
    expect(run(e).clusters.map(c => [c.session, c.quantity])).toEqual([["A", 200], ["B", 200]]);
  });
});

describe("correction interactions retain exact arithmetic and immutable formation", () => {
  it("refuses an intermediate overflow even if a later bust would reduce the final total", () => {
    const e = only([
      print("big", 10000, Number.MAX_SAFE_INTEGER), print("small", 10100, 2),
      print("bust-big", 20000, Number.MAX_SAFE_INTEGER, { kind: "cancel", targetId: "big", sourceRecordType: "B" }),
    ]);
    expect(validateLargeTradesEnvelope(e)).toBe(true);
    expect(() => run(e)).toThrow("QUANTITY_OVERFLOW");
  });
  it("cannot erode a group's formation end after its last active report is broken", () => {
    const e = only([
      print("a", 10000), print("b", 10200),
      print("bust-b", 10210, 100, { kind: "cancel", targetId: "b", sourceRecordType: "B" }),
      print("late", 10150, 100, { availableNs: at(10220) }),
    ]);
    const s = run(e);
    expect(s.clusters).toHaveLength(2);
    expect(s.clusters[0]).toMatchObject({ sourceIds: ["a"], formationStartNs: at(10000), formationEndNs: at(10200) });
    expect(s.clusters[1]).toMatchObject({ sourceIds: ["late"], quantity: 100 });
  });
  it("cannot extend the duration bound after the first active report is broken", () => {
    const e = only([
      print("a", 10000), print("b", 10200),
      print("bust-a", 10300, 100, { kind: "cancel", targetId: "a", sourceRecordType: "B" }),
      print("c", 11100),
    ]);
    const s = run(e, { maxGapMs: 1000, maxDurationMs: 1000 });
    expect(s.clusters.map(c => c.sourceIds)).toEqual([["b"], ["c"]]);
    expect(s.clusters[0].formationStartNs).toBe(at(10000));
    expect(s.clusters[0].formationEndNs).toBe(at(10200));
  });
});
