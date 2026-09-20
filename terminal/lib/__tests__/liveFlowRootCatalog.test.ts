import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildOptionsRootChoices,
  buildTickerCandidateRows,
  normalizeRootQuery,
  parseLiveFlowRootCatalog,
} from "@/lib/liveFlowRootCatalog";

const VALID_META = {
  schema: "live_flow.meta/v2",
  roots_configured: 3,
  root_catalog: [
    {
      root: "AMD",
      tier: "rotating",
      scheduled_this_cycle: true,
      source_ok_this_cycle: true,
      last_source_success: "2026-09-20T15:42:00Z",
      has_session_data: true,
      activity_rank: 1,
    },
    {
      root: "SPY",
      tier: "core",
      scheduled_this_cycle: true,
      source_ok_this_cycle: true,
      last_source_success: "2026-09-20T15:41:00.123456Z",
      has_session_data: true,
      activity_rank: 2,
    },
    {
      root: "TLT",
      tier: "core",
      scheduled_this_cycle: false,
      source_ok_this_cycle: false,
      last_source_success: null,
      has_session_data: false,
      activity_rank: null,
    },
  ],
} as const;

describe("parseLiveFlowRootCatalog", () => {
  it("parses a complete catalog and preserves producer order", () => {
    const parsed = parseLiveFlowRootCatalog(VALID_META);
    expect(parsed?.map((row) => row.root)).toEqual(["AMD", "SPY", "TLT"]);
    expect(parsed?.[0]).toEqual({
      root: "AMD",
      tier: "rotating",
      scheduledThisCycle: true,
      sourceOkThisCycle: true,
      lastSourceSuccess: "2026-09-20T15:42:00Z",
      hasSessionData: true,
      activityRank: 1,
    });
  });

  it("fails closed for a wrong schema", () => {
    expect(parseLiveFlowRootCatalog({ ...VALID_META, schema: "live_flow.meta/v1" }))
      .toBeNull();
  });

  it("fails closed for duplicate roots", () => {
    expect(parseLiveFlowRootCatalog({
      ...VALID_META,
      roots_configured: 4,
      root_catalog: [...VALID_META.root_catalog, VALID_META.root_catalog[0]],
    })).toBeNull();
  });

  it("fails closed for a malformed boolean", () => {
    const rows = VALID_META.root_catalog.map((row) => ({ ...row }));
    (rows[0] as Record<string, unknown>).has_session_data = 1;
    expect(parseLiveFlowRootCatalog({ ...VALID_META, root_catalog: rows })).toBeNull();
  });

  it("fails closed for a non-UTC timestamp", () => {
    const rows = VALID_META.root_catalog.map((row) => ({ ...row }));
    (rows[0] as Record<string, unknown>).last_source_success = "2026-09-20T15:42:00-04:00";
    expect(parseLiveFlowRootCatalog({ ...VALID_META, root_catalog: rows })).toBeNull();
  });

  it("fails closed for a non-positive activity rank", () => {
    const rows = VALID_META.root_catalog.map((row) => ({ ...row }));
    (rows[0] as Record<string, unknown>).activity_rank = 0;
    expect(parseLiveFlowRootCatalog({ ...VALID_META, root_catalog: rows })).toBeNull();
  });

  it("fails closed when roots_configured disagrees with the rows", () => {
    expect(parseLiveFlowRootCatalog({ ...VALID_META, roots_configured: 99 })).toBeNull();
  });
});

describe("ticker candidate rows", () => {
  it("normalizes ticker-friendly search", () => {
    expect(normalizeRootQuery("  $amd ")).toBe("AMD");
    expect(normalizeRootQuery("$$amd")).toBe("$AMD");
  });

  it("searches the complete catalog without the legacy 20-row cap", () => {
    const catalog = Array.from({ length: 24 }, (_, index) => ({
      root: `T${String(index).padStart(2, "0")}`,
      tier: "rotating" as const,
      scheduledThisCycle: false,
      sourceOkThisCycle: false,
      lastSourceSuccess: null,
      hasSessionData: false,
      activityRank: null,
    }));
    const all = buildTickerCandidateRows({
      catalog,
      impacts: new Map(),
      fallbackRoots: [],
      query: "",
    });
    expect(all).toHaveLength(24);
    expect(buildTickerCandidateRows({
      catalog,
      impacts: new Map(),
      fallbackRoots: [],
      query: "$t23",
    }).map((row) => row.root)).toEqual(["T23"]);
  });

  it("retains active impact while quiet catalog roots remain eligible", () => {
    const catalog = parseLiveFlowRootCatalog(VALID_META)!;
    const rows = buildTickerCandidateRows({
      catalog,
      impacts: new Map([["AMD", 12.5]]),
      fallbackRoots: ["AMD"],
      query: "",
    });
    expect(rows.map((row) => row.root)).toEqual(["AMD", "SPY", "TLT"]);
    expect(rows[0].impact).toBe(12.5);
    expect(rows[2].impact).toBeNull();
    expect(rows[2].catalog?.tier).toBe("core");
  });

  it("keeps the legacy 20-row preview only for catalog fallback", () => {
    const fallbackRoots = Array.from({ length: 25 }, (_, index) => `F${String(index).padStart(2, "0")}`);
    expect(buildTickerCandidateRows({
      catalog: null,
      impacts: new Map(),
      fallbackRoots,
      query: "",
    })).toHaveLength(20);
    expect(buildTickerCandidateRows({
      catalog: null,
      impacts: new Map(),
      fallbackRoots,
      query: "f24",
    }).map((row) => row.root)).toEqual(["F24"]);
  });


  it("fixture catalog exposes a quiet root absent from session activity", () => {
    const flowFixture = JSON.parse(readFileSync(
      resolve(process.cwd(), "public/data/flow_fixture.json"),
      "utf8",
    )) as { meta?: unknown; feed?: { unusual_names?: { root?: string }[] } };
    const tideFixture = JSON.parse(readFileSync(
      resolve(process.cwd(), "public/data/tide_fixture.json"),
      "utf8",
    )) as { top_net_impact?: { root?: string; net_prem_soft?: number }[] };
    const fallbackRoots = [
      ...(tideFixture.top_net_impact ?? []).map((row) => row.root ?? ""),
      ...(flowFixture.feed?.unusual_names ?? []).map((row) => row.root ?? ""),
    ];
    expect(fallbackRoots).not.toContain("HYG");

    const catalog = parseLiveFlowRootCatalog(flowFixture.meta);
    const rows = buildTickerCandidateRows({
      catalog,
      impacts: new Map(),
      fallbackRoots,
      query: "$hyg",
    });
    expect(rows.map((row) => row.root)).toEqual(["HYG"]);
    expect(rows[0].catalog?.hasSessionData).toBe(false);
  });
});

describe("shared per-root options choices", () => {
  it("puts the live coverage catalog ahead of EOD-only fallback roots without dropping either", () => {
    const catalog = parseLiveFlowRootCatalog(VALID_META);
    expect(buildOptionsRootChoices(catalog, ["SPY", "SPX", "NDX", "TLT", "SPX"])).toEqual([
      "AMD", "SPY", "TLT", "SPX", "NDX",
    ]);
  });

  it("keeps the static EOD fallback when live coverage metadata is absent", () => {
    expect(buildOptionsRootChoices(null, ["SPY", "SPX", "SPY", "bad root"])).toEqual([
      "SPY", "SPX",
    ]);
  });
});
