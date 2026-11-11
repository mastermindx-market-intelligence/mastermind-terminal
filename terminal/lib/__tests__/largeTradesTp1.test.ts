import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import nativeGolden from "./fixtures/tp1LargeTrades.envelope.synthetic.v1.json";
import { buildLargeTradesSnapshot, validateLargeTradesEnvelope } from "../largeTrades/engine";
import { makeLargeTradesFixture } from "../largeTrades/fixtures";
import { isAdmittedLargeTradesSource, IEX_HIST_ATTRIBUTION, IEX_HIST_TERMS } from "../largeTrades/sourceAdmission";
import type { LargeTradesEnvelope, TradeAccounting } from "../largeTrades/types";

const native = () => structuredClone(nativeGolden) as LargeTradesEnvelope;
const run = (e: LargeTradesEnvelope, market = e.provenance.generatedAtNs, known = market) =>
  buildLargeTradesSnapshot(e, {}, { marketCutoffNs: market, knowledgeCutoffNs: known });
const fixture = () => makeLargeTradesFixture("AAPL");

describe("native TP-1 private quantities through the existing engine", () => {
  it("produces 1,301 reported shares from three economic reports, never orders or signed pressure", () => {
    const e = native();
    expect(validateLargeTradesEnvelope(e)).toBe(true);
    const s = run(e);
    expect(s.accounting).toEqual({
      quantityBasis: "gross_as_reported", correctionCoverage: "unsupported", correctionEvidence: null,
    });
    expect(s.clusters.map(c => c.quantity)).toEqual([1301, 700, 1100]);
    expect(s.clusters[0]).toMatchObject({ quantity: 1301, tradeCount: 3, orderCount: null,
      buyQuantity: 0, sellQuantity: 0, unknownQuantity: 1301, weightedPrice: 225,
      side: "unknown", sideMethod: "unknown" });
    expect(s.diagnostics).toMatchObject({ sourceRecords: 6, eligibleTrades: 5,
      duplicateRecords: 1, eligibleQuantity: 3101, unknownQuantity: 3101 });
    expect(s.clusters.every(c => c.response.evidence === "unavailable"
      && c.response.absorption === "unavailable" && c.response.predictiveSignal === false)).toBe(true);
  });

  it("preserves native ns/sequence strings and admits reports only at their actual fixture receipt", () => {
    const e = native(), first = e.prints[0];
    expect(first.sourceSequence).toBe("9007199254740993");
    expect(first.availableNs).toBe("1791207010200000123");
    expect(first.eventNs).toBe("1791207010000000000");
    const before = (BigInt(first.availableNs) - BigInt(1)).toString();
    expect(run(e, before).visiblePrints).toHaveLength(0);
    const at = run(e, first.availableNs);
    expect(at.diagnostics.eligibleQuantity).toBe(1301);
    expect(at.clusters[0].knownAtNs).toBe(first.availableNs);
  });

  it("keeps a supplied source prefix invariant when later reports and price precision arrive", () => {
    const e = native(), prefix = native();
    prefix.prints = prefix.prints.slice(0, 3);
    prefix.range.endNs = prefix.prints[2].eventNs;
    prefix.provenance.generatedAtNs = prefix.prints[2].availableNs;
    expect(run(prefix, prefix.provenance.generatedAtNs)).toEqual(run(e, prefix.provenance.generatedAtNs));
  });

  it("does not gain response authority from supplied quotes, known sides, or a verified tick", () => {
    const e = fixture();
    e.accounting = native().accounting;
    const s = run(e);
    expect(s.clusters).not.toHaveLength(0);
    expect(s.clusters.every(c => c.response.evidence === "unavailable"
      && c.response.absorption === "unavailable")).toBe(true);
    expect(s.clusters.some(c => c.response.state === "failed_continuation")).toBe(false);
  });

  it("leaves the public source admission boundary unchanged", () => {
    const e = native();
    expect(isAdmittedLargeTradesSource(e)).toBe(false);
    // A caller cannot make native T records eligible merely by replacing provenance text.
    Object.assign(e.provenance, { provider: "IEX", dataset: "HIST DEEP+ 1.0", venue: "IEX",
      scope: "venue", dataMode: "historical", evidenceMode: "HISTORICAL_REPLAY",
      receiptBasis: "archive_acquisition", attribution: IEX_HIST_ATTRIBUTION, termsUrl: IEX_HIST_TERMS });
    expect(isAdmittedLargeTradesSource(e)).toBe(false);
  });

  it("does not accept fabricated SIP sub-millisecond precision", () => {
    const e = native();
    e.prints[0].eventNs = (BigInt(e.prints[0].eventNs) + BigInt(1)).toString();
    expect(validateLargeTradesEnvelope(e)).toBe(false);
  });
});

