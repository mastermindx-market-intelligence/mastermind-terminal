import { test } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  toIntlEvidenceCensus,
  reviewIntlEvidence,
  type IntlExactContext,
  type IntlOwnerObservation,
  type IntlOwnerResult,
  type IntlRequirements,
} from "@/lib/intlInvestigationEvidence";
import { reviewEvidence } from "@/lib/investigationEvidenceDiff";

/** Frozen kernel identity per INPUT_MANIFEST.json. */
const FROZEN_KERNEL_PATH = join(__dirname, "../investigationEvidenceDiff.ts");
const FROZEN_KERNEL_HASH =
  "c10f75678b5e1a5caf1004007b60bf70e946cb0fc6b1f5aba0d193364b121579";

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
    // @ts-expect-error TS2783 type-only: frozen fixture re-spreads `o` (with its id) below
    id: o.id,
    availability: "available",
    qualified: true,
    excluded: false,
    correction: false,
    contentIdentity: `content-${o.id}`,
    qualificationIdentity: `qual-${o.id}`,
    interpretation: { value: 1, unit: "USD", basis: "constant", cohort: "pilot-banks" },
    ...o,
  };
}

function makeResult(o: Partial<IntlOwnerResult> = {}): IntlOwnerResult {
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
    generation: "gen-a",
    read: "ok",
    membership: "complete",
    observations: [],
    tombstones: [],
    ...o,
  };
}

function intl(v: number): IntlOwnerObservation["interpretation"] {
  return { value: v, unit: "USD", basis: "constant", cohort: "pilot-banks" };
}

// 1. Revised row amid incomplete membership — both revised AND incomplete, distinguishable from unchanged.
test("revised row amid incomplete membership → incomplete summary with a revised item", () => {
  const prior = makeResult({
    generation: "gen-p",
    membership: "complete",
    observations: [
      makeObs({ id: "m1", contentIdentity: "ci-m1-p", interpretation: intl(10) }),
      makeObs({ id: "m2", contentIdentity: "ci-m2-p", interpretation: intl(20) }),
    ],
  });
  const current = makeResult({
    generation: "gen-c",
    membership: "page",
    observations: [
      makeObs({ id: "m1", contentIdentity: "ci-m1-c-new", interpretation: intl(12) }),
      makeObs({ id: "m2", contentIdentity: "ci-m2-p", interpretation: intl(20) }),
    ],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  assert.equal(out.baselineState, "available");
  assert.equal(out.review.summary, "incomplete");
  const m1 = out.review.items.find((i) => i.id === "m1");
  assert.ok(m1);
  assert.equal(m1!.version, "revised");
  assert.equal(m1!.membership, "present");
});

// 2. Absent baseline — never substituted by current.
test("absent prior baseline → comparison unavailable, no current substitution", () => {
  const current = makeResult({
    generation: "gen-c",
    membership: "complete",
    observations: [
      makeObs({ id: "m1", interpretation: intl(5) }),
      makeObs({ id: "m2", interpretation: intl(7) }),
    ],
  });
  const out = reviewIntlEvidence(null, current, baseCtx());
  assert.equal(out.baselineState, "unavailable");
  assert.equal(out.review.summary, "unavailable");
  assert.equal(out.review.items.length, 0);
  assert.equal(out.review.priorGeneration, "");
  assert.equal(out.review.currentGeneration, "gen-c");
});

// 3a. Whole-read rights loss — denied current must not leak retained numerics.
test("whole read denial scrubs every row's numeric and reports denied", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [
      makeObs({ id: "m1", interpretation: intl(10) }),
      makeObs({ id: "m2", interpretation: intl(20) }),
    ],
  });
  const current = makeResult({
    generation: "gen-c",
    read: "denied",
    observations: [
      makeObs({ id: "m1", interpretation: intl(99) }),
      makeObs({ id: "m2", interpretation: intl(99) }),
    ],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  assert.equal(out.review.summary, "denied");
  assert.equal(out.review.items.length, 0);
  for (const item of out.currentSafeCensus.items) {
    assert.equal(item.interpretation, null, `id ${item.id} kept a numeric interpretation`);
  }
  assert.equal(out.coverage.qualifiedCount, 0);
});

// 3b. Row-level rights loss — denied row must scrub its numeric but other rows stay intact.
test("row denial scrubs that row's numeric before reaching the kernel", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [
      makeObs({ id: "m1", contentIdentity: "ci-m1", interpretation: intl(10) }),
      makeObs({ id: "m2", contentIdentity: "ci-m2", interpretation: intl(20) }),
    ],
  });
  const current = makeResult({
    generation: "gen-c",
    observations: [
      makeObs({ id: "m1", availability: "denied", interpretation: intl(99) }),
      makeObs({ id: "m2", contentIdentity: "ci-m2", interpretation: intl(20) }),
    ],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  const m1Safe = out.currentSafeCensus.items.find((i) => i.id === "m1");
  assert.ok(m1Safe);
  assert.equal(m1Safe!.availability, "denied");
  assert.equal(m1Safe!.interpretation, null);
  const m1Review = out.review.items.find((i) => i.id === "m1");
  assert.equal(m1Review!.interpretation.comparable, false);
  // m2 identical → unchanged; m1 incomplete → summary incomplete.
  const m2Review = out.review.items.find((i) => i.id === "m2");
  assert.equal(m2Review!.version, "unchanged");
  assert.equal(out.review.summary, "incomplete");
});

