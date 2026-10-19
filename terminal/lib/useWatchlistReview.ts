"use client";

/**
 * useWatchlistReview — the shell-side owner of ONE frozen watchlist review (E16).
 *
 * The hook holds no navigation of its own: moving to a symbol calls the shell's `navigate`
 * (TerminalShell's `pick`), the same path a watchlist row click takes. That path feeds the Chart
 * Bus and the #821 Workspace Context Session, so linked panels follow and pinned / local panels
 * keep their own security. There is no second context session and no timer.
 *
 * Writes happen only inside user actions, exactly one per action, computed from a ref so a burst of
 * Next presses inside one frame advances one step per press instead of re-using a stale render. The
 * owner the record was LOADED for is captured with it: a write never lands in another owner's slot,
 * and an owner change hides the outgoing owner's review in the same render.
 *
 * Revision check: the hook remembers the stamp (start time, revision, last update) of the record it
 * last read or wrote. Before a write, and before Resume moves the chart, it re-reads the saved
 * record. If another tab has moved, refreshed, restarted or ended the review since, this tab adopts
 * the saved record (and shows its current symbol) and says so instead of writing an older position
 * over it.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { browserStorage } from "@/lib/ownerStorage";
import {
  currentSymbol, isSkipped, itineraryDrift, liveListOrder, markEntry, peekNext, peekPrev, readReview, refreshItinerary,
  renameItinerary, resolveAvailability, reviewStamp, startItinerary, stepItinerary, summarizeItinerary, writeReview,
  type EntryAvailability, type ItinerarySummary, type ReviewItinerary, type ReviewMark,
} from "@/lib/watchlistReview";

export type ReviewSave = "saved" | "unsaved";
export type ReviewNotice =
  | { kind: "skipped"; entries: { symbol: string; availability: EntryAvailability }[] }
  | { kind: "edge"; direction: 1 | -1 }
  | { kind: "empty"; listName: string }
  /** Another tab changed the saved review; this tab now shows the saved one (or none, if ended). */
  | { kind: "moved"; ended: boolean }
  | { kind: "discardFailed" }
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

type State = {
  owner: string;
  loaded: boolean;
  itinerary: ReviewItinerary | null;
  save: ReviewSave;
  notice: ReviewNotice;
  /** A saved record exists for this owner (or the store refused the read) but it could not be read. */
  unreadable: boolean;
  /** `reviewStamp` of the saved record as this tab last read or wrote it. */
  base: string | null;
};

export type WatchlistReview = {
  loaded: boolean;
  itinerary: ReviewItinerary | null;
  save: ReviewSave;
  notice: ReviewNotice;
  /** The saved review could not be read. Shown before a new start replaces it. */
  unreadable: boolean;
  current: string | null;
  currentAvailability: EntryAvailability | null;
  currentMark: ReviewMark | null;
  /** Where Next would land, in the frozen order; null at the end. */
  nextSymbol: string | null;
  /** Where Previous would land, in the frozen order; null at the start. Same skip rules. */
  prevSymbol: string | null;
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
  /** Remove a saved review that could not be read. */
  discardUnreadable: () => void;
  /** The user renamed a list; a review of it follows the new name. */
  renameList: (from: string, to: string) => void;
};

const now = () => Date.now();

