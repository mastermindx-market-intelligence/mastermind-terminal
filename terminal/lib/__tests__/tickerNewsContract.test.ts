import { describe, expect, it } from "vitest";

import {
  parseTickerNewsChange,
  parseTickerNewsSnapshot,
  parseTickerNewsStory,
  normalizeTickerNewsSymbol,
} from "@/lib/newsContract";

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

describe("ticker news contract", () => {
  it("accepts the exact snapshot contract and preserves cluster identity", () => {
    const parsed = parseTickerNewsSnapshot({
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
    });

    expect(parsed.ticker).toBe("NVDA");
    expect(parsed.rows[0].story_id).toBe("ev2_abc");
    expect(parsed.rows[0].item_count).toBe(2);
    expect(parsed.next_cursor).toBe(7);
  });

  it("accepts every explicit feed state but rejects unknown state/schema", () => {
    for (const state of ["live", "catching_up", "degraded", "quiet", "restricted", "unavailable"] as const) {
      expect(parseTickerNewsSnapshot({
        schema: "ticker_news.snapshot.v1",
        ticker: "NVDA",
        security_id: "SEC:US-XNAS-NVDA",
        state,
        rows: [],
        next_cursor: null,
        has_more: false,
        source_health: { state },
      }).state).toBe(state);
    }

    expect(() => parseTickerNewsSnapshot({
      schema: "wrong.v1",
      ticker: "NVDA",
      security_id: "SEC:US-XNAS-NVDA",
      state: "live",
      rows: [],
      next_cursor: null,
      has_more: false,
      source_health: {},
    })).toThrow(/snapshot_schema/);

    expect(() => parseTickerNewsSnapshot({
      schema: "ticker_news.snapshot.v1",
      ticker: "NVDA",
      security_id: "SEC:US-XNAS-NVDA",
      state: "mystery",
      rows: [],
      next_cursor: null,
      has_more: false,
      source_health: {},
    })).toThrow(/snapshot_state/);
  });

  it("fails closed on malformed row clocks, counts and URLs", () => {
    expect(() => parseTickerNewsSnapshot({
      schema: "ticker_news.snapshot.v1",
      ticker: "NVDA",
      security_id: "SEC:US-XNAS-NVDA",
      state: "live",
      rows: [{ ...row, sequence: -1 }],
      next_cursor: null,
      has_more: false,
      source_health: {},
    })).toThrow(/row_sequence/);

    expect(() => parseTickerNewsSnapshot({
      schema: "ticker_news.snapshot.v1",
      ticker: "NVDA",
      security_id: "SEC:US-XNAS-NVDA",
      state: "live",
      rows: [{ ...row, published_at: "yesterday" }],
      next_cursor: null,
      has_more: false,
      source_health: {},
    })).toThrow(/row_published_at/);

    expect(() => parseTickerNewsSnapshot({
      schema: "ticker_news.snapshot.v1",
      ticker: "NVDA",
      security_id: "SEC:US-XNAS-NVDA",
      state: "live",
      rows: [{ ...row, url: "javascript:alert(1)" }],
      next_cursor: null,
      has_more: false,
      source_health: {},
    })).toThrow(/row_url/);
  });

  it("parses ticker-scoped changes and preserves prior+new targets", () => {
    const parsed = parseTickerNewsChange({
      sequence: 8,
      kind: "upsert",
      source: "benzinga",
      source_item_id: "123",
      story_id: "ev2_abc",
      title: "Corrected story",
      url: "https://www.benzinga.com/news/123",
      teaser: "",
      security_ids: ["SEC:US-XNAS-NVDA", "SEC:US-XNAS-AVGO"],
      universe_revision: "sp500-r1",
      observed_at: "2026-10-05T14:02:00+00:00",
    });
    expect(parsed.security_ids).toEqual(["SEC:US-XNAS-NVDA", "SEC:US-XNAS-AVGO"]);

    expect(() => parseTickerNewsChange({
      ...parsed,
      kind: "rename",
    })).toThrow(/change_kind/);
  });

  it("parses story detail members and rejects member/story mismatch", () => {
    const detail = parseTickerNewsStory({
      schema: "ticker_news.story.v1",
      story_id: "ev2_abc",
      source_count: 1,
      item_count: 2,
      members: [row, { ...row, source_item_id: "124" }],
    });
    expect(detail.members).toHaveLength(2);

    expect(() => parseTickerNewsStory({
      schema: "ticker_news.story.v1",
      story_id: "ev2_abc",
      source_count: 1,
      item_count: 1,
      members: [{ ...row, story_id: "ev2_other" }],
    })).toThrow(/story_member_id/);
  });

  it("normalizes ordinary ticker symbols without accepting path syntax", () => {
    expect(normalizeTickerNewsSymbol(" nvda ")).toBe("NVDA");
    expect(normalizeTickerNewsSymbol("BRK.B")).toBe("BRK.B");
    expect(normalizeTickerNewsSymbol("RDS-A")).toBe("RDS-A");
    expect(() => normalizeTickerNewsSymbol("../NVDA")).toThrow(/symbol/);
    expect(() => normalizeTickerNewsSymbol("NVDA%2Fetc")).toThrow(/symbol/);
  });
});