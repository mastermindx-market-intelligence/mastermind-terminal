/** IM08-T4 International evidence adapter (repair r2 over rejected build
 * paper-01a1101f-im08-evidence-build-r1). Reuses the frozen investigationEvidenceDiff
 * kernel by composition; never copies the kernel algorithm. No storage, fetch, rights
 * grants or baseline mutation.
 *
 * Contract repair (im08-im09-contract-repair-r2, PATCH_ONLY): the result now
 * publishes the exact unique selected-measure id list alongside coverage
 * (`selectedMeasureIds`, first-occurrence order — the same derivation the
 * denominator already uses), so a composition can verify row MEMBERSHIP instead
 * of cardinality. Fail-closed results derive it with the same safe valid-ID law
 * as `selectedCount`; denominator behavior for malformed input is unchanged.
 * `CONTEXT_FIELDS` is exported so downstream mappers never re-declare the
 * nine-field law. No kernel change, no persistence or schema-version allocation.
 *
 * Repairs of the five demonstrated parent counterexamples:
 * 1. answerReadiness no longer invents sufficiency from baseline existence plus nonempty
 *    selectedMeasureIds. Readiness is derived only from the explicitly injected fourth
 *    argument `requirements` (frozen API: requiredMeasureIds + unmetPrerequisites),
 *    verified row-by-row against the scrubbed current census. Zero qualified fields or
 *    an unmet prerequisite can never be ready.
 * 2. A malformed context (including a missing selectedMeasureIds array) fails closed to
 *    an invalid review with answerReadiness incomplete; it never throws.
 * 3. The kernel census scope now deterministically encodes ALL nine context fields as a
 *    stable JSON array (CONTEXT_FIELDS order) inside the kernel's existing scope.query,
 *    so even a direct generic reviewEvidence call cannot compare across tool binding,
 *    market or window. Original owner scope stays discoverable in fullScope. This is an
 *    internal scope identity, not a manifest canonicalizer; no kernel copy.
 * 4. A failed (unavailable) whole read no longer relabels available rows as denied.
 *    Numerics are scrubbed and the row class follows the actual read failure class.
 * 5. Null/malformed result and observation arrays fail closed (invalid) instead of
 *    throwing; no silent deduplication of duplicate ids or colliding tombstones. */
import {
  reviewEvidence,
  type EvidenceAvailability,
  type EvidenceCensus,
  type EvidenceObservation,
  type EvidenceReview,
} from "./investigationEvidenceDiff";

/** Exact context required for international review. All nine scope strings must be nonempty;
 * selectedMeasureIds is separate from compare identity and feeds the coverage denominator. */
export interface IntlExactContext {
  researchMarket: string;
  toolBindingVersion: string;
  periodIdentity: string;
  currencyBasis: string;
  returnBasis: string;
  owner: string;
  query: string;
  cohort: string;
  temporalPolicy: string;
  selectedMeasureIds: readonly string[];
}

/** Trusted owner projection of an already-decoded observation. Interpretation is optional;
 * anything not fully usable is scrubbed before being passed to the kernel. */
export interface IntlInterpretation {
  value: number | null;
  unit: string | null;
  basis: string | null;
  cohort: string | null;
}

export interface IntlOwnerObservation {
  id: string;
  availability: EvidenceAvailability;
  qualified: boolean;
  excluded: boolean;
  correction: boolean;
  contentIdentity: string | null;
  qualificationIdentity: string | null;
  interpretation?: IntlInterpretation | null;
}

/** Trusted owner result projection. Carries its own 9-field context that must match
 * exactContext before any comparison is attempted. */
export interface IntlOwnerResult {
  researchMarket: string;
  toolBindingVersion: string;
  periodIdentity: string;
  currencyBasis: string;
  returnBasis: string;
  owner: string;
  query: string;
  cohort: string;
  temporalPolicy: string;
  generation: string;
  read: "ok" | "denied" | "unavailable";
  membership: "complete" | "page" | "top_k" | "unknown";
  observations: readonly IntlOwnerObservation[];
  tombstones: readonly string[];
}

/** Frozen readiness requirements API (repair 1). "Ready" can only ever be derived from
 * these explicitly injected required field IDs and prerequisite state, never inferred
 * from baseline existence or coverage counts. */
export interface IntlRequirements {
  requiredMeasureIds: readonly string[];
  unmetPrerequisites: readonly string[];
}

export interface IntlCoverage {
  /** Unique selected measure IDs (denominator that does not shrink when observations are absent). */
  selectedCount: number;
  /** Observations in selectedCount that survive the interpretation scrub as qualified. */
  qualifiedCount: number;
}

