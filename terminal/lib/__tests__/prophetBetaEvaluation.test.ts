import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BENCHMARK_COMPARATOR_ID, INCUMBENT_COMPARATOR_ID, COMPARATOR_ORDER,
  decodeBetaEvaluation, evaluationLevelRank, findComparator, intervalIncludesZero,
  orderedComparators,
} from "@/lib/prophetBetaEvaluation";

/** The REAL engine artifact, byte-identical to the committed fixture. */
const realArtifact = (): unknown =>
  JSON.parse(readFileSync(path.join(process.cwd(), "public/data/prophet_beta_evaluation_fixture.json"), "utf8"));

/** Deep clone + mutate, in the spirit of every closed-decoder test before it. */
const mutate = (edit: (draft: Record<string, unknown>) => void): unknown => {
  const draft = JSON.parse(JSON.stringify(realArtifact())) as Record<string, unknown>;
  edit(draft);
  return draft;
};

const cmp = (draft: Record<string, unknown>, id: string): Record<string, unknown> =>
  (draft.comparators as Array<Record<string, unknown>>).find(row => row.id === id) as Record<string, unknown>;
const cmpField = (draft: Record<string, unknown>, id: string): Record<string, unknown> =>
  cmp(draft, id) as unknown as Record<string, unknown>;

/** Wire view of the committed fixture. Expectations below read from the wire,
 * never from a copy of the numbers: when the engine republishes a corrected
 * artifact this suite keeps proving PRESERVATION, not last month's truth. */
const wire = (): Record<string, unknown> => realArtifact() as Record<string, unknown>;
const wireAt = (source: Record<string, unknown>, key: string): Record<string, unknown> =>
  source[key] as Record<string, unknown>;
const wireCmp = (id: string): Record<string, unknown> => cmp(wire(), id);

describe("the closed prophet.beta_evaluation/v1 decoder — the real artifact", () => {
  it("admits the committed real artifact and preserves its published numbers", () => {
    const raw = wire();
    const decoded = decodeBetaEvaluation(raw);
    expect(decoded).not.toBeNull();
    expect(decoded!.schema).toBe("prophet.beta_evaluation/v1");
    expect(decoded!.release.overallLevel).toBe(wireAt(raw, "release").overall_level);
    expect(decoded!.release.globalMinimumMet).toBe(wireAt(raw, "release").global_minimum_met);
    expect(decoded!.window.sessions).toBe(wireAt(raw, "window").sessions);
    expect(decoded!.window.spyTotalReturn).toBe(wireAt(raw, "window").spy_total_return);
    expect(decoded!.comparators).toHaveLength((raw.comparators as unknown[]).length);
    expect(decoded!.contrasts.rows.map(k => k.id))
      .toEqual((wireAt(raw, "contrasts").rows as Array<Record<string, unknown>>).map(r => r.id));
    expect(decoded!.attribution.map(entry => entry.bookId)).toContain(INCUMBENT_COMPARATOR_ID);
    expect(decoded!.coverage.eraPlans).toBe(wireAt(raw, "coverage").era_plans);
    expect(decoded!.coverage.evaluatedPositions).toBe(wireAt(raw, "coverage").evaluated_positions);
    expect(decoded!.coverage.excluded).toHaveLength(Object.keys(wireAt(raw, "coverage").excluded as object).length);
    expect(decoded!.deviations.map(d => d.id))
      .toEqual((raw.deviations as Array<Record<string, unknown>>).map(d => d.id));
    // Authority flags are contract law (all false), independent of the numbers.
    expect(decoded!.mayRank).toBe(false);
    const rawC6 = wireCmp(INCUMBENT_COMPARATOR_ID);
    const c6 = findComparator(decoded!.comparators, INCUMBENT_COMPARATOR_ID)!;
    expect(c6.status).toBe(rawC6.status);
    expect(c6.beta).toBe(rawC6.beta_vs_market);
    expect(c6.totalNetReturn).toBe(rawC6.total_net_return);
    expect(c6.vsSpy!.totalDiff).toBe(wireAt(rawC6, "vs_passive_market").total_diff);
    expect(c6.hitRateVsSpy?.beatSpy).toBe(wireAt(rawC6, "hit_rate_vs_spy").beat_spy);
    const rawPost = wireAt(wireAt(raw, "post_hoc_diagnostics"), INCUMBENT_COMPARATOR_ID);
    const ex = decoded!.postHocDiagnostics.books.find(b => b.bookId === INCUMBENT_COMPARATOR_ID)!.book.withoutTopContributor;
    expect(ex.droppedAsset).toBe(wireAt(rawPost, "without_top_contributor").dropped_asset);
    // Engine prose rides through verbatim, whatever it says this week.
    expect(decoded!.headline).toEqual(raw.headline);
  });

  it("tolerates unknown object keys (forward compatibility) without weakening closed values", () => {
    const decoded = decodeBetaEvaluation(mutate(draft => {
      (draft as Record<string, unknown>).future_block = { anything: true };
      cmpField(draft, INCUMBENT_COMPARATOR_ID).future_field = "unknown";
    }));
    expect(decoded).not.toBeNull();
  });
});

