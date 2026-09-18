// THE DISCRIMINATOR — one 3D bar grid, proven against the engine that trades on it.
//
// The fixture is produced by `scripts/gen_session_bars_golden.py` FROM
// `signal_layer/confluence.py::_3d_groups`, the function every Golden Oracle 3D signal is
// computed on, and is re-derived from that same function by `tests/test_session_anchor.py`. So
// these assertions are not "the resampler agrees with itself": they are the browser being held
// to the engine's bars.
//
// What is asserted, per the mission's four facts:
//   bar MEMBERSHIP        — which sessions share a bar (not merely a formatted date string)
//   OPEN-session TIMESTAMP — the bar's key is its opening session (TradingView's 3D crosshair)
//   CLOSE-session availability — the bar also carries the session on which it completes
//   OHLC AGGREGATION      — first open, max high, min low, last close, summed volume
//
// …plus the truncation case that is the whole reason an anchor exists, and an explicit mutation
// guard: restoring feed-start `Math.floor(i / 3)` must turn this file red.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  dailyMultipleOf, parseSessionAnchor, resolveBarAnchor,
  sessionBarOpens, sessionToBarTime,
} from "../sessionBars";
import { resampleTf } from "@/components/ChartPanel";

type Row = [string, number, number, number, number, number];
type Golden = {
  holidays: string[];
  full: { barAnchor: number; bars: Row[] };
  expected: Record<string, { time: string; closeTime: string; sessions: string[]; o: number; h: number; l: number; c: number; v: number }[]>;
  truncated: {
    dropLeading: number;
    sessionAnchor: { v: number; date: string; index: number; basis: string };
    bars: Row[];
    expected: Golden["expected"];
  }[];
};

const golden: Golden = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures", "sessionBars3D.golden.json"), "utf8"),
);

