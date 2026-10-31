/** Contract-repair discrimination tests (im08-im09-contract-repair-r2).
 *
 * One focused check per adjudicated ruling R1–R6 (PARENT_ADJUDICATION
 * blocking findings G1–G7), including the two counterexamples the rejected r1
 * mapper passed while losing semantics: same-count wrong selected IDs (G1) and
 * the collapsed failure statuses (G2). Every IntlReviewResult is produced by
 * the real IM08 adapter over the frozen kernel unless a test explicitly forges
 * a well-typed one to prove a refusal or an unreachable summary. No React
 * mounting, no I/O. */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  CONTEXT_FIELDS,
  reviewIntlEvidence,
  toIntlEvidenceCensus,
  type IntlExactContext,
  type IntlOwnerObservation,
  type IntlOwnerResult,
  type IntlRequirements,
} from "@/lib/intlInvestigationEvidence";
import { reviewEvidence } from "@/lib/investigationEvidenceDiff";
import { composeIntlInvestigationPanel } from "@/lib/intlInvestigationComposition";

/* ── fixtures (mirror composition.test.mts conventions) ──────────────────── */

function baseCtx(overrides: Partial<IntlExactContext> = {}): IntlExactContext {
  return {
    researchMarket: "global-equities",
    toolBindingVersion: "v1",
    periodIdentity: "2024Q4",
    currencyBasis: "USD-constant",
    returnBasis: "total-return",
    owner: "intl.evidence",
    query: "q-capex-share",
    cohort: "pilot-banks",
    temporalPolicy: "point-in-time",
    selectedMeasureIds: ["m1", "m2", "m3"],
    ...overrides,
  };
}

function makeObs(o: Partial<IntlOwnerObservation> & { id: string }): IntlOwnerObservation {
  return {
    id: o.id,
    availability: o.availability ?? "available",
    qualified: o.qualified ?? true,
    excluded: o.excluded ?? false,
    correction: o.correction ?? false,
    contentIdentity: o.contentIdentity ?? `cid-${o.id}`,
    qualificationIdentity: o.qualificationIdentity ?? `qid-${o.id}`,
    interpretation:
      o.interpretation === undefined
        ? { value: 10, unit: "%", basis: "USD-constant", cohort: "pilot-banks" }
        : o.interpretation,
  };
}

function makeResult(
  o: Partial<IntlOwnerResult> & { generation: string },
  observations: IntlOwnerObservation[],
): IntlOwnerResult {
  return {
    researchMarket: "global-equities",
    toolBindingVersion: "v1",
    periodIdentity: "2024Q4",
    currencyBasis: "USD-constant",
    returnBasis: "total-return",
    owner: "intl.evidence",
    query: "q-capex-share",
    cohort: "pilot-banks",
    temporalPolicy: "point-in-time",
    read: "ok",
    membership: "complete",
    ...o,
    generation: o.generation,
    observations,
    tombstones: o.tombstones ?? [],
  };
}

const LABELS: Record<string, string> = {
  m1: "Capex share",
  m2: "Payout ratio",
  m3: "Net margin",
  m4: "Leverage",
  m5: "Coverage",
};

function ownerInput(overrides: Record<string, unknown> = {}) {
  return {
    lang: "en" as const,
    question: "Where is capex share heading?",
    marketLabel: "Global equities",
    toolLabel: "Intl bindings v1",
    periodLabel: "2024Q4",
    basisLabel: "USD constant · total return",
    savedAt: "2026-10-01T09:00:00Z" as string | null,
    updatedAt: "2026-10-06T09:00:00Z" as string | null,
    sourceGenerationAt: "2026-10-06T08:55:00Z" as string | null,
    rightsAt: null as string | null,
    measureLabels: LABELS,
    unmetLabels: [] as string[],
    ...overrides,
  };
}

function compose(review: unknown, selected: readonly string[] | undefined, extra: Record<string, unknown> = {}) {
  const input: Record<string, unknown> = {
    review,
    owner: ownerInput(),
    ...extra,
  };
  if (selected !== undefined) input.selectedMeasureIds = selected;
  return composeIntlInvestigationPanel(input as never);
}

function panelCounts(p: { selectedMeasures: { availability: string }[] }) {
  return {
    selected: p.selectedMeasures.length,
    qualified: p.selectedMeasures.filter((m) => m.availability === "qualified").length,
  };
}

/* ══ R1 — IM08 publishes exact unique selected ids; CONTEXT_FIELDS exported ═ */

