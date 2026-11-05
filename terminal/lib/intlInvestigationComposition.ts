/** IM08→IM09 composition (PATCH_ONLY, paper-01a1101f im08-im09-contract-repair-r2
 * over the parent-rejected r1 mapper).
 *
 * Pure mapper: exact `IntlReviewResult` (IM08 r2 + contract repair: publishes
 * `selectedMeasureIds`, exports `CONTEXT_FIELDS`) + explicit owner presentation
 * inputs → exact `IntlInvestigationPanelProps` (IM09 r1 + contract repair:
 * distinct failure statuses, distinct availability literals, lossless
 * `evidenceChanges` rows). No React mounting, DOM, I/O, fetch, storage, schema
 * change, rights grant, clock generation or callback invocation. Callbacks are
 * passed through by reference and never called here.
 *
 * Repairs of the six adjudicated gaps (PARENT_ADJUDICATION blocking findings):
 * - G1 discharged: the review's published `selectedMeasureIds` is the row
 *   authority. A caller-supplied list is verified by exact MEMBERSHIP, not
 *   cardinality — a same-count substitution of different ids is refused.
 * - G2 discharged: every kernel summary maps to its own panel status
 *   (denied / invalid / scope_changed are no longer collapsed into
 *   "unavailable"); no failure ever becomes "unchecked" or "unchanged".
 * - G3 discharged: read-ok-but-unqualified and not-applicable rows render
 *   `not_qualified` / `not_applicable`, never `unknown`.
 * - G4/G5 discharged: `evidenceChanges` carries, per stable measure id, every
 *   concurrent kernel dimension — membership, version, qualification,
 *   correction, exclusion, comparable prior/current/delta with the row's
 *   legitimate unit, or the exact non-comparable reason — and the panel
 *   renders it. The legacy per-dimension `changedItems` list is still emitted
 *   for compatibility but is NOT the rendered path and nothing lossless is
 *   left in diagnostics only.
 * - G6 discharged: per-row observation clocks are optional explicit owner
 *   data (`observedAtByMeasureId`, null semantics); absent stays null and
 *   clocks are suppressed for any row that is not qualified. No now(), no
 *   fetch time, no identity-as-time; the four record clocks stay exact/null.
 * - G7 discharged: `CONTEXT_FIELDS` is imported from IM08, never re-declared.
 *
 * Integrity rules carried over unchanged from r1 (OWNER_COMPATibility
 * safe_next_delta): one selected-measure row per UNIQUE selected id including
 * ids with no observation; panel recount must equal adapter coverage exactly
 * or the result is refused; `qualified` means exactly the adapter's scrubbed
 * usable interpretation; missing baseline is never substituted by current;
 * not_observed / not_previously_observed are never relabelled added/removed;
 * incomplete reviews keep known changes plus the limitation note; readiness
 * state is `answerReadiness` verbatim and owner text may only label it.
 *
 * Provenance of every string is fixed by FIELD_ORIGINS_R2.md: data strings
 * come from the owner verbatim; note text is this module's own closed bilingual
 * vocabulary built only from typed review state — it never contains values,
 * clocks or observation details that the adapter scrubbed.
 */
import {
  CONTEXT_FIELDS,
  INTL_EVIDENCE_REVIEW_SCHEMA,
  type IntlExactContext,
  type IntlRequirements,
  type IntlReviewResult,
} from "./intlInvestigationEvidence";
import type {
  EvidenceAvailability,
  EvidenceChange,
  EvidenceCensus,
  EvidenceObservation,
  EvidenceReview,
} from "./investigationEvidenceDiff";
import type {
  IntlChangedItem,
  IntlChangedKind,
  IntlComparisonStatus,
  IntlEvidenceChange,
  IntlEvidenceMembership,
  IntlEvidenceQualification,
  IntlEvidenceRowAvailability,
  IntlEvidenceVersion,
  IntlInvestigationPanelProps,
  IntlLang,
  IntlMeasureAvailability,
  IntlNonComparableReason,
  IntlReadiness,
  IntlSelectedMeasure,
} from "@/components/research/IntlInvestigationPanel";

/* ── owner-supplied presentation input (all explicit; nothing inferred) ──── */

export interface IntlCompositionCallbacks {
  onInspect?: (measureId: string) => void;
  onContinue?: () => void;
  onEdit?: () => void;
}

/** Explicit, already-localized owner presentation input. Field-origin rules
 * L0–L3 in FIELD_ORIGINS_R2.md; nothing here is derived from the review. */
