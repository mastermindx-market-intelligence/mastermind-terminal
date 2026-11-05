/**
 * newsReviewState.ts — personal "what have I read" state over the existing ticker-news feed.
 *
 * This is NOT a second story ledger. The feed (`useTickerNewsFeed` → `ticker_news.snapshot.v1`)
 * stays the only source of stories. For each story a user marks as read we keep exactly two
 * numbers the feed already supplies:
 *
 *     story_id → [sequence, item_count]
 *
 * `sequence` is the producer's change sequence for the story (the newest revision of any of its
 * reports). The producer allocates a new sequence for every accepted revision, so a corrected or
 * re-grouped story keeps its `story_id` and arrives with a different `sequence`. Comparing the
 * stored pair with the presented row therefore separates three cases without guessing:
 *
 *   * no stored pair            → "new"      (never marked read by this user)
 *   * stored pair ≠ row's pair  → "updated"  (same story, a revision the user has not read)
 *   * stored pair = row's pair  → "reviewed" (exactly the revision the user marked)
 *
 * No title, teaser, URL or body is stored.
 *
 * ── Saved evidence basis (Journey 6 / E5) ──────────────────────────────────────────────────────
 * The pair answers "have I read THIS revision?" and moves on every re-mark. `basis` answers a
 * different question: "what exactly did I see when I first marked this?" For each marked story it
 * keeps the report key (`source:source_item_id`), the revision markers of that presentation
 * (sequence, item_count, editorial view revision), the rights receipt the snapshot carried, and
 * the source `received_at` — still only references the feed already supplies. A basis is written
 * ONCE, at the first mark that captures it, and is never overwritten by later marks: the user's
 * authorship over what they reviewed is the point. `describeSavedDrift` compares a later
 * presentation against the saved basis (newer revision, fewer/more grouped reports, a re-keyed
 * report, a different view revision, a different rights receipt); an OLDER presentation is
 * out-of-order and is never described as an update.
 *
 * ── Reviewed-through receipt ───────────────────────────────────────────────────────────────────
 * `through` records the newest record of a presented page at the moment EVERY presented story in it
 * was read. Its time is the source's `received_at` for that record — never the local clock — and
 * it is only ever computed from rows that were successfully loaded and shown. It is a display
 * receipt ("last full read covered stories through 19:31"); classification never uses it, so a
 * story that was never presented (a page beyond the first 20, a late arrival with an older
 * sequence, a failed refresh) can never be implied read by it.
 *
 * ── Owner boundary ─────────────────────────────────────────────────────────────────────────────
 * The key is an `ownerStorage` envelope keyed by `ownerKeyFor(userId)` (the immutable auth id).
 * There is no guest → account adoption: an account reads only its own slot.
 */

import type { TickerNewsRightsBasis, TickerNewsStoryRow } from "@/lib/newsTypes";
import {
  isPlainObject, readOwnerSlot, writeOwnerSlot, type StoragePort,
} from "@/lib/ownerStorage";

export const NEWS_REVIEW_KEY = "mm.newsReview.v1";
/** Per-ticker cap. Oldest (lowest sequence) marks are dropped first. */
export const MAX_REVIEW_STORIES_PER_TICKER = 200;
/** Per-owner cap. Tickers whose newest mark is oldest are dropped first. */
export const MAX_REVIEW_TICKERS = 60;

export type ReviewedRevision = [sequence: number, itemCount: number];

export type ReviewReceipt = {
  /** Newest presented sequence at the moment the whole presented page was read. */
  sequence: number;
  /** That record's source `received_at` — a source timestamp, not the device clock. */
  at: string;
};

/** The evidence basis of one mark, exactly as the story was presented then. No content fields. */
export type SavedBasis = {
  /** `${source}:${source_item_id}` — which report the mark referred to. */
  report_key: string;
  sequence: number;
  item_count: number;
  /** `row.editorial_view?.revision ?? null` — the view the mark was made under. */
  view_revision: string | null;
  /** The snapshot's rights_basis as seen, copied field-by-field; null when absent. */
  rights: TickerNewsRightsBasis | null;
  /** `row.received_at` — a source timestamp, same convention as `ReviewReceipt.at`. */
  at: string;
};

