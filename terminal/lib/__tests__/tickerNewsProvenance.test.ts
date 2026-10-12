import { describe, expect, it } from "vitest";

import { parseTickerNewsSnapshot } from "@/lib/newsContract";
import {
  parseRightsBasis,
  parseUniverseKnownAt,
} from "@/lib/newsProvenance";
import type { TickerNewsSnapshot } from "@/lib/newsTypes";

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

  it("P9 a snapshot literal without provenance keys still satisfies the TickerNewsSnapshot type", () => {
    const legacySnapshot: TickerNewsSnapshot = {
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

    expect("universe_known_at" in legacySnapshot).toBe(false);
    expect("rights_basis" in legacySnapshot).toBe(false);
  });

  it.each([
    ["a boolean", true],
    ["a nested array", [["2026-10-12T14:59:00Z"]]],
    [
      "a getter-free null-prototype object",
      Object.assign(Object.create(null), { iso: "2026-10-12T14:59:00Z" }),
    ],
    ["a 1000000-char string", "x".repeat(1000000)],
    ["a 1000000-char whitespace string", " ".repeat(1000000)],
  ])("P10 drops hostile universe_known_at (%s) without throwing", (_label, universeKnownAt) => {
    const parsed = parseTickerNewsSnapshot({
      ...baseSnapshot,
      universe_known_at: universeKnownAt,
    });

    expect(parsed.universe_known_at).toBeNull();
  });

  it.each([
    ["a boolean", false],
    ["a nested array", [[{ ...rightsBasis }]]],
    ["a null-prototype object with no fields", Object.create(null)],
    ["a 1000000-char receipt_id", { ...rightsBasis, receipt_id: "r".repeat(1000000) }],
    ["a 1000000-char source", { ...rightsBasis, source: "s".repeat(1000000) }],
    ["a 1000000-char provider", { ...rightsBasis, provider: "p".repeat(1000000) }],
    [
      "a 1000000-char effective_at",
      { ...rightsBasis, effective_at: "e".repeat(1000000) },
    ],
    [
      "a 1000000-char expires_at",
      { ...rightsBasis, expires_at: "x".repeat(1000000) },
    ],
  ])("P10 drops hostile rights_basis (%s) without throwing", (_label, rightsBasisValue) => {
    const parsed = parseTickerNewsSnapshot({
      ...baseSnapshot,
      rights_basis: rightsBasisValue,
    });

    expect(parsed.rights_basis).toBeNull();
  });

  it("P10 keeps a valid rights_basis carried on a null-prototype object", () => {
    const nullProtoBasis = Object.assign(Object.create(null), { ...rightsBasis });

    const parsed = parseTickerNewsSnapshot({
      ...baseSnapshot,
      rights_basis: nullProtoBasis,
    });

    expect(parsed.rights_basis).toEqual({ ...rightsBasis });
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

  // Every field x every malformation class the contract must null out.
  const fieldMalformations: Array<[string, string, unknown]> = [];
  for (const field of [
    "receipt_id",
    "source",
    "provider",
    "effective_at",
    "expires_at",
  ] as const) {
    const limit = field === "receipt_id" ? 256 : 128;
    const nulValue =
      field === "effective_at" || field === "expires_at"
        ? "2026-10-12\0T14:59:00Z"
        : "qbus\0news";
    fieldMalformations.push(
      [field, "a number", { ...rightsBasis, [field]: 7 }],
      [field, "a boolean", { ...rightsBasis, [field]: true }],
      [field, "an empty string", { ...rightsBasis, [field]: "" }],
      [field, "a whitespace-only string", { ...rightsBasis, [field]: " \t " }],
      [field, "a NUL char", { ...rightsBasis, [field]: nulValue }],
      [field, "an over-length string", { ...rightsBasis, [field]: "x".repeat(limit + 1) }],
    );
  }

  it.each(fieldMalformations)(
    "P11 drops a malformed rights_basis (%s: %s)",
    (_field, _label, rightsBasisValue) => {
      expect(parseRightsBasis(rightsBasisValue)).toBeNull();
    },
  );

  it.each([
    ["effective_at", "not-a-date"],
    ["expires_at", "yesterday"],
  ])("P11 drops an unparseable %s timestamp", (field, value) => {
    expect(parseRightsBasis({ ...rightsBasis, [field]: value })).toBeNull();
  });

  it.each([
    ["exactly 256 chars of receipt_id", { receipt_id: "r".repeat(256) }],
    ["exactly 128 chars of source", { source: "s".repeat(128) }],
    ["exactly 128 chars of provider", { provider: "p".repeat(128) }],
  ])("P11 keeps boundary-length text (%s)", (_label, override) => {
    expect(parseRightsBasis({ ...rightsBasis, ...override })).toEqual({
      ...rightsBasis,
      ...override,
    });
  });

  it("P11 drops a reversed window", () => {
    expect(
      parseRightsBasis({
        ...rightsBasis,
        effective_at: "2026-10-12T15:59:00Z",
        expires_at: "2026-10-12T14:59:00Z",
      }),
    ).toBeNull();
  });

  it("P12 keeps an equal window and an already-expired window", () => {
    const equal = {
      ...rightsBasis,
      effective_at: "2026-10-12T14:59:00Z",
      expires_at: "2026-10-12T14:59:00Z",
    };
    const expired = {
      ...rightsBasis,
      effective_at: "2020-01-01T00:00:00Z",
      expires_at: "2020-01-02T00:00:00Z",
    };

    expect(parseRightsBasis(equal)).toEqual(equal);
    expect(parseRightsBasis(expired)).toEqual(expired);
  });

  it("P13 trims every text field and both timestamps", () => {
    const padded = {
      receipt_id: "  " + rightsBasis.receipt_id + "  ",
      source: "\t" + rightsBasis.source + "\t",
      provider: "\n" + rightsBasis.provider + "\n",
      effective_at: "  " + rightsBasis.effective_at + "  ",
      expires_at: " " + rightsBasis.expires_at + " ",
    };

    expect(parseRightsBasis(padded)).toEqual({ ...rightsBasis });
  });
});
