import { describe, expect, it } from "vitest";

import { parseTickerNewsSnapshot } from "@/lib/newsContract";
import {
  parseRightsBasis,
  parseUniverseKnownAt,
} from "@/lib/newsProvenance";

const row = {
  sequence: 7,
  source: "benzinga",
  source_item_id: "123",
  story_id: "ev2_abc",
  source_count: 1,
  item_count: 2,
  title: "Nvidia launches accelerator",
  url: "https://www.benzinga.com/news/123",
  teaser: "Short lead",
  published_at: "2026-10-05T14:00:00+00:00",
  updated_at: "2026-10-05T14:01:00+00:00",
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1",
};

const baseSnapshot = {
  schema: "ticker_news.snapshot.v1",
  ticker: "NVDA",
  security_id: "SEC:US-XNAS-NVDA",
  state: "live",
  rows: [row],
  next_cursor: 7,
  has_more: false,
  source_health: {
    state: "live",
    last_successful_catchup: "2026-10-05T14:01:01+00:00",
  },
};

const rightsBasis = {
  receipt_id: "rcpt_qbus_7f3a2b91",
  source: "qbus",
  provider: "qbus_news",
  effective_at: "2026-10-12T14:59:00Z",
  expires_at: "2026-10-12T15:59:00Z",
};

// Master-field projection: exactly the pre-#9015 keys, never a whole-snapshot
// toEqual, so a future extra snapshot key cannot break these tests.
function projectMaster(snapshot: ReturnType<typeof parseTickerNewsSnapshot>) {
  const {
    schema,
    ticker,
    security_id,
    state,
    rows,
    next_cursor,
    has_more,
    source_health,
  } = snapshot;
  return {
    schema,
    ticker,
    security_id,
    state,
    rows,
    next_cursor,
    has_more,
    source_health,
  };
}

describe("ticker news snapshot provenance", () => {
  it("P1 carries present universe_known_at and rights_basis", () => {
    const parsed = parseTickerNewsSnapshot({
      ...baseSnapshot,
      universe_known_at: "2026-10-12T14:59:00Z",
      rights_basis: { ...rightsBasis },
    });

    expect(parsed.universe_known_at).toBe("2026-10-12T14:59:00Z");
    expect(parsed.rights_basis).toEqual({ ...rightsBasis });
  });

  it("P2 old payloads parse with null provenance and identical master fields", () => {
    const parsed = parseTickerNewsSnapshot({ ...baseSnapshot });

    expect(parsed.universe_known_at).toBeNull();
    expect(parsed.rights_basis).toBeNull();
    expect(projectMaster(parsed)).toEqual(
      projectMaster(
        parseTickerNewsSnapshot({
          ...baseSnapshot,
          universe_known_at: "2026-10-12T14:59:00Z",
          rights_basis: { ...rightsBasis },
        }),
      ),
    );
  });

  it("P3 explicit null for both provenance keys parses as null", () => {
    const parsed = parseTickerNewsSnapshot({
      ...baseSnapshot,
      universe_known_at: null,
      rights_basis: null,
    });

    expect(parsed.universe_known_at).toBeNull();
    expect(parsed.rights_basis).toBeNull();
  });

  it.each([
    ["a number", 1760288340],
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
    ["a not-a-date string", "not-a-date"],
    ["a 129-char string", "x".repeat(129)],
    ["a string containing a NUL char", "2026-10-12\0T14:59:00Z"],
    ["an object", { iso: "2026-10-12T14:59:00Z" }],
    ["an array", ["2026-10-12T14:59:00Z"]],
  ])("P4 drops malformed universe_known_at (%s) without throwing", (_label, universeKnownAt) => {
    const parsed = parseTickerNewsSnapshot({
      ...baseSnapshot,
      universe_known_at: universeKnownAt,
    });

    expect(parsed.universe_known_at).toBeNull();
  });

  it.each([
    ["an array", []],
    ["a string", "qbus"],
    ["a number", 7],
    [
      "a missing receipt_id",
      {
        source: rightsBasis.source,
        provider: rightsBasis.provider,
        effective_at: rightsBasis.effective_at,
        expires_at: rightsBasis.expires_at,
      },
    ],
    ["an empty source", { ...rightsBasis, source: "   " }],
    ["a NUL in provider", { ...rightsBasis, provider: "qbus\0news" }],
    ["a 257-char receipt_id", { ...rightsBasis, receipt_id: "r".repeat(257) }],
    ["a number-typed provider", { ...rightsBasis, provider: 42 }],
    ["an unparseable effective_at", { ...rightsBasis, effective_at: "yesterday" }],
    [
      "a missing expires_at",
      {
        receipt_id: rightsBasis.receipt_id,
        source: rightsBasis.source,
        provider: rightsBasis.provider,
        effective_at: rightsBasis.effective_at,
      },
    ],
    [
      "a reversed window",
      {
        ...rightsBasis,
        effective_at: "2026-10-12T15:59:00Z",
        expires_at: "2026-10-12T14:59:00Z",
      },
    ],
  ])("P5 drops malformed rights_basis (%s) without throwing", (_label, rightsBasisValue) => {
    const parsed = parseTickerNewsSnapshot({
      ...baseSnapshot,
      rights_basis: rightsBasisValue,
    });

    expect(parsed.rights_basis).toBeNull();
  });

  it("P6 drops unknown rights_basis keys", () => {
    const parsed = parseTickerNewsSnapshot({
      ...baseSnapshot,
      rights_basis: {
        ...rightsBasis,
        owner_ref: "team_7",
        product_id: "news_terminal",
        audience: "professionals",
        note: "extra key",
      },
    });

    expect(parsed.rights_basis).not.toBeNull();
    expect(Object.keys(parsed.rights_basis ?? {}).sort()).toEqual([
      "effective_at",
      "expires_at",
      "provider",
      "receipt_id",
      "source",
    ]);
  });

  it("P7 ignores an unknown flow object carrying a composite cluster_policy_version", () => {
    const parsed = parseTickerNewsSnapshot({
      ...baseSnapshot,
      flow: {
        provenance: { cluster_policy_version: "qbus_news_cluster.v2 + unknown" },
      },
    });

    expect(projectMaster(parsed)).toEqual(
      projectMaster(parseTickerNewsSnapshot({ ...baseSnapshot })),
    );
  });
});

describe("parseUniverseKnownAt unit", () => {
  it("P8 returns null for undefined, null and one malformed value", () => {
    expect(parseUniverseKnownAt(undefined)).toBeNull();
    expect(parseUniverseKnownAt(null)).toBeNull();
    expect(parseUniverseKnownAt(20261012)).toBeNull();
  });

  it("P8 returns the trimmed timestamp for a valid value", () => {
    expect(parseUniverseKnownAt(" 2026-10-12T14:59:00Z ")).toBe(
      "2026-10-12T14:59:00Z",
    );
  });
});

describe("parseRightsBasis unit", () => {
  it("P8 returns null for undefined, null and one malformed value", () => {
    expect(parseRightsBasis(undefined)).toBeNull();
    expect(parseRightsBasis(null)).toBeNull();
    expect(parseRightsBasis("qbus")).toBeNull();
  });

  it("P8 returns the five-key object for a valid value", () => {
    expect(parseRightsBasis({ ...rightsBasis })).toEqual({ ...rightsBasis });
  });
});
