import { afterEach, describe, expect, it, vi } from "vitest";

import type { TickerNewsStoryRow } from "@/lib/newsTypes";
import {
  MAX_REVIEW_STORIES_PER_TICKER,
  MAX_REVIEW_TICKERS,
  NEWS_REVIEW_KEY,
  classifyStory,
  countByStatus,
  markStoriesReviewed,
  parseOwnerReview,
  pruneOwnerReview,
  readOwnerReview,
  writeOwnerReview,
  type OwnerNewsReview,
} from "@/lib/newsReviewState";
import type { StoragePort } from "@/lib/ownerStorage";

const row = (
  storyId: string,
  sequence: number,
  itemCount = 1,
  receivedAt = "2026-10-05T14:01:01+00:00",
): TickerNewsStoryRow => ({
  sequence,
  source: "benzinga",
  source_item_id: storyId + "-item",
  story_id: storyId,
  source_count: 1,
  item_count: itemCount,
  title: "Headline " + storyId,
  url: "https://www.benzinga.com/news/" + storyId,
  teaser: "Lead " + storyId,
  published_at: "2026-10-05T14:00:00+00:00",
  updated_at: null,
  received_at: receivedAt,
  universe_revision: "sp500-r1",
});

class MemoryStorage implements StoragePort {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key: string) { this.data.delete(key); }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("classifyStory — revision-aware review status", () => {
  it("separates new, reviewed, a revised story and a story with more grouped reports", () => {
    const review = { stories: { ev2_a: [5, 1] as [number, number] }, through: null };
    expect(classifyStory(undefined, row("ev2_a", 5))).toEqual({ status: "new" });
    expect(classifyStory(review, row("ev2_b", 6))).toEqual({ status: "new" });
    expect(classifyStory(review, row("ev2_a", 5))).toEqual({ status: "reviewed" });
    // Same story id, new producer revision, same grouping → a correction, not a new event.
    expect(classifyStory(review, row("ev2_a", 9))).toEqual({ status: "updated", change: "revised" });
    // Same story id, more reports grouped into it.
    expect(classifyStory(review, row("ev2_a", 9, 3))).toEqual({ status: "updated", change: "more_reports", added: 2 });
    // A report removed from the group is still a revision the user has not read.
    expect(classifyStory({ stories: { ev2_a: [5, 3] }, through: null }, row("ev2_a", 9, 2)))
      .toEqual({ status: "updated", change: "revised" });
  });

  it("never classifies an unmarked story as reviewed from the receipt, however old it is", () => {
    const review = {
      stories: { ev2_new: [50, 1] as [number, number] },
      through: { sequence: 50, at: "2026-10-05T15:00:00+00:00" },
    };
    // A late arrival: older sequence and older source time than the receipt, never presented.
    const late = row("ev2_late", 12, 1, "2026-10-05T09:00:00+00:00");
    expect(classifyStory(review, late)).toEqual({ status: "new" });
  });
});

describe("markStoriesReviewed — only presented rows, only the presented revision", () => {
  it("ignores ids that were not presented and returns the same object", () => {
    const current: OwnerNewsReview = {};
    const presented = [row("ev2_a", 3)];
    expect(markStoriesReviewed(current, "NVDA", presented, ["ev2_hidden"])).toBe(current);
    expect(markStoriesReviewed(current, "NVDA", [], ["ev2_a"])).toBe(current);
  });

  it("records the presented [sequence, item_count] and nothing about the story's content", () => {
    const next = markStoriesReviewed({}, "nvda", [row("ev2_a", 3, 2)], ["ev2_a"]);
    expect(next).toEqual({ NVDA: { stories: { ev2_a: [3, 2] }, through: { sequence: 3, at: "2026-10-05T14:01:01+00:00" } } });
    expect(JSON.stringify(next)).not.toContain("Headline");
    expect(JSON.stringify(next)).not.toContain("benzinga.com");
  });

  it("an interrupted review keeps per-story marks but does not advance the receipt", () => {
    const presented = [row("ev2_c", 30), row("ev2_b", 20), row("ev2_a", 10)];
    const next = markStoriesReviewed({}, "NVDA", presented, ["ev2_b"]);
    expect(next.NVDA.stories).toEqual({ ev2_b: [20, 1] });
    expect(next.NVDA.through).toBeNull();
    expect(countByStatus(next.NVDA, presented)).toEqual({ new: 2, updated: 0, reviewed: 1 });
  });

  it("takes the receipt time from the newest presented record, never from the device clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
    const presented = [
      row("ev2_b", 21, 1, "2026-10-05T19:31:00+00:00"),
      row("ev2_a", 10, 1, "2026-10-05T12:00:00+00:00"),
    ];
    const next = markStoriesReviewed({}, "NVDA", presented, ["ev2_a", "ev2_b"]);
    expect(next.NVDA.through).toEqual({ sequence: 21, at: "2026-10-05T19:31:00+00:00" });
    // Time passing on the device moves nothing.
    vi.setSystemTime(new Date("2032-06-01T00:00:00Z"));
    expect(markStoriesReviewed(next, "NVDA", presented, ["ev2_a", "ev2_b"])).toBe(next);
  });

  it("never moves the receipt backwards", () => {
    const first = markStoriesReviewed({}, "NVDA", [row("ev2_z", 90, 1, "2026-10-06T10:00:00+00:00")], ["ev2_z"]);
    const older = [row("ev2_y", 40, 1, "2026-10-05T10:00:00+00:00")];
    const next = markStoriesReviewed(first, "NVDA", older, ["ev2_y"]);
    expect(next.NVDA.through).toEqual({ sequence: 90, at: "2026-10-06T10:00:00+00:00" });
    expect(next.NVDA.stories).toEqual({ ev2_z: [90, 1], ev2_y: [40, 1] });
  });

  it("re-marking a revised story records the new revision", () => {
    const first = markStoriesReviewed({}, "NVDA", [row("ev2_a", 5)], ["ev2_a"]);
    const revised = [row("ev2_a", 9, 2)];
    expect(classifyStory(first.NVDA, revised[0])).toEqual({ status: "updated", change: "more_reports", added: 1 });
    const next = markStoriesReviewed(first, "NVDA", revised, ["ev2_a"]);
    expect(classifyStory(next.NVDA, revised[0])).toEqual({ status: "reviewed" });
  });

  it("does not mutate the presented rows or the prior state", () => {
    const presented = deepFreeze([row("ev2_a", 5), row("ev2_b", 4)]);
    const before = JSON.stringify(presented);
    const prior = deepFreeze(markStoriesReviewed({}, "NVDA", [row("ev2_a", 5)], ["ev2_a"]));
    expect(() => markStoriesReviewed(prior, "NVDA", presented, ["ev2_a", "ev2_b"])).not.toThrow();
    expect(JSON.stringify(presented)).toBe(before);
  });
});

