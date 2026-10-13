// Wave B3 — terminal parser pins for the frozen ticker_news.flow.v1 contract
// (wb_news_flow_contract.md sections 2, 4, 5). The six fixtures below are copied
// VERBATIM from contract section 5, and the provenance is built exactly as the
// contract's flow_provenance helper does (start/end dates derived from the frozen
// as_of 2026-10-12T10:30:00Z). Terminal differences the contract names: unknown
// EXTRA keys are ignored, all 13 keys must be present, and every failure is the
// MALFORMED flow — never a throw.
import { describe, expect, it } from "vitest";

import { parseTickerNewsSnapshot } from "@/lib/newsContract";
import type { TickerNewsFlow } from "@/lib/newsTypes";
import { parseTickerNewsFlow } from "@/lib/newsValidation";

const FLOW_METHOD =
  "distinct reports by source + source_item_id; active status only; " +
  "rights-allowed sources only; UTC calendar days; median of 28 prior days";

function flowProvenance(publishedAt: number, receivedAt: number) {
  return {
    velocity_schema: "qbus.news_velocity.v1",
    sources_counted: ["benzinga"],
    status_counted: "active",
    distinct_by: "source + source_item_id",
    story_grouping:
      "news_cluster_members.cluster_id; a report in no cluster is its own story",
    cluster_policy_version: "qbus_news_cluster.v2",
    windows: {
      reports_24h: "rolling, closed at both ends: [as_of - 24h, as_of]",
      reports_7d: "rolling, closed at both ends: [as_of - 7d, as_of]",
      daily_28d: {
        start_date: "2026-09-14",
        end_date: "2026-10-11",
        unit: "UTC calendar day",
        excludes: "the current UTC day",
        order: "oldest first",
      },
    },
    calculation: { method: FLOW_METHOD, comparison_rule: "flow_compare.v1" },
    time_basis_counts_24h: { published_at: publishedAt, received_at: receivedAt },
  };
}

const OK_DAILY = [2, 3, 1, 4, 2, 3, 0, 5, 2, 3, 2, 3, 1, 4, 2, 3, 2, 3, 1, 3, 2, 4, 2, 3, 2, 3, 2, 3];
const THIN_DAILY = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];

const FLOW_OK = {
  schema: "ticker_news.flow.v1",
  state: "ok",
  reason: null,
  coverage: "complete",
  as_of: "2026-10-12T10:30:00Z",
  reports_24h: 7,
  reports_7d: 21,
  stories_24h: 4,
  median_daily_28d: 2.5,
  daily_counts_28d: OK_DAILY,
  history_days_observed: 28,
  comparison: "busier",
  provenance: flowProvenance(6, 1),
};

const FLOW_PARTIAL = { ...FLOW_OK, coverage: "partial", comparison: null };

const FLOW_THIN = {
  schema: "ticker_news.flow.v1",
  state: "thin_history",
  reason: null,
  coverage: "complete",
  as_of: "2026-10-12T10:30:00Z",
  reports_24h: 2,
  reports_7d: 3,
  stories_24h: 2,
  median_daily_28d: null,
  daily_counts_28d: THIN_DAILY,
  history_days_observed: 6,
  comparison: "insufficient_history",
  provenance: flowProvenance(2, 0),
};

const FLOW_THIN_PARTIAL = { ...FLOW_THIN, coverage: "partial", comparison: null };

const FLOW_NO_ACCESS = {
  schema: "ticker_news.flow.v1",
  state: "unavailable",
  reason: "no_accessible_sources",
  coverage: "complete",
  as_of: null,
  reports_24h: null,
  reports_7d: null,
  stories_24h: null,
  median_daily_28d: null,
  daily_counts_28d: null,
  history_days_observed: null,
  comparison: null,
  provenance: null,
};

const FLOW_UNAVAILABLE = { ...FLOW_NO_ACCESS, reason: "calculation_failed" };

const MALFORMED: TickerNewsFlow = {
  schema: "ticker_news.flow.v1",
  state: "unavailable",
  reason: "malformed",
  coverage: "complete",
  as_of: null,
  reports_24h: null,
  reports_7d: null,
  stories_24h: null,
  median_daily_28d: null,
  daily_counts_28d: null,
  history_days_observed: null,
  comparison: null,
  provenance: null,
};

const FLOW_KEYS = [
  "schema",
  "state",
  "reason",
  "coverage",
  "as_of",
  "reports_24h",
  "reports_7d",
  "stories_24h",
  "median_daily_28d",
  "daily_counts_28d",
  "history_days_observed",
  "comparison",
  "provenance",
] as const;

// ---- snapshot body helpers -----------------------------------------------------------

const storyRow = (storyId: string, sequence: number) => ({
  sequence,
  source: "benzinga",
  source_item_id: storyId + "-item",
  story_id: storyId,
  source_count: 1,
  item_count: 1,
  title: "Story " + storyId,
  url: "https://www.benzinga.com/news/" + storyId,
  teaser: "",
  published_at: "2026-10-05T14:00:00+00:00",
  updated_at: null,
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1",
});

const snapshotBody = (flow: unknown) => ({
  schema: "ticker_news.snapshot.v1",
  ticker: "NVDA",
  security_id: "SEC:US-XNAS-NVDA",
  state: "live",
  rows: [storyRow("ev2_a", 2), storyRow("ev2_b", 1)],
  next_cursor: null,
  has_more: false,
  source_health: { state: "live", last_successful_catchup: "2026-10-05T14:01:01+00:00" },
  ...(flow === undefined ? {} : { flow }),
});

