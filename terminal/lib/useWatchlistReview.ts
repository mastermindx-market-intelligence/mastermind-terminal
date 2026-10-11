"use client";

/**
 * useWatchlistReview — the shell-side owner of ONE frozen watchlist review (E16).
 *
 * The hook holds no navigation of its own: moving to a company calls the shell's `navigate`
 * (TerminalShell's `pick`), the same path a watchlist row click takes. That path feeds the Chart
 * Bus and the #821 Workspace Context Session, so linked panels follow and pinned / local panels
 * keep their own security. There is no second context session and no timer.
 *
 * Writes happen only inside user actions, exactly one per action, computed from a ref so a burst of
 * Next presses inside one frame advances one step per press instead of re-using a stale render. The
 * owner the record was LOADED for is captured with it: a write never lands in another owner's slot,
 * and an owner change hides the outgoing owner's review in the same render.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { browserStorage } from "@/lib/ownerStorage";
import {
  currentSymbol, isSkipped, itineraryDrift, liveListOrder, markEntry, peekNext, readReview, refreshItinerary,
  resolveAvailability, startItinerary, stepItinerary, summarizeItinerary, writeReview,
  type EntryAvailability, type ItinerarySummary, type ReviewItinerary, type ReviewMark,
} from "@/lib/watchlistReview";

export type ReviewSave = "saved" | "unsaved";
export type ReviewNotice =
  | { kind: "skipped"; entries: { symbol: string; availability: EntryAvailability }[] }
  | { kind: "edge"; direction: 1 | -1 }
  | { kind: "empty"; listName: string }
  | null;

type ListRows = Record<string, readonly { symbol: string; section: string }[]>;
type ListMeta = Record<string, { sections: string[]; collapsed: string[] } | undefined>;

export type WatchlistReviewInputs = {
  /** `watchlistOwnerKey(userId)` — `guest` | `account:<uuid>`. */
  owner: string;
  lists: ListRows;
  listMeta: ListMeta;
  /** False until the saved lists have been restored; membership is then UNKNOWN, not empty. */
  listsReady: boolean;
  /** Manifest symbols, or null while not loaded. */
  manifestSymbols: Readonly<Record<string, unknown>> | null;
  /** The shell's existing navigation owner. */
  navigate: (symbol: string) => void;
};

type State = { owner: string; loaded: boolean; itinerary: ReviewItinerary | null; save: ReviewSave; notice: ReviewNotice };

export type WatchlistReview = {
  loaded: boolean;
  itinerary: ReviewItinerary | null;
  save: ReviewSave;
  notice: ReviewNotice;
  current: string | null;
  currentAvailability: EntryAvailability | null;
  currentMark: ReviewMark | null;
  /** Where Next would land, in the frozen order; null at the end. */
  nextSymbol: string | null;
  summary: ItinerarySummary | null;
  drift: { added: string[]; removed: string[] };
  /** The review's list no longer exists (lists restored, name absent). */
  listMissing: boolean;
  canPrev: boolean;
  canNext: boolean;
  start: (listName: string) => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  toggleReviewed: () => void;
  defer: (note: string) => void;
  clearMark: () => void;
  refresh: () => void;
  end: () => void;
  retrySave: () => void;
  dismissUnsaved: () => void;
};

const now = () => Date.now();

