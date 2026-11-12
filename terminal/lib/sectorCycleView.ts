/* ────────────────────────────────────────────────────────────────────────────
 * Capture/apply view codec (Macro #10707 semantics, natively ported).
 *
 * A captured view is the EXACT restorable state of one Cycles controller
 * instance: schema 'sector_dossier.view.v1' with exactly nine fields. Apply is
 * a two-phase operation — plan (pure validation against the current capture)
 * then verify (the controller re-renders and re-captures, and the actual view
 * must equal the requested one or the outcome is partial, never a lie).
 *
 * Outcomes mirror the donor exactly:
 *   applied  — every field restored
 *   partial  — re-render happened but the view did not fully restore
 *              (view_unavailable | source_changed | view_not_restored)
 *   rejected — nothing applied
 *              (view_unavailable | invalid_view | source_changed |
 *               values_unavailable | chart_unavailable)
 * ──────────────────────────────────────────────────────────────────────────── */

export const CYCLE_VIEW_SCHEMA = "sector_dossier.view.v1";
export const CYCLE_VIEW_FIELDS = [
  "schema",
  "publicationId",
  "id",
  "family",
  "asOf",
  "range",
  "valuesOpen",
  "sourcesOpen",
  "valuesOffset",
] as const;

export type CycleViewRange = [number, number];
export interface CycleViewSnapshot {
  schema: typeof CYCLE_VIEW_SCHEMA;
  publicationId: string;
  id: string;
  family: string;
  asOf: string;
  range: CycleViewRange | null;
  valuesOpen: boolean;
  sourcesOpen: boolean;
  valuesOffset: number;
}

export type CycleViewRejectReason =
  | "view_unavailable"
  | "invalid_view"
  | "source_changed"
  | "values_unavailable"
  | "chart_unavailable";
export type CycleViewPartialReason =
  | "view_unavailable"
  | "source_changed"
  | "view_not_restored";
export type CycleApplyOutcome =
  | { status: "applied"; reason: null }
  | { status: "partial"; reason: CycleViewPartialReason }
  | { status: "rejected"; reason: CycleViewRejectReason };

const PUBLICATION_ID = /^cycp1-[0-9a-f]{64}$/;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** What a live controller reports about itself when asked to capture. */
export interface CycleViewSource {
  /** Ready or stale views are capturable; loading/denied/unavailable are not. */
  state: "ready" | "stale" | "loading" | "denied" | "unavailable";
  subjectId: string | null;
  family: string | null;
  asOf: string | null;
  publicationVerified: boolean;
  publicationId: string | null;
  valuesOpen: boolean;
  sourcesOpen: boolean;
  valuesOffset: number;
  /** Current chart window in source coordinates, or null when no chart. */
  range: CycleViewRange | null;
}

/** Capture the current view, or null when the controller has nothing stable to
 * hand over (donor captureView). */
export function captureCycleView(source: CycleViewSource): CycleViewSnapshot | null {
  if (
    (source.state !== "ready" && source.state !== "stale") ||
    !source.subjectId ||
    !source.family ||
    !source.asOf ||
    !source.publicationVerified ||
    !source.publicationId ||
    !PUBLICATION_ID.test(source.publicationId)
  ) return null;
  return {
    schema: CYCLE_VIEW_SCHEMA,
    publicationId: source.publicationId,
    id: source.subjectId,
    family: source.family,
    asOf: source.asOf,
    range: source.range ? [source.range[0], source.range[1]] : null,
    valuesOpen: source.valuesOpen,
    sourcesOpen: source.sourcesOpen,
    valuesOffset: source.valuesOffset,
  };
}

const has = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

/** Strict parse of an externally supplied view: exactly the nine fields, with
 * donor-valid types and bounds. Extra or missing fields are invalid. */
