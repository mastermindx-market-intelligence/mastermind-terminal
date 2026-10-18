import type { LargeTradesEnvelope, ResponseObservation, TradePrint } from "./types";

/**
 * Deterministic test/demo input, never an automatic substitute for a missing feed.
 * The route admits this only with explicit non-production TERMINAL_E2E_FIXTURE.
 * 1,301 is executed shares from three reports, not 1,301 orders.
 */
export function makeLargeTradesFixture(symbol = "AAPL"): LargeTradesEnvelope {
  const origin = BigInt(Date.parse("2026-10-05T13:30:00.000Z")) * BigInt(1000000);
  const at = (ms: number) => (origin + BigInt(ms) * BigInt(1000000)).toString();
  const prints: TradePrint[] = [
    { id: "fixture:buy:1", eventNs: at(10000), quantity: 500, priceInt: 2250000, side: "buy", sourceSequence: "1" },
    { id: "fixture:buy:2", eventNs: at(10100), quantity: 501, priceInt: 2250000, side: "buy", sourceSequence: "2" },
    { id: "fixture:buy:3", eventNs: at(10200), quantity: 300, priceInt: 2250100, side: "buy", sourceSequence: "3" },
    { id: "fixture:sell:1", eventNs: at(70000), quantity: 800, priceInt: 2250100, side: "sell", sourceSequence: "4" },
    { id: "fixture:sell:2", eventNs: at(70100), quantity: 700, priceInt: 2250000, side: "sell", sourceSequence: "5" },
    { id: "fixture:unknown:1", eventNs: at(130000), quantity: 1800, priceInt: 2250500, side: "unknown", sourceSequence: "6" },
    { id: "fixture:sell:continues", eventNs: at(190000), quantity: 1600, priceInt: 2250000, side: "sell", sourceSequence: "7" },
  ].map(p => ({
    ...p, kind: "trade", availableNs: p.eventNs, session: "2026-10-05",
    sideMethod: p.side === "unknown" ? "unknown" : "exchange",
    eligible: true, conditions: [], sourceRecordType: "T",
  } as TradePrint));
  const response = (id: string, ms: number, priceInt: number): ResponseObservation => ({
    id, eventNs: at(ms), availableNs: at(ms), priceInt, kind: "qualified_midpoint",
    eligible: true, sourceRef: "fixture:qualified-midpoint", quoteAgeMs: 0,
  });
  return {
    schema: "mastermind.large_trades.v1",
    instrument: {
      symbol, instrumentId: "fixture:" + symbol, assetClass: "equity",
      quantityUnit: "shares", priceScale: 10000, tickSizeInt: 100, timezone: "America/New_York",
    },
    provenance: {
      provider: "Deterministic fixture", dataset: "large-trades-adverse-cases-v1",
      venue: "SIMULATED", scope: "venue", dataMode: "fixture", evidenceMode: "FIXTURE",
      sourceId: "fixture:large-trades-v1", sourceSha256: null, sourceRef: "fixture:large-trades-v1",
      generatedAtNs: at(300000), acquiredAtNs: null, receiptBasis: "fixture", coverage: "complete",
      sequenceGaps: 0, delayMs: null,
      conditionPolicy: "Synthetic execution reports for UI and causal replay tests only",
      attribution: "Synthetic fixture. No market transactions or investment evidence.", termsUrl: null,
    },
    range: { startNs: at(0), endNs: at(300000) }, prints,
    accounting: { quantityBasis: "net_of_observed_cancels", correctionCoverage: "complete",
      correctionEvidence: { startNs: at(0), endNs: at(220000), knownAtNs: at(220000),
        sourceRef: "fixture:complete-synthetic-correction-range" } },
    responses: [
      response("fixture:q:buy:prior", 9900, 2250000),
      response("fixture:q:buy:end", 40200, 2250100),
      response("fixture:q:sell:prior", 69900, 2250100),
      response("fixture:q:sell:end", 100100, 2250600),
      response("fixture:q:unknown:prior", 129900, 2250500),
      response("fixture:q:unknown:end", 160000, 2250400),
      response("fixture:q:adverse:prior", 189900, 2250000),
      response("fixture:q:adverse:end", 220000, 2249400),
    ],
    responseCoverage: "complete", responseKnownAtNs: at(220000),
  };
}
