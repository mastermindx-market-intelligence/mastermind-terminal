// Data OS U02 — pure derivation of the chart's data-origin readout from the daily
// OHLC document's `view` block (schema "terminal.ohlc_view.v1", produced verbatim by
// ingest/polygon_bars.py::view_block). Pure only: no React, no lightweight-charts,
// no fetch. A file with no view is the NORMAL state today (Macro does not emit the
// contract yet) and reads as "unknown" — never an error, never a claimed "adjusted".

export type DataOriginState = "pending" | "known" | "partial" | "unknown" | "refused" | "unavailable" | "composite";

export interface DataOrigin {
  symbol: string;
  state: DataOriginState;
  basis: "tradj" | null;
  src: string | null;
  asOf: string | null;
  generation: string | null;
  /** B1 source clock — the document's OWN last daily session (a valid YYYY-MM-DD UTC date).
   *  Deliberately OPTIONAL: it is absent whenever the document is not exactly the requested
   *  symbol or its last bar carries no valid date, and it never fills asOf/generation, which
   *  remain the adjustment reference's own facts. */
  sourceLastSession?: string;
  mode: string | null;
  openReconstructed: boolean;
  segments: { from: string; to: string; src: string; quality: string }[];
  suspectedBreaks: number;
  basisDrift: boolean;
  refusals: string[];
}

// Readout-refusal codes that mean "this view is refused", not merely caveated.
const REFUSED_CODES = new Set(["VIEW_BASIS_UNSUPPORTED", "VENUE_OUT_OF_SCOPE", "LISTING_ABSENT"]);

function blank(symbol: string, state: DataOriginState, refusals: string[]): DataOrigin {
  return {
    symbol, state, refusals,
    basis: null, src: null, asOf: null, generation: null, mode: null,
    openReconstructed: false, segments: [], suspectedBreaks: 0, basisDrift: false,
  };
}