/** Safe census with the original 9-field owner scope preserved alongside the kernel's
 * 4-field scope (whose query now carries the full encoded identity). */
export type IntlSafeCensus = EvidenceCensus & {
  fullScope: Readonly<Record<string, string>>;
};

export interface IntlReviewResult {
  schema: "intl.investigation.evidence_review.v1";
  baselineState: "available" | "unavailable";
  review: EvidenceReview;
  currentSafeCensus: IntlSafeCensus;
  coverage: IntlCoverage;
  /** Exact unique selected measure ids (first-occurrence order) the coverage
   * denominator was computed over — the membership behind `coverage.selectedCount`.
   * Fail-closed results derive it with the same safe valid-ID law as the count. */
  selectedMeasureIds: readonly string[];
  answerReadiness: "incomplete" | "ready";
}

export const INTL_EVIDENCE_REVIEW_SCHEMA = "intl.investigation.evidence_review.v1" as const;

/** The nine exact-context scope fields, in the canonical order used to encode the
 * kernel scope identity. Exported (contract repair G7) so compositions import the
 * single law instead of re-declaring it. */
export const CONTEXT_FIELDS = [
  "researchMarket",
  "toolBindingVersion",
  "periodIdentity",
  "currencyBasis",
  "returnBasis",
  "owner",
  "query",
  "cohort",
  "temporalPolicy",
] as const;

const READ_STATES: readonly string[] = ["ok", "denied", "unavailable"];
const MEMBERSHIP_STATES: readonly string[] = ["complete", "page", "top_k", "unknown"];
const AVAILABILITY_STATES: readonly string[] = [
  "available",
  "stale",
  "denied",
  "unavailable",
  "not_applicable",
];

const KERNEL_FIELD_LIMIT = 10000;

function isStringNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Ordinary decoded-JSON object test (arrays rejected); no exotic proxy/accessor claims. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isContextValid(c: unknown): c is IntlExactContext {
  if (!isPlainObject(c)) return false;
  for (const f of CONTEXT_FIELDS) {
    if (!isStringNonEmpty(c[f])) return false;
  }
  if (!Array.isArray(c.selectedMeasureIds)) return false;
  for (const id of c.selectedMeasureIds) {
    if (!isStringNonEmpty(id)) return false;
  }
  return true;
}

function ownerContextMatches(c: IntlExactContext, r: Record<string, unknown>): boolean {
  return CONTEXT_FIELDS.every((f) => c[f] === r[f]);
}

/** Deterministic scope encoding for the kernel's 4-field scope (repair 3): a stable JSON
 * array of all nine context values in CONTEXT_FIELDS order, placed in scope.query. JSON
 * escaping makes the encoding injective — no naive-concatenation collisions — so distinct
 * contexts always yield distinct scope strings. Internal scope identity only; NOT a
 * manifest canonicalizer. Original owner scope remains discoverable in fullScope. */
function kernelScopeQuery(c: IntlExactContext): string {
  return JSON.stringify(CONTEXT_FIELDS.map((f) => c[f]));
}

interface ValidationOk { ok: true }
interface ValidationFail { ok: false; reason: string }
type Validation = ValidationOk | ValidationFail;

/** Validates raw owner arrays: non-array input, non-object rows, bad enums/flags,
 * duplicate ids, duplicate tombstones and tombstone/observation collisions all fail
 * closed. No silent deduplication — dedup here could fabricate completeness. */
function validateItems(observations: unknown, tombstones: unknown): Validation {
  if (!Array.isArray(observations)) return { ok: false, reason: "observations_not_array" };
  if (!Array.isArray(tombstones)) return { ok: false, reason: "tombstones_not_array" };
  if (observations.length > KERNEL_FIELD_LIMIT || tombstones.length > KERNEL_FIELD_LIMIT) {
    return { ok: false, reason: "size_limit" };
  }
  const ids = new Set<string>();
  for (const o of observations) {
    if (!isPlainObject(o)) return { ok: false, reason: "invalid_observation" };
    if (!isStringNonEmpty(o.id)) return { ok: false, reason: "empty_observation_id" };
    if (typeof o.availability !== "string" || !AVAILABILITY_STATES.includes(o.availability)) {
      return { ok: false, reason: "invalid_availability" };
    }
    if (typeof o.qualified !== "boolean") return { ok: false, reason: "invalid_qualified_flag" };
    if (typeof o.excluded !== "boolean") return { ok: false, reason: "invalid_excluded_flag" };
    if (typeof o.correction !== "boolean") return { ok: false, reason: "invalid_correction_flag" };
    if (ids.has(o.id)) return { ok: false, reason: "duplicate_observation_id" };
    ids.add(o.id);
  }
  const tombSet = new Set<string>();
  for (const t of tombstones) {
    if (!isStringNonEmpty(t)) return { ok: false, reason: "empty_tombstone" };
    if (tombSet.has(t)) return { ok: false, reason: "duplicate_tombstone" };
    if (ids.has(t)) return { ok: false, reason: "tombstone_collides_with_observation" };
    tombSet.add(t);
  }
  return { ok: true };
}

