/* Trusted-caller seam over the accepted IM08 adapter and IM09 mapper. Every
 * review and composition here is produced by the real accepted modules; the
 * spies pass through and only count calls, so a disposition can be proven to
 * compose nothing. No React mounting, no I/O. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/intlInvestigationEvidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intlInvestigationEvidence")>();
  return { ...actual, reviewIntlEvidence: vi.fn(actual.reviewIntlEvidence) };
});
vi.mock("@/lib/intlInvestigationComposition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intlInvestigationComposition")>();
  return { ...actual, composeIntlInvestigationPanel: vi.fn(actual.composeIntlInvestigationPanel) };
});

import {
  CONTEXT_FIELDS,
  reviewIntlEvidence,
  type IntlExactContext,
  type IntlOwnerObservation,
  type IntlOwnerResult,
  type IntlRequirements,
} from "@/lib/intlInvestigationEvidence";
import {
  composeIntlInvestigationPanel,
  type IntlCompositionOwnerInput,
} from "@/lib/intlInvestigationComposition";
import {
  INTL_CALLER_DISPOSITIONS,
  resolveIntlInvestigation,
  type IntlCallerInput,
  type IntlCallerResult,
  type IntlResolvedPacket,
} from "@/lib/intlInvestigationCaller";

const review = vi.mocked(reviewIntlEvidence);
const compose = vi.mocked(composeIntlInvestigationPanel);

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── fixtures ────────────────────────────────────────────────────────────── */

const ctx: IntlExactContext = {
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
};

const BASE_VALUES: Record<string, number> = { m1: 10, m2: 20, m3: 30 };

const obs = (id: string, value = BASE_VALUES[id], cid = `cid-${id}`): IntlOwnerObservation => ({
  id,
  availability: "available",
  qualified: true,
  excluded: false,
  correction: false,
  contentIdentity: cid,
  qualificationIdentity: `qid-${id}`,
  interpretation: { value, unit: "%", basis: "USD-constant", cohort: "pilot-banks" },
});

function result(over: Partial<IntlOwnerResult> = {}): IntlOwnerResult {
  const { selectedMeasureIds: _selected, ...scope } = ctx;
  return {
    ...scope,
    generation: "g1",
    read: "ok",
    membership: "complete",
    observations: ["m1", "m2", "m3"].map((id) => obs(id)),
    tombstones: [],
    ...over,
  };
}

const requirements: IntlRequirements = { requiredMeasureIds: ["m1", "m2", "m3"], unmetPrerequisites: [] };

function owner(over: Partial<IntlCompositionOwnerInput> = {}): IntlCompositionOwnerInput {
  return {
    lang: "en",
    question: "Where is capex share heading?",
    marketLabel: "Global equities",
    toolLabel: "Intl bindings v1",
    periodLabel: "2024Q4",
    basisLabel: "USD constant · total return",
    savedAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-06T09:00:00Z",
    sourceGenerationAt: "2026-10-05T00:00:00Z",
    rightsAt: "2026-10-02T00:00:00Z",
    measureLabels: { m1: "Capex share", m2: "Payout ratio", m3: "Net margin" },
    unmetLabels: [],
    ...over,
  };
}

function packet(over: Partial<IntlResolvedPacket> = {}): IntlCallerInput {
  return {
    disposition: "resolved",
    exactContext: ctx,
    prior: result(),
    current: result({ generation: "g2" }),
    requirements,
    owner: owner(),
    ...over,
  };
}

function resolved(r: IntlCallerResult) {
  if (r.kind !== "resolved") throw new Error(`expected resolved, got ${JSON.stringify(r)}`);
  return r;
}

function props(r: IntlCallerResult) {
  const c = resolved(r).composition;
  if (!c.ok) throw new Error(`composition refused: ${c.reason} ${c.detail.join(",")}`);
  return c.props;
}

const noComposition = () => {
  expect(review).not.toHaveBeenCalled();
  expect(compose).not.toHaveBeenCalled();
};

/* ── 1. resolved control ─────────────────────────────────────────────────── */