describe("correction evidence is explicit, scoped and causal", () => {
  it("preserves legacy quantities and observed cancels with unknown correction coverage", () => {
    const e = fixture();
    delete e.accounting;
    expect(validateLargeTradesEnvelope(e)).toBe(true);
    const original = e.prints[0];
    e.prints.push({ ...original, id: "fixture:cancel-first", kind: "cancel",
      targetId: original.id, eventNs: e.provenance.generatedAtNs,
      availableNs: e.provenance.generatedAtNs, sourceSequence: "99", sourceRecordType: "B" });
    const s = run(e);
    expect(s.diagnostics.eligibleQuantity).toBe(5701);
    expect(s.accounting).toEqual({ quantityBasis: "net_of_observed_cancels",
      correctionCoverage: "unknown", correctionEvidence: null });
    expect(s.clusters.every(c => c.response.evidence === "unavailable")).toBe(true);
  });

  it("requires an explicit synthetic correction universe for positive fixture responses", () => {
    const e = fixture(), s = run(e);
    expect(s.accounting.correctionCoverage).toBe("complete");
    expect(s.clusters[0].response.absorption).toBe("candidate");
    expect(s.clusters.some(c => c.response.state === "failed_continuation")).toBe(true);
    for (const c of s.clusters.filter(c => c.response.evidence === "qualified_midpoint")) {
      expect(BigInt(c.response.knownAtNs!)).toBeGreaterThanOrEqual(
        BigInt(e.accounting!.correctionEvidence!.knownAtNs));
    }
  });

  it("does not expose a correction attestation or its reference before knowledge cutoff", () => {
    const e = fixture(), legacy = fixture();
    delete legacy.accounting;
    const known = (BigInt(e.accounting!.correctionEvidence!.knownAtNs) - BigInt(1)).toString();
    expect(run(e, known)).toEqual(run(legacy, known));
    expect(run(e, known).accounting).toEqual({ quantityBasis: "net_of_observed_cancels",
      correctionCoverage: "unknown", correctionEvidence: null });
  });

  it("requires correction evidence to cover the whole response window", () => {
    const e = fixture();
    e.accounting!.correctionEvidence!.endNs = e.prints[2].eventNs;
    const s = run(e);
    expect(s.clusters[0].response.reason).toBe("Correction evidence does not cover this response window");
    expect(s.clusters[0].response.evidence).toBe("unavailable");
  });

  it("rejects a gross label on a ledger that would subtract observed cancellations", () => {
    const e = fixture();
    e.accounting = native().accounting;
    e.prints.push({ ...e.prints[0], kind: "cancel", id: "cancel", targetId: e.prints[0].id,
      sourceRecordType: "B" });
    expect(validateLargeTradesEnvelope(e)).toBe(false);
    expect(() => run(e)).toThrow("INVALID_TRANSACTION_ENVELOPE");
  });

  it.each([
    null, {}, { quantityBasis: "gross_as_reported", correctionCoverage: "unsupported" },
    { quantityBasis: "net_of_observed_cancels", correctionCoverage: "complete", correctionEvidence: null },
    { quantityBasis: "estimated_candle_volume", correctionCoverage: "unknown", correctionEvidence: null },
  ])("rejects malformed accounting instead of silently treating it as legacy: %j", accounting => {
    const e = fixture();
    e.accounting = accounting as TradeAccounting;
    expect(validateLargeTradesEnvelope(e)).toBe(false);
  });

  it("rejects impossible correction ranges and future knowledge declarations", () => {
    const e = fixture();
    e.accounting!.correctionEvidence!.knownAtNs = e.prints[0].eventNs;
    expect(validateLargeTradesEnvelope(e)).toBe(false);
    const future = fixture();
    future.accounting!.correctionEvidence!.knownAtNs =
      (BigInt(future.provenance.generatedAtNs) + BigInt(1)).toString();
    expect(validateLargeTradesEnvelope(future)).toBe(false);
    const beyond = fixture();
    beyond.accounting!.correctionEvidence!.endNs =
      (BigInt(beyond.range.endNs) + BigInt(1)).toString();
    expect(validateLargeTradesEnvelope(beyond)).toBe(false);
  });
});
