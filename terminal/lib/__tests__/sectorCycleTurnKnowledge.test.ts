import { describe, expect, it } from "vitest";
import {
  firstKnownAt,
  seriesFirstKnown,
  turnFirstKnownIndex,
} from "../sectorCycleTurnKnowledge";

/* v1.1 SP11: a pivot is dated by its event; it became knowable only at
 * confirmation — the producer's field is `confirmed_at` (engine/
 * sector_heads.py: the transition-time head scores "the next turn becomes
 * first-known (confirmed_at, not pivot date)"). Confirmation is a
 * PER-SERIES fact: dates are keyed by (series id, event date, turn kind),
 * and only the selected series' map is ever handed to a chart. The two
 * dates are distinct facts and never conflated. FIXTURE feeds throughout. */

const row = (turns: unknown[], id = "xlk") => ({ id, kind: "sector", ticker: "XLK", turns });

describe("turn first-known dates (SP11, FIXTURE feeds)", () => {
  it("indexes each series' confirmed_at under (series, event date, kind)", () => {
    const index = turnFirstKnownIndex({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([
          { date: "2026-06-01", k: "trough", provisional: false, confirmed_at: "2026-06-04" },
          { date: "2026-08-10", k: "peak", provisional: false, confirmed_at: "2026-08-12" },
        ]),
      ],
    });
    expect(seriesFirstKnown(index, "xlk")).toEqual({
      "2026-06-01#trough": "2026-06-04",
      "2026-08-10#peak": "2026-08-12",
    });
    // Another series' map never leaks into this one.
    expect(seriesFirstKnown(index, "xlf")).toEqual({});
  });

  it("B2: sector A's date never attaches to sector B's same-date turn", () => {
    // The reviewer's P9 shape: XLK confirms 2026-06-01; XLF has a provisional
    // peak on the SAME day; XLE's provisional turn carries a stray date; two
    // sectors confirm their own same-date pivots on different days.
    const index = turnFirstKnownIndex({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([{ date: "2026-06-01", k: "trough", provisional: false, confirmed_at: "2026-06-04" }], "xlk"),
        row([{ date: "2026-06-01", k: "peak", provisional: true }], "xlf"),
        row([{ date: "2026-07-01", k: "trough", provisional: true, confirmed_at: "2026-07-03" }], "xle"),
        row([{ date: "2026-08-01", k: "peak", provisional: false, confirmed_at: "2026-08-05" }], "xlu"),
        row([{ date: "2026-08-01", k: "peak", provisional: false, confirmed_at: "2026-08-07" }], "xlb"),
      ],
    });
    // XLK's own date, keyed per series.
    expect(firstKnownAt(seriesFirstKnown(index, "xlk"), "2026-06-01", "trough")).toBe("2026-06-04");
    // XLF's provisional turn never borrows XLK's date.
    expect(firstKnownAt(seriesFirstKnown(index, "xlf"), "2026-06-01", "peak")).toBeNull();
    expect(seriesFirstKnown(index, "xlf")).toEqual({});
    // Same-date turns in different series keep their OWN dates — no poisoning.
    expect(firstKnownAt(seriesFirstKnown(index, "xlu"), "2026-08-01", "peak")).toBe("2026-08-05");
    expect(firstKnownAt(seriesFirstKnown(index, "xlb"), "2026-08-01", "peak")).toBe("2026-08-07");
  });

  it("B2: a provisional turn never shows a first-known date, even if it carries one", () => {
    const index = turnFirstKnownIndex({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([
          { date: "2026-07-01", k: "trough", provisional: true, confirmed_at: "2026-07-03" },
          { date: "2026-07-05", k: "peak", provisional: false, confirmed_at: "2026-07-08" },
        ]),
      ],
    });
    const xlk = seriesFirstKnown(index, "xlk");
    expect(firstKnownAt(xlk, "2026-07-01", "trough")).toBeNull();
    expect(firstKnownAt(xlk, "2026-07-05", "peak")).toBe("2026-07-08");
  });

  it("S2: confirmed_at is the producer's field; known_since is not read", () => {
    const index = turnFirstKnownIndex({
      meta: { asOf: "2026-10-30" },
      sectors: [row([{ date: "2026-06-01", k: "trough", known_since: "2026-06-04" }])],
    });
    expect(seriesFirstKnown(index, "xlk")).toEqual({});
  });

  it("never conflates: confirmed must be strictly after the pivot and not past the feed", () => {
    const index = turnFirstKnownIndex({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([
          { date: "2026-06-01", k: "trough", provisional: false, confirmed_at: "2026-06-01" }, // same day — refused
          { date: "2026-08-10", k: "peak", provisional: false, confirmed_at: "2026-05-01" }, // before the pivot — refused
          { date: "2026-09-01", k: "trough", provisional: false, confirmed_at: "2026-10-30" }, // asOf day — kept
          { date: "2026-09-20", k: "peak", provisional: false, confirmed_at: "2026-10-31" }, // after the feed — refused
        ]),
      ],
    });
    expect(seriesFirstKnown(index, "xlk")).toEqual({ "2026-09-01#trough": "2026-10-30" });
  });

  it("drops absent or malformed dates; an unconfirmed turn carries no claim", () => {
    const index = turnFirstKnownIndex({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([
          { date: "2026-06-01", k: "trough", provisional: false }, // no confirmed_at
          { date: "not-a-date", k: "peak", provisional: false, confirmed_at: "2026-07-01" },
          { date: "2026-08-01", k: "peak", provisional: false, confirmed_at: "yesterday" },
        ]),
      ],
    });
    expect(seriesFirstKnown(index, "xlk")).toEqual({});
  });

  it("conflicting claims WITHIN one series drop that date; other series and other turns are untouched", () => {
    const index = turnFirstKnownIndex({
      meta: { asOf: "2026-10-30" },
      sectors: [
        // Two rows for the same series (same id) disagree on 06-01; agree later.
        row([{ date: "2026-06-01", k: "trough", provisional: false, confirmed_at: "2026-06-04" }], "xlk"),
        row(
          [
            { date: "2026-06-01", k: "trough", provisional: false, confirmed_at: "2026-06-05" }, // conflict — dropped
            { date: "2026-06-01", k: "peak", provisional: false, confirmed_at: "2026-06-03" }, // same date, other kind — kept
            { date: "2026-08-01", k: "peak", provisional: false, confirmed_at: "2026-08-03" },
          ],
          "xlk",
        ),
        // A different series' identical turn is unaffected by xlk's conflict.
        row([{ date: "2026-06-01", k: "trough", provisional: false, confirmed_at: "2026-06-04" }], "xlf"),
      ],
    });
    expect(seriesFirstKnown(index, "xlk")).toEqual({
      "2026-06-01#peak": "2026-06-03",
      "2026-08-01#peak": "2026-08-03",
    });
    expect(seriesFirstKnown(index, "xlf")).toEqual({ "2026-06-01#trough": "2026-06-04" });
  });

  it("NEW-3: a feed without a valid asOf keeps no date at all", () => {
    // The feed's own asOf vouches that every confirmation has happened; an
    // undated feed can vouch for nothing — not even a past-looking date.
    for (const meta of [undefined, {}, { asOf: "not-a-day" }, { asOf: 42 }]) {
      const index = turnFirstKnownIndex({
        meta,
        sectors: [row([{ date: "2026-06-01", k: "trough", provisional: false, confirmed_at: "2026-06-02" }])],
      });
      expect(seriesFirstKnown(index, "xlk"), JSON.stringify(meta)).toEqual({});
    }
  });

  it("NEW-3: only an explicit provisional:false counts as confirmed", () => {
    const index = turnFirstKnownIndex({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([
          { date: "2026-06-01", k: "trough", provisional: "true", confirmed_at: "2026-06-04" },
          { date: "2026-06-05", k: "peak", provisional: 1, confirmed_at: "2026-06-08" },
          { date: "2026-07-01", k: "trough", confirmed_at: "2026-07-04" }, // flag missing
          { date: "2026-07-05", k: "peak", provisional: false, confirmed_at: "2026-07-08" },
        ]),
      ],
    });
    expect(seriesFirstKnown(index, "xlk")).toEqual({ "2026-07-05#peak": "2026-07-08" });
  });

  it("NEW-3: a `__proto__` series id is an ordinary series on the null-prototype index", () => {
    const index = turnFirstKnownIndex({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([{ date: "2026-06-01", k: "trough", provisional: false, confirmed_at: "2026-06-04" }], "__proto__"),
        row([{ date: "2026-06-01", k: "trough", provisional: false, confirmed_at: "2026-06-05" }], "xlk"),
      ],
    });
    // The index has no prototype at all, and "__proto__" is a plain own key —
    // the id can neither mutate the index nor vanish through the setter.
    expect(Object.getPrototypeOf(index)).toBeNull();
    expect(Object.hasOwn(index, "__proto__")).toBe(true);
    expect(firstKnownAt(seriesFirstKnown(index, "__proto__"), "2026-06-01", "trough")).toBe("2026-06-04");
    // A normal series alongside is unaffected.
    expect(firstKnownAt(seriesFirstKnown(index, "xlk"), "2026-06-01", "trough")).toBe("2026-06-05");
  });

  it("own-property lookups only: inherited keys never answer", () => {
    const map = seriesFirstKnown(
      { xlk: { "2026-06-01#trough": "2026-06-04" } },
      "xlk",
    );
    expect(firstKnownAt(map, "toString", "trough")).toBeNull();
    expect(firstKnownAt(map, "constructor", "peak")).toBeNull();
    expect(seriesFirstKnown({ xlk: {} }, "__proto__")).toEqual({});
  });
});