describe("resolved packet", () => {
  it("composes reviewIntlEvidence then composeIntlInvestigationPanel exactly once with the packet as given", () => {
    const prior = result();
    const current = result({
      generation: "g2",
      observations: [obs("m1", 12, "cid-m1-v2"), obs("m2"), obs("m3")],
    });
    const own = owner();
    const r = resolveIntlInvestigation(packet({ prior, current, owner: own }));

    expect(review).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[0]).toEqual([prior, current, ctx, requirements]);
    expect(review.mock.calls[0][0]).toBe(prior);
    expect(compose).toHaveBeenCalledTimes(1);
    const arg = compose.mock.calls[0][0];
    expect(Object.keys(arg).sort()).toEqual(["exactContext", "owner", "requirements", "review"]);
    expect(arg.review).toBe(resolved(r).review);
    expect(arg.owner).toBe(own);
    expect(arg.exactContext).toBe(ctx);
    expect(arg.requirements).toBe(requirements);

    const rv = resolved(r).review;
    expect(rv.baselineState).toBe("available");
    expect(rv.review.summary).toBe("changed");
    expect(rv.answerReadiness).toBe("ready");

    const p = props(r);
    expect(p.comparisonStatus).toBe("changed");
    expect(p.readiness).toEqual({ state: "ready", unmet: [] });
    expect(p.selectedMeasures.map((m) => [m.stableId, m.label, m.availability, m.value])).toEqual([
      ["m1", "Capex share", "qualified", 12],
      ["m2", "Payout ratio", "qualified", 20],
      ["m3", "Net margin", "qualified", 30],
    ]);
    const m1 = (p.evidenceChanges ?? []).find((c) => c.stableId === "m1");
    expect(m1?.version).toBe("revised");
    expect(m1?.numeric).toEqual({ prior: 10, current: 12, delta: 2, unit: "%" });
    expect([p.question, p.marketLabel, p.toolLabel, p.periodLabel, p.basisLabel]).toEqual([
      own.question, own.marketLabel, own.toolLabel, own.periodLabel, own.basisLabel,
    ]);
    expect([p.savedAt, p.updatedAt, p.sourceGenerationAt, p.rightsAt]).toEqual([
      own.savedAt, own.updatedAt, own.sourceGenerationAt, own.rightsAt,
    ]);
  });
});

/* ── 2. explicit caller dispositions ─────────────────────────────────────── */

describe("explicit caller dispositions", () => {
  it("publishes exactly the seven caller dispositions", () => {
    expect([...INTL_CALLER_DISPOSITIONS]).toEqual([
      "unauthenticated", "not_found", "not_admitted", "denied", "unavailable", "invalid", "scope_changed",
    ]);
  });

  for (const d of INTL_CALLER_DISPOSITIONS) {
    it(`${d} stays ${d}, with no review, composition or props`, () => {
      const r = resolveIntlInvestigation({ disposition: d });
      expect(r).toStrictEqual({ kind: "disposition", disposition: d, origin: "caller" });
      noComposition();
    });

    it(`${d} ignores stray packet fields instead of composing them`, () => {
      const { disposition: _resolved, ...stray } = packet() as Extract<IntlCallerInput, { disposition: "resolved" }>;
      const r = resolveIntlInvestigation({ ...stray, disposition: d } as unknown as IntlCallerInput);
      expect(r).toStrictEqual({ kind: "disposition", disposition: d, origin: "caller" });
      noComposition();
    });
  }

  it("keeps all seven distinct; none becomes a generic unavailable", () => {
    const out = INTL_CALLER_DISPOSITIONS.map((d) => resolveIntlInvestigation({ disposition: d }));
    expect(out.map((r) => (r.kind === "disposition" ? r.disposition : r.kind))).toEqual([...INTL_CALLER_DISPOSITIONS]);
    expect(out.filter((r) => r.kind === "disposition" && r.disposition === "unavailable")).toHaveLength(1);
  });
});

/* ── 3. well-formed nine-field scope mismatch ────────────────────────────── */

describe("well-formed scope mismatch", () => {
  it("current mismatch is scope_changed (field names only), where the frozen adapter alone says invalid", () => {
    const current = result({ generation: "g2", toolBindingVersion: "v2", periodIdentity: "2025Q1" });
    const r = resolveIntlInvestigation(packet({ current }));
    expect(r).toStrictEqual({
      kind: "disposition",
      disposition: "scope_changed",
      origin: "scope_check",
      side: "current",
      fields: ["toolBindingVersion", "periodIdentity"],
    });
    expect(JSON.stringify(r)).not.toMatch(/v2|2025Q1/);
    noComposition();
    expect(reviewIntlEvidence(result(), current, ctx, requirements).review.summary).toBe("invalid");
  });

  it("prior mismatch is scope_changed, where the frozen adapter alone says baseline unavailable", () => {
    const prior = result({ researchMarket: "em-equities" });
    const r = resolveIntlInvestigation(packet({ prior }));
    expect(r).toStrictEqual({
      kind: "disposition",
      disposition: "scope_changed",
      origin: "scope_check",
      side: "prior",
      fields: ["researchMarket"],
    });
    noComposition();
    const direct = reviewIntlEvidence(prior, result({ generation: "g2" }), ctx, requirements);
    expect([direct.baselineState, direct.review.summary]).toEqual(["unavailable", "unavailable"]);
  });

  it("each of the nine fields is detected on its own", () => {
    for (const f of CONTEXT_FIELDS) {
      const r = resolveIntlInvestigation(packet({ current: result({ generation: "g2", [f]: `${ctx[f]}-x` }) }));
      expect(r).toMatchObject({ disposition: "scope_changed", side: "current", fields: [f] });
    }
  });

  it("a current mismatch takes precedence over a prior mismatch", () => {
    const r = resolveIntlInvestigation(packet({
      prior: result({ cohort: "other-banks" }),
      current: result({ generation: "g2", query: "q-other" }),
    }));
    expect(r).toMatchObject({ side: "current", fields: ["query"] });
  });
});