export interface IntlCompositionOwnerInput {
  lang: IntlLang;
  /** Exact saved question, rendered verbatim (React-escaped by the panel). */
  question: string;
  marketLabel: string;
  toolLabel: string;
  periodLabel: string;
  basisLabel: string;
  /** L3: exact parent display strings. null is the ONLY way to say unavailable;
   * undefined or "" is refused so unavailability is always explicit. */
  savedAt: string | null;
  updatedAt: string | null;
  sourceGenerationAt: string | null;
  rightsAt: string | null;
  /** L1: trusted public labels by stable measure id, verbatim. */
  measureLabels: Readonly<Record<string, string>>;
  /** L2: already-localized unmet requirement labels, verbatim. Allowed only
   * while answerReadiness is "incomplete"; a "ready" review with labels is
   * refused as a readiness contradiction. */
  unmetLabels: readonly string[];
  /** L3 (G6 repair): optional explicit per-row observation clocks by stable
   * measure id. Absent id (or the whole map) stays null — never now()/fetch
   * time. Clocks are suppressed for every row that is not `qualified`
   * (denied / unavailable / excluded / stale / not_applicable /
   * not_qualified / absent), matching the panel's value-visibility law. */
  observedAtByMeasureId?: Readonly<Record<string, string | null>>;
}

export interface IntlCompositionInput {
  review: IntlReviewResult;
  /** L0: owner-declared selected ids, OPTIONAL since the contract repair —
   * the review itself now publishes the exact membership
   * (`review.selectedMeasureIds`), which is the row authority. When supplied,
   * this list is verified by exact membership (same-count substitution of
   * different ids is refused, not just cardinality drift). */
  selectedMeasureIds?: readonly string[];
  /** The requirements actually injected into reviewIntlEvidence, when the owner
   * still has them; used only for contradiction checks and gap diagnostics. */
  requirements?: IntlRequirements;
  /** The exact context the review was run under; cross-checked against
   * currentSafeCensus.fullScope and the encoded kernel scope when present. */
  exactContext?: IntlExactContext;
  owner: IntlCompositionOwnerInput;
  callbacks?: IntlCompositionCallbacks;
}

/* ── diagnostics (structured, non-rendered; the panel never sees these) ──── */

/** Every material change dimension the kernel can report. `numeric.delta` and
 * `version.revised` share the legacy panel kind "revised" but stay distinct. */
export type IntlMaterialDimension =
  | "membership.added"
  | "membership.removed"
  | "version.revised"
  | "numeric.delta"
  | "qualification.changed";

export interface IntlMaterialChangeDetail {
  id: string;
  dimension: IntlMaterialDimension;
  kind: IntlChangedKind;
  membership: EvidenceChange["membership"];
  version: EvidenceChange["version"];
  qualification: EvidenceChange["qualification"];
  availability: EvidenceAvailability;
  excluded: boolean;
  correction: boolean;
  /** Exact kernel numeric verdict; numbers only ever come from comparable
   * qualified rows the adapter already left unscrubbed. */
  interpretation: EvidenceChange["interpretation"];
}

export interface IntlCompositionDiagnostics {
  /** Exact kernel summary — identical to the panel status since the G2 repair. */
  kernelSummary: EvidenceReview["summary"];
  /** Status actually sent to the panel. */
  comparisonStatus: IntlComparisonStatus;
  /** Always false since the G2 repair: every failure summary now has its own
   * distinct panel status; nothing is collapsed into "unavailable". */
  collapsedSummary: false;
  /** Always false: no IntlReviewResult can produce panel "unchecked". */
  uncheckedUsed: false;
  /** Which list authored the selected rows: the review's published membership
   * (G1 repair) — the caller list is only ever verified against it. */
  selectedIdsAuthority: "review.published";
  baselineState: "available" | "unavailable";
  currentRead: "ok" | "denied" | "unavailable";
  currentMembership: EvidenceCensus["membership"];
  /** Opaque generation identity; never formatted as a clock by this module. */
  currentGeneration: string;
  coverage: {
    selectedCount: number;
    qualifiedCount: number;
    recomputedSelectedCount: number;
    recomputedQualifiedCount: number;
    agree: true;
  };
  duplicateSelectedIds: string[];
  selectedIdsWithoutObservation: string[];
  /** Ids where an explicit owner observation clock was intentionally
   * suppressed because the row is not qualified (G6 repair). */
  observationClocksSuppressed: string[];
  /** Ids sent as "qualified" whose value/unit the panel's visibleValue would
   * hide. Always empty for genuine IM08 results; non-empty is refused. */
  hiddenQualifiedValues: string[];
  /** Legacy per-dimension detail (compat mirror of `changedItems`); the
   * lossless rendered path is `props.evidenceChanges`. */
  materialChanges: IntlMaterialChangeDetail[];
  /** Kernel rows whose numeric comparison was not possible, with the exact
   * kernel reason (never relabelled "unchanged"). Also carried visibly in
   * `props.evidenceChanges[].nonComparableReason`. */
  nonComparable: Array<{ id: string; reason: EvidenceChange["interpretation"] }>;
  requirementsUsable: boolean;
  unmetPrerequisites: string[];
  /** Required ids not qualified in the current census (recomputed projection;
   * answerReadiness stays authoritative). Empty whenever state is "ready". */
  requirementGaps: string[];
  /** Provenance marker for every note string produced below. */
  noteVocabulary: "intl.composition.notes.v1";
}

