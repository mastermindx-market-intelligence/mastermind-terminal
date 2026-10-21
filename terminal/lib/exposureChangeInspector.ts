/**
 * Pure descriptive view model over `compareReportedGamma` (W1C).
 *
 * The inspector says what changed between two reported sessions and never
 * why: no velocity, no percentage, no attribution - those stay null at the
 * type level. Population counts sit beside the change and are never summed
 * into any change figure. The comparison itself stays owned by
 * `lib/exposureReportedChange.ts`; this module only reshapes its output and
 * validates the record it was handed.
 */

import type { ReportedGammaChange } from "@/lib/exposureReportedChange";

export const CHANGE_INSPECTOR_BASIS = "matched_reported_gamma/v1" as const;
export const CHANGE_INSPECTOR_TOP_K = 8;
export const CHANGE_INSPECTOR_MAX_K = 50;
export const CHANGE_INSPECTOR_FLAT_USD = 0.5;

export type ChangeInspectorState = "data" | "unavailable" | "single_session" | "invalid";

export type ChangeInspectorReason =
  | "missing_basis"
  | "identity"
  | "scope"
  | "definition"
  | "time"
  | "malformed"
  | "empty_intersection"
  | "one_session"
  | "malformed_input";

export interface ChangeInspectorRow {
  strike: number;
  contracts: number;
  previousNetUsd: number;
  currentNetUsd: number;
  signedChangeUsd: number;
  netMagnitudeChangeUsd: number;
  grossChangeUsd: number;
  direction: "up" | "down" | "flat";
  focus: boolean;
}

export interface ChangeInspectorInput {
  change: ReportedGammaChange | null | undefined;
  currentSession: string | null;
  previousSession: string | null;
  focusStrike?: number | null;
  topK?: number;
}

export interface ChangeInspectorModel {
  state: ChangeInspectorState;
  basis: typeof CHANGE_INSPECTOR_BASIS;
  reason: ChangeInspectorReason | null;
  sessions: { previous: string | null; current: string | null };
  populations: {
    matched: number;
    previousOnly: number;
    currentOnly: number;
    qualificationLost: number;
    qualificationGained: number;
    unavailableEither: number;
    previousObserved: number;
    currentObserved: number;
  } | null;
  aggregate: {
    contracts: number | null;
    previousNetUsd: number | null;
    currentNetUsd: number | null;
    signedChangeUsd: number | null;
    netMagnitudeChangeUsd: number | null;
    grossChangeUsd: number | null;
  };
  rows: ChangeInspectorRow[];
  more: number;
  focus: { strike: number; included: boolean; inTopK: boolean } | null;
  velocity: null;
  percentChange: null;
}

const STATS_FIELDS = [
  "contracts",
  "previousNetUsd",
  "currentNetUsd",
  "signedChangeUsd",
  "netMagnitudeChangeUsd",
  "previousGrossUsd",
  "currentGrossUsd",
  "grossChangeUsd",
] as const;

const POPULATION_FIELDS = [
  "previousObserved",
  "currentObserved",
  "previousQualified",
  "currentQualified",
  "matchedQualified",
  "previousOnlyReported",
  "currentOnlyReported",
  "qualificationLost",
  "qualificationGained",
  "unavailableEither",
] as const;

const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUS_SIGN = "−"; // U+2212, never an ASCII hyphen
const UNDATED = "—";