export function useWatchlistReview(inputs: WatchlistReviewInputs): WatchlistReview {
  const { owner, lists, listMeta, listsReady, manifestSymbols } = inputs;
  const [state, setState] = useState<State>(() => ({ owner, loaded: false, itinerary: null, save: "saved", notice: null, unreadable: false, base: null }));
  const stateRef = useRef(state);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  // Load this owner's review. A layout effect (not render) because storage is client-only and the
  // server render has no review; not a passive effect, so the bar never paints a frame late.
  useLayoutEffect(() => {
    const read = readReview(browserStorage(), owner);
    const itinerary = read.status === "ok" ? read.itinerary : null;
    const loaded: State = { owner, loaded: true, itinerary, save: "saved", notice: null, unreadable: read.status === "unreadable", base: reviewStamp(itinerary) };
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

  /**
   * The revision check. When the saved record is no longer the one this tab last read or wrote
   * (another tab moved, refreshed, restarted or ended the review), adopt it and return true. An
   * unreadable record is not a newer review, so it does not count as moved.
   */
  const adoptIfMoved = useCallback((): boolean => {
    const current = stateRef.current;
    const read = readReview(browserStorage(), current.owner);
    if (read.status === "unreadable") return false;
    const saved = read.status === "ok" ? read.itinerary : null;
    const stamp = reviewStamp(saved);
    if (stamp === current.base) return false;
    const adopted: State = { ...current, itinerary: saved, base: stamp, save: "saved", unreadable: false, notice: { kind: "moved", ended: !saved } };
    stateRef.current = adopted;
    setState(adopted);
    return true;
  }, []);

  /**
   * The single write path. Returns false (and writes nothing) when the owner moved underneath, or
   * when another tab changed the saved review (it is adopted, and its current symbol shown, instead).
   * `replace` is for Start only: starting a review deliberately replaces whatever is saved.
   */
  const commit = useCallback((itinerary: ReviewItinerary | null, notice: ReviewNotice, replace = false): boolean => {
    const current = stateRef.current;
    if (!current.loaded || current.owner !== ownerRef.current) return false;
    if (!replace && adoptIfMoved()) { go(stateRef.current.itinerary); return false; }
    const ok = writeReview(browserStorage(), current.owner, itinerary);
    const next: State = {
      ...current,
      itinerary,
      notice,
      save: ok ? "saved" : "unsaved",
      unreadable: ok ? false : current.unreadable,
      base: ok ? reviewStamp(itinerary) : current.base,
    };
    stateRef.current = next;
    setState(next);
    return true;
  }, [adoptIfMoved, go]);

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
    if (commit(itinerary, null, true)) go(itinerary);
  }, [availabilityFor, commit, go, liveOrderFor, setNotice]);

  /** Show the review's current symbol. Checks the saved revision first, so it never resumes a stale place. */
  const resume = useCallback(() => {
    if (!stateRef.current.loaded || stateRef.current.owner !== ownerRef.current) return;
    adoptIfMoved();
    go(stateRef.current.itinerary);
  }, [adoptIfMoved, go]);

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
  const discardUnreadable = useCallback(() => {
    const current = stateRef.current;
    if (!current.loaded || current.owner !== ownerRef.current || current.itinerary || !current.unreadable) return;
    const ok = writeReview(browserStorage(), current.owner, null);
    const next: State = ok ? { ...current, unreadable: false, base: null, notice: null } : { ...current, notice: { kind: "discardFailed" } };
    stateRef.current = next;
    setState(next);
  }, []);
  const renameList = useCallback((from: string, to: string) => {
    const itinerary = stateRef.current.itinerary;
    if (!itinerary || itinerary.listName !== from || stateRef.current.owner !== ownerRef.current) return;
    const renamed = renameItinerary(itinerary, to, now());
    if (renamed) commit(renamed, stateRef.current.notice);
  }, [commit]);

  // The outgoing owner's review is never rendered under the incoming owner, not even for the one
  // render before the load effect runs.
  const visible: State = state.owner === owner ? state : { owner, loaded: false, itinerary: null, save: "saved", notice: null, unreadable: false, base: null };
  const itinerary = visible.itinerary;

  const derived = useMemo(() => {
    if (!itinerary) {
      return { current: null, currentAvailability: null, currentMark: null, nextSymbol: null, prevSymbol: null, summary: null, drift: { added: [], removed: [] }, listMissing: false, canPrev: false, canNext: false };
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
      prevSymbol: peekPrev(itinerary, availabilityOf),
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
    unreadable: visible.unreadable,
    ...derived,
    start, resume, next, prev, toggleReviewed, defer, clearMark, refresh, end, retrySave, dismissUnsaved, discardUnreadable, renameList,
  };
}
