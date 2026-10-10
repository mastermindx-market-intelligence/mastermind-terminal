import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSelectionCohort,
  SELECTION_COHORT_FLAGS,
  SELECTION_COHORT_SCHEMA,
} from "@/lib/selectionCohort";

const ROOT = join(__dirname, "..", "..");
const READY = JSON.parse(
  readFileSync(join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "ready.json"), "utf8"),
) as Record<string, unknown>;
const UNAVAILABLE = JSON.parse(
  readFileSync(join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "unavailable.json"), "utf8"),
);
const EMPTY = JSON.parse(
  readFileSync(join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "empty.json"), "utf8"),
);

function cloneReady(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(READY));
}

describe("parseSelectionCohort", () => {
  it("READY fixture -> ready partial shared counts", () => {
    expect(parseSelectionCohort(READY)).toEqual({
      kind: "ready",
      partial: true,
      stale: false,
      overlap: "shared",
      asOf: "2026-10-05",
      nSelected: 6,
      nConcepts: 9,
      nShared: 3,
      nShown: 0,
      nWithheld: 9,
      withheldInternal: 5,
      withheldUnresolved: 4,
    });
  });

  it("unavailable.json -> unavailable source", () => {
    expect(parseSelectionCohort(UNAVAILABLE)).toEqual({
      kind: "unavailable",
      reason: "source",
      asOf: null,
    });
  });

  it("empty.json -> empty", () => {
    expect(parseSelectionCohort(EMPTY)).toEqual({
      kind: "empty",
      asOf: "2026-10-05",
      stale: false,
    });
  });

  it("R1 non-object / array / null / error body -> feed", () => {
    expect(parseSelectionCohort(null)).toEqual({ kind: "unavailable", reason: "feed", asOf: null });
    expect(parseSelectionCohort("x")).toEqual({ kind: "unavailable", reason: "feed", asOf: null });
    expect(parseSelectionCohort([])).toEqual({ kind: "unavailable", reason: "feed", asOf: null });
    expect(parseSelectionCohort({ error: "feed unavailable" })).toEqual({
      kind: "unavailable",
      reason: "feed",
      asOf: null,
    });
  });

  it("R2 wrong schema -> checks", () => {
    const doc = cloneReady();
    doc.schema = "other.schema.v1";
    expect(parseSelectionCohort(doc)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });
  });

  it("R3 authority ceiling public -> checks", () => {
    const doc = cloneReady();
    doc.authority_ceiling = "public";
    expect(parseSelectionCohort(doc)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });
  });

  it("R3 each can_* flag true, missing, or string false -> checks", () => {
    for (const flag of SELECTION_COHORT_FLAGS) {
      const trueDoc = cloneReady();
      trueDoc[flag] = true;
      expect(parseSelectionCohort(trueDoc)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });

      const missingDoc = cloneReady();
      delete missingDoc[flag];
      expect(parseSelectionCohort(missingDoc)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });

      const stringDoc = cloneReady();
      stringDoc[flag] = "false";
      expect(parseSelectionCohort(stringDoc)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });
    }
  });

  it("R4 unavailable reasons source vs checks", () => {
    const sourceRow = cloneReady();
    sourceRow.availability = { status: "UNAVAILABLE", overlap: "UNAVAILABLE" };
    sourceRow.unavailable_reason = "SOURCE_UNAVAILABLE:ROW_MISSING";
    expect(parseSelectionCohort(sourceRow)).toEqual({
      kind: "unavailable",
      reason: "source",
      asOf: "2026-10-05",
    });

    const checksDoc = cloneReady();
    checksDoc.availability = { status: "UNAVAILABLE", overlap: "UNAVAILABLE" };
    checksDoc.unavailable_reason = "EXPLANATION_UNAVAILABLE";
    expect(parseSelectionCohort(checksDoc)).toEqual({
      kind: "unavailable",
      reason: "checks",
      asOf: "2026-10-05",
    });
  });

  // Source-contract reproduction, not a live-feed or rights-admission fixture.
  // Macro's committed refusal is blob 533ad2e21f2154d49efda7196504dc64e88511b8.
  // Keep the incumbent unavailable fixture and replace only its typed reason.
  const captureRefusal = {
    ...UNAVAILABLE,
    unavailable_reason: "SOURCE_UNAVAILABLE:CAPTURE_RIGHTS_UNAVAILABLE",
  };

  it("capture-rights refusal is distinct from a source matching failure", () => {
    const before = JSON.stringify(captureRefusal);
    expect(parseSelectionCohort(captureRefusal)).toEqual({
      kind: "unavailable", reason: "capture_rights", asOf: null,
    });
    expect(JSON.stringify(captureRefusal)).toBe(before);
    expect(captureRefusal.generation_id).toBeNull();
  });

  it.each([
    "SOURCE_UNAVAILABLE:ROW_MISSING",
    "SOURCE_UNAVAILABLE:CAPTURE_RIGHTS_UNAVAILABLE:DETAIL",
    "SOURCE_UNAVAILABLE:CAPTURE_RIGHTS_UNAVAILABLE ",
    "WRAPPER_MISSING",
  ])("does not infer capture rights from another or near-match reason: %s", (why) => {
    expect(parseSelectionCohort({ ...captureRefusal, unavailable_reason: why }))
      .toEqual({ kind: "unavailable", reason: "source", asOf: null });
  });

  it.each(SELECTION_COHORT_FLAGS)("checks %s before trusting the capture-rights reason", (flag) => {
    for (const value of [true, "false", null, 0, 1, undefined]) {
      const doc: Record<string, unknown> = { ...captureRefusal, [flag]: value };
      if (value === undefined) delete doc[flag];
      expect(parseSelectionCohort(doc)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });
    }
  });

  it.each([
    { schema: "other.schema.v1" },
    { authority_ceiling: "public" },
    { availability: null },
    { availability: { status: "UNKNOWN", overlap: "UNAVAILABLE" } },
    { unavailable_reason: "CAPTURE_RIGHTS_UNAVAILABLE" },
    { unavailable_reason: null },
  ])("does not let the refusal label waive envelope/status checks: %j", (override) => {
    expect(parseSelectionCohort({ ...captureRefusal, ...override }))
      .toEqual({ kind: "unavailable", reason: "checks", asOf: null });
  });

  it("network error still takes precedence over a claimed capture-rights reason", () => {
    expect(parseSelectionCohort({ ...captureRefusal, error: "unavailable" }))
      .toEqual({ kind: "unavailable", reason: "feed", asOf: null });
  });

  it("reads a reason only for UNAVAILABLE, preserving ready and empty behavior", () => {
    expect(parseSelectionCohort({ ...READY, unavailable_reason: captureRefusal.unavailable_reason }))
      .toEqual(parseSelectionCohort(READY));
    expect(parseSelectionCohort({ ...EMPTY, unavailable_reason: captureRefusal.unavailable_reason }))
      .toEqual(parseSelectionCohort(EMPTY));
  });

  it("R7 status WEIRD -> checks", () => {
    const doc = cloneReady();
    doc.availability = { status: "WEIRD", overlap: "OBSERVED_SHARED_CONCEPTS" };
    expect(parseSelectionCohort(doc)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });
  });

  it("OK + NO_MEANINGFUL_OVERLAP -> none, not partial", () => {
    const doc = cloneReady();
    doc.availability = { status: "OK", overlap: "NO_MEANINGFUL_OVERLAP" };
    const view = parseSelectionCohort(doc);
    expect(view).toMatchObject({ kind: "ready", partial: false, overlap: "none" });
  });

  it("PARTIAL + UNDETERMINED -> unknown", () => {
    const doc = cloneReady();
    doc.availability = { status: "PARTIAL", overlap: "UNDETERMINED" };
    const view = parseSelectionCohort(doc);
    expect(view).toMatchObject({ kind: "ready", partial: true, overlap: "unknown" });
  });

  it("overlap WEIRD -> checks", () => {
    const doc = cloneReady();
    doc.availability = { status: "OK", overlap: "WEIRD" };
    expect(parseSelectionCohort(doc)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });
  });

  it("count sum mismatch -> checks", () => {
    const doc = cloneReady();
    const rights = doc.concept_rights as Record<string, unknown>;
    rights.n_concepts_withheld = 8;
    expect(parseSelectionCohort(doc)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });
  });

  it("negative and non-integer counts -> checks", () => {
    const neg = cloneReady();
    neg.n_selected = -1;
    expect(parseSelectionCohort(neg)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });

    const frac = cloneReady();
    frac.n_selected = 2.5;
    expect(parseSelectionCohort(frac)).toEqual({ kind: "unavailable", reason: "checks", asOf: null });
  });

  it("coverage without n_shared_concepts -> nShared null", () => {
    const doc = cloneReady();
    const coverage = { ...(doc.coverage as Record<string, unknown>) };
    delete coverage.n_shared_concepts;
    doc.coverage = coverage;
    const view = parseSelectionCohort(doc);
    expect(view).toMatchObject({ kind: "ready", nShared: null });
  });

  it("R8 stale:true -> stale on ready and empty", () => {
    const readyStale = cloneReady();
    readyStale.stale = true;
    expect(parseSelectionCohort(readyStale)).toMatchObject({ kind: "ready", stale: true });

    const emptyStale = { ...EMPTY, stale: true };
    expect(parseSelectionCohort(emptyStale)).toMatchObject({ kind: "empty", stale: true });
  });

  it("ORDER INVARIANCE: reversed selected parses equal", () => {
    const reversed = cloneReady();
    const selected = reversed.selected as unknown[];
    reversed.selected = [...selected].reverse();
    expect(parseSelectionCohort(reversed)).toEqual(parseSelectionCohort(READY));
  });

  it("KEY-SET PIN on READY fixture", () => {
    expect(Object.keys(READY).sort()).toEqual([
      "authority_ceiling",
      "availability",
      "can_add_candidates",
      "can_escalate",
      "can_gate",
      "can_originate_signal",
      "can_rank",
      "can_size",
      "cohort_scope",
      "concept_rights",
      "coverage",
      "effective_at",
      "explanation_id",
      "generation_id",
      "known_at",
      "limitations",
      "n_selected",
      "schema",
      "selected",
      "selection_sha256",
      "source_schema",
      "unavailable_reason",
      "version",
    ]);
    expect(READY.schema).toBe(SELECTION_COHORT_SCHEMA);
  });

  it("STATIC: reader and card never sort/reverse", () => {
    const reader = readFileSync(join(ROOT, "lib", "selectionCohort.ts"), "utf8");
    const card = readFileSync(
      join(ROOT, "components", "prophet", "SelectionCohortCard.tsx"),
      "utf8",
    );
    for (const src of [reader, card]) {
      expect(src).not.toMatch(/\.sort\(/);
      expect(src).not.toMatch(/\.toSorted\(/);
      expect(src).not.toMatch(/\.reverse\(/);
    }
  });
});