/** Exact canonical YYYY-MM-DD; rejects impossible dates such as 2026-02-30. */
function canonicalSession(value: string | null): string | null {
  if (value === null || !CANONICAL_DATE_PATTERN.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasFiniteStats(candidate: unknown): boolean {
  return isObject(candidate) && STATS_FIELDS.every((field) => isFiniteNumber(candidate[field]));
}

/** A `data` record whose own fields are unreadable is invalid, never shown. */
function isMalformedData(change: Extract<ReportedGammaChange, { state: "data" }>): boolean {
  const candidate = change as unknown as { basis: unknown; aggregate: unknown; population: unknown; byStrike: unknown };
  if (candidate.basis !== CHANGE_INSPECTOR_BASIS) return true;
  if (!hasFiniteStats(candidate.aggregate)) return true;
  const population = candidate.population;
  if (!isObject(population) || !POPULATION_FIELDS.every((field) => isCount(population[field]))) return true;
  if (!Array.isArray(candidate.byStrike)) return true;
  return candidate.byStrike.some(
    entry => !isObject(entry) || !isFiniteNumber(entry.strike) || (entry.strike as number) <= 0 || !hasFiniteStats(entry),
  );
}

function clampTopK(topK: number | undefined): number {
  if (typeof topK !== "number" || !Number.isFinite(topK)) return CHANGE_INSPECTOR_TOP_K;
  return Math.min(CHANGE_INSPECTOR_MAX_K, Math.max(1, Math.round(topK)));
}

function directionOf(signedChangeUsd: number): ChangeInspectorRow["direction"] {
  if (Math.abs(signedChangeUsd) < CHANGE_INSPECTOR_FLAT_USD) return "flat";
  return signedChangeUsd > 0 ? "up" : "down";
}

function emptyAggregate(): ChangeInspectorModel["aggregate"] {
  return {
    contracts: null,
    previousNetUsd: null,
    currentNetUsd: null,
    signedChangeUsd: null,
    netMagnitudeChangeUsd: null,
    grossChangeUsd: null,
  };
}

export function buildChangeInspector(input: ChangeInspectorInput): ChangeInspectorModel {
  const sessions = { previous: canonicalSession(input.previousSession), current: canonicalSession(input.currentSession) };
  const change = input.change ?? null;

  let state: ChangeInspectorState;
  let reason: ChangeInspectorReason | null;
  if (change === null) {
    const oneSession = (sessions.previous === null) !== (sessions.current === null);
    state = oneSession ? "single_session" : "unavailable";
    reason = oneSession ? "one_session" : "missing_basis";
  } else if (change.state === "unavailable") {
    state = "unavailable";
    reason = change.reason;
  } else if (change.state === "data" && isMalformedData(change)) {
    state = "invalid";
    reason = "malformed_input";
  } else if (change.state === "data") {
    state = "data";
    reason = null;
  } else {
    // An unknown state on a typed record is unreadable, like any other malformation.
    state = "invalid";
    reason = "malformed_input";
  }

  if (state !== "data" || change === null || change.state !== "data") {
    return {
      state,
      basis: CHANGE_INSPECTOR_BASIS,
      reason,
      sessions,
      populations: null,
      aggregate: emptyAggregate(),
      rows: [],
      more: 0,
      focus: null,
      velocity: null,
      percentChange: null,
    };
  }

  const topK = clampTopK(input.topK);
  const focusStrike = typeof input.focusStrike === "number" && Number.isFinite(input.focusStrike) ? input.focusStrike : null;
  const sorted = [...change.byStrike].sort(
    (left, right) => Math.abs(right.netMagnitudeChangeUsd) - Math.abs(left.netMagnitudeChangeUsd) || left.strike - right.strike,
  );
  const top = sorted.slice(0, topK);
  const focusEntry = focusStrike === null ? null : (sorted.find(entry => entry.strike === focusStrike) ?? null);
  const appendedFocus = focusEntry !== null && !top.includes(focusEntry) ? focusEntry : null;

  const toRow = (entry: (typeof sorted)[number]): ChangeInspectorRow => ({
    strike: entry.strike,
    contracts: entry.contracts,
    previousNetUsd: entry.previousNetUsd,
    currentNetUsd: entry.currentNetUsd,
    signedChangeUsd: entry.signedChangeUsd,
    netMagnitudeChangeUsd: entry.netMagnitudeChangeUsd,
    grossChangeUsd: entry.grossChangeUsd,
    direction: directionOf(entry.signedChangeUsd),
    focus: focusStrike !== null && entry.strike === focusStrike,
  });

  const rows = appendedFocus !== null ? [...top.map(toRow), toRow(appendedFocus)] : top.map(toRow);

  return {
    state: "data",
    basis: CHANGE_INSPECTOR_BASIS,
    reason: null,
    sessions,
    // Population counts stay counts; none of them is ever a change figure.
    populations: {
      matched: change.population.matchedQualified,
      previousOnly: change.population.previousOnlyReported,
      currentOnly: change.population.currentOnlyReported,
      qualificationLost: change.population.qualificationLost,
      qualificationGained: change.population.qualificationGained,
      unavailableEither: change.population.unavailableEither,
      previousObserved: change.population.previousObserved,
      currentObserved: change.population.currentObserved,
    },
    aggregate: {
      contracts: change.aggregate.contracts,
      previousNetUsd: change.aggregate.previousNetUsd,
      currentNetUsd: change.aggregate.currentNetUsd,
      signedChangeUsd: change.aggregate.signedChangeUsd,
      netMagnitudeChangeUsd: change.aggregate.netMagnitudeChangeUsd,
      grossChangeUsd: change.aggregate.grossChangeUsd,
    },
    rows,
    more: change.byStrike.length - top.length,
    focus:
      focusStrike === null
        ? null
        : { strike: focusStrike, included: focusEntry !== null, inTopK: focusEntry !== null && top.includes(focusEntry) },
    velocity: null,
    percentChange: null,
  };
}

function compactUnit(amount: number, divisor: number, suffix: string): string {
  return `${(amount / divisor).toFixed(2).replace(/\.?0+$/, "")}${suffix}`;
}

export function formatUsdCompact(value: number | null, signed = true): string {
  if (value === null || !Number.isFinite(value)) return UNDATED;
  const amount = Math.abs(value);
  const body =
    amount >= 1e9 ? compactUnit(amount, 1e9, "B") : amount >= 1e6 ? compactUnit(amount, 1e6, "M") : amount >= 1e3 ? compactUnit(amount, 1e3, "K") : String(Math.round(amount));
  const sign = value < 0 ? MINUS_SIGN : signed && value > 0 ? "+" : "";
  return `${sign}$${body}`;
}
