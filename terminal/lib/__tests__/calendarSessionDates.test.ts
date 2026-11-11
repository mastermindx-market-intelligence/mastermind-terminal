import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  calendarBarKey, isCalendarSessionDate, parseSessionAnchor, resampleTf,
  type SessionOhlcBar,
} from "../sessionBars";

const calendarTfs = ["W", "2W", "1M", "3M"] as const;
const invalidDates: unknown[] = [
  "", "bad-date", "2024-2-01", "2024-00-10", "2024-13-10", "2024-01-00",
  "2024-01-32", "2024-02-30", "2023-02-29", "1900-02-29", "2024-04-31",
  " 2024-02-29", "2024-02-29 ", "2024-02-29T00:00:00Z", null, undefined, 20240229,
];
const bar = (time: string, i = 1): SessionOhlcBar => ({ time, o: i * 10, h: i * 10 + 4, l: i * 10 - 1, c: i * 10 + 2, v: i * 100 });
const poison = (time: unknown): SessionOhlcBar => ({ time: time as string, o: 999999, h: 999999, l: -999999, c: 999999, v: 999999 });

describe("strict daily calendar identity", () => {
  it.each(invalidDates)("rejects a malformed date without rollover or coercion: %s", (date) => {
    expect(isCalendarSessionDate(date)).toBe(false);
    for (const tf of calendarTfs) expect(calendarBarKey(tf, date)).toBeNull();
  });

  it.each(["0000-02-29", "0099-01-01", "2000-02-29", "2024-02-29", "2024-03-02", "9999-12-31"])(
    "accepts the actual calendar date, including weekends and early years: %s", (date) => {
      expect(isCalendarSessionDate(date)).toBe(true);
      for (const tf of calendarTfs) expect(calendarBarKey(tf, date)).not.toBeNull();
    },
  );

  it("keeps Monday, fixed-epoch fortnight and zero-based quarter identities", () => {
    expect(calendarBarKey("W", "2021-01-01")).toBe("2020-12-28");
    expect(calendarBarKey("W", "2021-01-04")).toBe("2021-01-04");
    expect(["1970-01-01", "1970-01-05", "1970-01-12", "1970-01-19"].map((d) => calendarBarKey("2W", d)))
      .toEqual(["b-1", "b0", "b0", "b1"]);
    expect(calendarBarKey("1M", "2024-02-29")).toBe("2024-02");
    expect(calendarBarKey("3M", "2024-03-31")).toBe("2024-Q0");
    expect(calendarBarKey("3M", "2024-04-01")).toBe("2024-Q1");
    expect(calendarBarKey("D", "2024-02-29")).toBeNull();
  });

  it("retains the complete week date when a valid year-zero session crosses into year -1", () => {
    expect(isCalendarSessionDate("0000-01-01")).toBe(true);
    expect(calendarBarKey("W", "0000-01-01")).toBe("-000001-12-27");
    expect(calendarBarKey("2W", "0000-01-01")).toBe("b-51396");
  });
});

describe("calendar resampling ignores rejected rows before aggregation", () => {
  const valid = [bar("2024-02-26", 1), bar("2024-02-29", 2), bar("2024-03-01", 3), bar("2024-03-04", 4), bar("2024-04-01", 5)];
  for (const tf of calendarTfs) {
    it(`${tf}: rejected rows cannot change OHLCV, timestamps or bucket continuity`, () => {
      const before = structuredClone(valid);
      const noise = invalidDates.map(poison);
      const mixed = [noise[0], valid[0], ...noise.slice(1, 9), valid[1], ...noise.slice(9), ...valid.slice(2), poison("2024-04-31")];
      expect(resampleTf(mixed, tf)).toEqual(resampleTf(valid, tf));
      expect(resampleTf(noise, tf)).toEqual([]);
      expect(valid).toEqual(before);
    });
  }

  it("retains the last valid session and only the included OHLCV", () => {
    const mixed = [poison("bad-date"), valid[0], poison("2024-02-30"), valid[1], valid[2], poison("2024-03-01T12:00:00Z")];
    expect(resampleTf(mixed, "W")).toEqual([{ time: "2024-03-01", o: 10, h: 34, l: 9, c: 32, v: 600 }]);
  });

  it("leaves D identity, unknown/intraday keys and daily-multiple row positions intact", () => {
    const rows = [bar("2024-03-01", 1), bar("bad-date", 2), bar("2024-03-04", 3), bar("2024-03-05", 4)];
    expect(resampleTf(rows, "D")).toBe(rows);
    expect(resampleTf(rows, "1h")).toEqual(rows);
    expect(resampleTf(rows, "unknown")).toEqual(rows);
    expect(resampleTf(rows, "2D").map(({ time, closeTime, v }) => ({ time, closeTime, v })))
      .toEqual([
        { time: "2024-03-01", closeTime: "2024-03-01", v: 100 },
        { time: "bad-date", closeTime: "2024-03-04", v: 500 },
        { time: "2024-03-05", closeTime: "2024-03-05", v: 400 },
      ]);
    expect(resampleTf(rows, "3D").map(({ time, closeTime, v }) => ({ time, closeTime, v })))
      .toEqual([
        { time: "2024-03-01", closeTime: "2024-03-01", v: 100 },
        { time: "bad-date", closeTime: "2024-03-05", v: 900 },
      ]);
  });
});

// Independent signal-engine fixtures protect the daily-multiple phase boundary above.
type FixtureRow = [string, number, number, number, number, number];
type Expected = SessionOhlcBar & { sessions: string[] };
type Golden = {
  full: { bars: FixtureRow[] };
  expected: Record<string, Expected[]>;
  truncated: { dropLeading: number; sessionAnchor: unknown; bars: FixtureRow[]; expected: Record<string, Expected[]> }[];
};
const golden: Golden = JSON.parse(readFileSync(path.join(__dirname, "fixtures/sessionBars3D.golden.json"), "utf8"));
const toBars = (rows: FixtureRow[]): SessionOhlcBar[] => rows.map(([time, o, h, l, c, v]) => ({ time, o, h, l, c, v }));
const bodies = (rows: Expected[]) => rows.map(({ sessions: _sessions, ...body }) => body);

describe("calendar rejection does not rephase canonical daily multiples", () => {
  for (const tf of ["2D", "3D"] as const) {
    it(`${tf}: preserves the complete engine-derived full-history fixture`, () => {
      expect(resampleTf(toBars(golden.full.bars), tf)).toEqual(bodies(golden.expected[tf]));
    });
    for (const cut of golden.truncated) {
      it(`${tf}: preserves the published session anchor after dropping ${cut.dropLeading} rows`, () => {
        expect(resampleTf(toBars(cut.bars), tf, parseSessionAnchor(cut.sessionAnchor))).toEqual(bodies(cut.expected[tf]));
      });
    }
  }
});