test("R1: review publishes exact unique selectedMeasureIds in first-occurrence order", () => {
  const ctx = baseCtx({ selectedMeasureIds: ["m3", "m1", "m3", "m2", "m1"] });
  const current = makeResult({ generation: "g2" }, [makeObs({ id: "m1" })]);
  const out = reviewIntlEvidence(null, current, ctx);
  assert.deepEqual(out.selectedMeasureIds, ["m3", "m1", "m2"]);
  assert.equal(out.selectedMeasureIds.length, out.coverage.selectedCount);
  assert.equal(new Set(out.selectedMeasureIds).size, out.selectedMeasureIds.length);
});

test("R1: fail-closed review derives ids with the same safe law as the denominator", () => {
  // Malformed context (empty scope field) but a partially valid id array: only
  // the nonempty-string ids survive, deduped; the denominator is unchanged.
  const ctxBad = {
    ...baseCtx(),
    researchMarket: "",
    selectedMeasureIds: ["m1", "", "m2", "m1", 42],
  } as unknown as IntlExactContext;
  const current = makeResult({ generation: "g2" }, [makeObs({ id: "m1" })]);
  const out = reviewIntlEvidence(null, current, ctxBad);
  assert.equal(out.review.summary, "invalid");
  assert.deepEqual(out.selectedMeasureIds, ["m1", "m2"]);
  assert.deepEqual(out.coverage, { selectedCount: 2, qualifiedCount: 0 });

  // selectedMeasureIds not an array: empty list, zero denominator.
  const ctxNoArray = { ...baseCtx(), researchMarket: "", selectedMeasureIds: null } as unknown as IntlExactContext;
  const out2 = reviewIntlEvidence(null, current, ctxNoArray);
  assert.deepEqual(out2.selectedMeasureIds, []);
  assert.deepEqual(out2.coverage, { selectedCount: 0, qualifiedCount: 0 });
});

test("R1/G7: CONTEXT_FIELDS is exported from IM08 and is the scope-encoding law", () => {
  assert.deepEqual(CONTEXT_FIELDS, [
    "researchMarket",
    "toolBindingVersion",
    "periodIdentity",
    "currencyBasis",
    "returnBasis",
    "owner",
    "query",
    "cohort",
    "temporalPolicy",
  ]);
  const ctx = baseCtx();
  const build = toIntlEvidenceCensus(makeResult({ generation: "g" }, [makeObs({ id: "m1" })]), ctx);
  assert.equal(build.ok, true);
  if (!build.ok) return;
  assert.equal(build.census.scope.query, JSON.stringify(CONTEXT_FIELDS.map((f) => ctx[f])));
});

/* ══ R2 — exact membership verification; review list is the authority ═════ */

test("R2/G1: same-count wrong-ID list is refused as a membership mismatch", () => {
  // The exact r1 counterexample: both m3 and m5 are read-ok, present,
  // unqualified, so coverage is {selected:3, qualified:2} either way.
  const ctx = baseCtx({ selectedMeasureIds: ["m1", "m2", "m3"] });
  const current = makeResult({ generation: "g2" }, [
    makeObs({ id: "m1" }),
    makeObs({ id: "m2" }),
    makeObs({ id: "m3", qualified: false }),
    makeObs({ id: "m5", qualified: false }),
  ]);
  const review = reviewIntlEvidence(null, current, ctx);
  assert.deepEqual(review.coverage, { selectedCount: 3, qualifiedCount: 2 });

  const declared = compose(review, ["m1", "m2", "m5"]);
  assert.equal(declared.ok, false, JSON.stringify(declared));
  if (declared.ok) return;
  assert.equal(declared.reason, "selected_ids_membership_mismatch");
  assert.deepEqual(declared.detail, ["m5"]);

  const truthful = compose(review, ["m1", "m2", "m3"]);
  assert.equal(truthful.ok, true, JSON.stringify(truthful));
});

test("R2: the review-published list is the row authority and order", () => {
  const ctx = baseCtx();
  const current = makeResult({ generation: "g2" }, [
    makeObs({ id: "m1" }),
    makeObs({ id: "m2" }),
    makeObs({ id: "m3" }),
  ]);
  const review = reviewIntlEvidence(null, current, ctx);

  // Same set, different order: accepted, rows follow the published order.
  const reversed = compose(review, ["m3", "m2", "m1"]);
  assert.equal(reversed.ok, true);
  if (!reversed.ok) return;
  assert.deepEqual(reversed.props.selectedMeasures.map((m) => m.stableId), ["m1", "m2", "m3"]);
  assert.equal(reversed.diagnostics.selectedIdsAuthority, "review.published");

  // Caller list omitted entirely: the published membership still authors rows.
  const omitted = compose(review, undefined);
  assert.equal(omitted.ok, true);
  if (!omitted.ok) return;
  assert.deepEqual(omitted.props.selectedMeasures.map((m) => m.stableId), ["m1", "m2", "m3"]);
  assert.deepEqual(panelCounts(omitted.props), { selected: 3, qualified: 3 });
});

