import type { LargeTradesClock, LargeTradesEnvelope, TradeAccounting } from "./types";

const NS = /^(0|[1-9][0-9]{0,19})$/;
const isNs = (x: unknown): x is string => typeof x === "string" && NS.test(x);
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Optional v1 extension. Missing evidence preserves quantities, never correction authority. */
export function validateTradeAccounting(
  value: unknown, range: LargeTradesEnvelope["range"], generatedAtNs: string,
): boolean {
  if (value === undefined) return true;
  if (!record(value) || typeof value.quantityBasis !== "string" || typeof value.correctionCoverage !== "string"
    || !["gross_as_reported", "net_of_observed_cancels"].includes(value.quantityBasis)
    || !["complete", "unsupported", "unknown"].includes(value.correctionCoverage)) return false;
  if (value.correctionCoverage !== "complete") return value.correctionEvidence === null;
  const e = value.correctionEvidence;
  if (value.quantityBasis !== "net_of_observed_cancels" || !record(e)
    || !isNs(e.startNs) || !isNs(e.endNs) || !isNs(e.knownAtNs)
    || typeof e.sourceRef !== "string" || !e.sourceRef.length || e.sourceRef.length > 500
    || /[\x00-\x1f]/.test(e.sourceRef)) return false;
  return BigInt(e.startNs) >= BigInt(range.startNs) && BigInt(e.startNs) <= BigInt(e.endNs)
    && BigInt(e.endNs) <= BigInt(range.endNs) && BigInt(e.endNs) <= BigInt(e.knownAtNs)
    && BigInt(e.knownAtNs) <= BigInt(generatedAtNs);
}

/** An attestation learned later cannot alter the earlier snapshot or expose future provenance. */
export function tradeAccountingAt(
  envelope: LargeTradesEnvelope, clock: LargeTradesClock,
): TradeAccounting {
  const a = envelope.accounting;
  if (!a) return { quantityBasis: "net_of_observed_cancels",
    correctionCoverage: "unknown", correctionEvidence: null };
  if (a.correctionCoverage === "complete" && a.correctionEvidence
    && BigInt(a.correctionEvidence.knownAtNs) > BigInt(clock.knowledgeCutoffNs)) {
    return { quantityBasis: a.quantityBasis, correctionCoverage: "unknown", correctionEvidence: null };
  }
  return { ...a, correctionEvidence: a.correctionEvidence ? { ...a.correctionEvidence } : null };
}
