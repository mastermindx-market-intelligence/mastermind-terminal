import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backendPath,
  fixtureFor,
  isValidF,
  tryFetchUpstream,
} from "@/lib/flowSource";
import {
  normalizeProphetPerfPayload,
  PROPHET_PERF_SCHEMA,
} from "@/components/prophet/prophetPerfTypes";
import { makeProphetPerfT } from "@/components/prophet/prophetPerfStrings";

afterEach(() => {
  vi.unstubAllGlobals();
});

function cloneFixture(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe("Prophet PERF private transport", () => {
  it("admits one backend path and a synthetic fixture", async () => {
    expect(isValidF("prophet_perf")).toBe(true);
    expect(backendPath("prophet_perf")).toBe("/api/hub/prophet/perf");

    const fixture = normalizeProphetPerfPayload(await fixtureFor("prophet_perf"));
    expect(fixture?.schema).toBe(PROPHET_PERF_SCHEMA);
    expect(fixture?.plans).toHaveLength(4);
    expect(fixture?.summary.closed_plan_count).toBe(3);
    expect(fixture?.summary.no_entry_count).toBe(1);
    expect(fixture?.integrity.quarantined_excluded_count).toBe(1);
    expect(fixture?.summary.benchmarked_performance.available).toBe(false);
    expect(fixture?.plans.every((row) => row.option_result_pct === null)).toBe(true);
  });

  it("fails closed after backend failure instead of probing anonymous R2", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("unavailable", { status: 503 });
    }));

    expect(await tryFetchUpstream("prophet_perf")).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("/api/hub/prophet/perf");
    expect(seen[0]).not.toContain("r2.dev");
  });
});

describe("Prophet PERF schema admission", () => {
  it("rejects unreviewed schemas and inconsistent terminal counts", async () => {
    const fixture = await fixtureFor("prophet_perf");

    expect(normalizeProphetPerfPayload({
      ...fixture,
      schema: "prophet.perf_projection/v2",
    })).toBeNull();

    expect(normalizeProphetPerfPayload({
      ...fixture,
      summary: {
        ...(fixture.summary as Record<string, unknown>),
        terminal_plan_count: 99,
      },
    })).toBeNull();
  });

  it("rejects benchmark claims when the producer says benchmark evidence is unavailable", async () => {
    const fixture = await fixtureFor("prophet_perf");
    const summary = fixture.summary as Record<string, unknown>;
    const benchmark = summary.benchmarked_performance as Record<string, unknown>;

    expect(normalizeProphetPerfPayload({
      ...fixture,
      summary: {
        ...summary,
        benchmarked_performance: {
          ...benchmark,
          available: false,
          benchmark_return_pct: 1.25,
          excess_return_pct: 0.5,
        },
      },
    })).toBeNull();
  });

  it("keeps the user-facing doctrine explicit in both languages", () => {
    const en = makeProphetPerfT("en");
    const zh = makeProphetPerfT("zh");

    expect(en("rawBody")).toContain("Not adjusted for BULL/BEAR direction");
    expect(en("rawBody")).toContain("positive number means the underlying rose");
    expect(en("rawBody")).toContain("Not option-contract return");
    expect(en("rawBody")).toContain("portfolio return");
    expect(en("rawBody")).toContain("alpha");
    expect(en("benchmarkUnavailable")).toContain("not shown");
    expect(en("historyBody")).toContain("not “ever reached target” frequencies");

    expect(zh("rawBody")).toContain("不按看多/看空方向调整");
    expect(zh("rawBody")).toContain("正数只表示标的上涨");
    expect(zh("rawBody")).toContain("不是期权合约收益");
    expect(zh("benchmarkUnavailable")).toContain("不显示基准收益或超额收益");
    expect(zh("historyBody")).toContain("不代表“曾经触及目标”的频率");
  });
});


describe("Prophet PERF cross-field truth invariants", () => {
  it("rejects internally inconsistent outcome, raw-return, and integrity totals", async () => {
    const fixture = await fixtureFor("prophet_perf");

    const badOutcomes = cloneFixture(fixture);
    const badOutcomeSummary = badOutcomes.summary as Record<string, unknown>;
    badOutcomeSummary.outcome_counts = {
      ...(badOutcomeSummary.outcome_counts as Record<string, unknown>),
      T1_HIT: 99,
    };
    expect(normalizeProphetPerfPayload(badOutcomes)).toBeNull();

    const badRaw = cloneFixture(fixture);
    const badRawSummary = badRaw.summary as Record<string, unknown>;
    badRawSummary.raw_stock_return = {
      ...(badRawSummary.raw_stock_return as Record<string, unknown>),
      available_count: 2,
    };
    expect(normalizeProphetPerfPayload(badRaw)).toBeNull();

    const badIntegrity = cloneFixture(fixture);
    (badIntegrity.integrity as Record<string, unknown>).effective_row_count = 3;
    expect(normalizeProphetPerfPayload(badIntegrity)).toBeNull();
  });

  it("requires explicit unavailable reasons and refuses impossible no-entry results", async () => {
    const fixture = await fixtureFor("prophet_perf");

    const hiddenNull = cloneFixture(fixture);
    const hiddenNullPlans = hiddenNull.plans as Array<Record<string, unknown>>;
    hiddenNullPlans[0].option_result_pct_unavailable_reason = null;
    expect(normalizeProphetPerfPayload(hiddenNull)).toBeNull();

    const impossibleNoEntry = cloneFixture(fixture);
    const impossiblePlans = impossibleNoEntry.plans as Array<Record<string, unknown>>;
    const noEntry = impossiblePlans.find((row) => row.outcome === "NO_ENTRY");
    expect(noEntry).toBeTruthy();
    noEntry!.stock_result_pct = 4.2;
    noEntry!.stock_result_pct_unavailable_reason = null;
    expect(normalizeProphetPerfPayload(impossibleNoEntry)).toBeNull();
  });

  it("rejects duplicate ids and incomplete positive benchmark claims", async () => {
    const fixture = await fixtureFor("prophet_perf");

    const duplicate = cloneFixture(fixture);
    const duplicatePlans = duplicate.plans as Array<Record<string, unknown>>;
    duplicatePlans[1].id = duplicatePlans[0].id;
    expect(normalizeProphetPerfPayload(duplicate)).toBeNull();

    const incompleteBenchmark = cloneFixture(fixture);
    const incompleteSummary = incompleteBenchmark.summary as Record<string, unknown>;
    incompleteSummary.benchmarked_performance = {
      available: true,
      benchmark_return_pct: null,
      excess_return_pct: null,
      unavailable_reason: null,
    };
    expect(normalizeProphetPerfPayload(incompleteBenchmark)).toBeNull();
  });
});
