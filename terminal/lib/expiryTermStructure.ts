/**
 * expiryTermStructure.ts — pure transform for the Exposure-by-Expiry term-structure drawer
 * (Wave 2E). DOM-free so lib/__tests__/expiryTermStructure.test.ts can assert the
 * by_expiry → plot-node mapping (incl. the missing calls/puts-split → Net-only fallback)
 * without rendering a chart.
 *
 * The GEX payload's `by_expiry` carries per-expiration NET exposure only. Current payloads
 * may carry gamma/delta/vanna/charm; older archived payloads legitimately carry only
 * gamma/delta. There is NO calls/puts split in the payload, so the drawer ships a single Net
 * track and labels it honestly — it must never imply a call/put breakdown it doesn't have.
 * Bar direction (dealer-sign) is an assumption; magnitude is the read.
 *
 * This is an EOD structural read (the by_expiry snapshot), NOT an intraday series — the
 * drawer stamps its own as-of and does not participate in the replay scrubber.
 *
 * DTE + expiry-label maths moved to lib/dte.ts (T-A / B7 — the desk used to run two
 * conventions). The as-of-anchored form defined HERE is the one that won, so this module
 * re-exports it: every existing caller and test keeps importing from here unchanged.
 */

import { dteFrom, dteLabel, expLabel } from "./dte";

export { dteFrom, expLabel };

// Structural mirror of GexPayload["by_expiry"][number] — kept local so this lib has no
// dependency on the gexdesk component module (which is a client component).
export interface ExpiryRow {
  exp: string;
  gamma_net: number;
  delta_net?: number;
  vanna_net?: number | null;
  charm_net?: number | null;
  exposure_support?: { basis?: string; vanna?: unknown; charm?: unknown };
}

/** Which owner-native per-expiration net exposure lens the drawer plots. */
export type ExpiryLens = "gamma" | "delta" | "vanna" | "charm";

export type ExposureSign = -1 | 0 | 1;
export const EXPIRY_UNIT_KEYS = { gamma: "expiryUnitGamma", delta: "expiryUnitDelta", vanna: "expiryUnitVanna", charm: "expiryUnitCharm" } as const;

export interface ExpiryNode {
  exp: string; // raw expiry key (e.g. "2026-07-11")
  label: string; // MM-DD display label
  dte: number; // days-to-expiry from the snapshot's session date
  dteLabel: string; // "0DTE" | "3d" | …
  net: number; // reported complete-input value OR explicitly marked known subtotal
  partial: boolean;
  knownContracts: number | null;
  admittedContracts: number | null;
  sign: ExposureSign; // exact zero is neutral — never painted as + or − exposure
  mag: number; // |net|
  frac: number; // |net| / maxAbs across nodes, 0..1 (bubble size / bar length driver)
}

export interface ExpiryTermStructure {
  lens: ExpiryLens;
  available: boolean; // gamma/delta are schema-native; vanna/charm require a published row
  splitAvailable: false; // by_expiry never carries a calls/puts split → always Net-only
  nodes: ExpiryNode[]; // sorted nearest-expiration first; empty when no data
  maxAbs: number; // max |net| across nodes (0 when empty)
  sourceCount: number;
  missingCount: number;
  partialCount: number;
}

/** Signed exposure polarity. Exact zero is intentionally neutral. */
export function exposureSign(net: number): ExposureSign {
  return net > 0 ? 1 : net < 0 ? -1 : 0;
}

/** Net exposure for a row under the active lens. Missing fields stay null, never zero. */
export function expiryNetFor(r: ExpiryRow, lens: ExpiryLens): number | null {
  const raw =
    lens === "gamma" ? r.gamma_net
      : lens === "delta" ? r.delta_net
      : lens === "vanna" ? r.vanna_net
      : r.charm_net;
  return raw != null && Number.isFinite(raw) ? raw : null;
}