const toBars = (rows: Row[]) =>
  rows.map((b) => ({ time: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));

describe("canonical session grid (lib/sessionBars)", () => {
  it("opens a bar the session AFTER one closes, phased by the global anchor", () => {
    // anchor 0: [0] [1,2,3] [4,5,6] … — a one-session partial, then triples. NOT floor(i/3).
    expect(sessionBarOpens(10, 3, 0)).toEqual([0, 1, 4, 7]);
    // anchor 2: row 0 is global session 2; the NEXT session (global 3) closes a bar, so the
    // second bar opens at row 2 — a phase the feed's own row index cannot produce.
    expect(sessionBarOpens(10, 3, 2)).toEqual([0, 2, 5, 8]);
    // anchor 1: row 0 is already an opening session → the first full bar spans rows 0-2.
    expect(sessionBarOpens(10, 3, 1)).toEqual([0, 3, 6, 9]);
    // the same rule at mult 2
    expect(sessionBarOpens(8, 2, 0)).toEqual([0, 1, 3, 5, 7]);
    expect(sessionBarOpens(8, 2, 1)).toEqual([0, 2, 4, 6]);
  });

  it("is NOT the feed-start floor(i / 3) grid", () => {
    const floorGrid = (n: number, mult: number) =>
      Array.from({ length: n }, (_, i) => i).filter((i) => i % mult === 0);
    expect(sessionBarOpens(30, 3, 0)).not.toEqual(floorGrid(30, 3));
    expect(sessionBarOpens(30, 3, 2)).not.toEqual(floorGrid(30, 3));
    // …and the one anchor where they DO coincide is a real, distinct phase, not the default.
    expect(sessionBarOpens(30, 3, 1)).toEqual(floorGrid(30, 3));
  });

  it("resolves a published anchor POINT into this array's row-0 anchor", () => {
    const times = golden.full.bars.map((b) => b[0]);
    const trunc = golden.truncated[0];
    // the anchor read against the rows it was written for
    expect(resolveBarAnchor(trunc.bars.map((b) => b[0]), trunc.sessionAnchor))
      .toBe(trunc.dropLeading);
    // …and against a feed later extended BACKWARDS to full history: same anchored session,
    // now at position `dropLeading`, so row 0 is global session 0.
    expect(resolveBarAnchor(times, trunc.sessionAnchor)).toBe(0);
    // an anchored session that is no longer in the rows is UNKNOWN, never invented
    expect(resolveBarAnchor(times, { date: "1999-01-04", index: 12 })).toBe(0);
    expect(resolveBarAnchor(times, null)).toBe(0);
  });

  it("rejects a malformed session_anchor instead of half-trusting it", () => {
    expect(parseSessionAnchor({ date: "2021-06-28", index: 5645, basis: "ipo", v: 1 }))
      .toEqual({ v: 1, date: "2021-06-28", index: 5645, basis: "ipo" });
    expect(parseSessionAnchor({ date: "2021-06-28" })).toBeNull();
    expect(parseSessionAnchor({ date: "28/06/2021", index: 3 })).toBeNull();
    expect(parseSessionAnchor({ date: "2021-06-28", index: 1.5 })).toBeNull();
    expect(parseSessionAnchor({ date: "2021-06-28", index: -4 })).toBeNull();
    expect(parseSessionAnchor(null)).toBeNull();
  });
});

describe("ChartPanel.resampleTf reproduces the canonical grid bar-for-bar", () => {
  for (const tf of ["2D", "3D"] as const) {
    const mult = dailyMultipleOf(tf)!;

    it(`${tf}: full history — membership, open key, close availability, OHLCV`, () => {
      const rows = toBars(golden.full.bars);
      const want = golden.expected[tf];
      const got = resampleTf(rows, tf, null);

      expect(got.length).toBe(want.length);
      // BAR IDENTITY: every chart bar is keyed by its OPENING session.
      expect(got.map((b) => b.time)).toEqual(want.map((b) => b.time));
      // DATA AVAILABILITY: and carries the session on which it completes.
      expect(got.map((b) => b.closeTime)).toEqual(want.map((b) => b.closeTime));
      // MEMBERSHIP: re-derive which sessions each chart bar owns and compare to the engine's.
      const membership = sessionToBarTime(rows, mult, 0);
      for (const bar of want) for (const s of bar.sessions) expect(membership.get(s)).toBe(bar.time);
      // AGGREGATION
      for (let i = 0; i < want.length; i++) {
        expect({ o: got[i].o, h: got[i].h, l: got[i].l, c: got[i].c, v: got[i].v })
          .toEqual({ o: want[i].o, h: want[i].h, l: want[i].l, c: want[i].c, v: want[i].v });
      }
    });

    it(`${tf}: the close key is a DIFFERENT fact from the bar key`, () => {
      const want = golden.expected[tf];
      const multiSession = want.filter((b) => b.sessions.length > 1);
      expect(multiSession.length).toBeGreaterThan(10);
      for (const b of multiSession) expect(b.closeTime > b.time).toBe(true);
      // …so keying on the close, as the pre-fix resampler did, is a different grid entirely.
      expect(want.map((b) => b.closeTime)).not.toEqual(want.map((b) => b.time));
    });

    for (const trunc of golden.truncated) {
      it(`${tf}: dropping ${trunc.dropLeading} leading sessions does not re-phase later bars`, () => {
        const rows = toBars(trunc.bars);
        const anchor = parseSessionAnchor(trunc.sessionAnchor);
        const got = resampleTf(rows, tf, anchor);
        const want = trunc.expected[tf];

        expect(got.map((b) => b.time)).toEqual(want.map((b) => b.time));
        expect(got.map((b) => b.closeTime)).toEqual(want.map((b) => b.closeTime));

        // THE ACCEPTANCE CLAIM: a truncated source with a supplied canonical anchor matches
        // the equivalent SUFFIX of a full-history render. Every bar after the leading one —
        // the only bar that can have lost sessions to the truncation — is identical in key,
        // completion session and body to the bar the full feed draws.
        const fullBars = resampleTf(toBars(golden.full.bars), tf, null);
        const byTime = new Map(fullBars.map((b) => [b.time, b]));
        const tail = got.slice(1);
        expect(tail.length).toBeGreaterThan(5);
        for (const b of tail) {
          const f = byTime.get(b.time);
          expect(f, `${tf} bar ${b.time} is not a full-history bar`).toBeDefined();
          expect({ t: b.time, ct: b.closeTime, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })
            .toEqual({ t: f!.time, ct: f!.closeTime, o: f!.o, h: f!.h, l: f!.l, c: f!.c, v: f!.v });
        }
        // …and the leading bar is the surviving TAIL of a full-history bar: it completes on
        // the same session, it just starts later because its earlier sessions are gone.
        const lead = got[0];
        const leadFull = fullBars.find((f) => f.closeTime === lead.closeTime)!;
        expect(leadFull).toBeDefined();
        expect(lead.time >= leadFull.time).toBe(true);
        expect(lead.c).toBe(leadFull.c);
      });
    }

    it(`${tf}: without an anchor it falls back to the ENGINE's fallback, not to floor(i / n)`, () => {
      // The engine anchors a feed it cannot resolve at that feed's first row (bar_anchor 0).
      // An unanchored chart must land on the SAME grid, or an unresolvable symbol silently
      // reintroduces the very disagreement this contract removes.
      const trunc = golden.truncated[0];
      const rows = toBars(trunc.bars);
      const got = resampleTf(rows, tf, null);
      const wantOpens = sessionBarOpens(rows.length, mult, 0);
      expect(got.map((b) => b.time)).toEqual(wantOpens.map((i) => rows[i].time));
      // …which is emphatically not the feed-start grid.
      const floorOpens = rows.map((_, i) => i).filter((i) => i % mult === 0);
      expect(got.map((b) => b.time)).not.toEqual(floorOpens.map((i) => rows[i].time));
    });
  }

  it("MUTATION GUARD: restoring feed-start floor(i / 3) fails bar identity", () => {
    // The pre-fix implementation, verbatim in shape: bucket by row index from the feed's first
    // row, and re-stamp the bucket with its CLOSING session.
    const rows = toBars(golden.full.bars);
    const legacy: { time: string }[] = [];
    let cur: any = null, key: any = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const k = Math.floor(i / 3);
      if (k !== key) { if (cur) legacy.push(cur); key = k; cur = { ...r }; }
      else { cur.time = r.time; }
    }
    if (cur) legacy.push(cur);

    const want = golden.expected["3D"].map((b) => b.time);
    expect(legacy.map((b) => b.time)).not.toEqual(want);
    // Not a cosmetic difference: the grids disagree about which sessions share a bar.
    const canonical = sessionToBarTime(rows, 3, 0);
    const legacyMembership = new Map<string, string>();
    for (let i = 0; i < rows.length; i++) legacyMembership.set(rows[i].time, rows[Math.floor(i / 3) * 3].time);
    let disagreements = 0;
    for (const r of rows) if (canonical.get(r.time) !== legacyMembership.get(r.time)) disagreements++;
    expect(disagreements).toBeGreaterThan(rows.length / 2);
  });

  it("leaves W / 2W / 1M / 3M bucketing and stamping untouched", () => {
    const rows = toBars(golden.full.bars);
    for (const tf of ["W", "2W", "1M", "3M"] as const) {
      const withAnchor = resampleTf(rows, tf, { date: rows[0].time, index: 7, basis: "ipo" });
      const without = resampleTf(rows, tf, null);
      expect(withAnchor.map((b) => b.time)).toEqual(without.map((b) => b.time));
      // calendar units stay keyed by their LAST session, as they always were
      for (const b of without) expect(rows.some((r) => r.time === b.time)).toBe(true);
    }
    // a weekly bar's key is the last session of its week, not the first
    const weekly = resampleTf(rows, "W", null);
    expect(weekly[0].time).toBe("2019-11-01");        // week 1 has only Fri 11-01
    expect(weekly[1].time).toBe("2019-11-08");        // …then a full Mon-Fri week, keyed Friday
  });
});

describe("session→bar membership replaces nearest-bar snapping", () => {
  it("maps an engine bar date to itself and every other session to its owning bar", () => {
    const rows = toBars(golden.full.bars);
    const map = sessionToBarTime(rows, 3, 0);
    for (const bar of golden.expected["3D"]) {
      expect(map.get(bar.time)).toBe(bar.time);         // an engine bar date IS an open
      for (const s of bar.sessions) expect(map.get(s)).toBe(bar.time);
    }
    expect(map.size).toBe(rows.length);
  });

  it("a phase disagreement MISSES instead of hiding inside a tolerance window", () => {
    // Under nearest-bar snapping a signal dated on the canonical grid still lands on a
    // plausible-looking candle of the WRONG grid, because the two are only 1-2 sessions apart
    // and the tolerance is ~10 days. Membership resolution has no such slack.
    const rows = toBars(golden.full.bars);
    const wrongPhase = sessionToBarTime(rows, 3, 1);    // the floor(i/3) phase
    const canonical = golden.expected["3D"].map((b) => b.time);
    const landedOnItsOwnKey = canonical.filter((t) => wrongPhase.get(t) === t).length;
    expect(landedOnItsOwnKey).toBeLessThan(canonical.length / 2);
  });
});