// 4. Excluded / stale / unqualified — all numeric interpretations scrubbed before the kernel.
test("excluded, stale and unqualified rows have their numeric interpretation scrubbed", () => {
  const obs: IntlOwnerObservation[] = [
    makeObs({ id: "m-excluded", excluded: true, interpretation: intl(1) }),
    makeObs({ id: "m-stale", availability: "stale", interpretation: intl(2) }),
    makeObs({ id: "m-unqualified", qualified: false, interpretation: intl(3) }),
  ];
  const current = makeResult({ generation: "gen-c", observations: obs });
  const out = reviewIntlEvidence(null, current, baseCtx());
  assert.equal(out.currentSafeCensus.items.length, 3);
  for (const item of out.currentSafeCensus.items) {
    assert.equal(item.interpretation, null, `id ${item.id} should be scrubbed`);
  }
  assert.equal(out.coverage.qualifiedCount, 0);
});

// 5. Same value, different content identity → revised, not unchanged.
test("same numeric value with new content identity → revised version", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [makeObs({ id: "m1", contentIdentity: "alpha", interpretation: intl(10) })],
  });
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1", contentIdentity: "beta", interpretation: intl(10) })],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  const m1 = out.review.items.find((i) => i.id === "m1");
  assert.equal(m1!.version, "revised");
  assert.ok(m1!.interpretation.comparable);
  assert.equal((m1!.interpretation as { delta: number }).delta, 0);
  assert.equal(out.review.summary, "changed");
});

// 6. Same generation with changed qualification → "changed", not automatically "unchanged".
test("same generation with changed qualification identity → changed", () => {
  const prior = makeResult({
    generation: "gen-same",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-stay", qualificationIdentity: "q-old" })],
  });
  const current = makeResult({
    generation: "gen-same",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-stay", qualificationIdentity: "q-new" })],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  const m1 = out.review.items.find((i) => i.id === "m1");
  assert.equal(m1!.qualification, "changed");
  assert.equal(m1!.version, "unchanged");
  assert.equal(out.review.summary, "changed");
});

// 7a. Page omission — kernel reports not_observed.
test("page membership omission → not_observed (not tombstoned)", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [makeObs({ id: "m1" }), makeObs({ id: "m2" })],
  });
  const current = makeResult({
    generation: "gen-c",
    membership: "page",
    observations: [makeObs({ id: "m1" })],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  const m2 = out.review.items.find((i) => i.id === "m2");
  assert.equal(m2!.membership, "not_observed");
});

// 7b. Complete tombstone → kernel reports removed.
test("complete membership with explicit tombstone → removed", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [makeObs({ id: "m1" }), makeObs({ id: "m2" })],
  });
  const current = makeResult({
    generation: "gen-c",
    membership: "complete",
    observations: [makeObs({ id: "m1" })],
    tombstones: ["m2"],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  const m2 = out.review.items.find((i) => i.id === "m2");
  assert.equal(m2!.membership, "removed");
  assert.equal(out.review.summary, "changed");
});

// 8. Changed market / period / basis / cohort → comparison cannot be reviewed.
test("changed researchMarket cannot be reviewed against the requested context", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-m1-p", interpretation: intl(10) })],
  });
  const current = makeResult({
    researchMarket: "global-bonds",
    generation: "gen-c",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-m1-c", interpretation: intl(12) })],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx({ researchMarket: "global-equities" }));
  assert.ok(
    ["scope_changed", "invalid", "unavailable"].includes(out.review.summary),
    `expected scope_changed/invalid/unavailable, got ${out.review.summary}`,
  );
  assert.equal(out.answerReadiness, "incomplete");
});