export type IntlCompositionRefusalReason =
  | "invalid_input"
  | "invalid_review"
  | "context_mismatch"
  | "selected_ids_cardinality_mismatch"
  | "selected_ids_membership_mismatch"
  | "coverage_mismatch"
  | "unusable_qualified_interpretation"
  | "missing_measure_label"
  | "readiness_contradiction"
  | "status_consistency";

export type IntlCompositionResult =
  | {
      ok: true;
      props: IntlInvestigationPanelProps;
      diagnostics: IntlCompositionDiagnostics;
    }
  | {
      ok: false;
      reason: IntlCompositionRefusalReason;
      /** Ids / field names involved; never values, notes or clocks. */
      detail: string[];
    };

/* ── fixed constants ─────────────────────────────────────────────────────── */

const KERNEL_SUMMARIES: readonly string[] = [
  "changed",
  "unchanged",
  "incomplete",
  "scope_changed",
  "denied",
  "unavailable",
  "invalid",
];

/** Exact summary → panel status: the identity mapping since the G2 repair.
 * Every failure summary keeps its own literal; none is collapsed, and none
 * ever becomes "unchecked" (no IntlReviewResult means "not yet compared") or
 * "unchanged" (no failure is a zero-change result). */
const SUMMARY_TO_STATUS: Record<EvidenceReview["summary"], IntlComparisonStatus> = {
  changed: "changed",
  unchanged: "unchanged",
  incomplete: "incomplete",
  scope_changed: "scope_changed",
  denied: "denied",
  unavailable: "unavailable",
  invalid: "invalid",
};

/** Kernel row enum laws, validated before any row is projected or rendered. */
const KERNEL_MEMBERSHIPS: readonly string[] = [
  "present",
  "added",
  "removed",
  "not_observed",
  "not_previously_observed",
];
const KERNEL_VERSIONS: readonly string[] = ["initial", "unchanged", "revised", "unknown"];
const KERNEL_QUALIFICATIONS: readonly string[] = ["unchanged", "changed", "unknown"];
const KERNEL_AVAILABILITIES: readonly string[] = [
  "available",
  "stale",
  "denied",
  "unavailable",
  "not_applicable",
];
const NON_COMPARABLE_REASONS: readonly string[] = [
  "unavailable",
  "not_applicable",
  "missing",
  "incompatible",
];

/** Material dimension → legacy panel kind (compat path only). */
const DIMENSION_TO_KIND: Record<IntlMaterialDimension, IntlChangedKind> = {
  "membership.added": "added",
  "membership.removed": "removed",
  "version.revised": "revised",
  "numeric.delta": "revised",
  "qualification.changed": "qualification_changed",
};

/* ── closed bilingual note vocabulary (mapper-authored; no data strings) ──── */

type MeasureNoteKind =
  | "qualified"
  | "not_qualified"
  | "excluded"
  | "stale"
  | "denied"
  | "unavailable"
  | "not_applicable"
  | "not_observed";

const MEASURE_NOTES: Record<IntlLang, Record<MeasureNoteKind, string>> = {
  en: {
    qualified: "",
    not_qualified:
      "Read succeeded, but this measure is not qualified evidence; no value is shown.",
    excluded: "Excluded from qualified evidence; no value is shown.",
    stale: "Evidence is stale; no value is shown.",
    denied: "No rights were granted for this measure; no value is shown.",
    unavailable: "Evidence is unavailable for this measure; no value is shown.",
    not_applicable: "This measure does not apply to the current read; no value is shown.",
    not_observed: "Not observed in the current evidence read.",
  },
  zh: {
    qualified: "",
    not_qualified: "读取成功，但该指标不属于合格证据；不显示数值。",
    excluded: "已从合格证据中排除；不显示数值。",
    stale: "证据已过期；不显示数值。",
    denied: "未获得该指标的访问授权；不显示数值。",
    unavailable: "该指标证据不可用；不显示数值。",
    not_applicable: "该指标不适用于本次读取；不显示数值。",
    not_observed: "本次证据读取中未观察到该指标。",
  },
};