test("R2: cardinality drift is still refused", () => {
  const ctx = baseCtx();
  const current = makeResult({ generation: "g2" }, [makeObs({ id: "m1" })]);
  const review = reviewIntlEvidence(null, current, ctx);
  const r = compose(review, ["m1", "m2"]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "selected_ids_cardinality_mismatch");
});

test("R2: a review that does not publish its ids is refused, not guessed", () => {
  const ctx = baseCtx();
  const current = makeResult({ generation: "g2" }, [makeObs({ id: "m1" })]);
  const review = reviewIntlEvidence(null, current, ctx);
  const forged = { ...review, selectedMeasureIds: undefined };
  const r = compose(forged, ctx.selectedMeasureIds);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "invalid_review");
  assert.deepEqual(r.detail, ["selectedMeasureIds"]);
});

/* ══ R3 — every failure summary keeps its own visible status ═════════════ */

test("R3/G2: all seven kernel summaries keep distinct exact panel statuses", () => {
  const ctx = baseCtx({ selectedMeasureIds: ["m1"] });
  const obs = [makeObs({ id: "m1" })];
  const revised = makeResult({ generation: "g2" }, [makeObs({ id: "m1", contentIdentity: "cid-new" })]);

  const realCases: Array<[string, ReturnType<typeof reviewIntlEvidence>]> = [
    ["changed", reviewIntlEvidence(makeResult({ generation: "g1" }, obs), revised, ctx)],
    ["unchanged", reviewIntlEvidence(makeResult({ generation: "g1" }, obs), makeResult({ generation: "g2" }, obs), ctx)],
    [
      "incomplete",
      reviewIntlEvidence(
        makeResult({ generation: "g1" }, obs),
        makeResult({ generation: "g2", membership: "page" }, []),
        ctx,
      ),
    ],
    [
      "denied",
      reviewIntlEvidence(makeResult({ generation: "g1", read: "denied" }, []), makeResult({ generation: "g2" }, obs), ctx),
    ],
    ["unavailable", reviewIntlEvidence(null, makeResult({ generation: "g2" }, obs), ctx)],
    [
      "invalid",
      reviewIntlEvidence(
        null,
        { ...makeResult({ generation: "g2" }, obs), observations: "nope" } as unknown as IntlOwnerResult,
        ctx,
      ),
    ],
  ];
  const statuses = new Map<string, string>();
  const FAILURE_SUMMARIES = new Set(["denied", "unavailable", "invalid", "scope_changed"]);
  for (const [expectedSummary, review] of realCases) {
    assert.equal(review.review.summary, expectedSummary);
    const r = compose(review, ["m1"]);
    assert.equal(r.ok, true, `${expectedSummary}: ${JSON.stringify(r)}`);
    if (!r.ok) continue;
    assert.equal(r.props.comparisonStatus, expectedSummary, `${expectedSummary} must map to itself`);
    assert.equal(r.diagnostics.kernelSummary, expectedSummary);
    assert.equal(r.diagnostics.collapsedSummary, false);
    assert.equal(r.diagnostics.uncheckedUsed, false);
    assert.notEqual(r.props.comparisonStatus, "unchecked");
    if (FAILURE_SUMMARIES.has(expectedSummary)) {
      assert.notEqual(r.props.comparisonStatus, "unchanged", `${expectedSummary} must not become no-changes`);
    }
    statuses.set(expectedSummary, r.props.comparisonStatus);
  }

  // scope_changed is unreachable through reviewIntlEvidence (both censuses are
  // built from one exactContext) — assemble it from a direct kernel call over
  // two differently-scoped safe censuses, with the full published shape.
  const ctxA = baseCtx({ selectedMeasureIds: ["m1"] });
  const ctxB = baseCtx({ cohort: "other-banks", selectedMeasureIds: ["m1"] });
  const resultFor = (c: IntlExactContext, generation: string): IntlOwnerResult =>
    makeResult(
      {
        generation,
        researchMarket: c.researchMarket,
        toolBindingVersion: c.toolBindingVersion,
        periodIdentity: c.periodIdentity,
        currencyBasis: c.currencyBasis,
        returnBasis: c.returnBasis,
        owner: c.owner,
        query: c.query,
        cohort: c.cohort,
        temporalPolicy: c.temporalPolicy,
      },
      [makeObs({ id: "m1" })],
    );
  const priorCensus = toIntlEvidenceCensus(resultFor(ctxA, "g1"), ctxA);
  const currentCensus = toIntlEvidenceCensus(resultFor(ctxB, "g2"), ctxB);
  assert.equal(priorCensus.ok && currentCensus.ok, true);
  if (!priorCensus.ok || !currentCensus.ok) return;
  const kernelReview = reviewEvidence(priorCensus.census, currentCensus.census);
  assert.equal(kernelReview.summary, "scope_changed");
  const scoped = {
    schema: "intl.investigation.evidence_review.v1" as const,
    baselineState: "available" as const,
    review: kernelReview,
    currentSafeCensus: currentCensus.census,
    coverage: { selectedCount: 1, qualifiedCount: 1 },
    selectedMeasureIds: ["m1"],
    answerReadiness: "incomplete" as const,
  };
  const r = compose(scoped, ["m1"], { exactContext: ctxB });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.props.comparisonStatus, "scope_changed");
  assert.equal(r.diagnostics.collapsedSummary, false);
  statuses.set("scope_changed", r.props.comparisonStatus);

  // Seven distinct kernel summaries, seven distinct visible statuses.
  assert.equal(statuses.size, 7);
  assert.equal(new Set(statuses.values()).size, 7);
  assert.equal(statuses.has("unchecked"), false);
});

