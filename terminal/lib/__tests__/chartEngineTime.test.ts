// T01 — engine time facts: key normalization, key-list validation (first offender),
// per-market fact extraction (display epoch via liveDisplayEpoch), session-anchor
// preservation across a refresh, and record immutability.
import { describe, expect, it } from "vitest";
import type { EngineBusinessDay, EngineTime } from "@/lib/chart-engine/api";
import {
  barTimeFacts,
  preserveSessionAnchors,
  toBarKey,
  validateTimeKeys,
  type BarTimeFacts,
} from "@/lib/chart-engine/time";
import { liveDisplayEpoch } from "@/lib/liveCandle";
import type { Market } from "@/lib/intradayShared";

const S = (ms: number) => ms / 1000;
// 2026-10-09 is a Friday. October ET is UTC-4 (DST), Shanghai/Hong Kong UTC+8.
const US_RTH_OPEN_UTC = S(Date.UTC(2026, 9, 9, 13, 30)); // 13:30Z = 09:30 ET
const CN_OPEN_UTC = S(Date.UTC(2026, 9, 9, 1, 30)); // 01:30Z = 09:30 Shanghai
const ET_0930 = S(Date.UTC(2026, 9, 9, 9, 30));

describe("toBarKey", () => {
  it("passes finite integer seconds through as numbers", () => {
    expect(toBarKey(1_756_000_000)).toBe(1_756_000_000);
    expect(toBarKey(0)).toBe(0);
    expect(toBarKey(-5)).toBe(-5);
    expect(typeof toBarKey(1_756_000_000)).toBe("number");
  });

  it("accepts the ms-epoch boundary 1e11 seconds but nothing beyond", () => {
    expect(toBarKey(1e11)).toBe(1e11);
    expect(toBarKey(1e11 + 1)).toBeNull();
    expect(toBarKey(1_756_000_000_000)).toBeNull();
  });

  it("rejects fractional, non-finite numbers", () => {
    expect(toBarKey(1_756_000_000.5)).toBeNull();
    expect(toBarKey(-0.5)).toBeNull();
    expect(toBarKey(Number.NaN)).toBeNull();
    expect(toBarKey(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("passes calendar-valid YYYY-MM-DD strings through", () => {
    expect(toBarKey("2026-10-09")).toBe("2026-10-09");
    expect(toBarKey("2024-02-29")).toBe("2024-02-29"); // leap year
  });

  it("rejects malformed and calendar-impossible strings", () => {
    expect(toBarKey("2026-02-30")).toBeNull();
    expect(toBarKey("2026-13-01")).toBeNull();
    expect(toBarKey("2026-00-10")).toBeNull();
    expect(toBarKey("2026-10-9")).toBeNull();
    expect(toBarKey("10-09")).toBeNull();
    expect(toBarKey("")).toBeNull();
    expect(toBarKey("1756000000")).toBeNull(); // digit-only is NOT a date
    expect(toBarKey("2026-10-09T00:00:00Z")).toBeNull();
  });

  it("normalizes {year,month,day} to the same YYYY-MM-DD string", () => {
    expect(toBarKey({ year: 2026, month: 10, day: 9 })).toBe("2026-10-09");
    expect(toBarKey({ year: 2026, month: 9, day: 1 })).toBe("2026-09-01");
    expect(toBarKey({ year: 2026, month: 10, day: 9 })).toStrictEqual(toBarKey("2026-10-09"));
  });

  it("rejects malformed business-day objects and runtime junk", () => {
    expect(toBarKey({ year: 2026, month: 13, day: 1 } as EngineBusinessDay)).toBeNull();
    expect(toBarKey({ year: 2026, month: 0, day: 10 } as EngineBusinessDay)).toBeNull();
    expect(toBarKey({ year: 2026, month: 2, day: 30 } as EngineBusinessDay)).toBeNull();
    expect(toBarKey({ year: 2026, month: 10 } as EngineBusinessDay)).toBeNull();
    expect(toBarKey(null as unknown as EngineTime)).toBeNull();
    expect(toBarKey(undefined as unknown as EngineTime)).toBeNull();
  });
});

describe("validateTimeKeys", () => {
  it("accepts uniform increasing epoch-second lists", () => {
    expect(validateTimeKeys([])).toEqual({ ok: true, kind: "epochSec" });
    expect(validateTimeKeys([{ time: 5 }])).toEqual({ ok: true, kind: "epochSec" });
    expect(validateTimeKeys([{ time: 0 }, { time: 1 }, { time: 1_756_000_000 }])).toEqual({
      ok: true,
      kind: "epochSec",
    });
  });

  it("accepts uniform increasing business-day lists in both spellings", () => {
    expect(
      validateTimeKeys([{ time: "2026-10-07" }, { time: "2026-10-08" }, { time: "2026-10-09" }]),
    ).toEqual({ ok: true, kind: "businessDay" });
    expect(
      validateTimeKeys([{ time: { year: 2026, month: 10, day: 7 } }, { time: "2026-10-08" }]),
    ).toEqual({ ok: true, kind: "businessDay" });
  });

  type Bad = { rows: { time: EngineTime }[]; index: number; reason: string };
  const firstOffender: Bad[] = [
    { rows: [{ time: 1000 }, { time: 2000 }, { time: 1_756_000_000_000 }, { time: 3000 }], index: 2, reason: "millisecond epoch" },
    { rows: [{ time: 1000 }, { time: 2000 }, { time: 2000.5 }], index: 2, reason: "fractional seconds" },
    { rows: [{ time: 1000 }, { time: 2000 }, { time: Number.NaN }], index: 2, reason: "not a finite number" },
    { rows: [{ time: "2026-10-07" }, { time: "2026-10-08" }, { time: "2026-10-9" }], index: 2, reason: "malformed business-day string" },
    { rows: [{ time: "2026-10-07" }, { time: "2026-10-08" }, { time: "2026-02-30" }], index: 2, reason: "malformed business-day string" },
    { rows: [{ time: "2026-10-07" }, { time: "2026-10-08" }, { time: { year: 2026, month: 13, day: 1 } }], index: 2, reason: "malformed business-day object" },
    { rows: [{ time: 1000 }, { time: 2000 }, { time: "2026-10-09" }], index: 2, reason: "mixed time kinds" },
    { rows: [{ time: "2026-10-07" }, { time: 1000 }], index: 1, reason: "mixed time kinds" },
    { rows: [{ time: 1000 }, { time: 2000 }, { time: 2000 }, { time: 3000 }], index: 2, reason: "duplicate time key" },
    { rows: [{ time: 3000 }, { time: 2000 }, { time: 1000 }], index: 1, reason: "time key decreases" },
    { rows: [{ time: "2026-10-09" }, { time: "2026-10-07" }], index: 1, reason: "time key decreases" },
    { rows: [{ time: "2026-10-07" }, { time: { year: 2026, month: 10, day: 7 } }], index: 1, reason: "duplicate time key" },
    { rows: [{ time: 1000 }, { time: 2000 }, { time: undefined as unknown as EngineTime }], index: 2, reason: "time is missing" },
  ];

  it.each(firstOffender)("reports the FIRST offending index ($index: $reason)", ({ rows, index, reason }) => {
    const result = validateTimeKeys(rows);
    expect(result).toMatchObject({ ok: false, index });
    if (!result.ok) expect(result.reason).toContain(reason);
  });

  it("prefers the kind mismatch over a later ordering defect at the same row", () => {
    // Row 1 is both a different kind and (lexically) decreasing; the kind defect is the
    // one that makes the list ambiguous, so it is what gets reported.
    const result = validateTimeKeys([{ time: 1_756_000_000 }, { time: "2026-10-09" }]);
    expect(result).toMatchObject({ ok: false, index: 1 });
    if (!result.ok) expect(result.reason).toContain("mixed time kinds");
  });
});

describe("barTimeFacts", () => {
  it("extracts US facts: display epoch shifts 13:30Z to the 09:30 ET wall clock", () => {
    const f = barTimeFacts({ time: US_RTH_OPEN_UTC }, "us", 60);
    expect(f).not.toBeNull();
    expect(f?.key).toBe(US_RTH_OPEN_UTC);
    expect(f?.openUtcMs).toBe(US_RTH_OPEN_UTC * 1000);
    expect(f?.closeUtcMs).toBe(US_RTH_OPEN_UTC * 1000 + 60_000);
    expect(f?.displayEpochSec).toBe(ET_0930);
    expect(f?.sessionId).toBe("2026-10-09");
    expect(f?.cadenceSec).toBe(60);
    expect(f?.isSynthetic).toBe(false);
  });

  it("extracts CN/HK facts with the UTC+8 wall clock", () => {
    for (const market of ["cn", "hk"] as Market[]) {
      const f = barTimeFacts({ time: CN_OPEN_UTC }, market, 300);
      expect(f?.displayEpochSec).toBe(ET_0930); // 09:30 local in both zones
      expect(f?.sessionId).toBe("2026-10-09");
    }
  });

  it("keeps crypto on UTC days with an identity display shift", () => {
    const f = barTimeFacts({ time: US_RTH_OPEN_UTC }, "crypto", 3600);
    expect(f?.displayEpochSec).toBe(US_RTH_OPEN_UTC);
    expect(f?.sessionId).toBe("2026-10-09");
  });

  it("extracts CA facts on the Toronto wall clock", () => {
    const f = barTimeFacts({ time: US_RTH_OPEN_UTC }, "ca", 60);
    expect(f?.displayEpochSec).toBe(ET_0930); // Toronto is UTC-4 in October too
    expect(f?.sessionId).toBe("2026-10-09");
  });

  it("T01-A03: displayEpochSec equals liveDisplayEpoch(openUtcMs, market) for us/cn/hk/crypto/ca", () => {
    const markets: Market[] = ["us", "cn", "hk", "crypto", "ca"];
    for (const market of markets) {
      const f = barTimeFacts({ time: CN_OPEN_UTC }, market, 60);
      expect(f?.displayEpochSec).toBe(liveDisplayEpoch(CN_OPEN_UTC * 1000, market));
    }
  });

  it("derives the session id from the market-local calendar date of the open", () => {
    // 20:00Z is already 2026-10-10 in Shanghai — the CN session id rolls over.
    const cn = barTimeFacts({ time: S(Date.UTC(2026, 9, 9, 20, 0)) }, "cn", 60);
    expect(cn?.sessionId).toBe("2026-10-10");
    // …but still 2026-10-09 in New York.
    const us = barTimeFacts({ time: S(Date.UTC(2026, 9, 9, 20, 0)) }, "us", 60);
    expect(us?.sessionId).toBe("2026-10-09");
  });

  it("extracts business-day facts: key is the session, closeTime is availability", () => {
    const noon = Date.UTC(2026, 9, 9, 12);
    const f = barTimeFacts({ time: "2026-10-09" }, "us", 0);
    expect(f?.key).toBe("2026-10-09");
    expect(f?.openUtcMs).toBe(noon); // canonical UTC-noon instant (futureTime.ts convention)
    expect(f?.closeUtcMs).toBe(noon); // a plain daily bar closes on its own session
    expect(f?.sessionId).toBe("2026-10-09");
    expect(f?.cadenceSec).toBe(0);

    // Canonical 3D law: keyed by the opening session, knowable on the closing one.
    const d3 = barTimeFacts({ time: "2026-10-09", closeTime: "2026-10-13" }, "us", 0);
    expect(d3?.closeUtcMs).toBe(Date.UTC(2026, 9, 13, 12));
    expect(d3?.key).toBe("2026-10-09");
  });

  it("normalizes {year,month,day} keys to the same facts as the string spelling", () => {
    const fromObject = barTimeFacts({ time: { year: 2026, month: 10, day: 9 } }, "us", 0);
    const fromString = barTimeFacts({ time: "2026-10-09" }, "us", 0);
    expect(fromObject).toStrictEqual(fromString);
  });

  it("returns null for keys toBarKey rejects", () => {
    expect(barTimeFacts({ time: 1_756_000_000.5 }, "us", 60)).toBeNull();
    expect(barTimeFacts({ time: "2026-02-30" }, "us", 0)).toBeNull();
  });

  it("T01-A04: the facts record is frozen", () => {
    const f = barTimeFacts({ time: US_RTH_OPEN_UTC }, "us", 60) as BarTimeFacts;
    expect(Object.isFrozen(f)).toBe(true);
    expect(Reflect.set(f, "sessionId", "1999-01-01")).toBe(false);
    expect(f.sessionId).toBe("2026-10-09");
  });

  it("F-12: the same bar as utc vs display-epoch yields the same displayEpochSec and different sourceUtc", () => {
    const asUtc = barTimeFacts({ time: US_RTH_OPEN_UTC }, "us", 60, "utc");
    const asDisplay = barTimeFacts({ time: ET_0930 }, "us", 60, "display");
    expect(asUtc).not.toBeNull();
    expect(asDisplay).not.toBeNull();
    expect(asUtc?.displayEpochSec).toBe(ET_0930);
    expect(asDisplay?.displayEpochSec).toBe(ET_0930);
    expect(asUtc?.displayEpochSec).toBe(asDisplay?.displayEpochSec);
    expect(asUtc?.openUtcMs).toBe(US_RTH_OPEN_UTC * 1000);
    expect(asDisplay?.openUtcMs).toBe(ET_0930 * 1000);
    expect(asUtc?.openUtcMs).not.toBe(asDisplay?.openUtcMs);
    // Default basis stays true UTC so existing callers are unchanged.
    expect(barTimeFacts({ time: US_RTH_OPEN_UTC }, "us", 60)?.displayEpochSec).toBe(ET_0930);
  });
});

describe("preserveSessionAnchors", () => {
  // A clean modern 1-minute grid; 1_756_000_000 = 2025-08-24T01:46:40Z (ET: 08-23).
  const T0 = 1_756_000_000;
  const us = (time: EngineTime, cadenceSec = 60): BarTimeFacts =>
    barTimeFacts({ time }, "us", cadenceSec)!;

  it("accepts an identical refresh", () => {
    const facts = [us(T0), us(T0 + 60), us(T0 + 120)];
    expect(preserveSessionAnchors(facts, facts)).toEqual([]);
  });

  it("accepts appended and dropped keys — only shared keys are anchored", () => {
    const previous = [us(T0), us(T0 + 60), us(T0 + 120)];
    const next = [us(T0 + 60), us(T0 + 120), us(T0 + 180), us(T0 + 240)];
    expect(preserveSessionAnchors(previous, next)).toEqual([]);
  });

  it("flags a re-anchored session id (T01-A02)", () => {
    const previous = [us(T0), us(T0 + 60)];
    const moved = { ...previous[1], sessionId: "2020-03-16" };
    expect(preserveSessionAnchors(previous, [previous[0], moved])).toEqual([
      { key: T0 + 60, field: "sessionId", previous: previous[1].sessionId, next: "2020-03-16" },
    ]);
  });

  it("flags a shifted open instant and a changed availability instant", () => {
    const a = us(T0 + 60);
    expect(
      preserveSessionAnchors([a], [{ ...a, openUtcMs: a.openUtcMs + 1 }]),
    ).toEqual([{ key: T0 + 60, field: "openUtcMs", previous: (T0 + 60) * 1000, next: (T0 + 60) * 1000 + 1 }]);

    const c = barTimeFacts({ time: "2026-10-09", closeTime: "2026-10-13" }, "us", 0)!;
    const d = barTimeFacts({ time: "2026-10-09", closeTime: "2026-10-14" }, "us", 0)!;
    expect(preserveSessionAnchors([c], [d])).toEqual([
      {
        key: "2026-10-09",
        field: "closeUtcMs",
        previous: Date.UTC(2026, 9, 13, 12),
        next: Date.UTC(2026, 9, 14, 12),
      },
    ]);
  });

  it("reports every violated field of every shared key, in previous order", () => {
    const p0 = us(T0);
    const p1 = barTimeFacts({ time: "2026-10-08" }, "us", 0)!;
    const n1 = { ...p1, sessionId: "2000-01-01", openUtcMs: p1.openUtcMs + 1, closeUtcMs: p1.closeUtcMs + 1 };
    expect(preserveSessionAnchors([p0, p1], [p0, n1])).toEqual([
      { key: "2026-10-08", field: "sessionId", previous: "2026-10-08", next: "2000-01-01" },
      { key: "2026-10-08", field: "openUtcMs", previous: p1.openUtcMs, next: p1.openUtcMs + 1 },
      { key: "2026-10-08", field: "closeUtcMs", previous: p1.closeUtcMs, next: p1.closeUtcMs + 1 },
    ]);
  });

  it("anchors business-day keys shared across a refresh", () => {
    const previous = [barTimeFacts({ time: "2026-10-08" }, "us", 0)!, barTimeFacts({ time: "2026-10-09" }, "us", 0)!];
    const next = [barTimeFacts({ time: "2026-10-09" }, "hk", 0)!]; // same date, different market zone
    expect(preserveSessionAnchors(previous, next)).toEqual([]);
  });
});
