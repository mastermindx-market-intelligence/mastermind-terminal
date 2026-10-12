/**
 * Consumer adapter for the EXISTING options_hub.gex/v1 by_strike payload.
 * No fetch, cache, scheduler, receipt issuer, inventory inference, or entitlement decision.
 * The serving owner supplies already-verified publication receipts and contract definitions.
 * A YYYY-MM-DD asof or a successful HTTP fetch is NOT a point-in-time availability receipt.
 */
import {
  isRecord, finiteNumber, validClockMs, projectFuturesGex,
  type FuturesGexQuotePair, type FuturesGexMapping, type FuturesGexProjection,
} from "./futuresGexProjection";

import { selectFuturesGexLens, validFuturesLens, type FuturesMatrixSource, type FuturesLensReason } from "./futuresGexLens";
import type { ExpiryLens } from "./gexLadder";

export type FuturesGexFrameInput = {
  expiryLens?: ExpiryLens;
  matrix?: FuturesMatrixSource;
  quotes: FuturesGexQuotePair;
  quoteAvailability: {
    indexAvailableAtMs: number; futuresAvailableAtMs: number;
    indexFeedBasis: "realtime" | "delayed"; futuresFeedBasis: "realtime" | "delayed";
  };
  contract: { symbol: string; definitionId: string; validFromMs: number; validUntilMs: number };
  source: unknown;
  sourceReceipt: {
    artifactId: string; sessionDate: string; sourceAsOfMs: number; availableAtMs: number;
  };
  policy: {
    decisionTimeMs: number; maxQuoteAgeMs: number; maxExposureAgeMs: number;
    maxClockSkewMs: number; method: FuturesGexMapping;
  };
};
export type FuturesGexFrameReason = FuturesLensReason | "source_unavailable" | "invalid_input" | "invalid_policy" | "invalid_contract" |
  "contract_inactive" | "missing_receipt" | "invalid_clock" | "not_yet_available" |
  "stale_quote" | "stale_exposure" | "source_schema" | "source_root" |
  "source_session" | "source_rows" | "empty_source" | "invalid_projection";
export type FuturesGexFrame = { status: "unavailable"; reason: FuturesGexFrameReason } | {
  status: "ok";
  schema: "terminal.futures_gex_frame/v1";
  projection: FuturesGexProjection;
  provenance: {
    artifactId: string; definitionId: string; sourceAsOf: string;
    sourceAsOfMs: number; sourceAvailableAtMs: number; decisionTimeMs: number;
    indexAvailableAtMs: number; futuresAvailableAtMs: number;
    indexFeedBasis: "realtime" | "delayed"; futuresFeedBasis: "realtime" | "delayed";
    quoteAgeMs: number; exposureAgeMs: number; frameAvailableAtMs: number;
    inventoryBasis: string | null; expiryLens: ExpiryLens["kind"]; dealerPositioning: "estimate";
    expirySessionDate: string; selectedExpiries: string[];
    expiryCutBasis: "source_session_date_not_trading_cutoff";
    matrixArtifactId: string | null; matrixAvailableAtMs: number | null; matrixAsOfMs: number | null;
  };
};
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const basis = (v: unknown) => v === "realtime" || v === "delayed";
const unavailable = (reason: FuturesGexFrameReason): FuturesGexFrame => ({ status: "unavailable", reason });
const sessionDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const time = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === v;
};