test("changed currencyBasis cannot be reviewed against the requested context", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-m1-p" })],
  });
  const current = makeResult({
    currencyBasis: "EUR-current",
    generation: "gen-c",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-m1-c" })],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx({ currencyBasis: "USD-constant" }));
  assert.ok(
    ["scope_changed", "invalid", "unavailable"].includes(out.review.summary),
    `expected scope_changed/invalid/unavailable, got ${out.review.summary}`,
  );
});

// 9. Same generation across distinct scopes is still detected.
test("identical generation strings across distinct scopes do not bypass comparison", () => {
  const prior = makeResult({
    researchMarket: "global-equities",
    generation: "shared-gen",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-m1" })],
  });
  const current = makeResult({
    researchMarket: "global-bonds",
    generation: "shared-gen",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-m1" })],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx({ researchMarket: "global-equities" }));
  assert.ok(
    ["scope_changed", "invalid", "unavailable"].includes(out.review.summary),
    `expected scope-detecting summary, got ${out.review.summary}`,
  );
  assert.equal(out.baselineState, "unavailable");
});

// 10. Coverage denominator stays at selectedCount even when observations are absent.
test("denominator stays at 3 when only 2 measures have qualified observations", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [
      makeObs({ id: "m1", contentIdentity: "ci-m1-p", interpretation: intl(1) }),
      makeObs({ id: "m2", contentIdentity: "ci-m2-p", interpretation: intl(2) }),
    ],
  });
  const current = makeResult({
    generation: "gen-c",
    observations: [
      makeObs({ id: "m1", contentIdentity: "ci-m1-c", interpretation: intl(11) }),
      makeObs({ id: "m2", contentIdentity: "ci-m2-c", interpretation: intl(22) }),
    ],
  });
  const out = reviewIntlEvidence(
    prior,
    current,
    baseCtx({ selectedMeasureIds: ["m1", "m2", "m3"] }),
  );
  assert.equal(out.coverage.selectedCount, 3);
  assert.equal(out.coverage.qualifiedCount, 2);
});

// 11. Zero valid — empty selectedMeasureIds and absent observations produce no crash.
test("zero valid scenario: empty selectedMeasureIds with absent observations", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1", interpretation: intl(5) })],
  });
  const out = reviewIntlEvidence(
    null,
    current,
    baseCtx({ selectedMeasureIds: [] }),
  );
  assert.equal(out.coverage.selectedCount, 0);
  assert.equal(out.coverage.qualifiedCount, 0);
  assert.equal(out.baselineState, "unavailable");
  assert.equal(out.answerReadiness, "incomplete");
});

/** CORRECTED r1 test (was "zero qualified but prereqs satisfied → ready"). The r1 version
 * asserted answerReadiness "ready" with ZERO qualified fields and no declared requirements
 * — exactly the invented-readiness defect the parent demonstrated (readiness from baseline
 * existence + nonempty selectedIds). Under the frozen requirements API, readiness is only
 * derivable from explicitly injected requiredMeasureIds/unmetPrerequisites; with no
 * requirements declared the answer stays incomplete even though the baseline exists. */
test("zero qualified with no declared requirements → incomplete, denominator preserved", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-m1-p", interpretation: intl(1) })],
  });
  // Current keeps the same item but drops interpretation - excluded now.
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1", contentIdentity: "ci-m1-c", excluded: true })],
  });
  const out = reviewIntlEvidence(
    prior,
    current,
    baseCtx({ selectedMeasureIds: ["m1"] }),
  );
  assert.equal(out.coverage.selectedCount, 1);
  assert.equal(out.coverage.qualifiedCount, 0);
  assert.equal(out.baselineState, "available");
  assert.equal(out.answerReadiness, "incomplete");
});

// 12. Malformed / duplicate input fails closed without fabricating completeness.
test("duplicate observation ids fail closed to invalid review and unavailable baseline", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1" }), makeObs({ id: "m1" })],
  });
  const out = reviewIntlEvidence(null, current, baseCtx());
  assert.equal(out.baselineState, "unavailable");
  assert.equal(out.review.summary, "invalid");
  assert.equal(out.coverage.qualifiedCount, 0);
  assert.equal(out.answerReadiness, "incomplete");
});

test("tombstone colliding with an observation id fails closed", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1" })],
    tombstones: ["m1"],
  });
  const out = reviewIntlEvidence(null, current, baseCtx());
  assert.equal(out.baselineState, "unavailable");
  assert.equal(out.review.summary, "invalid");
});

test("malformed exact context fails closed", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1" })],
  });
  const ctxBad = {
    ...baseCtx(),
    researchMarket: "", // malformed - empty field
  };
  const out = reviewIntlEvidence(null, current, ctxBad);
  assert.equal(out.baselineState, "unavailable");
  assert.equal(out.review.summary, "invalid");
  assert.equal(out.answerReadiness, "incomplete");
});