test("R3/G3: not_qualified, not_applicable and absent are three distinct visible states", () => {
  const ctx = baseCtx({ selectedMeasureIds: ["m1", "m2", "m3", "m4"] });
  const current = makeResult({ generation: "g2" }, [
    makeObs({ id: "m1" }),
    makeObs({ id: "m2", qualified: false }),
    makeObs({ id: "m3", availability: "not_applicable" }),
    // m4 selected but never observed
  ]);
  const review = reviewIntlEvidence(null, current, ctx);
  const r = compose(review, ["m1", "m2", "m3", "m4"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const byId = new Map(r.props.selectedMeasures.map((m) => [m.stableId, m.availability]));
  assert.equal(byId.get("m1"), "qualified");
  assert.equal(byId.get("m2"), "not_qualified");
  assert.equal(byId.get("m3"), "not_applicable");
  assert.equal(byId.get("m4"), "unknown");
  assert.equal(new Set(byId.values()).size, 4);
  for (const m of r.props.selectedMeasures) {
    if (m.stableId !== "m1") {
      assert.equal(m.value, null, m.stableId);
      assert.equal(m.unit, null, m.stableId);
    }
  }
});

test("R3: finite qualified zero stays visible and is never an unknown count", () => {
  const ctx = baseCtx();
  const current = makeResult({ generation: "g2" }, [
    makeObs({ id: "m1", qualified: false }),
    makeObs({ id: "m2", availability: "stale" }),
    makeObs({ id: "m3", excluded: true }),
  ]);
  const review = reviewIntlEvidence(null, current, ctx);
  assert.deepEqual(review.coverage, { selectedCount: 3, qualifiedCount: 0 });
  const r = compose(review, ctx.selectedMeasureIds);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(panelCounts(r.props), { selected: 3, qualified: 0 });
  assert.equal(r.props.selectedMeasures.length, 3);
  assert.ok(r.props.selectedMeasures.every((m) => m.availability !== "qualified"));
  assert.ok(r.props.selectedMeasures.every((m) => m.value === null && m.unit === null));
  assert.deepEqual(r.diagnostics.coverage.recomputedQualifiedCount, 0);
});

/* ══ R4 — lossless per-measure evidence rows with concurrent dimensions ═══ */

test("R4/G5: concurrent revision+numeric+qualification on one measure → ONE row, all dimensions", () => {
  const ctx = baseCtx();
  const prior = makeResult({ generation: "g1" }, [
    makeObs({ id: "m1", contentIdentity: "cid-a", qualificationIdentity: "qid-a", interpretation: { value: 10, unit: "%", basis: "USD-constant", cohort: "pilot-banks" } }),
    makeObs({ id: "m2" }),
    makeObs({ id: "m3" }),
  ]);
  const current = makeResult({ generation: "g2" }, [
    makeObs({ id: "m1", contentIdentity: "cid-b", qualificationIdentity: "qid-b", interpretation: { value: 11, unit: "%", basis: "USD-constant", cohort: "pilot-banks" } }),
    makeObs({ id: "m2" }),
    makeObs({ id: "m3" }),
  ]);
  const review = reviewIntlEvidence(prior, current, ctx);
  const r = compose(review, ctx.selectedMeasureIds);
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // Exactly ONE evidence row for m1 (no per-dimension row duplication)…
  const rows = r.props.evidenceChanges ?? [];
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.stableId, "m1");
  assert.equal(row.membership, "present");
  assert.equal(row.version, "revised");
  assert.equal(row.qualification, "changed");
  assert.equal(row.correction, false);
  assert.equal(row.excluded, false);
  assert.deepEqual(row.numeric, { prior: 10, current: 11, delta: 1, unit: "%" });
  assert.equal(row.nonComparableReason, null);
  // …while the legacy compat list still carries one item per dimension.
  assert.deepEqual(
    r.props.changedItems.map((c) => c.id).sort(),
    ["m1::numeric.delta", "m1::qualification.changed", "m1::version.revised"],
  );
});

test("R4: numeric-only change keeps version 'unchanged' — not every change is revised", () => {
  const ctx = baseCtx();
  const prior = makeResult({ generation: "g1" }, [
    makeObs({ id: "m1", contentIdentity: "cid-same", interpretation: { value: 10, unit: "%", basis: "USD-constant", cohort: "pilot-banks" } }),
    makeObs({ id: "m2" }),
    makeObs({ id: "m3" }),
  ]);
  const current = makeResult({ generation: "g2" }, [
    makeObs({ id: "m1", contentIdentity: "cid-same", interpretation: { value: 12, unit: "%", basis: "USD-constant", cohort: "pilot-banks" } }),
    makeObs({ id: "m2" }),
    makeObs({ id: "m3" }),
  ]);
  const review = reviewIntlEvidence(prior, current, ctx);
  const r = compose(review, ctx.selectedMeasureIds);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const rows = r.props.evidenceChanges ?? [];
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.version, "unchanged");
  assert.equal(row.qualification, "unchanged");
  assert.deepEqual(row.numeric, { prior: 10, current: 12, delta: 2, unit: "%" });
});

