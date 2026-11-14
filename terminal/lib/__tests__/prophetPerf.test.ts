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

describe("Prophet PERF summary agrees with admitted plan rows", () => {
  const rawSummary = (value: Record<string, unknown>) =>
    (value.summary as Record<string, unknown>).raw_stock_return as Record<string, unknown>;
  const planRows = (value: Record<string, unknown>) => value.plans as Array<Record<string, unknown>>;

  async function unavailableReturns() {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    for (const row of planRows(value)) {
      if (row.outcome === "NO_ENTRY") continue;
      row.stock_result_pct = null;
      row.stock_result_pct_unavailable_reason = "canonical_ledger_null";
    }
    Object.assign(rawSummary(value), {
      available_count: 0, unavailable_count: 3,
      positive_count: 0, negative_count: 0, zero_count: 0,
      mean_pct: null, median_pct: null, min_pct: null, max_pct: null,
      unavailable_reason: "canonical_ledger_null",
    });
    return value;
  }

  function expectUnchangedAdmission(value: Record<string, unknown>) {
    const before = cloneFixture(value);
    const admitted = normalizeProphetPerfPayload(value);
    expect(admitted).not.toBeNull();
    expect(admitted!.summary).toEqual(value.summary);
    expect(admitted!.plans).toEqual(value.plans);
    expect(value).toEqual(before);
  }

  it("rejects an outcome substitution that preserves terminal and no-entry totals", async () => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    const outcomes = (value.summary as Record<string, unknown>).outcome_counts as Record<string, unknown>;
    outcomes.T1_HIT = 0;
    outcomes.T2_HIT = 1;
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it("rejects less declared coverage when all three entered rows still publish returns", async () => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    Object.assign(rawSummary(value), { available_count: 2, unavailable_count: 1, positive_count: 1 });
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it.each([
    { positive_count: 1, negative_count: 2, zero_count: 0 },
    { positive_count: 1, negative_count: 1, zero_count: 1 },
  ])("rejects total-preserving sign substitutions: %j", async (counts) => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    Object.assign(rawSummary(value), counts);
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it("rejects a newly unavailable row when the summary still claims full coverage", async () => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    planRows(value)[0].stock_result_pct = null;
    planRows(value)[0].stock_result_pct_unavailable_reason = "canonical_ledger_null";
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it.each(["mean_pct", "median_pct", "min_pct", "max_pct"])(
    "rejects a published %s when no entered row has a raw return", async (field) => {
      const value = await unavailableReturns();
      rawSummary(value)[field] = 1;
      expect(normalizeProphetPerfPayload(value)).toBeNull();
    },
  );

  it("admits consistent partial coverage without changing the producer's values", async () => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    planRows(value)[0].stock_result_pct = null;
    planRows(value)[0].stock_result_pct_unavailable_reason = "canonical_ledger_null";
    Object.assign(rawSummary(value), {
      available_count: 2, unavailable_count: 1, positive_count: 1,
      mean_pct: -1, median_pct: -1, min_pct: -3.25, max_pct: 1.25,
    });
    expectUnchangedAdmission(value);
  });

  it("admits a genuine zero and counts a positive BEAR price move as positive", async () => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    planRows(value)[0].stock_result_pct = 0;
    Object.assign(rawSummary(value), {
      positive_count: 1, zero_count: 1,
      mean_pct: -0.6667, median_pct: 0, min_pct: -3.25, max_pct: 1.25,
    });
    expectUnchangedAdmission(value);
  });

  it("admits explicitly unavailable raw returns without including NO_ENTRY in coverage", async () => {
    expectUnchangedAdmission(await unavailableReturns());
  });

  it("admits an honest empty ledger with no raw statistics", async () => {
    const value = await unavailableReturns();
    value.plans = [];
    const summary = value.summary as Record<string, unknown>;
    Object.assign(summary, {
      terminal_plan_count: 0, closed_plan_count: 0, no_entry_count: 0,
      outcome_counts: Object.fromEntries(Object.keys(summary.outcome_counts as object).map(key => [key, 0])),
    });
    Object.assign(rawSummary(value), { unavailable_count: 0, unavailable_reason: "no_closed_plans" });
    Object.assign(value.source as object, {
      latest_asof: null, latest_close_date: null, freshness_unavailable_reason: "no_terminal_plans",
    });
    value.integrity = Object.fromEntries(Object.keys(value.integrity as object).map(key => [key, 0]));
    expectUnchangedAdmission(value);
  });
});

describe("Prophet PERF calendar dates and source freshness", () => {
  const planRows = (value: Record<string, unknown>) => value.plans as Array<Record<string, unknown>>;
  const source = (value: Record<string, unknown>) => value.source as Record<string, unknown>;

  function expectUnchangedAdmission(value: Record<string, unknown>) {
    const before = cloneFixture(value);
    const admitted = normalizeProphetPerfPayload(value);
    expect(admitted).not.toBeNull();
    expect(admitted!.source).toEqual(value.source);
    expect(admitted!.plans).toEqual(value.plans);
    expect(admitted!.summary).toEqual(value.summary);
    expect(value).toEqual(before);
    return admitted!;
  }

  it.each([
    "2026-02-30", "1900-02-29", "2026-04-31", "2026-13-01",
    "2026-00-01", "2026-01-00", "0000-01-01", "2026-9-18",
    "2026-09-18T00:00:00Z", " 2026-09-18", "2026-09-18\n", "",
  ])("rejects a noncanonical or nonexistent calendar date: %j", async (date) => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    planRows(value)[0].signal_date = date;
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it.each(["signal_date", "entry_date", "close_date", "asof"] as const)(
    "validates the calendar for each admitted row's %s", async (field) => {
      const value = cloneFixture(await fixtureFor("prophet_perf"));
      planRows(value)[0][field] = "2026-13-01";
      // Keep the same-field summary clock consistent so a clock mismatch does
      // not hide missing calendar validation for close_date or asof.
      if (field === "asof") source(value).latest_asof = "2026-13-01";
      if (field === "close_date") source(value).latest_close_date = "2026-13-01";
      expect(normalizeProphetPerfPayload(value)).toBeNull();
    },
  );

  it.each([
    ["latest_asof", "2026-09-17"],
    ["latest_asof", "2026-09-19"],
    ["latest_close_date", "2026-09-17"],
    ["latest_close_date", "2026-09-19"],
  ])("rejects a %s clock of %s that disagrees with the admitted rows", async (field, date) => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    expect(source(value)[field]).toBe("2026-09-18");
    source(value)[field] = date;
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it.each(["2000-02-29", "2024-02-29", "0001-01-01", "9999-12-31"])(
    "preserves a valid calendar date without inferring chronology: %s", async (date) => {
      const value = cloneFixture(await fixtureFor("prophet_perf"));
      planRows(value)[0].signal_date = date;
      expectUnchangedAdmission(value);
    },
  );

  it("preserves explicitly unavailable signal and entry dates", async () => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    Object.assign(planRows(value)[0], {
      signal_date: null, signal_date_unavailable_reason: "canonical_ledger_null",
      entry_date: null, entry_date_unavailable_reason: "canonical_ledger_null",
    });
    expectUnchangedAdmission(value);
  });

  it("admits independent same-field maxima from different rows in any row order", async () => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    planRows(value)[0].asof = "2026-09-25";
    planRows(value)[1].close_date = "2026-09-27";
    Object.assign(source(value), { latest_asof: "2026-09-25", latest_close_date: "2026-09-27" });
    planRows(value).reverse();
    expectUnchangedAdmission(value);
  });

  it("preserves stale and future-but-consistent source receipts without consulting today's date", async () => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    value.stale = true;
    planRows(value)[0].asof = "2999-01-02";
    planRows(value)[0].close_date = "2999-01-01";
    Object.assign(source(value), { latest_asof: "2999-01-02", latest_close_date: "2999-01-01" });
    expect(expectUnchangedAdmission(value).stale).toBe(true);
  });
});

describe("Prophet PERF v1 producer authority", () => {
  it.each([
    "data/prophet/unrelated.jsonl",
    "https://example.invalid/ledger.jsonl",
    " data/prophet/ledger.jsonl",
    "data/prophet/ledger.jsonl ",
  ])("rejects a substituted canonical-ledger source attribution: %j", async (path) => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    (value.source as Record<string, unknown>).path = path;
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it.each([
    { benchmark_return_pct: 1.25, excess_return_pct: 0.5 },
    { benchmark_return_pct: 0, excess_return_pct: 0 },
    { benchmark_return_pct: -2.5, excess_return_pct: -1 },
  ])("rejects a populated benchmark claim unsupported by the v1 producer: %j", async (figures) => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    (value.summary as Record<string, unknown>).benchmarked_performance = {
      available: true,
      ...figures,
      unavailable_reason: null,
    };
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it("preserves the exact canonical source and supplied unavailable benchmark values", async () => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    const before = cloneFixture(value);
    const admitted = normalizeProphetPerfPayload(value);
    expect(admitted).not.toBeNull();
    expect(admitted!.source.path).toBe("data/prophet/ledger.jsonl");
    expect(admitted!.source).toEqual(value.source);
    expect(admitted!.summary).toEqual(value.summary);
    expect(admitted!.summary.benchmarked_performance).toEqual({
      available: false,
      benchmark_return_pct: null,
      excess_return_pct: null,
      unavailable_reason: "canonical_effective_ledger_has_no_benchmark_return_evidence",
    });
    expect(admitted!.plans).toEqual(value.plans);
    expect(value).toEqual(before);
  });
});

describe("Prophet PERF necessary raw-statistic invariants", () => {
  const rawSummary = (value: Record<string, unknown>) =>
    (value.summary as Record<string, unknown>).raw_stock_return as Record<string, unknown>;

  async function withReturns(
    returns: readonly (number | null)[],
    stats: { mean_pct: number; median_pct: number; min_pct: number; max_pct: number },
  ) {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    const rows = (value.plans as Array<Record<string, unknown>>)
      .filter((row) => row.outcome !== "NO_ENTRY");
    expect(rows).toHaveLength(returns.length);
    rows.forEach((row, index) => {
      row.stock_result_pct = returns[index];
      row.stock_result_pct_unavailable_reason = returns[index] === null ? "canonical_ledger_null" : null;
    });
    const available = returns.filter((value): value is number => value !== null);
    Object.assign(rawSummary(value), {
      ...stats,
      available_count: available.length,
      unavailable_count: returns.length - available.length,
      positive_count: available.filter((value) => value > 0).length,
      negative_count: available.filter((value) => value < 0).length,
      zero_count: available.filter((value) => value === 0).length,
      unavailable_reason: null,
    });
    return value;
  }

  it.each([
    { median_pct: 999 },
    { median_pct: -999 },
    { min_pct: 10, median_pct: 5, max_pct: 1 },
  ])("rejects impossible ordering of supplied rounded statistics: %j", async (stats) => {
    const value = cloneFixture(await fixtureFor("prophet_perf"));
    Object.assign(rawSummary(value), stats);
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it.each([
    { mean_pct: 1, median_pct: 0, min_pct: 0, max_pct: 0 },
    { mean_pct: 0, median_pct: 0, min_pct: -1, max_pct: 0 },
    { mean_pct: 0, median_pct: 0, min_pct: 0, max_pct: 1 },
    { mean_pct: 1, median_pct: 1, min_pct: 1, max_pct: 1 },
  ])("rejects invented performance for an all-zero available population: %j", async (stats) => {
    // Every supplied tuple remains ordered, isolating the all-zero contract.
    const value = await withReturns([0, -0, 0], stats);
    expect(normalizeProphetPerfPayload(value)).toBeNull();
  });

  it.each([
    {
      label: "signed zero",
      returns: [-0, 0, -0],
      stats: { mean_pct: 0, median_pct: 0, min_pct: -0, max_pct: -0 },
    },
    {
      label: "zero returns with partial coverage",
      returns: [-0, null, 0],
      stats: { mean_pct: 0, median_pct: 0, min_pct: -0, max_pct: -0 },
    },
    {
      label: "nonzero subnormal returns rounded to zero",
      returns: [Number.MIN_VALUE, Number.MIN_VALUE, null],
      stats: { mean_pct: 0, median_pct: 0, min_pct: 0, max_pct: 0 },
    },
    {
      label: "even midpoint underflow",
      returns: [0, Number.MIN_VALUE, null],
      stats: { mean_pct: 0, median_pct: 0, min_pct: 0, max_pct: 0 },
    },
    {
      label: "equal rounded extrema from distinct nonzero rows",
      returns: [0.00001, 0.00002, 0.00003],
      stats: { mean_pct: 0, median_pct: 0, min_pct: 0, max_pct: 0 },
    },
    {
      label: "finite opposite-sign extreme midpoint",
      returns: [-Number.MAX_VALUE, Number.MAX_VALUE, null],
      stats: { mean_pct: 0, median_pct: 0, min_pct: -Number.MAX_VALUE, max_pct: Number.MAX_VALUE },
    },
    {
      label: "valid native mean above identical large row values",
      returns: [15000000000000004, 15000000000000004, 15000000000000004],
      stats: { mean_pct: 15000000000000006, median_pct: 15000000000000004, min_pct: 15000000000000004, max_pct: 15000000000000004 },
    },
    {
      label: "valid native mean below identical negative row values",
      returns: [-15000000000000004, -15000000000000004, -15000000000000004],
      stats: { mean_pct: -15000000000000006, median_pct: -15000000000000004, min_pct: -15000000000000004, max_pct: -15000000000000004 },
    },
  ])("preserves $label without rewriting source, rows, statistics or signed zero", async ({ returns, stats }) => {
    const value = await withReturns(returns, stats);
    // structuredClone preserves signed zero; a JSON clone would erase it.
    const before = structuredClone(value);
    const admitted = normalizeProphetPerfPayload(value);
    expect(admitted).not.toBeNull();
    expect(admitted!.source).toEqual(value.source);
    expect(admitted!.plans).toEqual(value.plans);
    expect(admitted!.summary).toEqual(value.summary);
    expect(value).toEqual(before);
    for (const field of ["mean_pct", "median_pct", "min_pct", "max_pct"] as const) {
      expect(Object.is(admitted!.summary.raw_stock_return[field], stats[field])).toBe(true);
    }
  });
});