describe("the D5 correction: population and sensitivity blocks", () => {
  // The committed fixture IS the corrected artifact (16 outage-reconstructed
  // plans excluded). These tests prove the typed decode preserves the wire
  // values and that the page still works on the PRE-correction shape (blocks
  // absent → null, never a zero that reads as a value).
  it("decodes the population block and preserves every published cohort figure", () => {
    const raw = wireAt(wire(), "population");
    const decoded = decodeBetaEvaluation(wire())!.population;
    expect(decoded).not.toBeNull();
    expect(decoded!.primary).toBe(raw.primary);
    const cohortRaw = wireAt(raw, "excluded_cohort") as Record<string, unknown>;
    const cohort = decoded!.excludedCohort!;
    expect(cohort.eraPlansExcluded).toBe(cohortRaw.era_plans_excluded);
    expect(cohort.ofWhichReplayedReceiptedBake).toBe(cohortRaw.of_which_replayed_receipted_bake);
    expect(cohort.ofWhichSyntheticBoardReconstructions).toBe(cohortRaw.of_which_synthetic_board_reconstructions);
    expect(cohort.planIds).toEqual(cohortRaw.plan_ids);
    expect(cohort.wouldHaveEnteredPositionsAsRun).toBe(cohortRaw.would_have_entered_positions_as_run);
    // The census arithmetic is the artifact's own; we only preserve it.
    expect(cohort.ofWhichReplayedReceiptedBake! + cohort.ofWhichSyntheticBoardReconstructions!)
      .toBe(cohort.eraPlansExcluded);
    expect(decoded!.review?.file).toBe(wireAt(raw, "review").file);
  });

  it("decodes the sensitivity block: label verbatim, variant row and superseded books preserved", () => {
    const raw = wireAt(wire(), "sensitivity");
    const decoded = decodeBetaEvaluation(wire())!.sensitivity;
    expect(decoded).not.toBeNull();
    expect(decoded!.label).toBe(raw.label);
    const variantRaw = wireAt(raw, "backfill_replays_admitted_after_availability");
    const variant = decoded!.backfillReplaysAdmittedAfterAvailability!;
    expect(variant.positions).toBe(variantRaw.positions);
    expect(variant.excessTotalVsSpy).toBe(variantRaw.excess_total_vs_spy);
    expect(variant.excessTotalCi95).toEqual(variantRaw.excess_total_ci95);
    expect(variant.hitRateVsSpy?.beatSpy).toBe(wireAt(variantRaw, "hit_rate_vs_spy").beat_spy);
    const supersededRaw = wireAt(raw, "superseded_as_run") as Record<string, unknown>;
    const superseded = decoded!.supersededAsRun!;
    expect(superseded.sameEngineSeedPricesCosts).toBe(true);
    const c6Old = superseded.rows.find(r => r.comparatorId === INCUMBENT_COMPARATOR_ID)!.row;
    expect(c6Old.excessTotalVsSpy).toBe(wireAt(supersededRaw, INCUMBENT_COMPARATOR_ID).excess_total_vs_spy);
    expect(c6Old.totalNetReturn).toBe(wireAt(supersededRaw, INCUMBENT_COMPARATOR_ID).total_net_return);
    const contrastsRaw = wireAt(supersededRaw, "contrasts") as Record<string, unknown>;
    expect(superseded.contrasts.map(c => c.id)).toEqual(Object.keys(contrastsRaw));
  });

  it("carries the unmatured 63-session horizon as absent metrics, never zeros", () => {
    const raw63 = wireAt(wireAt(wire(), "event_study").horizons as object, "63") as Record<string, unknown>;
    const h63 = decodeBetaEvaluation(wire())!.eventStudy.horizons.find(h => h.horizon === "63")!;
    expect(raw63.status).toBe("unmatured");
    expect(h63.status).toBe("unmatured");
    expect(h63.n).toBe(raw63.n);
    expect(h63.excessVsSpy).toBeNull();
    expect(h63.shareBeatingSpy).toBeNull();
    expect(h63.nDates).toBeNull();
    const es = decodeBetaEvaluation(wire())!.eventStudy;
    expect(es.excludedBackfilledPlans).toBe(wireAt(wire(), "event_study").excluded_backfilled_plans);
    // A matured horizon still carries the full metric set.
    const h21 = es.horizons.find(h => h.horizon === "21")!;
    expect(h21.excessVsSpy).not.toBeNull();
  });

  it("still decodes the PRE-correction artifact shape with the D5 blocks absent", () => {
    const decoded = decodeBetaEvaluation(mutate(draft => {
      delete draft.population;
      delete draft.sensitivity;
      delete (draft.event_study as Record<string, unknown>).excluded_backfilled_plans;
    }));
    expect(decoded).not.toBeNull();
    expect(decoded!.population).toBeNull();
    expect(decoded!.sensitivity).toBeNull();
    expect(decoded!.eventStudy.excludedBackfilledPlans).toBeNull();
  });
});

