/**
 * A saved smart screen evaluated the way the screener table evaluates it (E04 × E02).
 *
 * A grammar-2 definition carries E02 fundamental conditions next to its manifest `where`. The
 * table keeps a row only when the manifest filter matches AND `passes()` holds for the E02
 * screen; this module applies exactly that rule to one row, so the panel's match count and its
 * "why" trace can never disagree with what the table shows after the screen is opened.
 *
 * Manifest leaves keep the grammar's Kleene trace; fundamental conditions are evaluated only by
 * lib/fundamentalScan (one scaling boundary, one coverage partition). Until the fundamental
 * scan has answered the row is `fund_not_ready` — never a guessed match or miss — unless the
 * manifest already proves a miss (a false AND is false whatever else is unknown).
 */

import {
  evaluateFundamentalScreen,
  matchFundamentalPredicate,
  type FundamentalClassification,
  type FundamentalPredicate,
  type FundamentalScanSource,
} from "@/lib/fundamentalScan";
import type { ScanMatch } from "@/lib/screenerScan";
import { classifyRow, fundOf, type LeafTrace, type RowStatus, type ScreenDefinition, type ScreenRow } from "./predicate";

export type FundamentalContext = {
  /** null until the fundamental scan answers; then ready / absent / error. */
  source: FundamentalScanSource | null;
  /** The clock the E02 staleness rules are evaluated against. */
  nowMs: number;
};

export type FundamentalTrace = {
  predicate: FundamentalPredicate;
  match: ScanMatch;
  cell: FundamentalClassification | null;
};

export type ScreenRowStatus = RowStatus | "fund_not_ready";
export type ScreenRowVerdict = { status: ScreenRowStatus; trace: LeafTrace[]; fund: FundamentalTrace[] };

export function classifyScreenRow(def: ScreenDefinition, row: ScreenRow, ctx: FundamentalContext): ScreenRowVerdict {
  const base = classifyRow(def, row);
  const preds = fundOf(def);
  if (!preds.length || base.status === "out_of_scope" || base.status === "unpriced") return { ...base, fund: [] };
  if (ctx.source === null) {
    return { status: base.status === "fail" ? "fail" : "fund_not_ready", trace: base.trace, fund: [] };
  }
  const result = evaluateFundamentalScreen(ctx.source, row.sym, preds, ctx.nowMs);
  const fund = preds.map((predicate) => {
    const cell = result.cells[predicate.field] ?? null;
    return { predicate, cell, match: cell ? matchFundamentalPredicate(cell, predicate) : ("unknown" as ScanMatch) };
  });
  // The table's rule: only "pass" keeps a row (an opted-in unknown already evaluates to "pass").
  const fundTri = result.match === "pass" ? true : result.match === "fail" ? false : null;
  const status: RowStatus = base.status === "fail" || fundTri === false
    ? "fail"
    : base.status === "unknown" || fundTri === null ? "unknown" : "match";
  return { status, trace: base.trace, fund };
}

/**
 * How many rows a screen matches now, or why no count can be given. A fundamental screen is
 * counted only against a READY fundamental scan: with no answer yet the count is pending, and
 * with an absent or failed scan it is unavailable — a failed read is not "0 matches".
 */
export type ScreenCount =
  | { kind: "count"; n: number }
  | { kind: "fund_pending" }
  | { kind: "fund_unavailable" };

export function countScreenMatches(def: ScreenDefinition, rows: readonly ScreenRow[], ctx: FundamentalContext): ScreenCount {
  const fundamental = fundOf(def).length > 0;
  if (fundamental && ctx.source === null) return { kind: "fund_pending" };
  if (fundamental && ctx.source?.kind !== "ready") return { kind: "fund_unavailable" };
  let n = 0;
  for (const row of rows) if (classifyScreenRow(def, row, ctx).status === "match") n++;
  return { kind: "count", n };
}