// 13. Frozen inputs unchanged.
test("frozen kernel file hash is exactly the manifest hash", () => {
  const content = readFileSync(FROZEN_KERNEL_PATH);
  const hash = createHash("sha256").update(content).digest("hex");
  assert.equal(hash, FROZEN_KERNEL_HASH);
});

// 14. Distinguishing page omission from complete tombstone — both paths treated distinctly.
test("tombstone removal in complete vs page omission in page produce different memberships", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [makeObs({ id: "m1" }), makeObs({ id: "m2" })],
  });

  const complete = makeResult({
    generation: "gen-c",
    membership: "complete",
    observations: [makeObs({ id: "m1" })],
    tombstones: ["m2"],
  });
  const paged = makeResult({
    generation: "gen-c",
    membership: "page",
    observations: [makeObs({ id: "m1" })],
  });

  const outComplete = reviewIntlEvidence(prior, complete, baseCtx());
  const outPaged = reviewIntlEvidence(prior, paged, baseCtx());
  const m2Complete = outComplete.review.items.find((i) => i.id === "m2");
  const m2Paged = outPaged.review.items.find((i) => i.id === "m2");
  assert.equal(m2Complete!.membership, "removed");
  assert.equal(m2Paged!.membership, "not_observed");
  assert.equal(outComplete.review.summary, "changed");
  assert.equal(outPaged.review.summary, "incomplete");
});

// 15. Not-applicable numeric input is removed before the kernel sees it.
test("not_applicable observation has its numeric interpretation removed", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [
      makeObs({ id: "m1", availability: "not_applicable", interpretation: intl(7) }),
    ],
  });
  const out = reviewIntlEvidence(null, current, baseCtx());
  const m1 = out.currentSafeCensus.items.find((i) => i.id === "m1");
  assert.ok(m1);
  assert.equal(m1!.interpretation, null);
});

// 16. Missing required comparison history keeps answer incomplete even when measures qualify.
test("missing comparison history → answer incomplete even with two qualified measures", () => {
  const ctx = baseCtx({ selectedMeasureIds: ["m1", "m2"] });
  const current = makeResult({
    generation: "gen-c",
    membership: "complete",
    observations: [
      makeObs({ id: "m1", contentIdentity: "ci-m1", interpretation: intl(10) }),
      makeObs({ id: "m2", contentIdentity: "ci-m2", interpretation: intl(20) }),
    ],
  });
  const out = reviewIntlEvidence(null, current, ctx);
  assert.equal(out.coverage.selectedCount, 2);
  assert.equal(out.coverage.qualifiedCount, 2);
  assert.equal(out.baselineState, "unavailable");
  assert.equal(out.answerReadiness, "incomplete");
});

// 17. Nonfinite interpretation values are scrubbed.
test("nonfinite (Infinity) interpretation value is scrubbed before the kernel", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [
      makeObs({
        id: "m1",
        contentIdentity: "ci-m1",
        interpretation: { value: Number.POSITIVE_INFINITY, unit: "USD", basis: "constant", cohort: "pilot-banks" },
      }),
    ],
  });
  const out = reviewIntlEvidence(null, current, baseCtx());
  const m1 = out.currentSafeCensus.items.find((i) => i.id === "m1");
  assert.ok(m1);
  assert.equal(m1!.interpretation, null);
  assert.equal(out.coverage.qualifiedCount, 0);
});

// 18. Missing unit / basis / cohort scrubs the interpretation.
test("interpretation missing unit is scrubbed", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [
      makeObs({
        id: "m1",
        contentIdentity: "ci-m1",
        interpretation: { value: 10, unit: null, basis: "constant", cohort: "pilot-banks" },
      }),
    ],
  });
  const out = reviewIntlEvidence(null, current, baseCtx());
  const m1 = out.currentSafeCensus.items.find((i) => i.id === "m1");
  assert.ok(m1);
  assert.equal(m1!.interpretation, null);
});