/* ── 4. malformed owner result vs context mismatch ───────────────────────── */

describe("malformed current keeps the frozen adapter fallback", () => {
  const malformedCurrents: Array<[string, IntlOwnerResult]> = [
    ["empty generation", result({ cohort: "other-banks", generation: "" })],
    ["empty scope field", result({ generation: "g2", cohort: "" })],
    ["non-string scope field", result({ generation: "g2", cohort: 7 as unknown as string })],
    ["duplicate observation ids", result({ generation: "g2", cohort: "other-banks", observations: [obs("m1"), obs("m1")] })],
    ["bad read state", result({ generation: "g2", cohort: "other-banks", read: "maybe" as unknown as "ok" })],
  ];

  for (const [name, current] of malformedCurrents) {
    it(`mismatched current with ${name} is composed invalid, not scope_changed`, () => {
      const r = resolveIntlInvestigation(packet({ current }));
      expect(resolved(r).review.review.summary).toBe("invalid");
      expect(props(r).comparisonStatus).toBe("invalid");
      expect(review).toHaveBeenCalledTimes(1);
      expect(compose).toHaveBeenCalledTimes(1);
    });
  }

  it("a malformed current wins over a well-formed prior mismatch", () => {
    const r = resolveIntlInvestigation(packet({
      prior: result({ cohort: "other-banks" }),
      current: result({ generation: "" }),
    }));
    expect(props(r).comparisonStatus).toBe("invalid");
  });

  it("a malformed current wins over a malformed prior", () => {
    const r = resolveIntlInvestigation(packet({
      prior: result({ generation: "" }),
      current: result({ generation: "g2", read: "maybe" as unknown as "ok" }),
    }));
    expect(props(r).comparisonStatus).toBe("invalid");
    expect(review).toHaveBeenCalledTimes(1);
  });
});

/* ── 4b. malformed prior is invalid at the caller boundary ───────────────── */

const invalidPrior = (reason: string) => ({
  kind: "disposition",
  disposition: "invalid",
  origin: "owner_check",
  side: "prior",
  reason,
});

describe("malformed prior is invalid, not an unavailable comparison", () => {
  it("mismatched prior with an empty generation is invalid, where the frozen adapter alone says baseline unavailable", () => {
    const prior = result({ cohort: "other-banks", generation: "" });
    const r = resolveIntlInvestigation(packet({ prior }));
    expect(r).toStrictEqual(invalidPrior("missing_generation"));
    expect(JSON.stringify(r)).not.toMatch(/other-banks|pilot-banks/);
    noComposition();
    const direct = reviewIntlEvidence(prior, result({ generation: "g2" }), ctx, requirements);
    expect([direct.baselineState, direct.review.summary]).toEqual(["unavailable", "unavailable"]);
  });

  const malformedPriors: Array<[string, IntlOwnerResult, string]> = [
    ["empty generation", result({ generation: "" }), "missing_generation"],
    ["bad read state", result({ read: "maybe" as unknown as "ok" }), "invalid_read"],
    ["bad membership", result({ membership: "most" as unknown as "complete" }), "invalid_membership"],
    ["duplicate observation ids", result({ observations: [obs("m1"), obs("m1")] }), "duplicate_observation_id"],
    ["mismatched empty scope field", result({ cohort: "" }), "invalid_context"],
    ["mismatched non-string scope field", result({ cohort: 7 as unknown as string }), "invalid_context"],
    ["non-object result", "not-a-result" as unknown as IntlOwnerResult, "invalid_result"],
  ];

  for (const [name, prior, reason] of malformedPriors) {
    it(`prior with ${name} is invalid (${reason}) with no review or composition`, () => {
      expect(resolveIntlInvestigation(packet({ prior }))).toStrictEqual(invalidPrior(reason));
      noComposition();
    });
  }

  it("a current scope change still takes precedence over a malformed prior", () => {
    const r = resolveIntlInvestigation(packet({
      prior: result({ generation: "" }),
      current: result({ generation: "g2", query: "q-other" }),
    }));
    expect(r).toMatchObject({ disposition: "scope_changed", side: "current", fields: ["query"] });
  });
});