describe("the closed decoder — malformed variants fail closed", () => {
  it.each([
    ["wrong schema", (d: Record<string, unknown>) => { d.schema = "prophet.beta_evaluation/v2"; }],
    ["wrong view", (d: Record<string, unknown>) => { d.view = "OTHER_VIEW"; }],
    ["missing incumbent C6", (d: Record<string, unknown>) => {
      d.comparators = (d.comparators as unknown[]).filter(row => (row as Record<string, unknown>).id !== INCUMBENT_COMPARATOR_ID);
    }],
    ["missing benchmark C1", (d: Record<string, unknown>) => {
      d.comparators = (d.comparators as unknown[]).filter(row => (row as Record<string, unknown>).id !== BENCHMARK_COMPARATOR_ID);
    }],
    ["duplicate comparator ids", (d: Record<string, unknown>) => {
      (d.comparators as unknown[]).push(JSON.parse(JSON.stringify(cmpField(d, BENCHMARK_COMPARATOR_ID))));
    }],
    ["any may_* authority flag true", (d: Record<string, unknown>) => { d.may_trade = true; }],
    ["harness dirty", (d: Record<string, unknown>) => {
      ((d.code as Record<string, unknown>)).harness_dirty = true;
    }],
    ["inverted CI", (d: Record<string, unknown>) => {
      const c6 = cmp(d, INCUMBENT_COMPARATOR_ID) as { vs_passive_market: { total_diff_ci95: number[] } };
      c6.vs_passive_market.total_diff_ci95 = [0.2, 0.1];
    }],
    ["non-numeric return", (d: Record<string, unknown>) => {
      (cmp(d, INCUMBENT_COMPARATOR_ID) as { total_net_return: unknown }).total_net_return = "+9.9%";
    }],
    ["implausible magnitude", (d: Record<string, unknown>) => {
      (cmp(d, INCUMBENT_COMPARATOR_ID) as { total_net_return: unknown }).total_net_return = 999;
    }],
    ["unknown comparator status", (d: Record<string, unknown>) => {
      (cmp(d, BENCHMARK_COMPARATOR_ID) as { status: unknown }).status = "partial";
    }],
    ["evaluated row without vs_passive_market", (d: Record<string, unknown>) => {
      delete (cmp(d, BENCHMARK_COMPARATOR_ID) as Record<string, unknown>).vs_passive_market;
    }],
    ["non-numeric horizon key", (d: Record<string, unknown>) => {
      const horizons = ((d.event_study as Record<string, unknown>).horizons) as Record<string, unknown>;
      horizons.twentyone = horizons["21"];
    }],
    ["bad exclusion reason characters", (d: Record<string, unknown>) => {
      const excluded = ((d.coverage as Record<string, unknown>).excluded) as Record<string, unknown>;
      excluded["Bad Reason!"] = 1;
    }],
    ["no release jobs", (d: Record<string, unknown>) => {
      (((d.release as Record<string, unknown>)).jobs) = {};
    }],
    ["job level outside levels_defined", (d: Record<string, unknown>) => {
      const jobs = (d.release as Record<string, unknown>).jobs as Record<string, unknown>;
      (jobs.A_market_participation as Record<string, unknown>).level = "L9_future";
    }],
    ["empty headline", (d: Record<string, unknown>) => { d.headline = []; }],
    ["impossible protocol date", (d: Record<string, unknown>) => {
      (d.protocol as Record<string, unknown>).frozen_on = "2026-13-45";
    }],
    ["zero-session window", (d: Record<string, unknown>) => {
      (d.window as Record<string, unknown>).sessions = 0;
    }],
    ["lowercase contributor asset", (d: Record<string, unknown>) => {
      const post = (d.post_hoc_diagnostics as Record<string, unknown>);
      const book = post[INCUMBENT_COMPARATOR_ID] as { top_contributors: Array<Record<string, unknown>> };
      book.top_contributors[0].asset = "mrna";
    }],
    ["lowercase c4 sector key", (d: Record<string, unknown>) => {
      const weights = ((d.coverage as Record<string, unknown>).c4_sector_weights) as Record<string, number>;
      weights.xlk = weights.XLK ?? 0.1;
    }],
    ["missing incumbent attribution book", (d: Record<string, unknown>) => {
      delete (d.attribution as Record<string, unknown>)[INCUMBENT_COMPARATOR_ID];
    }],
    ["missing incumbent post-hoc book", (d: Record<string, unknown>) => {
      delete (d.post_hoc_diagnostics as Record<string, unknown>)[INCUMBENT_COMPARATOR_ID];
    }],
    ["contrast with out-of-range p", (d: Record<string, unknown>) => {
      const rows = (d.contrasts as Record<string, unknown>).rows as Array<Record<string, unknown>>;
      rows[0].p_holm = 1.5;
    }],
    ["population cohort count not a number", (d: Record<string, unknown>) => {
      ((d.population as Record<string, unknown>).excluded_cohort as Record<string, unknown>).era_plans_excluded = "sixteen";
    }],
    ["sensitivity variant excess not a number", (d: Record<string, unknown>) => {
      const s = (d.sensitivity as Record<string, unknown>);
      (s.backfill_replays_admitted_after_availability as Record<string, unknown>).excess_total_vs_spy = "+4.7 pp";
    }],
    ["unmatured horizon carrying an invalid metric", (d: Record<string, unknown>) => {
      const horizons = ((d.event_study as Record<string, unknown>).horizons) as Record<string, unknown>;
      (horizons["63"] as Record<string, unknown>).excess_vs_spy = { mean: "n/a" };
    }],
    ["superseded contrast with out-of-range p", (d: Record<string, unknown>) => {
      const sup = ((d.sensitivity as Record<string, unknown>).superseded_as_run) as Record<string, unknown>;
      const contrasts = sup.contrasts as Record<string, Record<string, unknown>>;
      contrasts.K1_C6_minus_C1.p_one_sided = 1.5;
    }],
  ])("rejects %s", (_name, edit) => {
    expect(decodeBetaEvaluation(mutate(edit))).toBeNull();
  });
});