// 19. Full 9-field scope is preserved on the safe census for downstream discovery.
test("full owner scope fields remain discoverable on the safe census", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1", interpretation: intl(1) })],
  });
  const out = reviewIntlEvidence(null, current, baseCtx({
    toolBindingVersion: "v9",
    researchMarket: "global-equities",
  }));
  assert.equal(out.currentSafeCensus.fullScope.toolBindingVersion, "v9");
  assert.equal(out.currentSafeCensus.fullScope.researchMarket, "global-equities");
  assert.equal(out.currentSafeCensus.fullScope.currencyBasis, "USD-constant");
  assert.equal(out.currentSafeCensus.fullScope.periodIdentity, "2024Q4");
  assert.equal(out.currentSafeCensus.fullScope.returnBasis, "total-return");
  assert.equal(out.currentSafeCensus.fullScope.owner, "intl.evidence");
  assert.equal(out.currentSafeCensus.fullScope.query, "q-capex-share");
  assert.equal(out.currentSafeCensus.fullScope.cohort, "pilot-banks");
  assert.equal(out.currentSafeCensus.fullScope.temporalPolicy, "point-in-time");
});

// 20. Whole-read unavailable must surface as unavailable (not empty + ok).
test("whole read unavailable produces unavailable summary, not substituted empty census", () => {
  const prior = makeResult({ generation: "gen-p" });
  const current = makeResult({
    generation: "gen-c",
    read: "unavailable",
    observations: [
      makeObs({ id: "m1", availability: "unavailable", interpretation: intl(99) }),
    ],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  assert.equal(out.review.summary, "unavailable");
  assert.equal(out.coverage.qualifiedCount, 0);
});

// 21. Identical snapshots with same context → unchanged summary.
/** CORRECTED r1 test: the r1 version asserted answerReadiness "ready" here with no
 * declared requirements — readiness invented from an unchanged review alone. Under the
 * frozen API, an unchanged exact-scope review with a usable baseline is necessary but
 * never sufficient; without explicit requirements the answer stays incomplete. The
 * positive ready path is covered below ("explicit declared requirements fully satisfied"). */
test("identical snapshots and same context → unchanged, baseline available, incomplete without requirements", () => {
  const obs = [makeObs({ id: "m1" }), makeObs({ id: "m2" })];
  const prior = makeResult({ generation: "gen-same", observations: obs });
  const current = makeResult({ generation: "gen-same", observations: obs });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  assert.equal(out.review.summary, "unchanged");
  assert.equal(out.baselineState, "available");
  assert.equal(out.answerReadiness, "incomplete");
});

// 22. Whole-read trust loss fully scrubs even qualified rows.
test("when whole read is denied, all rows lose their numeric even if individually qualified", () => {
  const current = makeResult({
    generation: "gen-c",
    read: "denied",
    observations: [
      makeObs({ id: "m1", qualified: true, interpretation: intl(50) }),
      makeObs({ id: "m2", qualified: true, interpretation: intl(60) }),
    ],
  });
  const out = reviewIntlEvidence(null, current, baseCtx());
  for (const item of out.currentSafeCensus.items) {
    assert.equal(item.interpretation, null);
  }
  assert.equal(out.coverage.qualifiedCount, 0);
});

// 23. toIntlEvidenceCensus rejects malformed context without partial output.
test("toIntlEvidenceCensus rejects empty context", () => {
  const out = toIntlEvidenceCensus(
    makeResult({ observations: [makeObs({ id: "m1" })] }),
    baseCtx({ researchMarket: "" }),
  );
  assert.equal(out.ok, false);
});

// 24. Duplicate selectedMeasureIds in context collapse to the unique denominator.
test("duplicate selectedMeasureIds in context yield a unique denominator", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1", interpretation: intl(5) })],
  });
  const out = reviewIntlEvidence(
    null,
    current,
    baseCtx({ selectedMeasureIds: ["m1", "m1", "m2"] }),
  );
  assert.equal(out.coverage.selectedCount, 2);
  assert.equal(out.coverage.qualifiedCount, 1);
});

/* ---------------------------------------------------------------------------
 * r2 repair tests: frozen requirements API (readiness), scope boundary of the
 * encoded 9-field kernel scope, fail-closed malformed inputs, and availability
 * class preservation. These encode the semantics the five frozen parent
 * countertests demonstrated were broken in the rejected r1 build.
 * ------------------------------------------------------------------------- */

const req = (requiredMeasureIds: readonly string[], unmetPrerequisites: readonly string[] = []) =>
  ({ requiredMeasureIds, unmetPrerequisites } as IntlRequirements);

/** Owner result whose 9-field context matches the given context (mirrors how the owner
 * projection carries its own context alongside the payload). */
function resultFor(ctx: IntlExactContext, o: Partial<IntlOwnerResult> = {}): IntlOwnerResult {
  return makeResult({
    researchMarket: ctx.researchMarket,
    toolBindingVersion: ctx.toolBindingVersion,
    periodIdentity: ctx.periodIdentity,
    currencyBasis: ctx.currencyBasis,
    returnBasis: ctx.returnBasis,
    owner: ctx.owner,
    query: ctx.query,
    cohort: ctx.cohort,
    temporalPolicy: ctx.temporalPolicy,
    ...o,
  });
}