test("R4: not_observed / not_previously_observed survive exactly, never as added/removed", () => {
  const ctx = baseCtx();
  // Page omission on the current side → not_observed.
  const prior = makeResult({ generation: "g1" }, [makeObs({ id: "m1" }), makeObs({ id: "m2" }), makeObs({ id: "m3" })]);
  const paged = makeResult({ generation: "g2", membership: "page" }, [makeObs({ id: "m1" })]);
  const a = composeIntlInvestigationPanel({
    review: reviewIntlEvidence(prior, paged, ctx),
    selectedMeasureIds: ctx.selectedMeasureIds,
    owner: ownerInput() as never,
  });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const aRows = a.props.evidenceChanges ?? [];
  const memberships = new Map(aRows.map((row) => [row.stableId, row.membership]));
  assert.equal(memberships.get("m2"), "not_observed");
  assert.equal(memberships.get("m3"), "not_observed");
  assert.ok(aRows.every((row) => row.membership !== "added" && row.membership !== "removed"));

  // Page membership on the prior side → not_previously_observed.
  const priorPaged = makeResult({ generation: "g1", membership: "page" }, [makeObs({ id: "m1" })]);
  const grown = makeResult({ generation: "g2" }, [makeObs({ id: "m1" }), makeObs({ id: "m2" }), makeObs({ id: "m3" })]);
  const b = composeIntlInvestigationPanel({
    review: reviewIntlEvidence(priorPaged, grown, ctx),
    selectedMeasureIds: ctx.selectedMeasureIds,
    owner: ownerInput() as never,
  });
  assert.equal(b.ok, true);
  if (!b.ok) return;
  const bRows = b.props.evidenceChanges ?? [];
  const bMemberships = new Map(bRows.map((row) => [row.stableId, row.membership]));
  assert.equal(bMemberships.get("m2"), "not_previously_observed");
  assert.ok(bRows.every((row) => row.membership !== "added" && row.membership !== "removed"));
});