describe("owner-scoped storage", () => {
  it("writes one owner's slot and leaves every other owner's payload byte-identical", () => {
    const storage = new MemoryStorage();
    const guestPayload = { NVDA: { stories: { ev2_a: [5, 1] }, through: null } };
    const otherPayload = { AAPL: { stories: { ev2_q: [7, 1] }, through: null } };
    storage.setItem(NEWS_REVIEW_KEY, JSON.stringify({ guest: guestPayload, "account:other": otherPayload }));
    const before = JSON.parse(storage.getItem(NEWS_REVIEW_KEY)!);

    const next = markStoriesReviewed(readOwnerReview(storage, "account:me"), "NVDA", [row("ev2_b", 8)], ["ev2_b"]);
    expect(writeOwnerReview(storage, "account:me", next)).toBe(true);

    const after = JSON.parse(storage.getItem(NEWS_REVIEW_KEY)!);
    expect(JSON.stringify(after.guest)).toBe(JSON.stringify(before.guest));
    expect(JSON.stringify(after["account:other"])).toBe(JSON.stringify(before["account:other"]));
    expect(after["account:me"].NVDA.stories).toEqual({ ev2_b: [8, 1] });
    // The account never sees the guest's marks.
    expect(readOwnerReview(storage, "account:me").NVDA.stories.ev2_a).toBeUndefined();
  });

  it("reports a refused write so the caller can degrade to session-only marks", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const next = markStoriesReviewed({}, "NVDA", [row("ev2_a", 5)], ["ev2_a"]);
    expect(writeOwnerReview(storage, "account:me", next)).toBe(false);
  });

  it("parses tolerantly and drops anything that is not a feed reference", () => {
    const parsed = parseOwnerReview({
      NVDA: {
        stories: {
          ev2_ok: [4, 2],
          not_a_story: [4, 1],
          ev2_bad_pair: [0, 1],
          ev2_bad_count: [4, -1],
          ev2_float: [4.5, 1],
        },
        through: { sequence: 4, at: "not a time" },
      },
      "lower-case": { stories: { ev2_x: [1, 1] }, through: null },
      AAPL: { stories: {}, through: null },
      MSFT: "garbage",
    });
    expect(parsed).toEqual({ NVDA: { stories: { ev2_ok: [4, 2] }, through: null } });
    expect(parseOwnerReview(null)).toEqual({});
    expect(parseOwnerReview([1, 2])).toEqual({});
  });

  it("bounds the slot by producer sequence, not by a clock", () => {
    const stories: Record<string, [number, number]> = {};
    for (let i = 1; i <= MAX_REVIEW_STORIES_PER_TICKER + 25; i++) stories["ev2_s" + i] = [i, 1];
    const many: OwnerNewsReview = { NVDA: { stories, through: null } };
    for (let t = 0; t < MAX_REVIEW_TICKERS + 5; t++) {
      many["T" + t] = { stories: { ["ev2_t" + t]: [1000 + t, 1] }, through: null };
    }
    const pruned = pruneOwnerReview(many);
    expect(Object.keys(pruned)).toHaveLength(MAX_REVIEW_TICKERS);
    // The tickers whose newest mark is oldest are dropped: NVDA (newest 225) and T0..T4.
    expect(pruned.NVDA).toBeUndefined();
    expect(pruned.T0).toBeUndefined();
    expect(pruned["T" + (MAX_REVIEW_TICKERS + 4)]).toBeDefined();

    const one = pruneOwnerReview({ NVDA: { stories, through: null } });
    const kept = Object.values(one.NVDA.stories).map((pair) => pair[0]);
    expect(kept).toHaveLength(MAX_REVIEW_STORIES_PER_TICKER);
    expect(Math.min(...kept)).toBe(26);
  });

  it("deletes the owner's slot when nothing is left to keep", () => {
    const storage = new MemoryStorage();
    storage.setItem(NEWS_REVIEW_KEY, JSON.stringify({ "account:me": { NVDA: { stories: { ev2_a: [1, 1] }, through: null } } }));
    expect(writeOwnerReview(storage, "account:me", {})).toBe(true);
    expect(storage.getItem(NEWS_REVIEW_KEY)).toBeNull();
  });
});