// 25. Explicit declared requirements fully satisfied → ready (positive frozen-API path).
test("explicit declared requirements fully satisfied → ready", () => {
  const obs = [makeObs({ id: "m1", interpretation: intl(1) }), makeObs({ id: "m2", interpretation: intl(2) })];
  const prior = makeResult({ generation: "gen-p", observations: obs });
  const current = makeResult({ generation: "gen-c", observations: obs });
  const out = reviewIntlEvidence(prior, current, baseCtx(), req(["m1", "m2"]));
  assert.equal(out.review.summary, "unchanged");
  assert.equal(out.baselineState, "available");
  assert.equal(out.coverage.qualifiedCount, 2);
  assert.equal(out.answerReadiness, "ready");
});

// 26. Incomplete global membership does not block readiness when every required field verifies.
test("ready despite incomplete membership when all required fields are verified", () => {
  const prior = makeResult({
    generation: "gen-p",
    membership: "complete",
    observations: [makeObs({ id: "m1", interpretation: intl(1) }), makeObs({ id: "m2" })],
  });
  const current = makeResult({
    generation: "gen-c",
    membership: "page",
    observations: [makeObs({ id: "m1", interpretation: intl(1) })],
  });
  const out = reviewIntlEvidence(prior, current, baseCtx(), req(["m1"]));
  assert.equal(out.review.summary, "incomplete");
  const m2 = out.review.items.find((i) => i.id === "m2");
  assert.equal(m2!.membership, "not_observed");
  assert.equal(out.answerReadiness, "ready");
});

// 27. Empty requiredMeasureIds → incomplete (readiness cannot be declared from nothing).
test("empty requiredMeasureIds → incomplete even with everything qualified", () => {
  const obs = [makeObs({ id: "m1", interpretation: intl(1) })];
  const prior = makeResult({ generation: "gen-p", observations: obs });
  const current = makeResult({ generation: "gen-c", observations: obs });
  const out = reviewIntlEvidence(prior, current, baseCtx(), req([]));
  assert.equal(out.answerReadiness, "incomplete");
});

// 28. Malformed requirements shapes fail closed to incomplete without throwing.
test("malformed requirements shapes → incomplete without throwing", () => {
  const obs = [makeObs({ id: "m1", interpretation: intl(1) })];
  const prior = makeResult({ generation: "gen-p", observations: obs });
  const current = makeResult({ generation: "gen-c", observations: obs });
  const malformed: unknown[] = [
    null,
    {},
    { requiredMeasureIds: "m1", unmetPrerequisites: [] },
    { requiredMeasureIds: ["", "m1"], unmetPrerequisites: [] },
    { requiredMeasureIds: ["m1"] },
    { requiredMeasureIds: ["m1"], unmetPrerequisites: "none" },
    { requiredMeasureIds: ["m1"], unmetPrerequisites: [7] },
  ];
  for (const m of malformed) {
    let out: ReturnType<typeof reviewIntlEvidence> | undefined;
    assert.doesNotThrow(() => {
      out = reviewIntlEvidence(prior, current, baseCtx(), m as IntlRequirements);
    });
    assert.equal(out!.answerReadiness, "incomplete");
  }
});

// 29. A required id absent from the current census keeps the answer incomplete.
test("required measure absent from current census → incomplete", () => {
  const obs = [makeObs({ id: "m1", interpretation: intl(1) })];
  const prior = makeResult({ generation: "gen-p", observations: obs });
  const current = makeResult({ generation: "gen-c", observations: obs });
  const out = reviewIntlEvidence(prior, current, baseCtx(), req(["m1", "m9"]));
  assert.equal(out.answerReadiness, "incomplete");
});

// 30. A required id present but denied / excluded / stale / unqualified → incomplete.
test("required measure not usable (denied, excluded, stale, unqualified) → incomplete", () => {
  const prior = makeResult({
    generation: "gen-p",
    observations: [makeObs({ id: "m1", interpretation: intl(1) })],
  });
  const badRows = [
    { availability: "denied" as const },
    { excluded: true },
    { availability: "stale" as const },
    { qualified: false },
  ];
  for (const patch of badRows) {
    const current = makeResult({
      generation: "gen-c",
      observations: [makeObs({ id: "m1", interpretation: intl(9), ...patch })],
    });
    const out = reviewIntlEvidence(prior, current, baseCtx(), req(["m1"]));
    assert.equal(out.answerReadiness, "incomplete", `patch ${JSON.stringify(patch)} should not be ready`);
    assert.equal(out.coverage.qualifiedCount, 0);
  }
});

