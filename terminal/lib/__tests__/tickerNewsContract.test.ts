import { describe, expect, it } from "vitest";
import {
  applyChanges,
  NewsContractError,
  parseSnapshot,
  TICKER_NEWS_SNAPSHOT_SCHEMA,
  type ChangeRow,
  type StoryRow,
} from "@/lib/newsContract";
import { fixtureChanges, fixtureSnapshot, fixtureStoryDetail } from "@/lib/server/tickerNewsFixture";
import { parseChanges, parseStory } from "@/lib/newsContract";

const baseRow = (story_id: string, sequence: number): StoryRow => ({
  sequence,
  source: "benzinga",
  source_item_id: `i-${sequence}`,
  story_id,
  source_count: 1,
  item_count: 1,
  title: `Title ${story_id}`,
  url: `https://example.test/${story_id}`,
  teaser: "teaser",
  published_at: null,
  updated_at: "2026-10-06T12:00:00Z",
  received_at: "2026-10-06T12:00:00Z",
  universe_revision: "rev-1",
});

const baseChange = (overrides: Partial<ChangeRow> = {}): ChangeRow => ({
  sequence: 10,
  kind: "upsert",
  source: "benzinga",
  source_item_id: "c-10",
  story_id: "story-a",
  title: "New title",
  url: "https://example.test/a",
  teaser: "t",
  security_ids: ["sec:1"],
  universe_revision: "rev-1",
  observed_at: "2026-10-06T12:00:00Z",
  ...overrides,
});

describe("tickerNews contract", () => {
  it("[T04 previous-symbol-late-response] parseSnapshot throws NewsContractError when ticker mismatches", () => {
    const payload = {
      schema: TICKER_NEWS_SNAPSHOT_SCHEMA,
      ticker: "MSFT",
      security_id: "sec:msft",
      state: "quiet",
      rows: [],
      next_cursor: null,
      has_more: false,
      source_health: { state: "ok" },
    };
    expect(() => parseSnapshot(payload, "AAPL")).toThrow(NewsContractError);
  });

  it("[T05 snapshot-stream-overlap] applyChanges ignores changes with sequence <= watermark", () => {
    const rows = [baseRow("s1", 1)];
    const changes = [baseChange({ sequence: 5, story_id: "s1", title: "ignored" })];
    const result = applyChanges(rows, changes, 5);
    expect(result.rows[0]!.title).toBe("Title s1");
    expect(result.watermark).toBe(5);
  });

  it("[T06 duplicate-delivery] applying the same ChangeRow twice is idempotent", () => {
    const rows = [baseRow("s1", 1)];
    const change = baseChange({ sequence: 6, story_id: "s2", title: "Added" });
    const once = applyChanges(rows, [change], 0);
    const twice = applyChanges(rows, [change, change], 0);
    expect(twice).toEqual(once);
  });

  it("[T07 correction] upsert on an existing story_id replaces title in place", () => {
    const rows = [baseRow("s1", 1), baseRow("s2", 2)];
    const change = baseChange({ sequence: 7, story_id: "s1", title: "Corrected title" });
    const result = applyChanges(rows, [change], 0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.story_id).toBe("s1");
    expect(result.rows[0]!.title).toBe("Corrected title");
    expect(result.rows[1]!.story_id).toBe("s2");
  });

  it("[T08 withdrawal] remove deletes story_id and later upsert inserts new story", () => {
    const rows = [baseRow("s1", 1), baseRow("s2", 2)];
    const remove = baseChange({ sequence: 8, kind: "remove", story_id: "s1", title: "" });
    const afterRemove = applyChanges(rows, [remove], 0);
    expect(afterRemove.rows.map((r) => r.story_id)).toEqual(["s2"]);
    const insert = baseChange({ sequence: 9, story_id: "s3", title: "Fresh" });
    const afterInsert = applyChanges(afterRemove.rows, [insert], afterRemove.watermark);
    expect(afterInsert.rows.map((r) => r.story_id)).toEqual(["s2", "s3"]);
  });

  it("[T18 fixture-mode] fixture payloads pass parseSnapshot, parseChanges, and parseStory", () => {
    const snap = fixtureSnapshot("AAPL");
    expect(snap).not.toBeNull();
    expect(parseSnapshot(snap, "AAPL")).toEqual(snap);
    const changes = fixtureChanges("AAPL");
    expect(changes).not.toBeNull();
    expect(parseChanges(changes, "AAPL")).toEqual(changes);
    const story = fixtureStoryDetail("story-102");
    expect(story).not.toBeNull();
    expect(parseStory(story)).toEqual(story);
  });
});