describe("parseTickerNewsFlow — contract section 5 fixtures", () => {
  it.each([
    ["FLOW_OK", FLOW_OK],
    ["FLOW_PARTIAL", FLOW_PARTIAL],
    ["FLOW_THIN", FLOW_THIN],
    ["FLOW_THIN_PARTIAL", FLOW_THIN_PARTIAL],
    ["FLOW_NO_ACCESS", FLOW_NO_ACCESS],
    ["FLOW_UNAVAILABLE", FLOW_UNAVAILABLE],
  ])("%s parses to an equal object", (_name, fixture) => {
    expect(parseTickerNewsFlow(fixture)).toEqual(fixture);
  });

  it("never throws on non-object values", () => {
    for (const bad of [undefined, null, 42, "flow", [], true]) {
      expect(parseTickerNewsFlow(bad)).toEqual(MALFORMED);
    }
  });

  it("an unknown EXTRA key is ignored (forward compatibility)", () => {
    const withExtra = { ...FLOW_OK, surprise: "x" };
    expect(parseTickerNewsFlow(withExtra)).toEqual(FLOW_OK);
  });
});

describe("parseTickerNewsFlow — malformed variants (contract section 4)", () => {
  const variants: ReadonlyArray<[string, Record<string, unknown>]> = [
    ["stories_24h > reports_24h", { ...FLOW_OK, stories_24h: 8 }],
    ["reports_24h > reports_7d", { ...FLOW_OK, reports_24h: 22 }],
    ["27 daily entries", { ...FLOW_OK, daily_counts_28d: OK_DAILY.slice(1) }],
    ["a negative count", { ...FLOW_OK, reports_7d: -1 }],
    ["a boolean count", { ...FLOW_OK, reports_24h: true }],
    ["a boolean median", { ...FLOW_OK, median_daily_28d: false }],
    ["an unknown state", { ...FLOW_OK, state: "weird" }],
    ["a wrong schema string", { ...FLOW_OK, schema: "ticker_news.flow.v2" }],
    ["ok with history 19", { ...FLOW_OK, history_days_observed: 19 }],
    ["thin with history 20", { ...FLOW_THIN, history_days_observed: 20 }],
    ["ok with a null median", { ...FLOW_OK, median_daily_28d: null }],
    ["thin with a median", { ...FLOW_THIN, median_daily_28d: 1 }],
    ["partial with a non-null comparison", { ...FLOW_PARTIAL, comparison: "busier" }],
    ["ok complete with a null comparison", { ...FLOW_OK, comparison: null }],
    ["thin complete with a null comparison", { ...FLOW_THIN, comparison: null }],
    ["a bad as_of format", { ...FLOW_OK, as_of: "2026-10-12 10:30:00" }],
    ["unavailable with a null reason", { ...FLOW_UNAVAILABLE, reason: null }],
    ["unavailable with a non-null count", { ...FLOW_UNAVAILABLE, reports_24h: 3 }],
    ["unavailable with partial coverage", { ...FLOW_UNAVAILABLE, coverage: "partial" }],
    ["ok with a reason", { ...FLOW_OK, reason: "calculation_failed" }],
    [
      "time basis that does not sum to reports_24h",
      {
        ...FLOW_OK,
        provenance: { ...FLOW_OK.provenance, time_basis_counts_24h: { published_at: 5, received_at: 1 } },
      },
    ],
    [
      "empty sources_counted",
      { ...FLOW_OK, provenance: { ...FLOW_OK.provenance, sources_counted: [] } },
    ],
    [
      "provenance missing the daily_28d window",
      {
        ...FLOW_OK,
        provenance: { ...FLOW_OK.provenance, windows: { ...FLOW_OK.provenance.windows, daily_28d: { start_date: "2026-09-14" } } },
      },
    ],
    ["an unknown coverage value", { ...FLOW_OK, coverage: "full" }],
    ["an unknown reason value", { ...FLOW_UNAVAILABLE, reason: "because" }],
  ];

  it.each(variants)("%s gives MALFORMED and never throws", (_name, variant) => {
    expect(parseTickerNewsFlow(variant)).toEqual(MALFORMED);
  });

  it("a missing key (each of the 13) gives MALFORMED", () => {
    for (const key of FLOW_KEYS) {
      const rest = { ...FLOW_OK } as Record<string, unknown>;
      delete rest[key];
      expect(parseTickerNewsFlow(rest), `missing ${key}`).toEqual(MALFORMED);
    }
  });
});

describe("parseTickerNewsSnapshot — flow key handling", () => {
  it("an absent flow key gives flow null on the snapshot", () => {
    const parsed = parseTickerNewsSnapshot(snapshotBody(undefined));
    expect(parsed.flow).toBeNull();
    expect(parsed.rows).toHaveLength(2);
  });

  it("a present flow: null gives MALFORMED (the API never sends flow: null)", () => {
    const parsed = parseTickerNewsSnapshot(snapshotBody(null));
    expect(parsed.flow).toEqual(MALFORMED);
  });

  it("a valid flow is carried through unchanged, provenance included", () => {
    const parsed = parseTickerNewsSnapshot(snapshotBody(FLOW_OK));
    expect(parsed.flow).toEqual(FLOW_OK);
  });

  it("rows still parse when flow is malformed", () => {
    const parsed = parseTickerNewsSnapshot(snapshotBody({ ...FLOW_OK, state: "weird" }));
    expect(parsed.rows.map((row) => row.story_id)).toEqual(["ev2_a", "ev2_b"]);
    expect(parsed.flow).toEqual(MALFORMED);
  });

  it("a malformed flow never throws the snapshot", () => {
    expect(() => parseTickerNewsSnapshot(snapshotBody("garbage"))).not.toThrow();
    expect(parseTickerNewsSnapshot(snapshotBody("garbage")).flow).toEqual(MALFORMED);
  });
});
