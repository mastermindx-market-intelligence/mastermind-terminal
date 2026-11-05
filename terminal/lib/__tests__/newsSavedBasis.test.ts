// Journey 6 (E5) — a review mark keeps the story's exact evidence basis as seen, written once
// and never overwritten; a later presentation that differs from the saved basis is described
// facet by facet, and an out-of-order older copy is never an update.
import { describe, expect, it } from "vitest";

import { NEWS_VIEW } from "./fixtures/newsEditorial";
import type { TickerNewsRightsBasis, TickerNewsStoryRow } from "@/lib/newsTypes";
import {
  MAX_REVIEW_STORIES_PER_TICKER,
  NEWS_REVIEW_KEY,
  describeSavedDrift,
  markStoriesReviewed,
  parseOwnerReview,
  pruneOwnerReview,
  readOwnerReview,
  writeOwnerReview,
  type OwnerNewsReview,
  type SavedBasis,
  type SavedDrift,
} from "@/lib/newsReviewState";
import type { StoragePort } from "@/lib/ownerStorage";

const RIGHTS: TickerNewsRightsBasis = {
  receipt_id: "rr_0001",
  source: "benzinga",
  provider: "fixture-provider",
  effective_at: "2026-10-01T00:00:00Z",
  expires_at: "2027-10-01T00:00:00Z",
};

const row = (
  storyId: string,
  sequence: number,
  itemCount = 1,
  extra: Partial<TickerNewsStoryRow> = {},
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
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1",
  editorial_view: NEWS_VIEW,
  ...extra,
});

