"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ownerKeyFor } from "@/lib/accountIdentity";
import type { TickerNewsStoryRow } from "@/lib/newsTypes";
import { browserStorage } from "@/lib/ownerStorage";
import {
  NEWS_REVIEW_KEY,
  classifyStory,
  markStoriesReviewed,
  readOwnerReview,
  writeOwnerReview,
  type OwnerNewsReview,
  type ReviewClass,
  type ReviewReceipt,
  type ReviewStatus,
} from "@/lib/newsReviewState";

/**
 * pending      — this owner's marks have not been read yet (first paint, or just after an account
 *                switch). Nothing is classified and nothing can be marked.
 * saved        — marks are read from and written to this owner's slot on this device.
 * session      — the device store is unreachable or refused a write; marks live in memory only.
 * unavailable  — no account identity, so there is no owner to keep marks for.
 */
export type NewsReviewMode = "pending" | "saved" | "session" | "unavailable";
export type NewsReviewFilter = "all" | ReviewStatus;

type Loaded = { owner: string; data: OwnerNewsReview; mode: "saved" | "session" };

const NO_ROWS: readonly TickerNewsStoryRow[] = [];

/**
 * Review state for the rows the News panel is presenting.
 *
 * `presented` must be the rows of a SUCCESSFUL load that are on screen — the panel passes an empty
 * list for loading / restricted / unavailable — and it is the only thing a mark can apply to.
 */
export function useNewsCatchup({
  userId,
  ticker,
  presented,
}: {
  userId?: string;
  ticker: string;
  presented: readonly TickerNewsStoryRow[];
}) {
  const owner = userId && userId.trim() ? ownerKeyFor(userId) : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const commit = useCallback((next: Loaded) => {
    loadedRef.current = next;
    setLoaded(next);
  }, []);

  useEffect(() => {
    if (!owner) return;
    const storage = browserStorage();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; reading this owner's slot after mount is the hydration boundary.
    commit(storage ? { owner, data: readOwnerReview(storage, owner), mode: "saved" } : { owner, data: {}, mode: "session" });
    if (!storage) return;
    // Another tab of the same owner marked something: re-read this owner's slot only.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== NEWS_REVIEW_KEY) return;
      const current = loadedRef.current;
      if (!current || current.owner !== owner || current.mode !== "saved") return;
      commit({ owner, data: readOwnerReview(storage, owner), mode: "saved" });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [owner, commit]);

  const active = owner && loaded?.owner === owner ? loaded : null;
  const mode: NewsReviewMode = !owner ? "unavailable" : active ? active.mode : "pending";
  const key = ticker.toUpperCase();
  const review = active?.data[key];

  const [filter, setFilter] = useState<NewsReviewFilter>("all");
  const [sourcePick, setSourcePick] = useState<{ ticker: string; source: string } | null>(null);

  const sources = useMemo(
    () => Array.from(new Set(presented.map((row) => row.source))).sort(),
    [presented],
  );
  // The source filter belongs to the catch-up controls, so it applies only while they are shown.
  const source = active && sourcePick && sourcePick.ticker === key && sources.includes(sourcePick.source)
    ? sourcePick.source
    : null;
  const setSource = useCallback((next: string | null) => {
    setSourcePick(next ? { ticker: key, source: next } : null);
  }, [key]);

  const classified = useMemo(() => {
    const map = new Map<string, ReviewClass>();
    if (!active) return map;
    for (const row of presented) map.set(row.story_id, classifyStory(review, row));
    return map;
  }, [active, presented, review]);

  const bySource = useMemo(
    () => (source ? presented.filter((row) => row.source === source) : presented),
    [presented, source],
  );
  const counts = useMemo(() => {
    const out: Record<ReviewStatus, number> = { new: 0, updated: 0, reviewed: 0 };
    for (const row of bySource) {
      const cls = classified.get(row.story_id);
      if (cls) out[cls.status] += 1;
    }
    return out;
  }, [bySource, classified]);

  const effectiveFilter: NewsReviewFilter = active ? filter : "all";
  const visible = useMemo(
    () => (effectiveFilter === "all"
      ? bySource
      : bySource.filter((row) => classified.get(row.story_id)?.status === effectiveFilter)),
    [bySource, classified, effectiveFilter],
  );

  const mark = useCallback((storyIds: readonly string[]) => {
    const current = loadedRef.current;
    // No owner, or this owner's marks are not loaded yet: there is nothing safe to write to.
    if (!owner || !current || current.owner !== owner) return;
    if (!presented.length || !storyIds.length) return;
    const storage = current.mode === "saved" ? browserStorage() : null;
    // Merge onto the newest stored copy so another tab's marks are not overwritten.
    const base = storage ? readOwnerReview(storage, owner) : current.data;
    const next = markStoriesReviewed(base, key, presented, storyIds);
    if (next === base) {
      if (storage) commit({ owner, data: base, mode: "saved" });
      return;
    }
    if (storage && writeOwnerReview(storage, owner, next)) {
      commit({ owner, data: readOwnerReview(storage, owner), mode: "saved" });
    } else {
      commit({ owner, data: next, mode: "session" });
    }
  }, [owner, presented, key, commit]);

  const markStory = useCallback((storyId: string) => mark([storyId]), [mark]);
  const unreadShown = useMemo(
    () => visible.filter((row) => {
      const status = classified.get(row.story_id)?.status;
      return status === "new" || status === "updated";
    }).map((row) => row.story_id),
    [visible, classified],
  );
  const markShown = useCallback(() => mark(unreadShown), [mark, unreadShown]);

  const through: ReviewReceipt | null = active ? review?.through ?? null : null;

  return {
    mode,
    classify: (row: TickerNewsStoryRow): ReviewClass | null => classified.get(row.story_id) ?? null,
    counts,
    filter: effectiveFilter,
    setFilter,
    sources,
    source,
    setSource,
    visible: presented.length ? visible : NO_ROWS,
    unreadShown: unreadShown.length,
    markStory,
    markShown,
    through,
  };
}

export type NewsCatchup = ReturnType<typeof useNewsCatchup>;
