import { describe, expect, it } from "vitest";
import { turnFirstKnown } from "../sectorCycleTurnKnowledge";

/* v1.1 SP11: a pivot is dated by its event; it became knowable only at
 * confirmation (lane 8 scores transition time on confirmed_at, never the
 * pivot date). The two dates are distinct facts and never conflated.
 * FIXTURE feeds throughout. */

const row = (turns: unknown[], id = "xlk") => ({ id, kind: "sector", ticker: "XLK", turns });

describe("turn first-known dates (SP11, FIXTURE feeds)", () => {
  it("maps each event date to its distinct first-known date", () => {
    const map = turnFirstKnown({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([
          { date: "2026-06-01", k: "trough", known_since: "2026-06-04" },
          { date: "2026-08-10", k: "peak", known_since: "2026-08-12" },
        ]),
      ],
    });
    expect(map).toEqual({ "2026-06-01": "2026-06-04", "2026-08-10": "2026-08-12" });
  });

  it("never conflates: first-known must be strictly after the pivot and not past the feed", () => {
    const map = turnFirstKnown({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([
          { date: "2026-06-01", k: "trough", known_since: "2026-06-01" }, // same day — refused
          { date: "2026-08-10", k: "peak", known_since: "2026-05-01" }, // before the pivot — refused
          { date: "2026-09-01", k: "trough", known_since: "2026-10-30" }, // asOf day — kept
          { date: "2026-09-20", k: "peak", known_since: "2026-10-31" }, // after the feed — refused
        ]),
      ],
    });
    expect(map).toEqual({ "2026-09-01": "2026-10-30" });
  });

  it("drops absent or malformed dates; an unconfirmed turn carries no claim", () => {
    const map = turnFirstKnown({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([
          { date: "2026-06-01", k: "trough" }, // no known_since (e.g. provisional)
          { date: "not-a-date", k: "peak", known_since: "2026-07-01" },
          { date: "2026-08-01", k: "peak", known_since: "yesterday" },
        ]),
      ],
    });
    expect(map).toEqual({});
  });

  it("conflicting claims across rows drop the date rather than guessing", () => {
    const map = turnFirstKnown({
      meta: { asOf: "2026-10-30" },
      sectors: [
        row([{ date: "2026-06-01", k: "trough", known_since: "2026-06-04" }], "xlk"),
        row([{ date: "2026-06-01", k: "trough", known_since: "2026-06-05" }], "xlf"),
        // A later matching row cannot resurrect a conflicted date.
        row([{ date: "2026-06-01", k: "trough", known_since: "2026-06-04" }], "xle"),
        row([{ date: "2026-08-01", k: "peak", known_since: "2026-08-03" }], "xlh"),
        row([{ date: "2026-08-01", k: "peak", known_since: "2026-08-03" }], "xly"),
      ],
    });
    expect(map).toEqual({ "2026-08-01": "2026-08-03" });
  });

  it("a feed without a valid asOf still keeps the strictly-after rule", () => {
    const map = turnFirstKnown({
      sectors: [row([{ date: "2026-06-01", k: "trough", known_since: "2026-06-02" }])],
    });
    expect(map).toEqual({ "2026-06-01": "2026-06-02" });
  });
});