// 31. A declared unmet prerequisite blocks readiness even when every required field verifies.
test("declared unmet prerequisite blocks readiness despite verified fields", () => {
  const obs = [makeObs({ id: "m1", interpretation: intl(1) })];
  const prior = makeResult({ generation: "gen-p", observations: obs });
  const current = makeResult({ generation: "gen-c", observations: obs });
  const out = reviewIntlEvidence(
    prior,
    current,
    baseCtx(),
    req(["m1"], ["comparison economy history missing"]),
  );
  assert.equal(out.coverage.qualifiedCount, 1);
  assert.equal(out.answerReadiness, "incomplete");
});

// 32. Missing prior baseline blocks readiness even with requirements declared and verified.
test("requirements declared but baseline missing → incomplete", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1", interpretation: intl(1) })],
  });
  const out = reviewIntlEvidence(null, current, baseCtx(), req(["m1"]));
  assert.equal(out.baselineState, "unavailable");
  assert.equal(out.answerReadiness, "incomplete");
});

// 33. Scope boundary: safe censuses bind ALL nine context fields even under a direct
// generic kernel call (r1 only bound 4, allowing cross tool-binding comparison).
test("direct generic kernel review detects toolBindingVersion scope change", () => {
  const ctxA = baseCtx();
  const ctxB = baseCtx({ toolBindingVersion: "v2" });
  const a = toIntlEvidenceCensus(resultFor(ctxA), ctxA);
  const b = toIntlEvidenceCensus(resultFor(ctxB), ctxB);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(reviewEvidence(a.census, b.census).summary, "scope_changed");
});

test("direct generic kernel review detects periodIdentity scope change", () => {
  const ctxA = baseCtx();
  const ctxB = baseCtx({ periodIdentity: "2025Q1" });
  const a = toIntlEvidenceCensus(resultFor(ctxA), ctxA);
  const b = toIntlEvidenceCensus(resultFor(ctxB), ctxB);
  // @ts-expect-error TS2339 type-only: frozen assertion reads .census from the BuildResult union
  assert.equal(reviewEvidence(a.census, b.census).summary, "scope_changed");
});

test("direct generic kernel review of identical contexts stays comparable", () => {
  const ctx = baseCtx();
  const a = toIntlEvidenceCensus(resultFor(ctx, { observations: [makeObs({ id: "m1" })] }), ctx);
  const b = toIntlEvidenceCensus(resultFor(ctx, { observations: [makeObs({ id: "m1" })] }), ctx);
  // @ts-expect-error TS2339 type-only: frozen assertion reads .census from the BuildResult union
  assert.equal(reviewEvidence(a.census, b.census).summary, "unchanged");
});

// 34. The JSON array scope encoding is collision-free where naive concatenation collides.
test("scope encoding does not collide where naive concatenation would", () => {
  // Naive "|" join of (researchMarket, toolBindingVersion) yields "a|b|c" for BOTH contexts.
  const ctxA = baseCtx({ researchMarket: "a", toolBindingVersion: "b|c" });
  const ctxB = baseCtx({ researchMarket: "a|b", toolBindingVersion: "c" });
  const a = toIntlEvidenceCensus(resultFor(ctxA), ctxA);
  const b = toIntlEvidenceCensus(resultFor(ctxB), ctxB);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.census.scope.query, b.census.scope.query);
  assert.equal(reviewEvidence(a.census, b.census).summary, "scope_changed");
});

// 35. Kernel scope.query carries all nine context fields in canonical order.
test("kernel scope query encodes all nine context fields as a JSON array", () => {
  const ctx = baseCtx();
  const a = toIntlEvidenceCensus(resultFor(ctx), ctx);
  assert.equal(a.ok, true);
  const decoded = JSON.parse(a.census.scope.query) as string[];
  assert.deepEqual(decoded, [
    ctx.researchMarket,
    ctx.toolBindingVersion,
    ctx.periodIdentity,
    ctx.currencyBasis,
    ctx.returnBasis,
    ctx.owner,
    ctx.query,
    ctx.cohort,
    ctx.temporalPolicy,
  ]);
  assert.equal(a.census.scope.owner, ctx.owner);
  assert.equal(a.census.scope.cohort, ctx.cohort);
  assert.equal(a.census.scope.temporalPolicy, ctx.temporalPolicy);
});