describe("a future artifact at L1 renders without code change", () => {
  const l1Artifact = (): unknown => mutate(draft => {
    (draft.release as Record<string, unknown>).overall_level = "L1_accepted_historical";
    (draft.release as Record<string, unknown>).global_minimum_met = true;
    const c6 = cmp(draft, INCUMBENT_COMPARATOR_ID) as Record<string, unknown>;
    c6.total_net_return = 0.021;
    const vs = c6.vs_passive_market as Record<string, unknown>;
    vs.total_diff = 0.088;
    vs.total_diff_ci95 = [0.012, 0.164];
    // A comparator id this build has never seen, with a full evaluated row.
    (draft.comparators as unknown[]).push({
      ...JSON.parse(JSON.stringify(c6)),
      id: "C9_future_book", label: "Future book (wire label)",
      vs_passive_market: { ...vs, ann_diff: 0.3, ann_diff_ci95: [0.05, 0.55], p_one_sided: 0.02 },
    });
    draft.headline = ["Release level: accepted historical evidence (L1)."];
  });

  it("decodes the mutated L1 body and reports its properties honestly", () => {
    const decoded = decodeBetaEvaluation(l1Artifact());
    expect(decoded).not.toBeNull();
    expect(decoded!.release.overallLevel).toBe("L1_accepted_historical");
    expect(decoded!.release.globalMinimumMet).toBe(true);
    const c6 = findComparator(decoded!.comparators, INCUMBENT_COMPARATOR_ID)!;
    expect(c6.vsSpy!.totalDiff).toBeCloseTo(0.088, 8);
    expect(intervalIncludesZero(c6.vsSpy!.totalDiffCi95!)).toBe(false);
    expect(intervalIncludesZero([-0.121, 0.183])).toBe(true);
    expect(evaluationLevelRank("L1_accepted_historical", decoded!.release.levelsDefined)).toBe(1);
    expect(evaluationLevelRank("L0_descriptive", decoded!.release.levelsDefined)).toBe(0);
  });

  it("orders known comparators first and unknown future ids last", () => {
    const decoded = decodeBetaEvaluation(l1Artifact())!;
    const ids = orderedComparators(decoded.comparators).map(row => row.id);
    expect(ids[0]).toBe(BENCHMARK_COMPARATOR_ID);
    expect(ids.indexOf("C9_future_book")).toBe(COMPARATOR_ORDER.length);
    expect(ids).toHaveLength(10);
  });
});