const CHANGE_NOTES: Record<IntlLang, Record<IntlMaterialDimension, string>> = {
  en: {
    "membership.added": "Present now, absent from the saved baseline.",
    "membership.removed":
      "In the saved baseline, absent now; removal is confirmed by an owner tombstone or complete current membership, not inferred from a missing page.",
    "version.revised": "Saved-baseline content identity changed for this measure.",
    "numeric.delta": "Qualified numeric value changed against the saved baseline.",
    "qualification.changed": "Qualification, exclusion or correction state changed.",
  },
  zh: {
    "membership.added": "现在存在，已保存基线中没有。",
    "membership.removed":
      "在已保存基线中存在，现在不存在；移除由所有者墓碑或完整的当前成员关系确认，并非由缺失页推断。",
    "version.revised": "该指标的已保存基线内容标识已变化。",
    "numeric.delta": "合格数值相对已保存基线发生变化。",
    "qualification.changed": "资格、排除或更正状态发生变化。",
  },
};

/* ── small guards (fail closed on anything not ordinary decoded JSON) ────── */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** A clock must be an explicit display string or an explicit null. */
function isExplicitClock(v: unknown): v is string | null {
  return v === null || isNonEmptyString(v);
}

function fail(reason: IntlCompositionRefusalReason, detail: string[]): IntlCompositionResult {
  return { ok: false, reason, detail };
}

/* ── owner input validation ─────────────────────────────────────────────── */

function validateOwnerInput(owner: IntlCompositionOwnerInput): IntlCompositionResult | null {
  if (!isPlainObject(owner)) return fail("invalid_input", ["owner"]);
  if (owner.lang !== "en" && owner.lang !== "zh") {
    return fail("invalid_input", ["lang"]);
  }
  for (const f of ["question", "marketLabel", "toolLabel", "periodLabel", "basisLabel"] as const) {
    if (!isNonEmptyString(owner[f])) return fail("invalid_input", [f]);
  }
  for (const f of [
    "savedAt",
    "updatedAt",
    "sourceGenerationAt",
    "rightsAt",
  ] as const) {
    if (!isExplicitClock(owner[f])) return fail("invalid_input", [f]);
  }
  if (!isPlainObject(owner.measureLabels)) return fail("invalid_input", ["measureLabels"]);
  for (const [id, label] of Object.entries(owner.measureLabels)) {
    if (!isNonEmptyString(label)) return fail("invalid_input", [`measureLabels.${id}`]);
  }
  if (!Array.isArray(owner.unmetLabels)) return fail("invalid_input", ["unmetLabels"]);
  for (const [i, u] of owner.unmetLabels.entries()) {
    if (!isNonEmptyString(u)) return fail("invalid_input", [`unmetLabels.${i}`]);
  }
  if (owner.observedAtByMeasureId !== undefined) {
    if (!isPlainObject(owner.observedAtByMeasureId)) {
      return fail("invalid_input", ["observedAtByMeasureId"]);
    }
    for (const [id, clock] of Object.entries(owner.observedAtByMeasureId)) {
      if (!isExplicitClock(clock)) return fail("invalid_input", [`observedAtByMeasureId.${id}`]);
    }
  }
  return null;
}

/* ── review validation ──────────────────────────────────────────────────── */

function validateReview(review: IntlReviewResult): IntlCompositionResult | null {
  if (!isPlainObject(review)) return fail("invalid_review", ["review"]);
  if (review.schema !== INTL_EVIDENCE_REVIEW_SCHEMA) {
    return fail("invalid_review", ["schema"]);
  }
  if (review.baselineState !== "available" && review.baselineState !== "unavailable") {
    return fail("invalid_review", ["baselineState"]);
  }
  const r = review.review;
  if (!isPlainObject(r) || r.schema !== "investigation.evidence_review.v1") {
    return fail("invalid_review", ["review.schema"]);
  }
  if (typeof r.summary !== "string" || !KERNEL_SUMMARIES.includes(r.summary)) {
    return fail("invalid_review", ["review.summary"]);
  }
  if (!Array.isArray(r.items)) return fail("invalid_review", ["review.items"]);
  const census = review.currentSafeCensus;
  if (!isPlainObject(census) || !Array.isArray(census.items)) {
    return fail("invalid_review", ["currentSafeCensus.items"]);
  }
  if (
    !isPlainObject(census.scope) ||
    (census.read !== "ok" && census.read !== "denied" && census.read !== "unavailable") ||
    (census.membership !== "complete" &&
      census.membership !== "page" &&
      census.membership !== "top_k" &&
      census.membership !== "unknown")
  ) {
    return fail("invalid_review", ["currentSafeCensus.scope"]);
  }
  if (review.answerReadiness !== "incomplete" && review.answerReadiness !== "ready") {
    return fail("invalid_review", ["answerReadiness"]);
  }
  if (!isPlainObject(review.coverage)) return fail("invalid_review", ["coverage"]);
  const { selectedCount, qualifiedCount } = review.coverage;
  if (
    typeof selectedCount !== "number" || !Number.isInteger(selectedCount) || selectedCount < 0 ||
    typeof qualifiedCount !== "number" || !Number.isInteger(qualifiedCount) || qualifiedCount < 0 ||
    qualifiedCount > selectedCount
  ) {
    return fail("invalid_review", ["coverage"]);
  }
  // G1 repair: the review must publish the exact membership behind the
  // denominator — a genuine IM08 output always does. Unique, nonempty, and
  // exactly as long as the declared count.
  const published = review.selectedMeasureIds;
  if (!Array.isArray(published)) return fail("invalid_review", ["selectedMeasureIds"]);
  const publishedSeen = new Set<string>();
  for (const id of published) {
    if (!isNonEmptyString(id)) return fail("invalid_review", ["selectedMeasureIds"]);
    if (publishedSeen.has(id)) return fail("invalid_review", ["selectedMeasureIds"]);
    publishedSeen.add(id);
  }
  if (published.length !== selectedCount) {
    return fail("invalid_review", ["selectedMeasureIds"]);
  }
  return null;
}