/** Keeps a numeric interpretation only when it is a well-formed object with a finite
 * number value and nonempty unit/basis/cohort. Everything else is removed before the
 * kernel ever sees it. */
function usableInterpretation(input: unknown): IntlInterpretation | null {
  if (!isPlainObject(input)) return null;
  const value = input.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!isStringNonEmpty(input.unit)) return null;
  if (!isStringNonEmpty(input.basis)) return null;
  if (!isStringNonEmpty(input.cohort)) return null;
  return { value, unit: input.unit, basis: input.basis, cohort: input.cohort };
}

/** Converts one owner observation into a kernel-safe observation. Numeric interpretation
 * is removed whenever the whole read failed, the row is unavailable/stale/denied/
 * not_applicable, unqualified, excluded, nonfinite, or missing unit/basis/cohort.
 * Availability class follows the real failure (repair 4): only a denied whole read may
 * relabel an available row as denied; an unavailable whole read keeps it unavailable. */
function scrubObservation(
  obs: IntlOwnerObservation,
  read: "ok" | "denied" | "unavailable",
): EvidenceObservation {
  let availability: EvidenceAvailability = obs.availability;
  if (read !== "ok" && availability === "available") {
    // Whole-read trust is gone; the row cannot assert its own class. Relabel with the
    // actual read failure class — an unavailable read is a failure, not a denial.
    availability = read;
  }
  let keep: IntlInterpretation | null = null;
  if (read === "ok" && availability === "available" && obs.qualified && !obs.excluded) {
    keep = usableInterpretation(obs.interpretation);
  }
  return {
    id: obs.id,
    availability,
    contentIdentity: isStringNonEmpty(obs.contentIdentity) ? obs.contentIdentity : null,
    qualificationIdentity: isStringNonEmpty(obs.qualificationIdentity)
      ? obs.qualificationIdentity
      : null,
    correction: obs.correction,
    excluded: obs.excluded,
    interpretation: keep
      ? { value: keep.value, unit: keep.unit, basis: keep.basis, cohort: keep.cohort }
      : null,
  };
}

interface BuildOk {
  ok: true;
  census: IntlSafeCensus;
  fullScope: Readonly<Record<string, string>>;
}
interface BuildFail { ok: false; reason: string }
type BuildResult = BuildOk | BuildFail;

/** Converts an owner result + exact context into an EvidenceCensus safe to compare —
 * including by a direct generic reviewEvidence call, because the kernel scope encodes
 * all nine context fields. Returns ok:false on malformed input, context mismatch or
 * duplicate/collision without ever exposing a partially-trusted census. */
export function toIntlEvidenceCensus(
  result: IntlOwnerResult,
  exactContext: IntlExactContext,
): BuildResult {
  if (!isContextValid(exactContext)) return { ok: false, reason: "invalid_context" };
  if (!isPlainObject(result)) return { ok: false, reason: "invalid_result" };
  if (!ownerContextMatches(exactContext, result)) {
    return { ok: false, reason: "context_mismatch" };
  }
  if (!isStringNonEmpty(result.generation)) {
    return { ok: false, reason: "missing_generation" };
  }
  if (!READ_STATES.includes(result.read)) return { ok: false, reason: "invalid_read" };
  if (!MEMBERSHIP_STATES.includes(result.membership)) {
    return { ok: false, reason: "invalid_membership" };
  }
  const v = validateItems(result.observations, result.tombstones);
  if (!v.ok) return { ok: false, reason: v.reason };

  const read = result.read as "ok" | "denied" | "unavailable";
  const items: EvidenceObservation[] = (result.observations as readonly IntlOwnerObservation[]).map(
    (o) => scrubObservation(o, read),
  );

  const fullScope: Record<string, string> = {};
  for (const f of CONTEXT_FIELDS) fullScope[f] = exactContext[f];

  const census: IntlSafeCensus = {
    scope: {
      owner: exactContext.owner,
      query: kernelScopeQuery(exactContext),
      cohort: exactContext.cohort,
      temporalPolicy: exactContext.temporalPolicy,
    },
    read,
    membership: result.membership as EvidenceCensus["membership"],
    generation: result.generation,
    items,
    tombstones: result.tombstones as readonly string[],
    fullScope,
  };
  return { ok: true, census, fullScope };
}

