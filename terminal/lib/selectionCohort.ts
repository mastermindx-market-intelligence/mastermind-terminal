/**
 * selectionCohort.ts — typed, fail-closed reader for the macro gate #8 projection
 * `mastermind.selection_cohort_projection.v1` (macro engine/theme_graph/selection_cohort_projection.py,
 * served at ${NW_BASE}/selection_cohort/us.json and proxied by /api/nw?f=selection_cohort_us).
 *
 * Read-only consumer. It never sorts, ranks, filters, or re-orders anything; it reduces the
 * document to the handful of honest states the card can show. Fail-closed: a document that
 * does not carry the exact schema, the research-only authority ceiling, and every can_* flag
 * set to false is refused and shown as unavailable — this surface may never display a
 * projection that claims authority.
 */

export const SELECTION_COHORT_SCHEMA = "mastermind.selection_cohort_projection.v1";
export const SELECTION_COHORT_AUTHORITY_CEILING = "research_internal_only";
export const SELECTION_COHORT_FLAGS = [
  "can_rank",
  "can_size",
  "can_gate",
  "can_originate_signal",
  "can_add_candidates",
  "can_escalate",
] as const;

export type CohortAvailabilityStatus = "EMPTY_SELECTION" | "PARTIAL" | "OK" | "UNAVAILABLE";
export type CohortOverlap =
  | "EMPTY_SELECTION"
  | "OBSERVED_SHARED_CONCEPTS"
  | "UNDETERMINED"
  | "NO_MEANINGFUL_OVERLAP"
  | "UNAVAILABLE";
export type CohortWithheldReason = "RIGHTS_INTERNAL_ONLY" | "RIGHTS_FAMILY_UNRESOLVED";

/** Wire shape of the projection (producer: macro selection_cohort_projection.py). */
export type SelectionCohortProjection = {
  schema: typeof SELECTION_COHORT_SCHEMA;
  source_schema: string;
  availability: { status: CohortAvailabilityStatus; overlap: CohortOverlap };
  unavailable_reason: string | null;
  authority_ceiling: typeof SELECTION_COHORT_AUTHORITY_CEILING;
  can_rank: false;
  can_size: false;
  can_gate: false;
  can_originate_signal: false;
  can_add_candidates: false;
  can_escalate: false;
  explanation_id: string | null;
  selection_sha256: string | null;
  generation_id: string | null;
  cohort_scope: string | null;
  effective_at: string | null;
  known_at: string | null;
  version: { number: number; corrects: unknown; basis: "AS_KNOWN_AT_SELECTION" } | null;
  n_selected: number;
  selected: Array<{
    selection_id: string | null;
    original_identity: unknown;
    security_id: string | null;
    reason_codes: string[];
    original_reasons: unknown;
    n_concepts: number;
    concepts_display: Array<{ node_id: string; kind: string }>;
    n_concepts_withheld: number;
  }>;
  coverage: Record<string, unknown>;
  concept_rights: {
    n_concepts_total: number;
    n_concepts_displayable: number;
    n_concepts_withheld: number;
    withheld_reasons: Record<CohortWithheldReason, number>;
  };
  limitations: string[];
  /** Added by /api/nw when it serves the last good copy after an upstream failure. */
  stale?: boolean;
};

export type CohortUnavailableReason = "feed" | "source" | "checks";

export type SelectionCohortView =
  | { kind: "unavailable"; reason: CohortUnavailableReason; asOf: string | null }
  | { kind: "empty"; asOf: string | null; stale: boolean }
  | {
      kind: "ready";
      partial: boolean;
      stale: boolean;
      overlap: "shared" | "none" | "unknown";
      asOf: string | null;
      nSelected: number;
      nConcepts: number;
      nShared: number | null;
      nShown: number;
      nWithheld: number;
      withheldInternal: number;
      withheldUnresolved: number;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function asOfOf(doc: Record<string, unknown>): string | null {
  const v = doc.effective_at;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

const CHECKS = { kind: "unavailable", reason: "checks", asOf: null } as const;

export function parseSelectionCohort(raw: unknown): SelectionCohortView {
  // 1. Nothing usable arrived (route 503 body, network failure, non-object): not published.
  if (!isRecord(raw) || "error" in raw) return { kind: "unavailable", reason: "feed", asOf: null };

  // 2. Exact schema and the research-only authority envelope, or nothing is shown.
  if (raw.schema !== SELECTION_COHORT_SCHEMA) return CHECKS;
  if (raw.authority_ceiling !== SELECTION_COHORT_AUTHORITY_CEILING) return CHECKS;
  for (const flag of SELECTION_COHORT_FLAGS) {
    if (raw[flag] !== false) return CHECKS;
  }

  const availability = isRecord(raw.availability) ? raw.availability : null;
  if (!availability) return CHECKS;
  const status = availability.status;
  const overlap = availability.overlap;
  const asOf = asOfOf(raw);
  const stale = raw.stale === true;

  // 3. The producer's own honest UNAVAILABLE: say whether the source or the checks failed.
  if (status === "UNAVAILABLE") {
    const why = typeof raw.unavailable_reason === "string" ? raw.unavailable_reason : "";
    const source = why === "WRAPPER_MISSING" || why.startsWith("SOURCE_UNAVAILABLE");
    return { kind: "unavailable", reason: source ? "source" : "checks", asOf };
  }

  // 4. No finalized picks this run.
  if (status === "EMPTY_SELECTION") return { kind: "empty", asOf, stale };

  if (status !== "OK" && status !== "PARTIAL") return CHECKS;

  const mapped =
    overlap === "OBSERVED_SHARED_CONCEPTS"
      ? "shared"
      : overlap === "NO_MEANINGFUL_OVERLAP"
        ? "none"
        : overlap === "UNDETERMINED"
          ? "unknown"
          : null;
  if (mapped === null) return CHECKS;

  // 5. Counts must be non-negative integers and must add up; otherwise refuse.
  const rights = isRecord(raw.concept_rights) ? raw.concept_rights : null;
  const reasons = rights && isRecord(rights.withheld_reasons) ? rights.withheld_reasons : null;
  const nSelected = count(raw.n_selected);
  const nConcepts = rights ? count(rights.n_concepts_total) : null;
  const nShown = rights ? count(rights.n_concepts_displayable) : null;
  const nWithheld = rights ? count(rights.n_concepts_withheld) : null;
  const withheldInternal = reasons ? count(reasons.RIGHTS_INTERNAL_ONLY ?? 0) : null;
  const withheldUnresolved = reasons ? count(reasons.RIGHTS_FAMILY_UNRESOLVED ?? 0) : null;
  if (
    nSelected === null ||
    nConcepts === null ||
    nShown === null ||
    nWithheld === null ||
    withheldInternal === null ||
    withheldUnresolved === null ||
    nShown + nWithheld !== nConcepts ||
    withheldInternal + withheldUnresolved !== nWithheld
  ) {
    return CHECKS;
  }
  const coverage = isRecord(raw.coverage) ? raw.coverage : {};
  const nShared = count(coverage.n_shared_concepts);

  return {
    kind: "ready",
    partial: status === "PARTIAL",
    stale,
    overlap: mapped,
    asOf,
    nSelected,
    nConcepts,
    nShared,
    nShown,
    nWithheld,
    withheldInternal,
    withheldUnresolved,
  };
}