interface ExpiryObservation {
  net: number | null;
  partial: boolean;
  knownContracts: number | null;
  admittedContracts: number | null;
}
/** Support applies to the producer's admitted input frame, never a collected universe. */
export function expiryObservationFor(r: ExpiryRow, lens: ExpiryLens): ExpiryObservation {
  const net = expiryNetFor(r, lens);
  const unknown: ExpiryObservation = { net: null, partial: false, knownContracts: null, admittedContracts: null };
  if (lens !== "vanna" && lens !== "charm") return { ...unknown, net };
  const support = r.exposure_support;
  if (support == null) return { ...unknown, net }; // legacy display, completeness remains unknown
  const raw = support[lens];
  if (support.basis !== "admitted_input_contracts" || !raw || typeof raw !== "object" || Array.isArray(raw)) return unknown;
  const row = raw as Record<string, unknown>;
  const known = row.known_contracts, admitted = row.admitted_contracts, value = row.known_net;
  if (typeof known !== "number" || !Number.isSafeInteger(known) || known < 0
    || typeof admitted !== "number" || !Number.isSafeInteger(admitted) || admitted < 1 || known > admitted) return unknown;
  if (known === 0) return net === null && value === null ? { ...unknown, knownContracts: known, admittedContracts: admitted } : unknown;
  if (typeof value !== "number" || !Number.isFinite(value)) return unknown;
  const partial = known < admitted;
  if (partial ? net !== null : net !== value) return unknown;
  return { net: value, partial, knownContracts: known, admittedContracts: admitted };
}

/**
 * Transform a payload's `by_expiry` into the drawer's plot nodes for one lens.
 *
 * - Rows whose lens value is null/non-finite are dropped. An old payload that lacks
 *   vanna/charm therefore stays `available:false` and renders the existing honest
 *   "not per-expiration" state instead of inventing zeros.
 * - `frac` normalizes each node's magnitude to the max |net| so bubbles/bars share one scale.
 * - Nodes are sorted nearest-expiration first (ascending exp) so the term structure reads
 *   left→right / top→bottom by tenor.
 * - `splitAvailable` is always false: the payload carries no calls/puts split — Net-only.
 *
 * `asOf` anchors DTE deterministically (the by_expiry snapshot's day). Pure + DOM-free.
 */
export function byExpiryToTermStructure(
  byExpiry: ExpiryRow[] | null | undefined,
  lens: ExpiryLens,
  asOf: string | null | undefined,
): ExpiryTermStructure {
  const rows = byExpiry ?? [];
  const available =
    lens === "gamma" || lens === "delta"
      ? true
      : rows.some((r) => expiryObservationFor(r, lens).net != null || r.exposure_support?.basis === "admitted_input_contracts");
  const base: ExpiryTermStructure = {
    lens,
    available,
    splitAvailable: false,
    nodes: [],
    maxAbs: 0,
    sourceCount: rows.length, missingCount: rows.length, partialCount: 0,
  };
  if (!available || rows.length === 0) return base;

  const kept = rows
    .map((r) => ({ r, ...expiryObservationFor(r, lens) }))
    .filter((x): x is { r: ExpiryRow; net: number; partial: boolean; knownContracts: number | null; admittedContracts: number | null } => x.net != null)
    .sort((a, b) => a.r.exp.localeCompare(b.r.exp));
  if (kept.length === 0) return base;

  const maxAbs = kept.reduce((m, x) => Math.max(m, Math.abs(x.net)), 0);
  const denom = maxAbs > 0 ? maxAbs : 1;
  const nodes: ExpiryNode[] = kept.map(({ r, net, partial, knownContracts, admittedContracts }) => {
    const dte = dteFrom(r.exp, asOf);
    return {
      exp: r.exp,
      label: expLabel(r.exp),
      dte,
      dteLabel: dteLabel(dte),
      net, partial, knownContracts, admittedContracts,
      sign: exposureSign(net),
      mag: Math.abs(net),
      frac: Math.abs(net) / denom,
    };
  });
  return { lens, available, splitAvailable: false, nodes, maxAbs, sourceCount: rows.length,
    missingCount: rows.length - nodes.length, partialCount: nodes.filter(n => n.partial).length };
}
