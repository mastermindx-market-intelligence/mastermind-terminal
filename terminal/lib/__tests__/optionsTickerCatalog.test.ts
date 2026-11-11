import { describe, expect, it } from "vitest";
import {
  buildOptionsTickerChoices,
  findExactOptionsTickerChoice,
  optionsTickerNoDataMessage,
  parseOptionsTickerCatalog,
} from "../optionsTickerCatalog";

const META = {
  schema: "live_flow.meta/v2",
  ticker_catalog: {
    schema: "live_flow.ticker_catalog/v1",
    session_date: "2026-09-20",
    supported_n: 4,
    available_n: 1,
    quiet_n: 2,
    waiting_n: 1,
    roots: [
      { root: "spy", tier: "core", status: "available", last_success: "2026-09-20T14:05:00Z", session_date: "2026-09-20" },
      { root: "AMD", tier: "rotating", status: "quiet", last_success: "2026-09-20T14:06:00Z", session_date: "2026-09-20" },
      { root: "TLT", tier: "core", status: "waiting", last_success: null, session_date: "2026-09-20" },
      { root: "bad root", tier: "core", status: "quiet", last_success: null, session_date: "2026-09-20" },
      { root: "SPY", tier: "rotating", status: "quiet", last_success: null, session_date: "2026-09-20" },
    ],
  },
};

describe("parseOptionsTickerCatalog", () => {
  it("normalizes, validates, and deduplicates producer rows", () => {
    expect(parseOptionsTickerCatalog(META)).toEqual([
      {
        root: "SPY",
        tier: "core",
        status: "available",
        lastSuccess: "2026-09-20T14:05:00Z",
        sessionDate: "2026-09-20",
      },
      {
        root: "AMD",
        tier: "rotating",
        status: "quiet",
        lastSuccess: "2026-09-20T14:06:00Z",
        sessionDate: "2026-09-20",
      },
      {
        root: "TLT",
        tier: "core",
        status: "waiting",
        lastSuccess: null,
        sessionDate: "2026-09-20",
      },
    ]);
  });

  it("fails closed on the wrong catalog schema", () => {
    expect(parseOptionsTickerCatalog({ ticker_catalog: { schema: "other/v1", roots: META.ticker_catalog.roots } })).toEqual([]);
  });
});

describe("buildOptionsTickerChoices", () => {
  it("ranks active names first, then core coverage, then rotating coverage", () => {
    const choices = buildOptionsTickerChoices({
      catalog: parseOptionsTickerCatalog(META),
      activeRoots: ["AMD"],
      fallbackRoots: ["NVDA"],
    });

    expect(choices.map((choice) => choice.root)).toEqual(["AMD", "SPY", "TLT"]);
    expect(choices[0]).toMatchObject({ active: true, status: "quiet", source: "catalog" });
  });

  it("searches the complete catalog, including quiet rotating roots", () => {
    const choices = buildOptionsTickerChoices({
      catalog: parseOptionsTickerCatalog(META),
      activeRoots: [],
      query: "am",
    });

    expect(choices.map((choice) => choice.root)).toEqual(["AMD"]);
  });

  it("treats activity as a rank signal, not a membership gate, once the catalog is authoritative", () => {
    const choices = buildOptionsTickerChoices({
      catalog: parseOptionsTickerCatalog(META),
      activeRoots: ["NVDA"],
      fallbackRoots: ["NVDA"],
    });

    expect(choices.some((choice) => choice.root === "NVDA")).toBe(false);
    expect(choices.map((choice) => choice.root)).toEqual(["SPY", "TLT", "AMD"]);
  });

  it("uses the static fallback only before an authoritative catalog arrives", () => {
    const choices = buildOptionsTickerChoices({
      catalog: [],
      activeRoots: ["AAPL"],
      fallbackRoots: ["SPY", "AAPL", "NVDA"],
    });

    expect(choices.map((choice) => choice.root)).toEqual(["AAPL", "NVDA", "SPY"]);
    expect(choices.find((choice) => choice.root === "NVDA")).toMatchObject({ source: "fallback", status: "unknown" });
  });

  it("resolves an exact Enter-key selection case-insensitively", () => {
    const choices = buildOptionsTickerChoices({
      catalog: parseOptionsTickerCatalog(META),
      activeRoots: [],
    });

    expect(findExactOptionsTickerChoice(choices, " amd ")?.root).toBe("AMD");
    expect(findExactOptionsTickerChoice(choices, "AM")).toBeNull();
  });
});


describe("optionsTickerNoDataMessage", () => {
  const [active, core, waiting] = buildOptionsTickerChoices({
    catalog: parseOptionsTickerCatalog(META),
    activeRoots: ["AMD"],
  });

  it("distinguishes a missing core refresh from a rotating root awaiting its slot", () => {
    expect(optionsTickerNoDataMessage(waiting, "TLT", true, "en", true)).toContain("core coverage has not published");
    const rotatingWaiting = { ...waiting, root: "SOXX", tier: "rotating" as const };
    expect(optionsTickerNoDataMessage(rotatingWaiting, "SOXX", true, "en", true)).toContain("rotating lane");
  });

  it("distinguishes a covered quiet root from an unsupported root", () => {
    expect(optionsTickerNoDataMessage(active, "AMD", true, "en", true)).toContain("no qualifying options prints");
    expect(optionsTickerNoDataMessage(null, "ZZZZ", true, "en", true)).toContain("not in the current intraday options coverage catalog");
  });

  it("reports an available artifact mismatch as a load problem", () => {
    expect(optionsTickerNoDataMessage(core, "SPY", true, "en", true)).toContain("artifact did not load");
  });
});