/* ── adapter row projection ─────────────────────────────────────────────── */

/** Exactly the adapter's usable-interpretation predicate, tightened by the
 * panel's own visibility rule: a row counts as qualified only when the value it
 * would show is a finite number with a unit. Anything else is never silent
 * health. */
function isQualifiedRow(item: EvidenceObservation): boolean {
  if (item.availability !== "available" || item.excluded) return false;
  const it = item.interpretation;
  if (it === null || it === undefined) return false;
  if (typeof it.value !== "number" || !Number.isFinite(it.value)) return false;
  if (typeof it.unit !== "string" || it.unit.trim() === "") return false;
  return true;
}

interface MeasureProjection {
  availability: IntlMeasureAvailability;
  noteKind: MeasureNoteKind;
}

/** Total projection since the G3 repair: every adapter state has its own panel
 * literal. Only a genuinely absent row stays `unknown`. */
function projectMeasure(item: EvidenceObservation | undefined): MeasureProjection {
  if (item === undefined) {
    return { availability: "unknown", noteKind: "not_observed" };
  }
  switch (item.availability) {
    case "available":
      if (isQualifiedRow(item)) return { availability: "qualified", noteKind: "qualified" };
      if (item.excluded) return { availability: "excluded", noteKind: "excluded" };
      return { availability: "not_qualified", noteKind: "not_qualified" };
    case "stale":
      return { availability: "stale", noteKind: "stale" };
    case "denied":
      return { availability: "denied", noteKind: "denied" };
    case "unavailable":
      return { availability: "unavailable", noteKind: "unavailable" };
    case "not_applicable":
      return { availability: "not_applicable", noteKind: "not_applicable" };
  }
}

/** Material dimensions for one kernel change row, in a stable order. */
function materialDimensions(row: EvidenceChange): IntlMaterialDimension[] {
  const out: IntlMaterialDimension[] = [];
  if (row.membership === "added") out.push("membership.added");
  if (row.membership === "removed") out.push("membership.removed");
  if (row.version === "revised") out.push("version.revised");
  if (row.interpretation.comparable && row.interpretation.delta !== 0) {
    out.push("numeric.delta");
  }
  if (row.qualification === "changed") out.push("qualification.changed");
  return out;
}

/** Rows carried into `evidenceChanges`: every material row, plus every row the
 * kernel itself counts toward incompleteness (partial-membership limitations,
 * unknown version/qualification, non-comparable numeric with a reason other
 * than not_applicable). Fully clean rows state nothing and are omitted. */
function isEvidenceWorthy(row: EvidenceChange, material: boolean): boolean {
  if (material) return true;
  if (row.membership === "not_observed" || row.membership === "not_previously_observed") {
    return true;
  }
  if (row.version === "unknown" || row.qualification === "unknown") return true;
  return !row.interpretation.comparable && row.interpretation.reason !== "not_applicable";
}

/** Structural validation of one kernel change row before it is projected. */
function validateKernelRow(row: unknown): IntlCompositionResult | null {
  if (!isPlainObject(row) || !isNonEmptyString(row.id)) {
    return fail("invalid_review", ["review.items"]);
  }
  if (
    typeof row.membership !== "string" || !KERNEL_MEMBERSHIPS.includes(row.membership) ||
    typeof row.version !== "string" || !KERNEL_VERSIONS.includes(row.version) ||
    typeof row.qualification !== "string" || !KERNEL_QUALIFICATIONS.includes(row.qualification) ||
    typeof row.availability !== "string" || !KERNEL_AVAILABILITIES.includes(row.availability) ||
    typeof row.excluded !== "boolean" || typeof row.correction !== "boolean"
  ) {
    return fail("invalid_review", ["review.items"]);
  }
  const it = row.interpretation;
  if (!isPlainObject(it)) return fail("invalid_review", ["review.items"]);
  if (it.comparable === true) {
    if (
      typeof it.prior !== "number" || !Number.isFinite(it.prior) ||
      typeof it.current !== "number" || !Number.isFinite(it.current) ||
      typeof it.delta !== "number" || !Number.isFinite(it.delta)
    ) {
      return fail("invalid_review", ["review.items"]);
    }
  } else if (it.comparable !== false || typeof it.reason !== "string" || !NON_COMPARABLE_REASONS.includes(it.reason)) {
    return fail("invalid_review", ["review.items"]);
  }
  return null;
}