test("R4: tombstone removal stays 'removed' and carries no invented numeric", () => {
  const ctx = baseCtx();
  const prior = makeResult({ generation: "g1" }, [makeObs({ id: "m1" }), makeObs({ id: "m2" }), makeObs({ id: "m3" })]);
  const current = makeResult({ generation: "g2", tombstones: ["m2"] }, [makeObs({ id: "m1" }), makeObs({ id: "m3" })]);
  const review = reviewIntlEvidence(prior, current, ctx);
  const r = compose(review, ctx.selectedMeasureIds);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const row = (r.props.evidenceChanges ?? []).find((c) => c.stableId === "m2")!;
  assert.ok(row);
  assert.equal(row.membership, "removed");
  assert.equal(row.numeric, null);
});

test("R4: correction and exclusion dimensions are carried into the props rows", () => {
  const ctx = baseCtx();
  const prior = makeResult({ generation: "g1" }, [
    makeObs({ id: "m1", qualificationIdentity: "qid-1" }),
    makeObs({ id: "m2", qualificationIdentity: "qid-2" }),
    makeObs({ id: "m3" }),
  ]);
  const current = makeResult({ generation: "g2" }, [
    makeObs({ id: "m1", qualificationIdentity: "qid-1", correction: true }),
    makeObs({ id: "m2", qualificationIdentity: "qid-2", excluded: true }),
    makeObs({ id: "m3" }),
  ]);
  const review = reviewIntlEvidence(prior, current, ctx);
  const r = compose(review, ctx.selectedMeasureIds);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const rows = new Map((r.props.evidenceChanges ?? []).map((row) => [row.stableId, row]));
  assert.equal(rows.get("m1")!.correction, true);
  assert.equal(rows.get("m1")!.excluded, false);
  assert.equal(rows.get("m2")!.excluded, true);
  assert.equal(rows.get("m2")!.correction, false);
  assert.equal(rows.get("m2")!.qualification, "changed");
});

test("R4/G4: every non-comparable reason survives exactly in the props rows", () => {
  const ctx = baseCtx();
  const interpretation = (value: number | null, unit = "%") =>
    value === null ? null : { value, unit, basis: "USD-constant", cohort: "pilot-banks" };

  // unavailable: current row denied.
  const denied = reviewIntlEvidence(
    makeResult({ generation: "g1" }, [makeObs({ id: "m1" }), makeObs({ id: "m2" }), makeObs({ id: "m3" })]),
    makeResult({ generation: "g2" }, [
      makeObs({ id: "m1", availability: "denied" }),
      makeObs({ id: "m2" }),
      makeObs({ id: "m3" }),
    ]),
    ctx,
  );
  const a = compose(denied, ctx.selectedMeasureIds);
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const aRow = (a.props.evidenceChanges ?? []).find((c) => c.stableId === "m1")!;
  assert.ok(aRow);
  assert.equal(aRow.numeric, null);
  assert.equal(aRow.nonComparableReason, "unavailable");
  assert.equal(aRow.version, "unknown");
  assert.equal(aRow.availability, "denied");

  // not_applicable: both sides available with no numeric interpretation at all.
  const notApplicable = reviewIntlEvidence(
    makeResult({ generation: "g1" }, [
      makeObs({ id: "m1", interpretation: null }),
      makeObs({ id: "m2" }),
      makeObs({ id: "m3" }),
    ]),
    makeResult({ generation: "g2" }, [
      makeObs({ id: "m1", interpretation: null }),
      makeObs({ id: "m2" }),
      makeObs({ id: "m3" }),
    ]),
    ctx,
  );
  const b = compose(notApplicable, ctx.selectedMeasureIds);
  assert.equal(b.ok, true);
  if (!b.ok) return;
  assert.equal((b.props.evidenceChanges ?? []).length, 0); // clean limitation-free rows are omitted

  // missing: prior side has no usable value, current side does.
  const missing = reviewIntlEvidence(
    makeResult({ generation: "g1" }, [
      makeObs({ id: "m1", interpretation: null }),
      makeObs({ id: "m2" }),
      makeObs({ id: "m3" }),
    ]),
    makeResult({ generation: "g2" }, [
      makeObs({ id: "m1", interpretation: interpretation(5) }),
      makeObs({ id: "m2" }),
      makeObs({ id: "m3" }),
    ]),
    ctx,
  );
  const c = compose(missing, ctx.selectedMeasureIds);
  assert.equal(c.ok, true);
  if (!c.ok) return;
  const cRow = (c.props.evidenceChanges ?? []).find((row) => row.stableId === "m1")!;
  assert.ok(cRow);
  assert.equal(cRow.nonComparableReason, "missing");
  assert.equal(cRow.numeric, null);

  // incompatible: legitimate units differ between the generations.
  const incompatible = reviewIntlEvidence(
    makeResult({ generation: "g1" }, [
      makeObs({ id: "m1", interpretation: interpretation(10, "%") }),
      makeObs({ id: "m2" }),
      makeObs({ id: "m3" }),
    ]),
    makeResult({ generation: "g2" }, [
      makeObs({ id: "m1", interpretation: interpretation(10, "bp") }),
      makeObs({ id: "m2" }),
      makeObs({ id: "m3" }),
    ]),
    ctx,
  );
  const d = compose(incompatible, ctx.selectedMeasureIds);
  assert.equal(d.ok, true);
  if (!d.ok) return;
  const dRow = (d.props.evidenceChanges ?? []).find((row) => row.stableId === "m1")!;
  assert.ok(dRow);
  assert.equal(dRow.nonComparableReason, "incompatible");
  assert.equal(dRow.numeric, null);
});

