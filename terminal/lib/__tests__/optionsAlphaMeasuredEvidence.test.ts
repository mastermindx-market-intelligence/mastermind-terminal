import { describe, expect, it } from "vitest";

import {
  OPTIONS_ALPHA_MEASURED_FEED_SCHEMA,
  OPTIONS_ALPHA_MICROSTRUCTURE_SCHEMA,
  normalizeOptionsAlphaMeasuredFeed,
} from "@/components/prophet/optionsAlphaMeasuredEvidence";

const micro = () => ({
  schema: OPTIONS_ALPHA_MICROSTRUCTURE_SCHEMA,
  source_print_count: 4,
  nbbo_valid_print_count: 3,
  source_premium_usd: 1000,
  nbbo_covered_premium_usd: 900,
  nbbo_print_coverage: 0.75,
  nbbo_premium_coverage: 0.9,
  at_ask_share: 0.444444,
  at_bid_share: 0.222222,
  inside_share: 0.333334,
  outside_share: 0,
  aggression_share: 0.666666,
  aggression_balance: 0.222222,
  spread_median_usd: 0.2,
  spread_median_pct: 0.05,
  quote_age_median_ms: 100,
  quote_age_max_ms: 250,
  bid_size_median: 12,
  ask_size_median: 14,
});

const measured = (overrides: Record<string, unknown> = {}) => ({
  id: "lf_evt_001",
  root: "NVDA",
  right: "C",
  exp: "2026-09-25",
  strike: 200,
  observed_at: "2026-09-19T14:00:00.000Z",
  decision_at: "2026-09-19T14:00:01.000Z",
  available_at: "2026-09-19T14:00:02.000Z",
  vol_gt_oi_ratio: 1.25,
  microstructure: micro(),
  ...overrides,
});

const feed = (events: unknown[]) => ({
  schema: OPTIONS_ALPHA_MEASURED_FEED_SCHEMA,
  asof: "2026-09-19T14:00:05Z",
  source_asof: "2026-09-19T14:00:04Z",
  session_date: "2026-09-19",
  events,
});

describe("Options Alpha measured-flow evidence", () => {
  it("parses the canonical measured microstructure block without inferring direction", () => {
    const parsed = normalizeOptionsAlphaMeasuredFeed(feed([measured()]));

    expect(parsed).toMatchObject({
      asof: "2026-09-19T14:00:05Z",
      source_asof: "2026-09-19T14:00:04Z",
      session_date: "2026-09-19",
    });
    expect(parsed?.events).toHaveLength(1);
    expect(parsed?.events[0]).toMatchObject({
      root: "NVDA",
      right: "C",
      expiration: "2026-09-25",
      strike: 200,
      vol_gt_oi_ratio: 1.25,
      microstructure: {
        schema: OPTIONS_ALPHA_MICROSTRUCTURE_SCHEMA,
        nbbo_premium_coverage: 0.9,
        at_ask_share: 0.444444,
        at_bid_share: 0.222222,
        inside_share: 0.333334,
        outside_share: 0,
      },
    });
    expect(parsed?.events[0]).not.toHaveProperty("direction");
    expect(parsed?.events[0]).not.toHaveProperty("side");
    expect(parsed?.events[0]).not.toHaveProperty("score");
  });

  it("orders measured rows by exact availability without re-ranking by premium", () => {
    const parsed = normalizeOptionsAlphaMeasuredFeed(feed([
      measured({ id: "older-big", available_at: "2026-09-19T14:00:03Z", microstructure: { ...micro(), source_premium_usd: 5000000, nbbo_covered_premium_usd: 4500000 } }),
      measured({ id: "newer-small", available_at: "2026-09-19T14:00:04Z" }),
    ]));

    expect(parsed?.events.map((event) => event.id)).toEqual(["newer-small", "older-big"]);
  });

  it("drops a measured child whose decision/availability clocks reverse", () => {
    const parsed = normalizeOptionsAlphaMeasuredFeed(feed([
      measured({ decision_at: "2026-09-19T14:00:03Z", available_at: "2026-09-19T14:00:02Z" }),
      measured({ id: "good" }),
    ]));

    expect(parsed?.events.map((event) => event.id)).toEqual(["good"]);
  });

  it("drops arithmetic-inconsistent measured blocks instead of normalizing them", () => {
    const parsed = normalizeOptionsAlphaMeasuredFeed(feed([
      measured({ microstructure: { ...micro(), aggression_share: 0.95 } }),
      measured({ id: "good" }),
    ]));

    expect(parsed?.events.map((event) => event.id)).toEqual(["good"]);
  });

  it("preserves zero covered-premium semantics only when all location shares are null", () => {
    const zeroCoverage = {
      ...micro(),
      nbbo_valid_print_count: 0,
      nbbo_covered_premium_usd: 0,
      nbbo_print_coverage: 0,
      nbbo_premium_coverage: 0,
      at_ask_share: null,
      at_bid_share: null,
      inside_share: null,
      outside_share: null,
      aggression_share: null,
      aggression_balance: null,
      spread_median_usd: null,
      spread_median_pct: null,
      quote_age_median_ms: null,
      quote_age_max_ms: null,
      bid_size_median: null,
      ask_size_median: null,
    };
    const parsed = normalizeOptionsAlphaMeasuredFeed(feed([
      measured({ microstructure: zeroCoverage }),
    ]));

    expect(parsed?.events[0]?.microstructure).toMatchObject({
      nbbo_valid_print_count: 0,
      nbbo_premium_coverage: 0,
      at_ask_share: null,
    });

    const contradicted = normalizeOptionsAlphaMeasuredFeed(feed([
      measured({ microstructure: { ...zeroCoverage, at_ask_share: 0 } }),
    ]));
    expect(contradicted?.events).toEqual([]);
  });

  it("rejects unreviewed root schemas and malformed root clocks", () => {
    expect(normalizeOptionsAlphaMeasuredFeed({ ...feed([]), schema: "live_flow.feed/v2" })).toBeNull();
    expect(normalizeOptionsAlphaMeasuredFeed({ ...feed([]), asof: "today" })).toBeNull();
    expect(normalizeOptionsAlphaMeasuredFeed({ ...feed([]), source_asof: "today" })).toBeNull();
    expect(normalizeOptionsAlphaMeasuredFeed({ ...feed([]), session_date: "2026-02-31" })).toBeNull();
  });

  it("does not require every source event to carry measured evidence", () => {
    const parsed = normalizeOptionsAlphaMeasuredFeed(feed([
      { id: "legacy", root: "SPY" },
      measured({ id: "measured" }),
    ]));

    expect(parsed?.events.map((event) => event.id)).toEqual(["measured"]);
  });
});
