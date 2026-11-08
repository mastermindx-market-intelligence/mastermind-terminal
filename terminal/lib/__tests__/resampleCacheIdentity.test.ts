// The aggregation memo must not outlive its source.
//
// `resampleTfCached` was keyed `symbol::timeframe` and evicted only when the SYMBOL changed. That
// key says nothing about which OHLC the entry was aggregated from, so any same-symbol correction —
// a revalidated document, a repaired bar, a re-cut history — kept being served its predecessor's
// bars for as long as the tab lived. The chart would then be drawing one generation of data while
// every date-joined consumer read another.
//
// The entry now carries the source generation it was built from (the fetched document's own `bars`
// array) and the session anchor that phased it.

import { describe, it, expect, beforeEach } from "vitest";
import { resampleTfCached, clearResampleCache } from "@/components/ChartPanel";
import type { SessionAnchor } from "@/lib/sessionBars";

type Bar = { time: string; o: number; h: number; l: number; c: number; v: number };

/** Nine sessions, ascending, distinct bodies. */
function makeBars(closes: number[], start = 1): Bar[] {
  return closes.map((c, i) => ({
    time: `2024-03-${String(start + i).padStart(2, "0")}`,
    o: c - 1, h: c + 1, l: c - 2, c, v: 100 + i,
  }));
}

const SRC_A = Symbol("document-generation-A");
const SRC_B = Symbol("document-generation-B");

describe("resampleTfCached identity", () => {
  beforeEach(() => clearResampleCache());

  it("reuses the aggregation while the source document is the same object", () => {
    const rows = makeBars([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const first = resampleTfCached(rows, "3D", "NVDA", SRC_A, null);
    // A D→W→D style round trip re-derives the same array from the same cached document.
    const second = resampleTfCached(rows.map((r) => ({ ...r })), "3D", "NVDA", SRC_A, null);
    expect(second).toBe(first);            // identity: the O(N) pass was genuinely skipped
  });

  it("a CORRECTED document for the same symbol and timeframe never gets the stale aggregation", () => {
    const original = makeBars([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const before = resampleTfCached(original, "3D", "NVDA", SRC_A, null);

    // The repair the old key could not see: same symbol, same timeframe, same bar COUNT, same
    // first and last session, same last close — only a mid-history bar was corrected. A content
    // fingerprint of length/endpoints would have called this unchanged.
    const corrected = makeBars([10, 11, 12, 13, 999, 15, 16, 17, 18]);
    expect(corrected.length).toBe(original.length);
    expect(corrected[0].time).toBe(original[0].time);
    expect(corrected[corrected.length - 1].time).toBe(original[original.length - 1].time);
    expect(corrected[corrected.length - 1].c).toBe(original[original.length - 1].c);

    const after = resampleTfCached(corrected, "3D", "NVDA", SRC_B, null);
    expect(after).not.toBe(before);
    // …and the correction actually reached the drawn bars.
    expect(after.some((b) => b.h === 1000)).toBe(true);
    expect(before.some((b) => b.h === 1000)).toBe(false);
  });

  it("a re-phased grid never gets the aggregation built under the old anchor", () => {
    const rows = makeBars([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const unanchored = resampleTfCached(rows, "3D", "NVDA", SRC_A, null);
    // Same symbol, same timeframe, SAME source document — but the published anchor now says this
    // feed starts on a different global session, which is a different grid.
    const anchor: SessionAnchor = { v: 1, date: rows[0].time, index: 7, basis: "ipo" };
    const anchored = resampleTfCached(rows, "3D", "NVDA", SRC_A, anchor);
    expect(anchored).not.toBe(unanchored);
    expect(anchored.map((b) => b.time)).not.toEqual(unanchored.map((b) => b.time));
  });

  it("still evicts on symbol change, and only the named symbol's entries", () => {
    const rows = makeBars([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const nvda = resampleTfCached(rows, "3D", "NVDA", SRC_A, null);
    const aapl = resampleTfCached(rows, "3D", "AAPL", SRC_A, null);
    clearResampleCache("NVDA");
    expect(resampleTfCached(rows, "3D", "NVDA", SRC_A, null)).not.toBe(nvda);
    expect(resampleTfCached(rows, "3D", "AAPL", SRC_A, null)).toBe(aapl);
  });

  it("keeps separate entries per timeframe", () => {
    const rows = makeBars([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const three = resampleTfCached(rows, "3D", "NVDA", SRC_A, null);
    const two = resampleTfCached(rows, "2D", "NVDA", SRC_A, null);
    expect(two).not.toBe(three);
    expect(resampleTfCached(rows, "3D", "NVDA", SRC_A, null)).toBe(three);
  });
});