export type TickerReview = {
  stories: Record<string, ReviewedRevision>;
  through: ReviewReceipt | null;
  /** Journey 6: story_id → the basis captured at the story's FIRST capturing mark. Optional so
   *  every pre-change envelope parses unchanged. */
  basis?: Record<string, SavedBasis>;
};

/** One owner's review state: TICKER → review. */
export type OwnerNewsReview = Record<string, TickerReview>;

export type ReviewStatus = "new" | "updated" | "reviewed";

export type ReviewClass =
  | { status: "new" }
  | { status: "reviewed" }
  | { status: "updated"; change: "revised" }
  | { status: "updated"; change: "more_reports"; added: number };

/** How a later presentation differs from the saved basis. An out-of-order copy has no facets. */
export type SavedDriftFacet =
  | "newer_revision"
  | "fewer_reports"
  | "more_reports"
  | "report_rekeyed"
  | "view_revision"
  | "rights";

export type SavedDrift = {
  basis: SavedBasis;
  facets: SavedDriftFacet[];
  /** row.sequence < basis.sequence — an older copy is never an update. */
  out_of_order: boolean;
};

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isSequence = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
/** Same shapes `newsValidation` accepts from the feed; anything else is not a feed reference. */
const STORY_ID_RE = /^ev2_[A-Za-z0-9._-]{1,240}$/;
const TICKER_RE = /^[A-Z0-9][A-Z0-9.-]{0,15}$/;

export function revisionOf(row: Pick<TickerNewsStoryRow, "sequence" | "item_count">): ReviewedRevision {
  return [row.sequence, row.item_count];
}

/** Classify one presented row against the user's stored marks for its ticker. */
export function classifyStory(
  review: TickerReview | undefined,
  row: Pick<TickerNewsStoryRow, "story_id" | "sequence" | "item_count">,
): ReviewClass {
  const seen = review?.stories[row.story_id];
  if (!seen) return { status: "new" };
  if (seen[0] === row.sequence && seen[1] === row.item_count) return { status: "reviewed" };
  if (row.item_count > seen[1]) {
    return { status: "updated", change: "more_reports", added: row.item_count - seen[1] };
  }
  return { status: "updated", change: "revised" };
}

const reportKeyOf = (row: Pick<TickerNewsStoryRow, "source" | "source_item_id">): string =>
  `${row.source}:${row.source_item_id}`;

/**
 * Describe how a presented row differs from the basis saved at the story's first capturing mark.
 * Null when no basis was saved. An OLDER sequence is out-of-order (a stale copy, not a change the
 * user has not read) and carries no facets. Nothing is inferred from `story_id` beyond lookup.
 */
export function describeSavedDrift(
  review: TickerReview | undefined,
  row: Pick<
    TickerNewsStoryRow,
    "story_id" | "source" | "source_item_id" | "sequence" | "item_count" | "editorial_view"
  >,
  current?: { rights?: TickerNewsRightsBasis | null },
): SavedDrift | null {
  const basis = review?.basis?.[row.story_id];
  if (!basis) return null;
  if (row.sequence < basis.sequence) return { basis, facets: [], out_of_order: true };
  const facets: SavedDriftFacet[] = [];
  if (row.sequence > basis.sequence) facets.push("newer_revision");
  if (row.item_count < basis.item_count) facets.push("fewer_reports");
  if (row.item_count > basis.item_count) facets.push("more_reports");
  if (reportKeyOf(row) !== basis.report_key) facets.push("report_rekeyed");
  const viewRevision = row.editorial_view?.revision ?? null;
  if (viewRevision !== null && basis.view_revision !== null && viewRevision !== basis.view_revision) {
    facets.push("view_revision");
  }
  const receiptId = current?.rights?.receipt_id ?? null;
  if (receiptId !== null && basis.rights !== null && receiptId !== basis.rights.receipt_id) {
    facets.push("rights");
  }
  return { basis, facets, out_of_order: false };
}

const isFeedText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const isSourceTime = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));