test("R4: no numeric or note leakage on a denied whole read", () => {
  const ctx = baseCtx();
  const prior = makeResult({ generation: "g1" }, [makeObs({ id: "m1" }), makeObs({ id: "m2" }), makeObs({ id: "m3" })]);
  const current = makeResult({ generation: "g2", read: "denied" }, [
    makeObs({ id: "m1", interpretation: { value: 12, unit: "%", basis: "USD-constant", cohort: "pilot-banks" } }),
    makeObs({ id: "m2" }),
    makeObs({ id: "m3" }),
  ]);
  const review = reviewIntlEvidence(prior, current, ctx);
  const r = compose(review, ctx.selectedMeasureIds);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.props.comparisonStatus, "denied");
  assert.deepEqual(r.props.evidenceChanges, []);
  assert.deepEqual(r.props.changedItems, []);
  for (const m of r.props.selectedMeasures) {
    assert.equal(m.value, null, m.stableId);
    assert.equal(m.unit, null, m.stableId);
    assert.doesNotMatch(m.note, /\d/, `${m.stableId}: ${m.note}`);
  }
  assert.equal(panelCounts(r.props).qualified, 0);
});

test("R4: incomplete keeps known material changes plus the limitation rows", () => {
  const ctx = baseCtx();
  const prior = makeResult({ generation: "g1" }, [
    makeObs({ id: "m1", contentIdentity: "cid-old" }),
    makeObs({ id: "m2" }),
    makeObs({ id: "m3" }),
  ]);
  const current = makeResult({ generation: "g2", membership: "page" }, [
    makeObs({ id: "m1", contentIdentity: "cid-new" }),
    makeObs({ id: "m2" }),
  ]);
  const review = reviewIntlEvidence(prior, current, ctx);
  assert.equal(review.review.summary, "incomplete");
  const r = compose(review, ctx.selectedMeasureIds);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.props.comparisonStatus, "incomplete");
  const rows = new Map((r.props.evidenceChanges ?? []).map((row) => [row.stableId, row]));
  assert.equal(rows.get("m1")!.version, "revised"); // known material change kept
  assert.equal(rows.get("m3")!.membership, "not_observed"); // limitation kept
});

test("R4: unchanged summary yields no evidence rows; forged 'changed' with none is refused", () => {
  const ctx = baseCtx();
  const obs = [makeObs({ id: "m1" }), makeObs({ id: "m2" }), makeObs({ id: "m3" })];
  const review = reviewIntlEvidence(makeResult({ generation: "g1" }, obs), makeResult({ generation: "g2" }, obs), ctx);
  const r = compose(review, ctx.selectedMeasureIds);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.props.comparisonStatus, "unchanged");
  assert.deepEqual(r.props.evidenceChanges, []);

  const forged = compose(
    { ...review, review: { ...review.review, summary: "changed" } },
    ctx.selectedMeasureIds,
  );
  assert.equal(forged.ok, false);
  if (forged.ok) return;
  assert.equal(forged.reason, "status_consistency");
});

/* ══ R5 — explicit nullable observation clocks; record clocks exact ═══════ */

