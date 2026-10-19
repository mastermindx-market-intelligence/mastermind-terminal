import { describe, expect, it } from "vitest";
import {
  WL_REVIEW_KEY, currentSymbol, isSkipped, itineraryDrift, liveListOrder, markEntry, parseItinerary, peekNext,
  readReview, refreshItinerary, renameItinerary, resolveAvailability, reviewStamp, startItinerary, stepItinerary,
  summarizeItinerary, writeReview,
  type AvailabilityOf, type ReviewItinerary,
} from "@/lib/watchlistReview";
import type { StoragePort } from "@/lib/ownerStorage";

const T0 = 1_760_000_000_000;
const MANIFEST = { AAPL: {}, MSFT: {}, NVDA: {}, TSLA: {}, AMZN: {} } as const;

function memoryStorage(seed: Record<string, string> = {}): StoragePort & { data: Record<string, string>; writes: number; fail: boolean } {
  const store = {
    data: { ...seed },
    writes: 0,
    fail: false,
    getItem(key: string) { return key in store.data ? store.data[key] : null; },
    setItem(key: string, value: string) {
      store.writes++;
      if (store.fail) throw new Error("QuotaExceededError");
      store.data[key] = value;
    },
    removeItem(key: string) { store.writes++; if (store.fail) throw new Error("blocked"); delete store.data[key]; },
  };
  return store;
}

const availability = (members: readonly string[] | null, manifest: Record<string, unknown> | null = MANIFEST): AvailabilityOf =>
  (symbol) => resolveAvailability(symbol, { liveMembers: members ? new Set(members) : null, manifestSymbols: manifest });

function started(order: readonly string[], avail: AvailabilityOf = availability(order)): ReviewItinerary {
  const itinerary = startItinerary("Tech", order, avail, T0);
  if (!itinerary) throw new Error("expected an itinerary");
  return itinerary;
}

describe("E16 frozen order — AC-E16-01 and the falsifier", () => {
  it("a background re-sort of the live list does not change the next symbol", () => {
    const frozen = ["NVDA", "TSLA", "AAPL", "MSFT"];
    let review = started(frozen);
    expect(currentSymbol(review)).toBe("NVDA");

    // The live list is re-ranked by quotes / sorted A→Z after the review started. Same members.
    const resorted = [...frozen].sort();
    const avail = availability(resorted);
    expect(peekNext(review, avail)).toBe("TSLA");
    review = stepItinerary(review, 1, avail, T0 + 1)!.itinerary;
    expect(currentSymbol(review)).toBe("TSLA");
    review = stepItinerary(review, 1, avail, T0 + 2)!.itinerary;
    expect(currentSymbol(review)).toBe("AAPL");
    // Membership did not change, so nothing is reported as drift either.
    expect(itineraryDrift(review, resorted)).toEqual({ added: [], removed: [] });
  });

  it("only an explicit refresh adopts the live order, and it keeps the cursor on the same symbol", () => {
    const review = { ...started(["NVDA", "TSLA", "AAPL", "MSFT"]), cursor: 1 };
    const live = ["AAPL", "MSFT", "NVDA", "TSLA"];
    const refreshed = refreshItinerary(review, live, availability(live), T0 + 5)!;
    expect(refreshed.symbols).toEqual(live);
    expect(currentSymbol(refreshed)).toBe("TSLA");
    expect(refreshed.revision).toBe(review.revision + 1);
    expect(peekNext(refreshed, availability(live))).toBeNull();
  });

  it("refresh keeps markers for symbols still listed and drops the rest", () => {
    let review = started(["NVDA", "TSLA", "AAPL"]);
    review = markEntry(review, "NVDA", { state: "reviewed" }, T0 + 1)!;
    review = markEntry(review, "TSLA", { state: "deferred", note: "after earnings" }, T0 + 2)!;
    const live = ["NVDA", "AAPL", "AMZN"];
    const refreshed = refreshItinerary(review, live, availability(live), T0 + 3)!;
    expect(refreshed.marks).toEqual({ NVDA: review.marks.NVDA });
    // The cursor symbol (NVDA) is still listed, so the cursor follows it.
    expect(currentSymbol(refreshed)).toBe("NVDA");
  });

  it("a refresh whose cursor symbol left the list continues from the old position, mapped into the live order", () => {
    let review = { ...started(["NVDA", "TSLA", "AAPL", "MSFT"]), cursor: 1 };
    review = markEntry(review, "NVDA", { state: "reviewed" }, T0 + 1)!;
    // TSLA (the cursor) left. The frozen successor is AAPL, wherever the live order now puts it.
    const live = ["NVDA", "AAPL", "MSFT"];
    expect(currentSymbol(refreshItinerary(review, live, availability(live), T0 + 2)!)).toBe("AAPL");
    const live2 = ["NVDA", "MSFT", "AAPL"];
    const refreshed2 = refreshItinerary(review, live2, availability(live2), T0 + 2)!;
    expect(currentSymbol(refreshed2)).toBe("AAPL");
    expect(refreshed2.cursor).toBe(2);
  });

  it("a refresh deep in the review does not send the cursor back to the top", () => {
    // Reviewing MSFT, fourth of five, nothing marked yet. MSFT leaves the list.
    const review = { ...started(["NVDA", "TSLA", "AAPL", "MSFT", "AMZN"]), cursor: 3 };
    const live = ["NVDA", "TSLA", "AAPL", "AMZN"];
    const refreshed = refreshItinerary(review, live, availability(live), T0 + 1)!;
    expect(currentSymbol(refreshed)).toBe("AMZN");
    expect(currentSymbol(refreshed)).not.toBe("NVDA");
  });

  it("the old-position successor skips symbols that are no longer reviewable", () => {
    // Reviewing AAPL. AAPL leaves; its frozen successor ZZZQ has no market data, so MSFT is next.
    const review = { ...started(["NVDA", "TSLA", "AAPL", "ZZZQ", "MSFT"]), cursor: 2 };
    const live = ["NVDA", "TSLA", "ZZZQ", "MSFT"];
    expect(currentSymbol(refreshItinerary(review, live, availability(live), T0 + 1)!)).toBe("MSFT");
  });

  it("falls back to the top only when nothing reviewable is left at or after the old position", () => {
    let review = { ...started(["NVDA", "TSLA", "AAPL"]), cursor: 2 };
    review = markEntry(review, "NVDA", { state: "reviewed" }, T0 + 1)!;
    const live = ["NVDA", "TSLA"];
    // Nothing after AAPL: the first unmarked available symbol.
    expect(currentSymbol(refreshItinerary(review, live, availability(live), T0 + 2)!)).toBe("TSLA");
    // Everything marked: the first available symbol.
    const allMarked = markEntry(review, "TSLA", { state: "reviewed" }, T0 + 3)!;
    expect(currentSymbol(refreshItinerary(allMarked, live, availability(live), T0 + 4)!)).toBe("NVDA");
  });
});