export function parseCycleView(raw: unknown): CycleViewSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const view = raw as Record<string, unknown>;
  if (
    Object.keys(view).length !== CYCLE_VIEW_FIELDS.length ||
    !CYCLE_VIEW_FIELDS.every((k) => has(view, k)) ||
    view.schema !== CYCLE_VIEW_SCHEMA
  ) return null;
  if (
    typeof view.publicationId !== "string" ||
    typeof view.id !== "string" ||
    typeof view.family !== "string" ||
    typeof view.asOf !== "string" ||
    typeof view.valuesOpen !== "boolean" ||
    typeof view.sourcesOpen !== "boolean"
  ) return null;
  if (
    !Number.isSafeInteger(view.valuesOffset) ||
    (view.valuesOffset as number) < 0 ||
    (view.valuesOffset as number) > 1_000_000 ||
    (view.valuesOffset as number) % 50 !== 0
  ) return null;
  const range = view.range;
  if (
    range !== null &&
    (!Array.isArray(range) || range.length !== 2 ||
      !range.every(finite) || range[0] >= range[1])
  ) return null;
  return {
    schema: CYCLE_VIEW_SCHEMA,
    publicationId: view.publicationId,
    id: view.id,
    family: view.family,
    asOf: view.asOf,
    range: range === null ? null : [range[0], range[1]],
    valuesOpen: view.valuesOpen,
    sourcesOpen: view.sourcesOpen,
    valuesOffset: view.valuesOffset as number,
  };
}

export interface CycleViewApplyLimits {
  /** Whether the exact-values table has rows to page into. */
  historyReady: boolean;
  /** Highest legal valuesOffset for the current page count (floor((n-1)/50)*50). */
  lastOffset: number;
  /** Whether the chart can accept a range restore right now. */
  chartAvailable: boolean;
}

/** Phase 1 — validate the requested view against the current capture. A
 * "rejected" outcome must leave the controller exactly as it was. */
export function planCycleViewApply(
  raw: unknown,
  before: CycleViewSnapshot | null,
  limits: CycleViewApplyLimits,
): { status: "apply"; view: CycleViewSnapshot } | { status: "rejected"; reason: CycleViewRejectReason } {
  if (!before) return { status: "rejected", reason: "view_unavailable" };
  const view = parseCycleView(raw);
  if (!view) return { status: "rejected", reason: "invalid_view" };
  if (
    view.publicationId !== before.publicationId ||
    view.id !== before.id ||
    view.family !== before.family ||
    view.asOf !== before.asOf
  ) return { status: "rejected", reason: "source_changed" };
  if (
    view.valuesOffset > limits.lastOffset ||
    (view.valuesOpen && !limits.historyReady)
  ) return { status: "rejected", reason: "values_unavailable" };
  if (view.range !== null && !limits.chartAvailable) {
    return { status: "rejected", reason: "chart_unavailable" };
  }
  return { status: "apply", view };
}

/** Phase 2 — after the controller re-rendered, compare what it actually
 * captured against what was requested. */
export function verifyCycleViewApplied(
  requested: CycleViewSnapshot,
  actual: CycleViewSnapshot | null,
  beforeIdentity: Pick<CycleViewSnapshot, "publicationId" | "id" | "family" | "asOf">,
): CycleApplyOutcome {
  if (!actual) return { status: "partial", reason: "view_unavailable" };
  if (
    actual.publicationId !== beforeIdentity.publicationId ||
    actual.id !== beforeIdentity.id ||
    actual.family !== beforeIdentity.family ||
    actual.asOf !== beforeIdentity.asOf
  ) return { status: "partial", reason: "source_changed" };
  const equalRange =
    requested.range === null
      ? actual.range === null
      : actual.range !== null &&
        requested.range.every((n, i) => Math.abs(n - actual.range![i]) <= 1e-7);
  if (
    !equalRange ||
    actual.valuesOpen !== requested.valuesOpen ||
    actual.sourcesOpen !== requested.sourcesOpen ||
    actual.valuesOffset !== requested.valuesOffset
  ) return { status: "partial", reason: "view_not_restored" };
  return { status: "applied", reason: null };
}

/** Page size of the exact-values table (donor pagination contract). */
export const CYCLE_VIEW_PAGE = 50;
export const lastValuesOffset = (rows: number): number =>
  rows > 0 ? Math.floor((rows - 1) / CYCLE_VIEW_PAGE) * CYCLE_VIEW_PAGE : 0;

/* ── Generation-bound history handoff ──────────────────────────────────────── */

export { cycleGenerationKey, cycleHistoryForGeneration } from "./sectorCycleSnapshot";
export type { SectorCycleGeneration } from "./sectorCycleSnapshot";
