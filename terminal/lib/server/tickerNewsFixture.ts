import type { ChangePage, ChangeRow, NewsSnapshot, StoryDetail, StoryRow } from "@/lib/newsContract";
import {
  TICKER_NEWS_CHANGES_SCHEMA,
  TICKER_NEWS_SNAPSHOT_SCHEMA,
  TICKER_NEWS_STORY_SCHEMA,
} from "@/lib/newsContract";

export const FIXTURE_TICKER = "AAPL";
export const FIXTURE_SECURITY_ID = "sec:fixture:AAPL";
export const FIXTURE_UNIVERSE_REVISION = "fixture-2026-10-06";

const TS = "2026-10-06T12:00:00Z";
const TS2 = "2026-10-06T11:30:00Z";

function storyRow(
  sequence: number,
  story_id: string,
  overrides: Partial<StoryRow> = {},
): StoryRow {
  return {
    sequence,
    source: "benzinga",
    source_item_id: `item-${sequence}`,
    story_id,
    source_count: 1,
    item_count: 1,
    title: `Fixture headline ${story_id}`,
    url: `https://example.test/news/${story_id}`,
    teaser: `Teaser for ${story_id}`,
    published_at: TS2,
    updated_at: TS,
    received_at: TS,
    universe_revision: FIXTURE_UNIVERSE_REVISION,
    ...overrides,
  };
}

const snapshotRows: StoryRow[] = [
  storyRow(101, "story-101"),
  storyRow(102, "story-102", {
    source_count: 2,
    item_count: 2,
    title: "Apple supply chain update",
  }),
  storyRow(103, "story-103"),
];

export function fixtureSnapshot(ticker: string): NewsSnapshot | null {
  if (ticker !== FIXTURE_TICKER) return null;
  return {
    schema: TICKER_NEWS_SNAPSHOT_SCHEMA,
    ticker: FIXTURE_TICKER,
    security_id: FIXTURE_SECURITY_ID,
    state: "quiet",
    rows: snapshotRows.map((r) => ({ ...r })),
    next_cursor: null,
    has_more: false,
    source_health: { state: "ok" },
  };
}

function changeRow(
  sequence: number,
  kind: ChangeRow["kind"],
  story_id: string,
  title: string,
): ChangeRow {
  return {
    sequence,
    kind,
    source: "benzinga",
    source_item_id: `chg-${sequence}`,
    story_id,
    title,
    url: `https://example.test/news/${story_id}`,
    teaser: `Change teaser ${story_id}`,
    security_ids: [FIXTURE_SECURITY_ID],
    universe_revision: FIXTURE_UNIVERSE_REVISION,
    observed_at: TS,
  };
}

const changeRows: ChangeRow[] = [
  changeRow(104, "upsert", "story-104", "New fixture story arrives"),
  changeRow(105, "upsert", "story-102", "Apple supply chain update (corrected)"),
  changeRow(106, "remove", "story-101", ""),
];

export function fixtureChanges(ticker: string): ChangePage | null {
  if (ticker !== FIXTURE_TICKER) return null;
  return {
    schema: TICKER_NEWS_CHANGES_SCHEMA,
    ticker: FIXTURE_TICKER,
    security_id: FIXTURE_SECURITY_ID,
    rows: changeRows.map((r) => ({ ...r })),
    next_sequence: 106,
    has_more: false,
  };
}

export function fixtureStoryDetail(storyId: string): StoryDetail | null {
  if (storyId !== "story-102") return null;
  const base = storyRow(102, "story-102", {
    source_count: 2,
    item_count: 2,
    title: "Apple supply chain update",
  });
  const memberB: StoryRow = {
    ...base,
    source: "benzinga",
    source_item_id: "item-102b",
    sequence: 102,
  };
  return {
    schema: TICKER_NEWS_STORY_SCHEMA,
    story_id: "story-102",
    source_count: 2,
    item_count: 2,
    members: [base, memberB],
  };
}

export function fixtureStreamFrames(): string[] {
  const frames = changeRows.map((row) => {
    const payload = JSON.stringify(row);
    return `event: ${row.kind}\ndata: ${payload}\n\n`;
  });
  frames.push(": heartbeat\n\n");
  return frames;
}