// 36. Failed whole read keeps the row's unavailable class (not mislabeled denied);
// a denied whole read keeps denied. Numerics scrubbed in both cases.
test("whole-read failure class is preserved per read state on census rows", () => {
  const row = makeObs({ id: "m1", interpretation: intl(5) });
  const unavail = toIntlEvidenceCensus(
    makeResult({ generation: "g", read: "unavailable", observations: [row] }),
    baseCtx(),
  );
  assert.equal(unavail.ok, true);
  assert.equal(unavail.census.items[0].availability, "unavailable");
  assert.equal(unavail.census.items[0].interpretation, null);
  const denied = toIntlEvidenceCensus(
    makeResult({ generation: "g", read: "denied", observations: [row] }),
    baseCtx(),
  );
  assert.equal(denied.ok, true);
  assert.equal(denied.census.items[0].availability, "denied");
  assert.equal(denied.census.items[0].interpretation, null);
});

// 37. Null/malformed result and array inputs fail closed (invalid) rather than throwing.
test("null and malformed result inputs fail closed without throwing", () => {
  const cases: unknown[] = [
    null,
    42,
    makeResult({ observations: null as unknown as readonly IntlOwnerObservation[] }),
    makeResult({ observations: "nope" as unknown as readonly IntlOwnerObservation[] }),
    makeResult({ observations: [null as unknown as IntlOwnerObservation] }),
    makeResult({ tombstones: null as unknown as readonly string[] }),
    makeResult({ tombstones: [42] as unknown as readonly string[] }),
    makeResult({ read: "maybe" as unknown as "ok" }),
    makeResult({ membership: "partial" as unknown as "complete" }),
    makeResult({ generation: "" }),
  ];
  for (const bad of cases) {
    let out: ReturnType<typeof reviewIntlEvidence> | undefined;
    assert.doesNotThrow(() => {
      out = reviewIntlEvidence(null, bad as IntlOwnerResult, baseCtx());
    });
    assert.equal(out!.review.summary, "invalid");
    assert.equal(out!.baselineState, "unavailable");
    assert.equal(out!.answerReadiness, "incomplete");
    assert.equal(out!.currentSafeCensus.items.length, 0);
  }
});

// 38. Malformed prior result also fails closed instead of throwing or substituting current.
test("malformed prior result → comparison unavailable for the current row set", () => {
  const current = makeResult({
    generation: "gen-c",
    observations: [makeObs({ id: "m1", interpretation: intl(1) })],
  });
  let out: ReturnType<typeof reviewIntlEvidence> | undefined;
  assert.doesNotThrow(() => {
    out = reviewIntlEvidence(
      makeResult({ observations: null as unknown as readonly IntlOwnerObservation[] }),
      current,
      baseCtx(),
    );
  });
  assert.equal(out!.baselineState, "unavailable");
  assert.equal(out!.review.summary, "unavailable");
  // Current rows are still surfaced (scrubbed-safe) but never act as the prior.
  assert.equal(out!.review.currentGeneration, "gen-c");
  assert.equal(out!.review.items.length, 0);
});

// 39. Generation/timestamp-only change with identical contentIdentity is not a revision.
test("generation-only change with same contentIdentity → unchanged, not revised", () => {
  const obs = [makeObs({ id: "m1", contentIdentity: "ci-stable", interpretation: intl(3) })];
  const prior = makeResult({ generation: "gen-p", observations: obs });
  const current = makeResult({ generation: "gen-c", observations: obs });
  const out = reviewIntlEvidence(prior, current, baseCtx());
  const m1 = out.review.items.find((i) => i.id === "m1");
  assert.equal(m1!.version, "unchanged");
  assert.equal(out.review.summary, "unchanged");
});

// 40. Remaining context fields (period/returnBasis/cohort/temporalPolicy) cannot be
// reviewed when the owner result context diverges from the requested context.
test("changed periodIdentity/returnBasis/cohort/temporalPolicy fail comparison", () => {
  const prior = makeResult({ generation: "gen-p", observations: [makeObs({ id: "m1" })] });
  const patches = [
    { periodIdentity: "2025Q1" },
    { returnBasis: "price-return" },
    { cohort: "all-banks" },
    { temporalPolicy: "as-reported" },
  ] as const;
  for (const patch of patches) {
    const current = makeResult({ generation: "gen-c", observations: [makeObs({ id: "m1" })], ...patch });
    const out = reviewIntlEvidence(prior, current, baseCtx());
    assert.ok(
      ["scope_changed", "invalid", "unavailable"].includes(out.review.summary),
      `patch ${JSON.stringify(patch)} produced ${out.review.summary}`,
    );
    assert.equal(out.answerReadiness, "incomplete");
  }
});