// "unknown" is the producer's placeholder for an unstated source, not a source name;
// the readout prints "unknown" itself (nulls printed, never hidden).
function srcOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "unknown" ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// B1 — the source clock reads ONLY the document's own last bar, as a real UTC-calendar
// YYYY-MM-DD date. A numeric timestamp (an intraday epoch), a malformed or impossible
// date ("2026-13-01", "2026-02-30"), an empty bars array and a non-tuple last bar all
// answer null — no fallback to a build clock, a coverage "to", or any other guess.
function lastDailySession(bars: unknown): string | null {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const last = bars[bars.length - 1];
  if (!Array.isArray(last) || last.length === 0) return null;
  const t = last[0];
  if (typeof t !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
  return t;
}

/**
 * Derive the readout state from one daily-OHLC document. Rules apply in order (see
 * the lane spec); the payload is never mutated and no missing value is guessed.
 */
export function deriveDataOrigin(symbol: string, payload: unknown): DataOrigin {
  if (payload == null || typeof payload !== "object") return blank(symbol, "unavailable", ["DATA_ABSENT"]);
  const doc = payload as Record<string, unknown>;
  if (typeof doc.t === "string" && doc.t.trim().toLowerCase() !== symbol.trim().toLowerCase()) {
    return blank(symbol, "unknown", ["SYMBOL_MISMATCH"]);
  }
  // D00.D4: a synthetic open is displayed as reconstructed, never passed off as traded.
  const openReconstructed = doc.bar_quality === "synthetic_open_deepstore";

  // B1 source clock: the document's own last daily session, computed from the mounted
  // document itself (independent of the view contract). Exact symbol identity only — the
  // case-insensitive mismatch guard above tolerates a case-variant file, but the clock
  // does not adopt it — and a valid UTC-calendar date on the last bar. Conditional spread
  // keeps the no-date constructors byte-identical to before: no field, never a null key.
  const sourceLastSession = doc.t === symbol ? lastDailySession(doc.bars) : null;

  const view = doc.view as Record<string, unknown> | undefined;
  if (view == null || typeof view !== "object" || view.schema !== "terminal.ohlc_view.v1") {
    return {
      ...blank(symbol, "unknown", ["VIEW_ABSENT"]),
      openReconstructed,
      src: srcOrNull(doc.src),
      ...(sourceLastSession ? { sourceLastSession } : {}),
    };
  }

  const refusals: string[] = Array.isArray(view.refusal_reasons)
    ? view.refusal_reasons.filter((c): c is string => typeof c === "string")
    : [];
  const segments = (Array.isArray(view.segments) ? view.segments : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      from: strOrNull(s.from) ?? "",
      to: strOrNull(s.to) ?? "",
      src: strOrNull(s.src) ?? "",
      quality: strOrNull(s.bar_quality) ?? "",
    }));
  const suspectedBreaks = Array.isArray(view.suspected_breaks) ? view.suspected_breaks.length : 0;
  const basisDrift = view.basis_drift != null;
  const listing = view.listing as Record<string, unknown> | null | undefined;
  // The chain picks its layer with raw values (?? falls only on nullish); the WINNING
  // value is then mapped — the literal "unknown" is the authority saying "I don't know",
  // not an invitation to guess from a lower-priority layer.
  const rawListingSrc = listing && typeof listing === "object" && typeof listing.src === "string" ? listing.src : undefined;
  const firstSeg = Array.isArray(view.segments) && view.segments[0] && typeof view.segments[0] === "object"
    ? view.segments[0] as Record<string, unknown> : undefined;
  const rawSegSrc = firstSeg && typeof firstSeg.src === "string" ? firstSeg.src : undefined;
  const src = srcOrNull(rawListingSrc ?? rawSegSrc ?? (typeof doc.src === "string" ? doc.src : undefined));

  const contract = view.contract as Record<string, unknown> | null | undefined;
  const base: DataOrigin = {
    ...blank(symbol, "unknown", refusals),
    ...(sourceLastSession ? { sourceLastSession } : {}),
    openReconstructed, segments, suspectedBreaks, basisDrift, src,
  };
  if (contract == null || typeof contract !== "object") return base;

  const adj = contract.adjustment_reference as Record<string, unknown> | undefined;
  const evidence = contract.evidence_mode as Record<string, unknown> | undefined;
  base.asOf = adj && typeof adj === "object" ? strOrNull(adj.as_at) : null;
  base.generation = adj && typeof adj === "object" ? strOrNull(adj.action_revision_set_id) : null;
  base.mode = evidence && typeof evidence === "object" ? strOrNull(evidence.mode) : null;

  const basis = adj && typeof adj === "object" ? adj.basis : undefined;
  if (refusals.some((c) => REFUSED_CODES.has(c))) {
    return { ...base, state: "refused" };
  }
  if (basis === "tradj") {
    return { ...base, state: refusals.length ? "partial" : "known", basis: "tradj" };
  }
  return {
    ...base,
    state: "refused",
    refusals: refusals.includes("VIEW_BASIS_UNSUPPORTED") ? refusals : [...refusals, "VIEW_BASIS_UNSUPPORTED"],
  };
}

/** No read yet — the chip shows a placeholder until the owning request settles. */
export function originPending(symbol: string): DataOrigin {
  return blank(symbol, "pending", []);
}

/** The daily file could not be loaded (failure-state law: distinct from "no history"). */
export function originUnavailable(symbol: string): DataOrigin {
  return blank(symbol, "unavailable", ["DATA_UNAVAILABLE"]);
}

/** A basket's origin is per leg; v1 does not claim one for the summed series. */
export function originComposite(symbol: string): DataOrigin {
  return blank(symbol, "composite", ["COMPOSITE_NOT_IN_V1"]);
}

/** A readout fact v1 deliberately does not cover (e.g. intraday bars). */
export function originNotCovered(symbol: string, code: "INTRADAY_NOT_IN_V1"): DataOrigin {
  return blank(symbol, "unknown", [code]);
}