export function buildFuturesGexFrame(input: FuturesGexFrameInput): FuturesGexFrame {
  if (!isRecord(input) || !isRecord(input.quotes) || !isRecord(input.quoteAvailability) ||
      !isRecord(input.policy)) return unavailable("invalid_input");
  const { quotes: q, quoteAvailability: a, policy: p, contract: c, sourceReceipt: r } = input;
  const lens = input.expiryLens ?? { kind: "all" };
  if (!validFuturesLens(lens)) return unavailable("invalid_expiry_lens");
  if (!validClockMs(p.decisionTimeMs) ||
      ![p.maxQuoteAgeMs, p.maxExposureAgeMs, p.maxClockSkewMs].every(v => finiteNumber(v) && v >= 0) ||
      (p.method !== "basis" && p.method !== "ratio")) return unavailable("invalid_policy");
  if (!isRecord(c) || c.symbol !== q.futuresContract || !text(c.definitionId) ||
      !validClockMs(c.validFromMs) || !validClockMs(c.validUntilMs) ||
      c.validFromMs >= c.validUntilMs) return unavailable("invalid_contract");
  if (!isRecord(r) || !text(r.artifactId) || !sessionDate(r.sessionDate) ||
      !validClockMs(r.sourceAsOfMs) || !validClockMs(r.availableAtMs)) return unavailable("missing_receipt");
  if (!basis(a.indexFeedBasis) || !basis(a.futuresFeedBasis) ||
      !validClockMs(q.indexTimestampMs) || !validClockMs(q.futuresTimestampMs) ||
      !validClockMs(a.indexAvailableAtMs) || !validClockMs(a.futuresAvailableAtMs) ||
      a.indexAvailableAtMs < q.indexTimestampMs || a.futuresAvailableAtMs < q.futuresTimestampMs ||
      r.availableAtMs < r.sourceAsOfMs) return unavailable("invalid_clock");
  if (Math.max(a.indexAvailableAtMs, a.futuresAvailableAtMs, r.availableAtMs) > p.decisionTimeMs)
    return unavailable("not_yet_available");
  if (p.decisionTimeMs < c.validFromMs || p.decisionTimeMs >= c.validUntilMs ||
      q.futuresTimestampMs < c.validFromMs || q.futuresTimestampMs >= c.validUntilMs)
    return unavailable("contract_inactive");
  const quoteAgeMs = p.decisionTimeMs - Math.min(q.indexTimestampMs, q.futuresTimestampMs);
  const exposureAgeMs = p.decisionTimeMs - r.sourceAsOfMs;
  if (quoteAgeMs > p.maxQuoteAgeMs) return unavailable("stale_quote");
  if (exposureAgeMs > p.maxExposureAgeMs) return unavailable("stale_exposure");
  let source = input.source;
  if (!isRecord(source)) return unavailable("source_schema");
  if (Object.prototype.hasOwnProperty.call(source, q.indexRoot)) source = source[q.indexRoot];
  if (!isRecord(source) || source.schema !== "options_hub.gex/v1") return unavailable("source_schema");
  if (source.root !== q.indexRoot) return unavailable("source_root");
  if (!text(source.asof) || source.asof.slice(0, 10) !== r.sessionDate) return unavailable("source_session");
  if (!Array.isArray(source.by_strike)) return unavailable("source_rows");
  const rows = [];
  for (const row of source.by_strike) {
    if (!isRecord(row) || !finiteNumber(row.strike) ||
        !(row.gamma_net === null || finiteNumber(row.gamma_net))) return unavailable("source_rows");
    // by_strike is already USD millions, unlike the matrix's whole-dollar cells.
    rows.push({ strike: row.strike, gammaNetMn: row.gamma_net });
  }
  if (rows.length === 0) return unavailable("empty_source");
  let matrixArtifactId: string | null = null, matrixAvailableAtMs: number | null = null,
    matrixAsOfMs: number | null = null;
  let selectedExpiries: string[] = [];
  if (lens.kind !== "all") {
    const selected = selectFuturesGexLens({ matrix: input.matrix, lens, root: q.indexRoot,
      sourceSession: r.sessionDate, strikes: rows.map(row => row.strike),
      decisionTimeMs: p.decisionTimeMs, maxAgeMs: p.maxExposureAgeMs });
    if (selected.status !== "ok") return unavailable(selected.reason);
    matrixArtifactId = selected.matrixArtifactId; matrixAvailableAtMs = selected.matrixAvailableAtMs;
    matrixAsOfMs = selected.matrixAsOfMs; selectedExpiries = selected.selectedExpiries;
    for (const row of rows) row.gammaNetMn = selected.byStrike.get(row.strike) ?? null;
  }
  if (rows.every(row => row.gammaNetMn === null)) return unavailable("empty_source");
  const projection = projectFuturesGex(q, rows, p.maxClockSkewMs, p.method);
  if (!projection) return unavailable("invalid_projection");
  const coverage = isRecord(source.coverage) ? source.coverage : null;
  return { status: "ok", schema: "terminal.futures_gex_frame/v1", projection, provenance: {
    artifactId: r.artifactId, definitionId: c.definitionId, sourceAsOf: source.asof,
    sourceAsOfMs: r.sourceAsOfMs, sourceAvailableAtMs: r.availableAtMs,
    decisionTimeMs: p.decisionTimeMs, indexAvailableAtMs: a.indexAvailableAtMs,
    futuresAvailableAtMs: a.futuresAvailableAtMs,
    indexFeedBasis: a.indexFeedBasis, futuresFeedBasis: a.futuresFeedBasis,
    quoteAgeMs, exposureAgeMs: Math.max(exposureAgeMs, matrixAsOfMs === null ? 0 : p.decisionTimeMs - matrixAsOfMs),
    frameAvailableAtMs: Math.max(a.indexAvailableAtMs, a.futuresAvailableAtMs, r.availableAtMs, matrixAvailableAtMs ?? 0),
    inventoryBasis: coverage && text(coverage.oi_date) ? coverage.oi_date : null,
    expiryLens: lens.kind, dealerPositioning: "estimate", expirySessionDate: r.sessionDate, selectedExpiries,
    expiryCutBasis: "source_session_date_not_trading_cutoff", matrixArtifactId, matrixAvailableAtMs, matrixAsOfMs,
  } };
}