describe("E16 availability — AC-E16-02", () => {
  it("resolves removed, missing, unknown and available without guessing", () => {
    expect(resolveAvailability("NVDA", { liveMembers: new Set(["NVDA"]), manifestSymbols: MANIFEST })).toBe("available");
    expect(resolveAvailability("NVDA", { liveMembers: new Set(["AAPL"]), manifestSymbols: MANIFEST })).toBe("removed");
    expect(resolveAvailability("ZZZQ", { liveMembers: new Set(["ZZZQ"]), manifestSymbols: MANIFEST })).toBe("missing");
    // Manifest not loaded: unknown, never "available" and never "missing".
    expect(resolveAvailability("ZZZQ", { liveMembers: new Set(["ZZZQ"]), manifestSymbols: null })).toBe("unknown");
    // Lists not restored yet: membership unknown, so nothing is reported removed.
    expect(resolveAvailability("NVDA", { liveMembers: null, manifestSymbols: MANIFEST })).toBe("available");
    // Composites are available only when every leg has data.
    expect(resolveAvailability("NVDA+AAPL", { liveMembers: null, manifestSymbols: MANIFEST })).toBe("available");
    expect(resolveAvailability("NVDA+ZZZQ", { liveMembers: null, manifestSymbols: MANIFEST })).toBe("missing");
    expect(isSkipped("unknown")).toBe(false);
  });

  it("skips removed and missing symbols explicitly and never substitutes a neighbour", () => {
    const frozen = ["NVDA", "ZZZQ", "TSLA", "AAPL", "MSFT"];
    let review = started(frozen);
    // TSLA leaves the list after the review starts.
    const live = ["NVDA", "ZZZQ", "AAPL", "MSFT"];
    const avail = availability(live);
    const step = stepItinerary(review, 1, avail, T0 + 1)!;
    expect(currentSymbol(step.itinerary)).toBe("AAPL");
    expect(step.skipped).toEqual([
      { symbol: "ZZZQ", availability: "missing" },
      { symbol: "TSLA", availability: "removed" },
    ]);
    review = step.itinerary;
    const back = stepItinerary(review, -1, avail, T0 + 2)!;
    expect(currentSymbol(back.itinerary)).toBe("NVDA");
    expect(back.skipped.map((entry) => entry.symbol)).toEqual(["TSLA", "ZZZQ"]);
  });

  it("stops at either end instead of wrapping, and reports it by returning null", () => {
    const review = started(["NVDA", "AAPL"]);
    expect(stepItinerary(review, -1, availability(["NVDA", "AAPL"]), T0)).toBeNull();
    const last = { ...review, cursor: 1 };
    expect(stepItinerary(last, 1, availability(["NVDA", "AAPL"]), T0)).toBeNull();
    // Trailing unavailable entries do not count as "more to review".
    const trailing = started(["NVDA", "ZZZQ"]);
    expect(stepItinerary(trailing, 1, availability(["NVDA", "ZZZQ"]), T0)).toBeNull();
  });

  it("starts on the first available symbol", () => {
    const review = started(["ZZZQ", "NVDA", "AAPL"]);
    expect(currentSymbol(review)).toBe("NVDA");
    expect(startItinerary("Empty", [], availability([]), T0)).toBeNull();
  });

  it("an unknown entry stays navigable while the manifest is loading", () => {
    const review = started(["NVDA", "ZZZQ", "AAPL"], availability(null, null));
    const step = stepItinerary(review, 1, availability(null, null), T0 + 1)!;
    expect(currentSymbol(step.itinerary)).toBe("ZZZQ");
    expect(step.skipped).toEqual([]);
  });

  it("counts a mixed list honestly", () => {
    let review = started(["NVDA", "ZZZQ", "TSLA", "AAPL"]);
    review = markEntry(review, "NVDA", { state: "reviewed" }, T0 + 1)!;
    review = markEntry(review, "AAPL", { state: "deferred", note: "  wait for guidance  " }, T0 + 2)!;
    const summary = summarizeItinerary(review, availability(["NVDA", "ZZZQ", "AAPL"]));
    expect(summary).toEqual({ total: 4, position: 1, reviewed: 1, deferred: 1, unavailable: 2, unknown: 0 });
    expect(review.marks.AAPL.note).toBe("wait for guidance");
  });
});