function emptyKernelScope(): EvidenceCensus["scope"] {
  return { owner: "", query: "", cohort: "", temporalPolicy: "" };
}

/** Synthetic non-substituting prior for a missing/ unusable baseline. read:"unavailable"
 * makes the kernel report the comparison as unavailable without ever exposing prior rows. */
function unavailablePrior(): EvidenceCensus {
  return {
    scope: emptyKernelScope(),
    read: "unavailable",
    membership: "unknown",
    generation: "",
    items: [],
    tombstones: [],
  };
}

function uniqueSelected(c: IntlExactContext): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of c.selectedMeasureIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Exact unique valid selected ids for a possibly-malformed context: [] unless
 * selectedMeasureIds is a real array; only nonempty-string ids are kept, deduped in
 * first-occurrence order. Used on fail-closed paths so they never throw (repair 2). */
function safeSelectedIds(c: unknown): string[] {
  if (!isPlainObject(c) || !Array.isArray(c.selectedMeasureIds)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of c.selectedMeasureIds) {
    if (isStringNonEmpty(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Denominator for a possibly-malformed context: 0 unless selectedMeasureIds is a real
 * array of nonempty strings. Used on fail-closed paths so they never throw (repair 2).
 * Same safe valid-ID law as `safeSelectedIds` — the count is exactly the list length. */
function safeSelectedCount(c: unknown): number {
  return safeSelectedIds(c).length;
}

function computeCoverage(
  census: EvidenceCensus,
  selectedIds: readonly string[],
): IntlCoverage {
  const unique = Array.from(new Set(selectedIds));
  const sel = new Set(unique);
  let qualified = 0;
  for (const id of sel) {
    const item = census.items.find((it) => it.id === id);
    if (!item) continue;
    if (item.availability !== "available") continue;
    if (item.excluded) continue;
    // interpretation !== null implies the row was available, qualified, not excluded,
    // finite, and carried unit/basis/cohort — the scrub removed it otherwise.
    if (item.interpretation === null) continue;
    qualified++;
  }
  return { selectedCount: unique.length, qualifiedCount: qualified };
}

/** Requirements are usable only when explicitly declared and well formed: a nonempty
 * array of nonempty required ids plus a string array of unmet prerequisites. Missing,
 * malformed or empty requirements are incomplete, never an error (repair 1). */
function isUsableRequirements(r: unknown): r is IntlRequirements {
  if (!isPlainObject(r)) return false;
  if (!Array.isArray(r.requiredMeasureIds) || r.requiredMeasureIds.length === 0) return false;
  for (const id of r.requiredMeasureIds) {
    if (!isStringNonEmpty(id)) return false;
  }
  if (!Array.isArray(r.unmetPrerequisites)) return false;
  for (const p of r.unmetPrerequisites) {
    if (!isStringNonEmpty(p)) return false;
  }
  return true;
}

const READINESS_BLOCKING_SUMMARIES: ReadonlySet<string> = new Set([
  "denied",
  "unavailable",
  "scope_changed",
  "invalid",
]);

/** Frozen readiness semantics (repair 1). Ready requires: explicit usable requirements,
 * no unmet prerequisites, a usable baseline, an exact-scope valid review (an incomplete
 * global membership does NOT by itself block readiness), and every required id verified
 * in the current scrubbed census as available + qualified + not excluded + finite numeric
 * with unit/basis/cohort. Independent of selected-coverage counts. Ready declares only
 * that stated prerequisites are satisfied — no completeness, investment or confidence claim. */
function computeReadiness(
  baselineState: "available" | "unavailable",
  review: EvidenceReview,
  currentCensus: EvidenceCensus,
  requirements: unknown,
): "incomplete" | "ready" {
  if (!isUsableRequirements(requirements)) return "incomplete";
  if (requirements.unmetPrerequisites.length > 0) return "incomplete";
  if (baselineState !== "available") return "incomplete";
  if (READINESS_BLOCKING_SUMMARIES.has(review.summary)) return "incomplete";
  const byId = new Map(currentCensus.items.map((it) => [it.id, it] as const));
  for (const id of requirements.requiredMeasureIds) {
    const item = byId.get(id);
    if (!item) return "incomplete";
    if (item.availability !== "available") return "incomplete";
    if (item.excluded) return "incomplete";
    // Survived the scrub => qualified + finite numeric + unit/basis/cohort present.
    if (item.interpretation === null) return "incomplete";
  }
  return "ready";
}

interface FinishArgs {
  currentCensus: IntlSafeCensus;
  exactContext: IntlExactContext;
  review: EvidenceReview;
  baselineState: "available" | "unavailable";
  requirements: unknown;
}

function finalize(args: FinishArgs): IntlReviewResult {
  // Single derivation of the unique selected list (first-occurrence order); the
  // coverage denominator is computed over exactly this membership.
  const unique = uniqueSelected(args.exactContext);
  const coverage = computeCoverage(args.currentCensus, unique);
  const answerReadiness = computeReadiness(
    args.baselineState,
    args.review,
    args.currentCensus,
    args.requirements,
  );
  return {
    schema: INTL_EVIDENCE_REVIEW_SCHEMA,
    baselineState: args.baselineState,
    review: args.review,
    currentSafeCensus: args.currentCensus,
    coverage,
    selectedMeasureIds: unique,
    answerReadiness,
  };
}

/** Fail-closed result: invalid review, unavailable baseline, no rows, no derived private
 * values, coverage denominator only from a genuinely valid selectedMeasureIds array.
 * Never throws on any ordinary decoded-JSON input (repair 2). */
function failClosed(exactContext: unknown, reason: string): IntlReviewResult {
  const fullScope: Record<string, string> = {};
  if (isContextValid(exactContext)) {
    for (const f of CONTEXT_FIELDS) fullScope[f] = exactContext[f];
  }
  const safeCensus: IntlSafeCensus = {
    scope: emptyKernelScope(),
    read: "unavailable",
    membership: "unknown",
    generation: "",
    items: [],
    tombstones: [],
    fullScope,
  };
  // The exact-reason string is private to the failing input and never surfaces in the
  // returned metadata; only the schema-typed summary conveys the failure mode.
  void reason;
  return {
    schema: INTL_EVIDENCE_REVIEW_SCHEMA,
    baselineState: "unavailable",
    review: {
      schema: "investigation.evidence_review.v1",
      priorGeneration: "",
      currentGeneration: "",
      summary: "invalid",
      items: [],
    },
    currentSafeCensus: safeCensus,
    coverage: { selectedCount: safeSelectedCount(exactContext), qualifiedCount: 0 },
    selectedMeasureIds: safeSelectedIds(exactContext),
    answerReadiness: "incomplete",
  };
}

/** Reviews an international evidence comparison. Returns kernel review + safe census +
 * baseline state + coverage + answerReadiness. Never substitutes current for a missing
 * baseline; denied or failed reads scrub all numerics before the kernel runs. The
 * optional fourth argument is the frozen requirements API driving answerReadiness. */
export function reviewIntlEvidence(
  priorResult: IntlOwnerResult | null,
  currentResult: IntlOwnerResult,
  exactContext: IntlExactContext,
  requirements?: IntlRequirements,
): IntlReviewResult {
  const currentBuild = toIntlEvidenceCensus(currentResult, exactContext);
  if (!currentBuild.ok) {
    return failClosed(exactContext, currentBuild.reason);
  }

  if (priorResult === null) {
    // Missing historical prior: comparison unavailable; current/latest is never substituted.
    return finalize({
      currentCensus: currentBuild.census,
      exactContext,
      review: reviewEvidence(unavailablePrior(), currentBuild.census),
      baselineState: "unavailable",
      requirements,
    });
  }

  const priorBuild = toIntlEvidenceCensus(priorResult, exactContext);
  if (!priorBuild.ok) {
    // A malformed or mismatched-context prior cannot be reviewed against the requested
    // context; no fallthrough to a different market/window and no current substitution.
    return finalize({
      currentCensus: currentBuild.census,
      exactContext,
      review: reviewEvidence(unavailablePrior(), currentBuild.census),
      baselineState: "unavailable",
      requirements,
    });
  }

  const baselineState: "available" | "unavailable" =
    priorBuild.census.read === "ok" ? "available" : "unavailable";
  return finalize({
    currentCensus: currentBuild.census,
    exactContext,
    review: reviewEvidence(priorBuild.census, currentBuild.census),
    baselineState,
    requirements,
  });
}
