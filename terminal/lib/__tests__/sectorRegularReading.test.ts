import { describe, expect, it } from "vitest";
import { sectorRegularReading, sectorRegularSession } from "../sectorRegularReading";

const now = Date.parse("2026-11-02T19:30:00Z");
const current = sectorRegularSession(now)!;
const quote = { market: "us", marketSession: "rth", regularSession: "rth", regularSessionDate: "2026-11-02",
  source: "polygon-snapshot-rt", basis: "REALTIME", regularPrice: 101, prevClose: 100, regularChg: 1, asOfMs: now - 2000 };

describe("Sector Discover regular-session observations", () => {
  it.each([
    ["2026-11-02T14:29:00Z", "2026-10-30", false], // Monday after the DST change
    ["2026-11-02T14:30:00Z", "2026-11-02", true],
    ["2026-11-02T21:00:00Z", "2026-11-02", false],
    ["2026-11-26T18:00:00Z", "2026-11-25", false], // Thanksgiving
    ["2026-11-27T18:01:00Z", "2026-11-27", false], // half day
  ])("resolves the last opened NYSE session at %s", (at, date, open) => {
    expect(sectorRegularSession(Date.parse(String(at)))).toMatchObject({ date, open });
  });
  it("keeps a genuine zero and grades observed time independently of poll time", () => {
    expect(sectorRegularReading({ ...quote, regularPrice: 100, regularChg: 0 }, current, now)).toMatchObject({ value: 0, kind: "live" });
    expect(sectorRegularReading({ ...quote, asOfMs: now - 60_000 }, current, now)?.kind).toBe("delayed");
  });
  it.each([{ market: "hk" }, { stale_anchor: true }, { regularSessionDate: "2026-10-30" }, { prevSessionChg: 0 },
    { asOfMs: now + 1 }, { prevClose: 0 }, { asOfMs: now - 21 * 60_000 }, { regularPrice: null }, { regularChg: null },
    { marketSession: "post" }, { close: 101 }, { basis: "EOD" }])("rejects an unqualified row %o", patch => {
    expect(sectorRegularReading({ ...quote, ...patch }, current, now)).toBeNull();
  });
  it("keeps a snapshot's fetch clock out of its live claim", () => {
    const snap = { ...quote, asOfMs: null, ts: now / 1000, basis: "DELAYED_15M", source: "polygon-snapshot", anchor_source: "snapshot" };
    expect(sectorRegularReading(snap, current, now)).toEqual({ value: 1, kind: "untimed", observed: null });
    expect(sectorRegularReading({ ...snap, source: "polygon-delayed", ts: (now - 900_000) / 1000 }, current, now))
      .toMatchObject({ kind: "delayed", observed: now - 900_000 });
  });
  it("requires a dated regular close outside market hours", () => {
    const after = Date.parse("2026-11-02T22:30:00Z"), session = sectorRegularSession(after)!;
    const row = { ...quote, close: 101, extChg: 56, regularSessionDate: "2026-11-02" };
    expect(sectorRegularReading(row, session, after)).toEqual({ value: 1, kind: "close", observed: null });
    expect(sectorRegularReading({ ...row, close: null }, session, after)).toBeNull();
  });
});