/* ── 5. missing prior vs genuine denied prior ────────────────────────────── */

describe("prior handling", () => {
  it("a missing prior stays null; current stays useful and the comparison is unavailable", () => {
    const current = result({ generation: "g2" });
    const r = resolveIntlInvestigation(packet({ prior: null, current }));
    expect(review.mock.calls[0][0]).toBeNull();
    const rv = resolved(r).review;
    expect(rv.baselineState).toBe("unavailable");
    expect(rv.review.summary).toBe("unavailable");
    expect(rv.review.priorGeneration).not.toBe("g2");
    const p = props(r);
    expect(p.comparisonStatus).toBe("unavailable");
    expect(p.selectedMeasures.map((m) => [m.stableId, m.availability, m.value])).toEqual([
      ["m1", "qualified", 10],
      ["m2", "qualified", 20],
      ["m3", "qualified", 30],
    ]);
    expect((p.evidenceChanges ?? []).filter((c) => c.membership === "added" || c.membership === "removed")).toEqual([]);
    expect(p.readiness.state).toBe("incomplete");
  });

  it("an actual unavailable prior read stays an unavailable comparison, not invalid; current stays useful", () => {
    const prior = result({ read: "unavailable", observations: [] });
    const r = resolveIntlInvestigation(packet({ prior }));
    expect(review.mock.calls[0][0]).toBe(prior);
    const rv = resolved(r).review;
    expect([rv.baselineState, rv.review.summary]).toEqual(["unavailable", "unavailable"]);
    const p = props(r);
    expect(p.comparisonStatus).toBe("unavailable");
    expect(p.selectedMeasures.map((m) => [m.stableId, m.availability, m.value])).toEqual([
      ["m1", "qualified", 10],
      ["m2", "qualified", 20],
      ["m3", "qualified", 30],
    ]);
  });

  it("a genuine denied prior is passed through as denied, never as a null prior", () => {
    const prior = result({ read: "denied", observations: [] });
    const r = resolveIntlInvestigation(packet({ prior }));
    expect(review.mock.calls[0][0]).toBe(prior);
    expect(resolved(r).review.review.summary).toBe("denied");
    expect(props(r).comparisonStatus).toBe("denied");
  });
});

/* ── 6. clocks: explicit null vs omitted ─────────────────────────────────── */

const RECORD_CLOCKS = ["savedAt", "updatedAt", "sourceGenerationAt", "rightsAt"] as const;

describe("clocks", () => {
  it("explicit null record clocks stay null", () => {
    const r = resolveIntlInvestigation(packet({
      owner: owner({ savedAt: null, updatedAt: null, sourceGenerationAt: null, rightsAt: null }),
    }));
    const p = props(r);
    expect([p.savedAt, p.updatedAt, p.sourceGenerationAt, p.rightsAt]).toEqual([null, null, null, null]);
  });

  for (const f of RECORD_CLOCKS) {
    it(`an omitted ${f} is refused by the mapper, not defaulted`, () => {
      const own = owner();
      delete (own as Partial<IntlCompositionOwnerInput>)[f];
      const r = resolveIntlInvestigation(packet({ owner: own }));
      expect(resolved(r).composition).toStrictEqual({ ok: false, reason: "invalid_input", detail: [f] });
      expect(f in compose.mock.calls[0][0].owner).toBe(false);
    });
  }

  it("an omitted observedAtByMeasureId stays absent: no row clock copied from a record clock or now", () => {
    const now = vi.spyOn(Date, "now");
    const own = owner();
    const r = resolveIntlInvestigation(packet({ owner: own }));
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
    expect("observedAtByMeasureId" in compose.mock.calls[0][0].owner).toBe(false);
    const p = props(r);
    expect(p.selectedMeasures.map((m) => m.observedAt)).toEqual([null, null, null]);
    expect(JSON.stringify(p.selectedMeasures)).not.toContain(own.sourceGenerationAt as string);
  });

  it("explicit per-row clocks are kept as given, null included", () => {
    const r = resolveIntlInvestigation(packet({
      owner: owner({ observedAtByMeasureId: { m1: null, m2: "2026-10-04T08:00:00Z" } }),
    }));
    expect(props(r).selectedMeasures.map((m) => m.observedAt)).toEqual([null, "2026-10-04T08:00:00Z", null]);
  });
});