export function useWatchlistReview(inputs: WatchlistReviewInputs): WatchlistReview {
  const { owner, lists, listMeta, listsReady, manifestSymbols } = inputs;
  const [state, setState] = useState<State>(() => ({ owner, loaded: false, itinerary: null, save: "saved", notice: null }));
  const stateRef = useRef(state);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  // Load this owner's review. A layout effect (not render) because storage is client-only and the
  // server render has no review; not a passive effect, so the bar never paints a frame late.
  useLayoutEffect(() => {
    const storage = browserStorage();
    const loaded: State = { owner, loaded: true, itinerary: storage ? readReview(storage, owner) : null, save: "saved", notice: null };
    stateRef.current = loaded;
    setState(loaded);
  }, [owner]);

  const availabilityFor = useCallback((listName: string) => {
    const { lists: rows, listsReady: ready, manifestSymbols: manifest } = inputsRef.current;
    const members = ready ? new Set((rows[listName] ?? []).map((row) => row.symbol)) : null;
    return (symbol: string) => resolveAvailability(symbol, { liveMembers: members, manifestSymbols: manifest });
  }, []);

  const liveOrderFor = useCallback((listName: string): string[] | null => {
    const { lists: rows, listMeta: meta, listsReady: ready } = inputsRef.current;
    if (!ready || !rows[listName]) return ready ? [] : null;
    return liveListOrder(rows[listName], meta[listName]?.sections ?? []);
  }, []);

  const go = useCallback((itinerary: ReviewItinerary | null) => {
    if (!itinerary) return;
    const symbol = currentSymbol(itinerary);
    if (!symbol || isSkipped(availabilityFor(itinerary.listName)(symbol))) return;
    inputsRef.current.navigate(symbol);
  }, [availabilityFor]);

  /** The single write path. Returns false (and writes nothing) when the owner moved underneath. */
  const commit = useCallback((itinerary: ReviewItinerary | null, notice: ReviewNotice): boolean => {
    const current = stateRef.current;
    if (!current.loaded || current.owner !== ownerRef.current) return false;
    const ok = writeReview(browserStorage(), current.owner, itinerary);
    const next: State = { ...current, itinerary, save: ok ? "saved" : "unsaved", notice };
    stateRef.current = next;
    setState(next);
    return true;
  }, []);

  const setNotice = useCallback((notice: ReviewNotice) => {
    const current = stateRef.current;
    if (current.owner !== ownerRef.current) return;
    const next = { ...current, notice };
    stateRef.current = next;
    setState(next);
  }, []);

  const start = useCallback((listName: string) => {
    const order = liveOrderFor(listName);
    const itinerary = order ? startItinerary(listName, order, availabilityFor(listName), now()) : null;
    if (!itinerary) { setNotice({ kind: "empty", listName }); return; }
    if (commit(itinerary, null)) go(itinerary);
  }, [availabilityFor, commit, go, liveOrderFor, setNotice]);

  const resume = useCallback(() => { go(stateRef.current.itinerary); }, [go]);

  const step = useCallback((direction: 1 | -1) => {
    const itinerary = stateRef.current.itinerary;
    if (!itinerary || stateRef.current.owner !== ownerRef.current) return;
    const result = stepItinerary(itinerary, direction, availabilityFor(itinerary.listName), now());
    if (!result) { setNotice({ kind: "edge", direction }); return; }
    if (commit(result.itinerary, result.skipped.length ? { kind: "skipped", entries: result.skipped } : null)) go(result.itinerary);
  }, [availabilityFor, commit, go, setNotice]);
  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  const mark = useCallback((value: { state: "reviewed" | "deferred"; note?: string } | null) => {
    const itinerary = stateRef.current.itinerary;
    const symbol = itinerary ? currentSymbol(itinerary) : null;
    if (!itinerary || !symbol) return;
    const marked = markEntry(itinerary, symbol, value, now());
    if (marked) commit(marked, null);
  }, [commit]);
  const toggleReviewed = useCallback(() => {
    const itinerary = stateRef.current.itinerary;
    const symbol = itinerary ? currentSymbol(itinerary) : null;
    mark(symbol && itinerary?.marks[symbol]?.state === "reviewed" ? null : { state: "reviewed" });
  }, [mark]);
  const defer = useCallback((note: string) => mark({ state: "deferred", note }), [mark]);
  const clearMark = useCallback(() => mark(null), [mark]);

  const refresh = useCallback(() => {
    const itinerary = stateRef.current.itinerary;
    if (!itinerary) return;
    const order = liveOrderFor(itinerary.listName);
    if (!order) return;
    const refreshed = refreshItinerary(itinerary, order, availabilityFor(itinerary.listName), now());
    if (!refreshed) { setNotice({ kind: "empty", listName: itinerary.listName }); return; }
    const moved = currentSymbol(refreshed) !== currentSymbol(itinerary);
    if (commit(refreshed, null) && moved) go(refreshed);
  }, [availabilityFor, commit, go, liveOrderFor, setNotice]);

  const end = useCallback(() => { commit(null, null); }, [commit]);
  const retrySave = useCallback(() => { commit(stateRef.current.itinerary, stateRef.current.notice); }, [commit]);
  const dismissUnsaved = useCallback(() => {
    const current = stateRef.current;
    if (current.itinerary || current.owner !== ownerRef.current) return;
    const cleared: State = { ...current, save: "saved", notice: null };
    stateRef.current = cleared;
    setState(cleared);
  }, []);

  // The outgoing owner's review is never rendered under the incoming owner, not even for the one
  // render before the load effect runs.
  const visible = state.owner === owner ? state : { owner, loaded: false, itinerary: null, save: "saved" as const, notice: null };
  const itinerary = visible.itinerary;

  const derived = useMemo(() => {
    if (!itinerary) {
      return { current: null, currentAvailability: null, currentMark: null, nextSymbol: null, summary: null, drift: { added: [], removed: [] }, listMissing: false, canPrev: false, canNext: false };
    }
    const members = listsReady ? new Set((lists[itinerary.listName] ?? []).map((row) => row.symbol)) : null;
    const availabilityOf = (symbol: string) => resolveAvailability(symbol, { liveMembers: members, manifestSymbols });
    const current = currentSymbol(itinerary);
    const liveOrder = listsReady ? liveListOrder(lists[itinerary.listName], listMeta[itinerary.listName]?.sections ?? []) : null;
    return {
      current,
      currentAvailability: current ? availabilityOf(current) : null,
      currentMark: current ? itinerary.marks[current] ?? null : null,
      nextSymbol: peekNext(itinerary, availabilityOf),
      summary: summarizeItinerary(itinerary, availabilityOf),
      drift: listsReady && lists[itinerary.listName] ? itineraryDrift(itinerary, liveOrder) : { added: [], removed: [] },
      listMissing: listsReady && !lists[itinerary.listName],
      canPrev: !!stepItinerary(itinerary, -1, availabilityOf, itinerary.updatedAt),
      canNext: peekNext(itinerary, availabilityOf) !== null,
    };
  }, [itinerary, lists, listMeta, listsReady, manifestSymbols]);

  return {
    loaded: visible.loaded,
    itinerary,
    save: visible.save,
    notice: visible.notice,
    ...derived,
    start, resume, next, prev, toggleReviewed, defer, clearMark, refresh, end, retrySave, dismissUnsaved,
  };
}