class MemoryStorage implements StoragePort {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe("markStoriesReviewed — the saved evidence basis", () => {
  it("a first mark captures the basis as seen: report key, revision markers, rights, source time", () => {
    const next = markStoriesReviewed({}, "NVDA", [row("ev2_a", 5, 3)], ["ev2_a"], { rights: RIGHTS });
    expect(next.NVDA.basis?.ev2_a).toEqual({
      report_key: "benzinga:ev2_a-item",
      sequence: 5,
      item_count: 3,
      view_revision: NEWS_VIEW.revision,
      rights: RIGHTS,
      at: "2026-10-05T14:01:01+00:00",
    });
  });

  it("capturing a basis counts as a change even when the pair is unchanged", () => {
    const current: OwnerNewsReview = { NVDA: { stories: { ev2_a: [5, 3] }, through: null } };
    const next = markStoriesReviewed(current, "NVDA", [row("ev2_a", 5, 3)], ["ev2_a"], { rights: null });
    expect(next).not.toBe(current);
    expect(next.NVDA.stories.ev2_a).toEqual([5, 3]);
    expect(next.NVDA.basis?.ev2_a).toBeDefined();
  });

  it("a re-mark after a newer revision moves the pair but never rewrites the saved basis", () => {
    const first = markStoriesReviewed({}, "NVDA", [row("ev2_a", 5, 3)], ["ev2_a"], { rights: RIGHTS });
    const captured: SavedBasis = first.NVDA.basis!.ev2_a;
    // A partial retraction on a newer sequence, under a new rights receipt, re-keyed to another item.
    const corrected = markStoriesReviewed(first, "NVDA", [row("ev2_a", 9, 2, { source_item_id: "ev2_a-item-2" })], ["ev2_a"], {
      rights: { ...RIGHTS, receipt_id: "rr_0002" },
    });
    expect(corrected.NVDA.stories.ev2_a).toEqual([9, 2]);
    expect(corrected.NVDA.basis?.ev2_a).toEqual(captured);
  });

  it("parses an envelope without basis, and drops malformed basis entries and orphans", () => {
    expect(parseOwnerReview({ NVDA: { stories: { ev2_a: [5, 3] }, through: null } }))
      .toEqual({ NVDA: { stories: { ev2_a: [5, 3] }, through: null } });

    const basis = (over: Record<string, unknown> = {}) => ({
      report_key: "benzinga:x-item",
      sequence: 5,
      item_count: 3,
      view_revision: NEWS_VIEW.revision,
      rights: null,
      at: "2026-10-05T14:01:01+00:00",
      ...over,
    });
    const parsed = parseOwnerReview({
      NVDA: {
        stories: { ev2_ok: [5, 3], ev2_pair: [4, 1] },
        through: null,
        basis: {
          ev2_ok: basis({ report_key: "benzinga:ev2_ok-item" }),
          ev2_bad_sequence: basis({ sequence: 0 }),
          ev2_bad_count: basis({ item_count: -1 }),
          ev2_bad_key: basis({ report_key: "" }),
          ev2_bad_at: basis({ at: "not a time" }),
          ev2_bad_view: basis({ view_revision: 42 }),
          ev2_bad_rights: basis({ rights: { receipt_id: "x" } }),
          ev2_orphan: basis({ report_key: "benzinga:ev2_orphan-item" }),
          not_a_story: basis(),
        },
      },
    });
    expect(Object.keys(parsed.NVDA.basis ?? {})).toEqual(["ev2_ok"]);
    expect(parsed.NVDA.basis?.ev2_ok?.report_key).toBe("benzinga:ev2_ok-item");
  });

  it("writes one owner's basis and leaves every other owner's payload byte-identical", () => {
    const storage = new MemoryStorage();
    const guestPayload = { NVDA: { stories: { ev2_g: [5, 1] }, through: null } };
    const otherPayload = { AAPL: { stories: { ev2_q: [7, 1] }, through: null } };
    storage.setItem(NEWS_REVIEW_KEY, JSON.stringify({ guest: guestPayload, "account:other": otherPayload }));
    const before = storage.getItem(NEWS_REVIEW_KEY)!;

    const next = markStoriesReviewed(readOwnerReview(storage, "account:me"), "NVDA", [row("ev2_a", 5, 3)], ["ev2_a"], { rights: RIGHTS });
    expect(writeOwnerReview(storage, "account:me", next)).toBe(true);

    const after = JSON.parse(storage.getItem(NEWS_REVIEW_KEY)!);
    expect(JSON.stringify(after.guest)).toBe(JSON.stringify(JSON.parse(before).guest));
    expect(JSON.stringify(after["account:other"])).toBe(JSON.stringify(JSON.parse(before)["account:other"]));
    expect(after["account:me"].NVDA.basis.ev2_a.report_key).toBe("benzinga:ev2_a-item");
    expect(readOwnerReview(storage, "guest").NVDA.basis).toBeUndefined();
  });

  it("a saved basis survives the write/read round trip", () => {
    const storage = new MemoryStorage();
    const next = markStoriesReviewed({}, "NVDA", [row("ev2_a", 5, 3)], ["ev2_a"], { rights: RIGHTS });
    expect(writeOwnerReview(storage, "account:me", next)).toBe(true);
    expect(readOwnerReview(storage, "account:me").NVDA.basis?.ev2_a).toEqual(next.NVDA.basis?.ev2_a);
  });

  it("cap pruning keeps basis a subset of the kept stories", () => {
    const stories: Record<string, [number, number]> = {};
    const basis: Record<string, SavedBasis> = {};
    for (let i = 1; i <= MAX_REVIEW_STORIES_PER_TICKER + 25; i++) {
      const id = "ev2_s" + i;
      stories[id] = [i, 1];
      basis[id] = {
        report_key: `benzinga:${id}-item`, sequence: i, item_count: 1,
        view_revision: null, rights: null, at: "2026-10-05T14:01:01+00:00",
      };
    }
    const pruned = pruneOwnerReview({ NVDA: { stories, through: null, basis } });
    const keptIds = Object.keys(pruned.NVDA.stories);
    expect(keptIds).toHaveLength(MAX_REVIEW_STORIES_PER_TICKER);
    const basisIds = Object.keys(pruned.NVDA.basis ?? {});
    expect(basisIds).toHaveLength(MAX_REVIEW_STORIES_PER_TICKER);
    expect(basisIds.every((id) => keptIds.includes(id))).toBe(true);
  });

  it("the serialized envelope carries no title, teaser or url", () => {
    const next = markStoriesReviewed({}, "NVDA", [row("ev2_a", 5, 3, {
      title: "SECRET TITLE ALPHA",
      url: "https://secret.example/alpha",
      teaser: "SECRET TEASER ALPHA",
    })], ["ev2_a"], { rights: RIGHTS });
    const serialized = JSON.stringify(pruneOwnerReview(next));
    expect(serialized).not.toContain("SECRET TITLE ALPHA");
    expect(serialized).not.toContain("secret.example");
    expect(serialized).not.toContain("SECRET TEASER ALPHA");
    expect(serialized).toContain("benzinga:ev2_a-item");
  });
});

describe("describeSavedDrift — what moved since the saved basis", () => {
  it("names each facet of the difference from the saved basis", () => {
    const marked = markStoriesReviewed({}, "NVDA", [row("ev2_a", 5, 3)], ["ev2_a"], { rights: RIGHTS });
    const review = marked.NVDA;
    const driftFor = (presented: TickerNewsStoryRow, rights: TickerNewsRightsBasis | null = RIGHTS): SavedDrift["facets"] =>
      describeSavedDrift(review, presented, { rights })?.facets ?? [];

    expect(driftFor(row("ev2_a", 9, 3))).toContain("newer_revision");
    expect(driftFor(row("ev2_a", 9, 2))).toContain("fewer_reports");
    expect(driftFor(row("ev2_a", 9, 4))).toContain("more_reports");
    expect(driftFor(row("ev2_a", 9, 3, { source_item_id: "ev2_a-item-2" }))).toContain("report_rekeyed");
    expect(driftFor(row("ev2_a", 9, 3, { editorial_view: { ...NEWS_VIEW, revision: "b".repeat(64) } }))).toContain("view_revision");
    expect(driftFor(row("ev2_a", 9, 3), { ...RIGHTS, receipt_id: "rr_0009" })).toContain("rights");

    // No saved basis → nothing to describe.
    expect(describeSavedDrift(review, row("ev2_b", 9))).toBeNull();
    expect(describeSavedDrift(undefined, row("ev2_a", 9))).toBeNull();
  });

  it("an older out-of-order copy is never an update and never touches the basis", () => {
    const first = markStoriesReviewed({}, "NVDA", [row("ev2_a", 5, 3)], ["ev2_a"], { rights: RIGHTS });
    const captured: SavedBasis = first.NVDA.basis!.ev2_a;
    const older = row("ev2_a", 3, 3);
    const drift = describeSavedDrift(first.NVDA, older, { rights: RIGHTS });
    expect(drift?.out_of_order).toBe(true);
    expect(drift?.facets).toEqual([]);
    // Marking that older row moves the pair (today's semantics) but leaves the basis alone.
    const next = markStoriesReviewed(first, "NVDA", [older], ["ev2_a"], { rights: RIGHTS });
    expect(next.NVDA.stories.ev2_a).toEqual([3, 3]);
    expect(next.NVDA.basis?.ev2_a).toEqual(captured);
  });
});