/** Tolerant parse of one saved basis; anything malformed is dropped, never repaired by guessing. */
function parseSavedBasis(value: unknown): SavedBasis | null {
  if (!isPlainObject(value)) return null;
  if (!isFeedText(value.report_key, 385)) return null; // 128 source + ':' + 256 item id
  if (!isSequence(value.sequence) || !isCount(value.item_count)) return null;
  const rawView = value.view_revision;
  if (rawView !== undefined && rawView !== null && typeof rawView !== "string") return null;
  const viewRevision = typeof rawView === "string" ? rawView : null;
  if (viewRevision !== null && !isFeedText(viewRevision, 1024)) return null;
  if (!isSourceTime(value.at)) return null;
  let rights: TickerNewsRightsBasis | null = null;
  const rawRights = value.rights;
  if (rawRights !== null && rawRights !== undefined) {
    if (!isPlainObject(rawRights)) return null;
    if (!isFeedText(rawRights.receipt_id, 256) || !isFeedText(rawRights.source, 128)
        || !isFeedText(rawRights.provider, 128)
        || !isSourceTime(rawRights.effective_at) || !isSourceTime(rawRights.expires_at)) return null;
    rights = {
      receipt_id: rawRights.receipt_id,
      source: rawRights.source,
      provider: rawRights.provider,
      effective_at: rawRights.effective_at,
      expires_at: rawRights.expires_at,
    };
  }
  return {
    report_key: value.report_key,
    sequence: value.sequence,
    item_count: value.item_count,
    view_revision: viewRevision,
    rights,
    at: value.at,
  };
}

function parseTickerReview(value: unknown): TickerReview | null {
  if (!isPlainObject(value) || !isPlainObject(value.stories)) return null;
  const stories: Record<string, ReviewedRevision> = {};
  for (const [id, pair] of Object.entries(value.stories)) {
    if (!STORY_ID_RE.test(id) || !Array.isArray(pair) || pair.length !== 2) continue;
    if (!isSequence(pair[0]) || !isCount(pair[1])) continue;
    stories[id] = [pair[0], pair[1]];
  }
  let through: ReviewReceipt | null = null;
  const raw = value.through;
  if (isPlainObject(raw) && isSequence(raw.sequence) && typeof raw.at === "string"
      && Number.isFinite(Date.parse(raw.at))) {
    through = { sequence: raw.sequence, at: raw.at };
  }
  if (!Object.keys(stories).length) return null;
  // Bases exist only for kept stories; malformed entries and orphans are dropped silently.
  const basis: Record<string, SavedBasis> = {};
  if (isPlainObject(value.basis)) {
    for (const [id, entry] of Object.entries(value.basis)) {
      if (!STORY_ID_RE.test(id) || !stories[id]) continue;
      const parsed = parseSavedBasis(entry);
      if (parsed) basis[id] = parsed;
    }
  }
  if (!Object.keys(basis).length) return { stories, through };
  return { stories, through, basis };
}

/** Tolerant parse of one owner's slot: malformed entries are dropped, never repaired by guessing. */
export function parseOwnerReview(value: unknown): OwnerNewsReview {
  if (!isPlainObject(value)) return {};
  const out: OwnerNewsReview = {};
  for (const [ticker, review] of Object.entries(value)) {
    if (!TICKER_RE.test(ticker)) continue;
    const parsed = parseTickerReview(review);
    if (parsed) out[ticker] = parsed;
  }
  return out;
}

const newestMark = (review: TickerReview): number =>
  Object.values(review.stories).reduce((max, pair) => Math.max(max, pair[0]), 0);

/** Bound the slot. Producer sequences are global and monotonic, so they order recency without a clock. */
export function pruneOwnerReview(value: OwnerNewsReview): OwnerNewsReview {
  const out: OwnerNewsReview = {};
  const tickers = Object.entries(value)
    .sort((a, b) => newestMark(b[1]) - newestMark(a[1]))
    .slice(0, MAX_REVIEW_TICKERS);
  for (const [ticker, review] of tickers) {
    const entries = Object.entries(review.stories);
    const kept = entries.length > MAX_REVIEW_STORIES_PER_TICKER
      ? entries.sort((a, b) => b[1][0] - a[1][0]).slice(0, MAX_REVIEW_STORIES_PER_TICKER)
      : entries;
    // Prune bases to the same key set as the kept stories.
    const basis = review.basis
      ? Object.fromEntries(kept.filter(([id]) => review.basis?.[id]).map(([id]) => [id, review.basis![id]]))
      : undefined;
    out[ticker] = basis && Object.keys(basis).length
      ? { stories: Object.fromEntries(kept), through: review.through, basis }
      : { stories: Object.fromEntries(kept), through: review.through };
  }
  return out;
}