describe("E16 markers — AC-E16-04", () => {
  it("live only on the itinerary and refuse symbols outside it", () => {
    const review = started(["NVDA", "AAPL"]);
    expect(markEntry(review, "TSLA", { state: "reviewed" }, T0)).toBeNull();
    const marked = markEntry(review, "NVDA", { state: "reviewed", note: "ignored for reviewed" }, T0)!;
    expect(marked.marks.NVDA).toEqual({ state: "reviewed", at: T0 });
    expect(markEntry(marked, "NVDA", null, T0)!.marks).toEqual({});
    // Membership and order are untouched by a marker.
    expect(marked.symbols).toEqual(review.symbols);
  });

  it("writing a review touches only its own key", () => {
    const storage = memoryStorage({
      "mm.flags.v2": JSON.stringify({ guest: { NVDA: "red" } }),
      "mm.symbolNotes.v2": JSON.stringify({ guest: { NVDA: "my note" } }),
      "mm.wls.v2": JSON.stringify({ guest: { lists: { Tech: [{ symbol: "NVDA", section: "" }] } } }),
    });
    const before = { ...storage.data };
    const review = markEntry(started(["NVDA"]), "NVDA", { state: "deferred", note: "x" }, T0)!;
    expect(writeReview(storage, "guest", review)).toBe(true);
    for (const key of Object.keys(before)) expect(storage.data[key]).toBe(before[key]);
    expect(Object.keys(storage.data).sort()).toEqual([...Object.keys(before), WL_REVIEW_KEY].sort());
  });
});

