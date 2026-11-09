/**
 * expiryTermStructure.ts — pure transform for the Exposure-by-Expiry term-structure drawer
 * (Wave 2E). DOM-free so lib/__tests__/expiryTermStructure.test.ts can assert the
 * by_expiry → plot-node mapping (incl. the missing calls/puts-split → Net-only fallback)
 * without rendering a chart.
 *
 * The GEX payload's `by_expiry` carries per-expiration NET exposure only: `gamma_net` and
 * (optionally) `delta_net`. There is NO calls/puts split in the payload today, so the drawer
 * ships a single Net track and labels it honestly — it must never imply a call/put breakdown
 * it doesn't have. Bar direction (dealer-sign) is an assumption; magnitude is the read.
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
}

/** Which per-expiration lens the drawer plots. by_expiry only carries gamma + delta. */
export type ExpiryLens = "gamma" | "delta" | "vanna" | "charm";

export interface ExpiryNode {
  exp: string; // raw expiry key (e.g. "2026-07-11")
  label: string; // MM-DD display label
  dte: number; // days-to-expiry from the snapshot's session date
  dteLabel: string; // "0DTE" | "3d" | …
  net: number; // net exposure under the active lens
  isPos: boolean; // net >= 0 (sign colour selects var(--up)/var(--down))
  mag: number; // |net|
  frac: number; // |net| / maxAbs across nodes, 0..1 (bubble size / bar length driver)
}

export interface ExpiryTermStructure {
  lens: ExpiryLens;
  available: boolean; // false when the lens isn't carried per-expiration (vanna/charm)
  splitAvailable: false; // by_expiry never carries a calls/puts split → always Net-only
  nodes: ExpiryNode[]; // KNOWN values only, sorted nearest-expiration first; empty when no data
  maxAbs: number; // max |net| across nodes (0 when empty)
  /** Every by_expiry row, under every greek — the population never changes with the lens. */
  rowCount: number;
  /** Expiry keys (ascending) with no value for an available lens: unknown, never plotted as 0. */
  unresolved: string[];
}

/** Net exposure for a row under the active lens. by_expiry carries gamma + delta only. */
export function expiryNetFor(r: ExpiryRow, lens: ExpiryLens): number | null {
  if (lens === "gamma") return Number.isFinite(r.gamma_net) ? r.gamma_net : null;
  if (lens === "delta")
    return r.delta_net != null && Number.isFinite(r.delta_net) ? r.delta_net : null;
  return null; // vanna / charm not provided per-expiration
}

/**
 * Transform a payload's `by_expiry` into the drawer's plot nodes for one lens.
 *
 * - Rows whose lens value is null/non-finite get no plot node, but they stay in the
 *   population: `rowCount` counts every row and `unresolved` names the missing ones, so the
 *   drawer's count never changes with the greek (vanna/charm → `available:false`, empty nodes
 *   — the drawer shows an honest "not per-expiration" state). A measured 0 is a node.
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
  const available = lens === "gamma" || lens === "delta";
  const base: ExpiryTermStructure = {
    lens,
    available,
    splitAvailable: false,
    nodes: [],
    maxAbs: 0,
    rowCount: byExpiry?.length ?? 0,
    unresolved: [],
  };
  if (!available || !byExpiry || byExpiry.length === 0) return base;

  const valued = byExpiry
    .map((r) => ({ r, net: expiryNetFor(r, lens) }))
    .sort((a, b) => a.r.exp.localeCompare(b.r.exp));
  const unresolved = valued.filter((x) => x.net == null).map((x) => x.r.exp);
  const kept = valued.filter((x): x is { r: ExpiryRow; net: number } => x.net != null);
  if (kept.length === 0) return { ...base, unresolved };

  const maxAbs = kept.reduce((m, x) => Math.max(m, Math.abs(x.net)), 0);
  const denom = maxAbs > 0 ? maxAbs : 1;
  const nodes: ExpiryNode[] = kept.map(({ r, net }) => {
    const dte = dteFrom(r.exp, asOf);
    return {
      exp: r.exp,
      label: expLabel(r.exp),
      dte,
      dteLabel: dteLabel(dte),
      net,
      isPos: net >= 0,
      mag: Math.abs(net),
      frac: Math.abs(net) / denom,
    };
  });
  return { ...base, nodes, maxAbs, unresolved };
}