test("R5/G6: observation clocks pass through for qualified rows only", () => {
  const ctx = baseCtx();
  const current = makeResult({ generation: "g2" }, [
    makeObs({ id: "m1" }),
    makeObs({ id: "m2", availability: "denied" }),
    makeObs({ id: "m3", qualified: false }),
  ]);
  const review = reviewIntlEvidence(null, current, ctx);
  const clocks = {
    m1: "2026-10-06T09:00:00Z",
    m2: "2026-10-06T09:00:00Z",
    m3: "2026-10-06T09:00:00Z",
  };
  const r = composeIntlInvestigationPanel({
    review,
    selectedMeasureIds: ctx.selectedMeasureIds,
    owner: ownerInput({ observedAtByMeasureId: clocks }) as never,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const byId = new Map(r.props.selectedMeasures.map((m) => [m.stableId, m]));
  assert.equal(byId.get("m1")!.observedAt, "2026-10-06T09:00:00Z");
  assert.equal(byId.get("m2")!.observedAt, null); // denied: suppressed
  assert.equal(byId.get("m3")!.observedAt, null); // not qualified: suppressed
  assert.deepEqual(r.diagnostics.observationClocksSuppressed, ["m2", "m3"]);
});

test("R5/G6: absent clocks stay null and malformed clock data is refused", () => {
  const ctx = baseCtx();
  const current = makeResult({ generation: "g2" }, [makeObs({ id: "m1" }), makeObs({ id: "m2" }), makeObs({ id: "m3" })]);
  const review = reviewIntlEvidence(null, current, ctx);
  const r = compose(review, ctx.selectedMeasureIds);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.props.selectedMeasures.every((m) => m.observedAt === null));

  const empty = compose(review, ctx.selectedMeasureIds, {
    owner: ownerInput({ observedAtByMeasureId: {} }),
  });
  assert.equal(empty.ok, true);
  if (empty.ok) assert.ok(empty.props.selectedMeasures.every((m) => m.observedAt === null));

  const badValue = compose(review, ctx.selectedMeasureIds, {
    owner: ownerInput({ observedAtByMeasureId: { m1: "" } }),
  });
  assert.equal(badValue.ok, false);
  if (!badValue.ok) {
    assert.equal(badValue.reason, "invalid_input");
    assert.deepEqual(badValue.detail, ["observedAtByMeasureId.m1"]);
  }

  const badMap = compose(review, ctx.selectedMeasureIds, {
    owner: ownerInput({ observedAtByMeasureId: null }),
  });
  assert.equal(badMap.ok, false);
  if (!badMap.ok) assert.equal(badMap.reason, "invalid_input");
});

test("R5: the four record clocks stay exact/null; generation is never a clock", () => {
  const ctx = baseCtx();
  const current = makeResult({ generation: "g2" }, [makeObs({ id: "m1" }), makeObs({ id: "m2" }), makeObs({ id: "m3" })]);
  const review = reviewIntlEvidence(null, current, ctx);
  const r = composeIntlInvestigationPanel({
    review,
    selectedMeasureIds: ctx.selectedMeasureIds,
    owner: ownerInput({ savedAt: null, updatedAt: "2026-10-06T09:00:00Z", rightsAt: null }) as never,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.props.savedAt, null);
  assert.equal(r.props.updatedAt, "2026-10-06T09:00:00Z");
  assert.equal(r.props.rightsAt, null);
  assert.notEqual(r.props.sourceGenerationAt, review.currentSafeCensus.generation);
});

/* ══ R6 — purity: no callback invocation, no behaviour in props ═══════════ */

test("R6: composition invokes no callbacks; only deliberate callbacks pass through", () => {
  const ctx = baseCtx();
  const current = makeResult({ generation: "g2" }, [makeObs({ id: "m1" }), makeObs({ id: "m2" }), makeObs({ id: "m3" })]);
  const review = reviewIntlEvidence(null, current, ctx);
  let calls = 0;
  const onInspect = (id: string) => { calls += 1; void id; };
  const onContinue = () => { calls += 1; };
  const onEdit = () => { calls += 1; };
  const r = composeIntlInvestigationPanel({
    review,
    selectedMeasureIds: ctx.selectedMeasureIds,
    owner: ownerInput() as never,
    callbacks: { onInspect, onContinue, onEdit },
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.props.onInspect, onInspect);
  assert.equal(r.props.onContinue, onContinue);
  assert.equal(r.props.onEdit, onEdit);
  assert.equal(calls, 0);
  for (const [k, v] of Object.entries(r.props)) {
    if (k !== "onInspect" && k !== "onContinue" && k !== "onEdit") {
      assert.notEqual(typeof v, "function", `${k} must be data, not behaviour`);
    }
  }
  assert.equal("diagnostics" in r.props, false);
  assert.equal("kernelSummary" in r.props, false);
  assert.ok(Array.isArray(r.props.evidenceChanges));
});