describe("E16 persistence — AC-E16-05", () => {
  it("is owner scoped: one owner's review is unreadable by another and survives their writes", () => {
    const storage = memoryStorage();
    const mine = started(["NVDA", "AAPL"]);
    const theirs = { ...started(["TSLA"]), listName: "Other" };
    expect(writeReview(storage, "account:a", mine)).toBe(true);
    expect(writeReview(storage, "account:b", theirs)).toBe(true);
    expect(readReview(storage, "account:a")).toEqual({ status: "ok", itinerary: mine });
    expect(readReview(storage, "account:b")).toEqual({ status: "ok", itinerary: theirs });
    expect(readReview(storage, "guest")).toEqual({ status: "absent" });
    expect(writeReview(storage, "account:b", null)).toBe(true);
    expect(readReview(storage, "account:a")).toEqual({ status: "ok", itinerary: mine });
    expect(readReview(storage, "account:b")).toEqual({ status: "absent" });
  });

  it("reports a failed write so the UI can say 'not saved'", () => {
    const storage = memoryStorage();
    storage.fail = true;
    expect(writeReview(storage, "guest", started(["NVDA"]))).toBe(false);
    expect(writeReview(null, "guest", started(["NVDA"]))).toBe(false);
    expect(readReview(storage, "guest")).toEqual({ status: "absent" });
  });

  it("tells an absent review apart from one that cannot be read", () => {
    const good = started(["NVDA", "AAPL"]);
    const slot = (value: unknown) => memoryStorage({ [WL_REVIEW_KEY]: JSON.stringify({ guest: value }) });
    expect(readReview(memoryStorage(), "guest")).toEqual({ status: "absent" });
    expect(readReview(memoryStorage({ [WL_REVIEW_KEY]: "" }), "guest")).toEqual({ status: "absent" });
    // Another owner's slot is not this owner's record.
    expect(readReview(memoryStorage({ [WL_REVIEW_KEY]: JSON.stringify({ "account:b": good }) }), "guest")).toEqual({ status: "absent" });
    expect(readReview(slot(good), "guest")).toEqual({ status: "ok", itinerary: good });
    // Unreadable: the store refuses, the envelope is not JSON or not an object, the slot is malformed or a newer format.
    const refusing: StoragePort = { getItem() { throw new Error("SecurityError"); }, setItem() {}, removeItem() {} };
    expect(readReview(refusing, "guest")).toEqual({ status: "unreadable" });
    expect(readReview(null, "guest")).toEqual({ status: "unreadable" });
    expect(readReview(memoryStorage({ [WL_REVIEW_KEY]: "{not json" }), "guest")).toEqual({ status: "unreadable" });
    expect(readReview(memoryStorage({ [WL_REVIEW_KEY]: "[1,2]" }), "guest")).toEqual({ status: "unreadable" });
    expect(readReview(slot({ ...good, cursor: 9 }), "guest")).toEqual({ status: "unreadable" });
    expect(readReview(slot({ ...good, v: 2 }), "guest")).toEqual({ status: "unreadable" });
    expect(readReview(slot(null), "guest")).toEqual({ status: "unreadable" });
  });

  it("stamps a review by start, revision and last update", () => {
    const review = started(["NVDA", "AAPL"]);
    expect(reviewStamp(null)).toBeNull();
    const stepped = stepItinerary(review, 1, availability(["NVDA", "AAPL"]), T0 + 1)!.itinerary;
    expect(reviewStamp(stepped)).not.toBe(reviewStamp(review));
    // The stamp survives a JSON round-trip, so a tab never mistakes its own write for another tab's.
    expect(reviewStamp(review)).toBe(reviewStamp(JSON.parse(JSON.stringify(review))));
  });

  it("follows a list rename without changing position or markers", () => {
    const review = markEntry({ ...started(["NVDA", "AAPL"]), cursor: 1 }, "NVDA", { state: "reviewed" }, T0 + 1)!;
    const renamed = renameItinerary(review, "  Semis  ", T0 + 2)!;
    expect(renamed).toEqual({ ...review, listName: "Semis", updatedAt: T0 + 2 });
    expect(renameItinerary(review, "Tech", T0 + 2)).toBeNull();
    expect(renameItinerary(review, "   ", T0 + 2)).toBeNull();
  });

  it("rejects malformed records instead of repairing them into a review", () => {
    const good = started(["NVDA", "AAPL"]);
    expect(parseItinerary(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(parseItinerary({ ...good, v: 2 })).toBeNull();
    expect(parseItinerary({ ...good, cursor: 2 })).toBeNull();
    expect(parseItinerary({ ...good, symbols: ["NVDA", "NVDA"] })).toBeNull();
    expect(parseItinerary({ ...good, marks: { TSLA: { state: "reviewed", at: T0 } } })).toBeNull();
    expect(parseItinerary({ ...good, marks: { NVDA: { state: "bought", at: T0 } } })).toBeNull();
    expect(parseItinerary({ ...good, marks: { NVDA: { state: "deferred", at: T0, note: "x".repeat(281) } } })).toBeNull();
    expect(parseItinerary(null)).toBeNull();
  });
});

describe("liveListOrder", () => {
  it("follows the rail's section order and includes collapsed sections", () => {
    const rows = [
      { symbol: "AAPL", section: "Tech" },
      { symbol: "BTC-USD", section: "Crypto" },
      { symbol: "SPY", section: "" },
      { symbol: "NVDA", section: "Tech" },
    ];
    expect(liveListOrder(rows, ["Crypto", "Tech"])).toEqual(["SPY", "BTC-USD", "AAPL", "NVDA"]);
    expect(liveListOrder(undefined)).toEqual([]);
  });
});