/* ── composition ────────────────────────────────────────────────────────── */

export function composeIntlInvestigationPanel(
  input: IntlCompositionInput,
): IntlCompositionResult {
  if (!isPlainObject(input)) return fail("invalid_input", ["input"]);
  // Callbacks are a narrow channel; never spread caller keys over reviewed props.
  const callbacks: IntlCompositionCallbacks = {};
  if (input.callbacks !== undefined) {
    if (!isPlainObject(input.callbacks)) return fail("invalid_input", ["callbacks"]);
    for (const [key, value] of Object.entries(input.callbacks)) {
      if (!["onInspect", "onContinue", "onEdit"].includes(key) ||
          (value !== undefined && typeof value !== "function")) {
        return fail("invalid_input", [`callbacks.${key}`]);
      }
    }
    for (const key of ["onInspect", "onContinue", "onEdit"] as const) {
      if (Object.hasOwn(input.callbacks, key) && input.callbacks[key] !== undefined) {
        callbacks[key] = input.callbacks[key] as ((measureId: string) => void) & (() => void);
      }
    }
  }
  const ownerInvalid = validateOwnerInput(input.owner);
  if (ownerInvalid) return ownerInvalid;
  const owner = input.owner;
  const reviewInvalid = validateReview(input.review);
  if (reviewInvalid) return reviewInvalid;
  const review: IntlReviewResult = input.review;

  /* G1 repair: the published membership is the authority. */
  const published: readonly string[] = review.selectedMeasureIds;
  const publishedSet = new Set(published);
  const duplicateSelectedIds: string[] = [];

  if (input.selectedMeasureIds !== undefined) {
    if (!Array.isArray(input.selectedMeasureIds)) {
      return fail("invalid_input", ["selectedMeasureIds"]);
    }
    const callerSeen = new Set<string>();
    for (const [i, id] of input.selectedMeasureIds.entries()) {
      if (!isNonEmptyString(id)) return fail("invalid_input", [`selectedMeasureIds.${i}`]);
      if (callerSeen.has(id)) {
        duplicateSelectedIds.push(id);
        continue;
      }
      callerSeen.add(id);
    }
    const uniqueCaller = Array.from(callerSeen);
    if (uniqueCaller.length !== published.length) {
      return fail("selected_ids_cardinality_mismatch", [
        `declared=${uniqueCaller.length}`,
        `published=${published.length}`,
      ]);
    }
    // Same cardinality is not membership: refuse any substitution (G1).
    const offending = uniqueCaller.filter((id) => !publishedSet.has(id));
    if (offending.length > 0) {
      return fail("selected_ids_membership_mismatch", offending);
    }
  }

  /* Optional exact-context integrity check against the census the adapter built.
     CONTEXT_FIELDS is imported from IM08 (G7 repair) — no re-declared law. */
  const census = review.currentSafeCensus;
  if (input.exactContext !== undefined) {
    const ctx = input.exactContext;
    if (!isPlainObject(ctx)) return fail("invalid_input", ["exactContext"]);
    const fullScope = census.fullScope as Readonly<Record<string, string>>;
    if (isPlainObject(fullScope) && Object.keys(fullScope).length > 0) {
      for (const f of CONTEXT_FIELDS) {
        if (fullScope[f] !== ctx[f]) {
          return fail("context_mismatch", [f]);
        }
      }
    }
    if (isNonEmptyString(census.scope?.query)) {
      const encoded = JSON.stringify(CONTEXT_FIELDS.map((f) => ctx[f]));
      if (census.scope.query !== encoded) return fail("context_mismatch", ["scope.query"]);
    }
  }

  /* Current census rows by id; duplicates would make row projection ambiguous. */
  const byId = new Map<string, EvidenceObservation>();
  for (const item of census.items) {
    if (!isPlainObject(item) || !isNonEmptyString(item.id)) {
      return fail("invalid_review", ["currentSafeCensus.items"]);
    }
    if (byId.has(item.id)) return fail("invalid_review", [`duplicate_census_id:${item.id}`]);
    byId.set(item.id, item as EvidenceObservation);
  }

  /* Selected measure rows: exactly one per published selected id, in the
     published order, always visible — including ids with no observation. */
  const selectedMeasures: IntlSelectedMeasure[] = [];
  const hiddenQualifiedValues: string[] = [];
  const selectedIdsWithoutObservation: string[] = [];
  const observationClocksSuppressed: string[] = [];
  const notes = MEASURE_NOTES[owner.lang];

  for (const id of published) {
    const item = byId.get(id);
    const projection = projectMeasure(item);
    const label = owner.measureLabels[id];
    if (!isNonEmptyString(label)) {
      return fail("missing_measure_label", [id]);
    }
    if (item === undefined) selectedIdsWithoutObservation.push(id);
    let value: number | null = null;
    let unit: string | null = null;
    if (projection.availability === "qualified" && item && item.interpretation) {
      // The isQualifiedRow predicate guarantees finite value and nonempty unit,
      // so the panel's visibleValue will actually render this number.
      value = item.interpretation.value;
      unit = item.interpretation.unit;
    }
    // G6 repair: explicit owner clock, qualified rows only; suppressed
    // everywhere else; absent stays null. Never generated here.
    const ownerClock = owner.observedAtByMeasureId?.[id];
    let observedAt: string | null = null;
    if (projection.availability === "qualified" && typeof ownerClock === "string") {
      observedAt = ownerClock;
    } else if (typeof ownerClock === "string") {
      observationClocksSuppressed.push(id);
    }
    selectedMeasures.push({
      stableId: id,
      label,
      availability: projection.availability,
      value,
      unit,
      note: notes[projection.noteKind],
      observedAt,
    });
  }

  /* Coverage agreement: the panel recomputes both counts from these rows, so
     they must equal the adapter's coverage exactly or the props would lie. */
  const recomputedQualified = selectedMeasures.filter((m) => m.availability === "qualified").length;
  if (recomputedQualified !== review.coverage.qualifiedCount) {
    // Either the result was not produced by IM08 (scrub guarantees a shown
    // value for every qualified row) or coverage is inconsistent. Refuse.
    if (selectedMeasures.some((m) => m.availability !== "qualified" && byId.get(m.stableId)?.interpretation)) {
      return fail("unusable_qualified_interpretation", [
        `recomputed=${recomputedQualified}`,
        `coverage.qualifiedCount=${review.coverage.qualifiedCount}`,
      ]);
    }
    return fail("coverage_mismatch", [
      `recomputed=${recomputedQualified}`,
      `coverage.qualifiedCount=${review.coverage.qualifiedCount}`,
    ]);
  }
  for (const m of selectedMeasures) {
    if (m.availability === "qualified" && (m.value === null || m.unit === null)) {
      hiddenQualifiedValues.push(m.stableId);
    }
  }
  if (hiddenQualifiedValues.length > 0) {
    return fail("unusable_qualified_interpretation", hiddenQualifiedValues);
  }

  /* Change rows. One pass builds:
     - `changedItems`   — legacy per-dimension list (compat; not the rendered
       path when evidenceChanges is present);
     - `evidenceChanges`— the lossless rendered path: ONE row per stable
       measure id carrying every concurrent kernel dimension. */
  const kernelItems = review.review.items as readonly unknown[];
  const changedItems: IntlChangedItem[] = [];
  const evidenceChanges: IntlEvidenceChange[] = [];
  const materialChanges: IntlMaterialChangeDetail[] = [];
  const nonComparable: Array<{ id: string; reason: EvidenceChange["interpretation"] }> = [];
  const changeNotes = CHANGE_NOTES[owner.lang];
  const emitted = new Set<string>();

  for (const rowUnknown of kernelItems) {
    const rowInvalid = validateKernelRow(rowUnknown);
    if (rowInvalid) return rowInvalid;
    const row = rowUnknown as EvidenceChange;
    if (!row.interpretation.comparable) {
      nonComparable.push({ id: row.id, reason: row.interpretation });
    }
    const dims = materialDimensions(row);
    const label = owner.measureLabels[row.id];

    if (isEvidenceWorthy(row, dims.length > 0)) {
      if (!isNonEmptyString(label)) {
        return fail("missing_measure_label", [row.id]);
      }
      let numeric: IntlEvidenceChange["numeric"];
      let nonComparableReason: IntlNonComparableReason | null;
      if (row.interpretation.comparable) {
        // A comparable kernel verdict implies both sides were qualified rows
        // with matching unit/basis/cohort; the current census row still holds
        // the legitimate unit. A missing unit cannot be a genuine IM08 output.
        const unit = byId.get(row.id)?.interpretation?.unit;
        if (!isNonEmptyString(unit)) {
          return fail("invalid_review", [`review.items.interpretation.unit:${row.id}`]);
        }
        numeric = {
          prior: row.interpretation.prior,
          current: row.interpretation.current,
          delta: row.interpretation.delta,
          unit,
        };
        nonComparableReason = null;
      } else {
        numeric = null;
        nonComparableReason = row.interpretation.reason;
      }
      evidenceChanges.push({
        stableId: row.id,
        label,
        membership: row.membership as IntlEvidenceMembership,
        version: row.version as IntlEvidenceVersion,
        qualification: row.qualification as IntlEvidenceQualification,
        availability: row.availability as IntlEvidenceRowAvailability,
        correction: row.correction,
        excluded: row.excluded,
        numeric,
        nonComparableReason,
      });
    }

    for (const dimension of dims) {
      const kind = DIMENSION_TO_KIND[dimension];
      if (!isNonEmptyString(label)) {
        return fail("missing_measure_label", [row.id]);
      }
      const itemId = `${row.id}::${dimension}`;
      if (emitted.has(itemId)) continue;
      emitted.add(itemId);
      changedItems.push({
        id: itemId,
        label,
        kind,
        note: changeNotes[dimension],
      });
      materialChanges.push({
        id: row.id,
        dimension,
        kind,
        membership: row.membership,
        version: row.version,
        qualification: row.qualification,
        availability: row.availability,
        excluded: row.excluded,
        correction: row.correction,
        interpretation: row.interpretation,
      });
    }
  }

  /* Comparison status: identity mapping since the G2 repair; failures keep
     their exact literal and never become "unchecked" or "unchanged". */
  const kernelSummary = review.review.summary;
  const comparisonStatus = SUMMARY_TO_STATUS[kernelSummary];
  if (comparisonStatus === "changed" && changedItems.length === 0) {
    return fail("status_consistency", [`summary=changed`, `materialChanges=0`]);
  }
  if (comparisonStatus === "unchanged" && changedItems.length > 0) {
    return fail("status_consistency", [`summary=unchanged`, `materialChanges=${changedItems.length}`]);
  }

  /* Readiness: state is the adapter's verdict, verbatim. */
  const requirementsUsable =
    isPlainObject(input.requirements) &&
    Array.isArray((input.requirements as IntlRequirements).requiredMeasureIds) &&
    (input.requirements as IntlRequirements).requiredMeasureIds.length > 0 &&
    Array.isArray((input.requirements as IntlRequirements).unmetPrerequisites);
  const unmetPrerequisites = requirementsUsable
    ? ((input.requirements as IntlRequirements).unmetPrerequisites as readonly string[])
    : [];
  const requirementGaps: string[] = [];
  if (requirementsUsable) {
    for (const id of (input.requirements as IntlRequirements).requiredMeasureIds) {
      const item = byId.get(id);
      if (!(item !== undefined && isQualifiedRow(item))) requirementGaps.push(id);
    }
  }
  const readiness: IntlReadiness = {
    state: review.answerReadiness,
    unmet: review.answerReadiness === "ready" ? [] : owner.unmetLabels.slice(),
  };
  if (readiness.state === "ready") {
    if (owner.unmetLabels.length > 0) {
      return fail("readiness_contradiction", ["unmetLabels"]);
    }
    if (unmetPrerequisites.length > 0) {
      return fail("readiness_contradiction", ["requirements.unmetPrerequisites"]);
    }
    if (requirementGaps.length > 0) {
      return fail("readiness_contradiction", requirementGaps);
    }
  }

  const diagnostics: IntlCompositionDiagnostics = {
    kernelSummary,
    comparisonStatus,
    collapsedSummary: false,
    uncheckedUsed: false,
    selectedIdsAuthority: "review.published",
    baselineState: review.baselineState,
    currentRead: census.read,
    currentMembership: census.membership,
    currentGeneration: census.generation,
    coverage: {
      selectedCount: review.coverage.selectedCount,
      qualifiedCount: review.coverage.qualifiedCount,
      recomputedSelectedCount: selectedMeasures.length,
      recomputedQualifiedCount: recomputedQualified,
      agree: true,
    },
    duplicateSelectedIds,
    selectedIdsWithoutObservation,
    observationClocksSuppressed,
    hiddenQualifiedValues,
    materialChanges,
    nonComparable,
    requirementsUsable,
    unmetPrerequisites: unmetPrerequisites.slice(),
    requirementGaps,
    noteVocabulary: "intl.composition.notes.v1",
  };

  const props: IntlInvestigationPanelProps = {
    lang: owner.lang,
    question: owner.question,
    marketLabel: owner.marketLabel,
    toolLabel: owner.toolLabel,
    periodLabel: owner.periodLabel,
    basisLabel: owner.basisLabel,
    selectedMeasures,
    changedItems,
    evidenceChanges,
    comparisonStatus,
    savedAt: owner.savedAt,
    updatedAt: owner.updatedAt,
    sourceGenerationAt: owner.sourceGenerationAt,
    rightsAt: owner.rightsAt,
    readiness,
    ...callbacks,
  };

  return { ok: true, props, diagnostics };
}

export default composeIntlInvestigationPanel;