export function readOwnerReview(storage: StoragePort, owner: string): OwnerNewsReview {
  return parseOwnerReview(readOwnerSlot(storage, NEWS_REVIEW_KEY, owner));
}

/** Write one owner's slot. Every other owner's payload is left byte-identical. */
export function writeOwnerReview(storage: StoragePort, owner: string, value: OwnerNewsReview): boolean {
  const pruned = pruneOwnerReview(value);
  return writeOwnerSlot(storage, NEWS_REVIEW_KEY, owner, Object.keys(pruned).length ? pruned : undefined);
}

/**
 * Mark stories read — only rows that were PRESENTED, at the revision that was presented.
 *
 * `presented` must be the rows the panel actually rendered from a successful load. An id in
 * `storyIds` that is not in `presented` is ignored, so a caller cannot mark an unseen story.
 * Returns the same object when nothing changed (so callers can skip a write).
 *
 * `context` (the panel always supplies it) also captures each target's evidence basis: written
 * once at the first capturing mark and never overwritten by later marks, whatever they see.
 * Without `context` the legacy envelope shape is produced exactly as before.
 */
export function markStoriesReviewed(
  current: OwnerNewsReview,
  ticker: string,
  presented: readonly TickerNewsStoryRow[],
  storyIds: readonly string[],
  context?: { rights?: TickerNewsRightsBasis | null },
): OwnerNewsReview {
  const key = ticker.toUpperCase();
  const wanted = new Set(storyIds);
  const targets = presented.filter((row) => wanted.has(row.story_id));
  if (!targets.length) return current;

  const prior = current[key];
  const stories: Record<string, ReviewedRevision> = { ...(prior?.stories ?? {}) };
  let changed = false;
  for (const row of targets) {
    const next = revisionOf(row);
    const had = stories[row.story_id];
    if (!had || had[0] !== next[0] || had[1] !== next[1]) {
      stories[row.story_id] = next;
      changed = true;
    }
  }

  // Authorship (Journey 6): capture the basis as seen at the FIRST capturing mark; a basis that
  // already exists is left byte-identical, and capturing one counts as a change on its own.
  const priorBasis = prior?.basis;
  let basis: Record<string, SavedBasis> | undefined = priorBasis ? { ...priorBasis } : undefined;
  if (context) {
    for (const row of targets) {
      if (basis?.[row.story_id]) continue;
      const captured: SavedBasis = {
        report_key: reportKeyOf(row),
        sequence: row.sequence,
        item_count: row.item_count,
        view_revision: row.editorial_view?.revision ?? null,
        rights: context.rights
          ? {
              receipt_id: context.rights.receipt_id,
              source: context.rights.source,
              provider: context.rights.provider,
              effective_at: context.rights.effective_at,
              expires_at: context.rights.expires_at,
            }
          : null,
        at: row.received_at,
      };
      (basis ??= {})[row.story_id] = captured;
      changed = true;
    }
  }

  let through = prior?.through ?? null;
  const pageFullyRead = presented.length > 0
    && presented.every((row) => classifyStory({ stories, through }, row).status === "reviewed");
  if (pageFullyRead) {
    const newest = presented.reduce((best, row) => (row.sequence > best.sequence ? row : best), presented[0]);
    if (!through || newest.sequence > through.sequence) {
      through = { sequence: newest.sequence, at: newest.received_at };
      changed = true;
    }
  }

  if (!changed) return current;
  if (basis && Object.keys(basis).length) {
    return { ...current, [key]: { stories, through, basis } };
  }
  return { ...current, [key]: { stories, through } };
}

export function countByStatus(
  review: TickerReview | undefined,
  rows: readonly TickerNewsStoryRow[],
): Record<ReviewStatus, number> {
  const counts: Record<ReviewStatus, number> = { new: 0, updated: 0, reviewed: 0 };
  for (const row of rows) counts[classifyStory(review, row).status] += 1;
  return counts;
}
