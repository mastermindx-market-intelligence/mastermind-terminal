import { describe, expect, it } from "vitest";
import {
  bucketBarsBySession, buildSessionReview, measureSessionTouches, SESSION_REVIEW_VERSION,
  type ReviewFrameInput,
} from "@/lib/exposureSessionReview";
import type { Bar6 } from "@/lib/intradayShared";

/** Display epoch whose UTC fields already read as the ET wall clock, exactly as /api/intraday serves. */
const bar = (session: string, hm: string, o: number, h: number, l: number, c: number): Bar6 => {
  const [y, m, d] = session.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  return [Date.UTC(y, m - 1, d, hh, mm) / 1000, o, h, l, c, 0];
};
const S1 = "2026-10-19", S2 = "2026-10-20";
const frame = (session: string, kind: ReviewFrameInput["kind"], level: number | null, levelNetMn: number | null = null): ReviewFrameInput =>
  ({ session, kind, level, levelNetMn });

describe("bucketBarsBySession", () => {
  it("splits two sessions and sorts each bucket by time", () => {
    const b = bucketBarsBySession([bar(S1, "10:20", 600, 601, 599, 600), bar(S2, "09:30", 601, 602, 600, 601), bar(S1, "10:10", 600, 600.5, 599.5, 600)]);
    expect([...b.keys()]).toEqual([S1, S2]);
    expect(b.get(S1)!.map((x) => x[3])).toEqual([599.5, 599]);
    expect(b.get(S2)).toHaveLength(1);
  });
  it("returns an empty map for no bars", () => {
    expect(bucketBarsBySession([]).size).toBe(0);
  });
});

describe("measureSessionTouches", () => {
  it("counts inclusive boundary crossings: low === level and high === level both touch", () => {
    const bars = [bar(S1, "10:00", 602, 602, 600, 601), bar(S1, "10:10", 598, 599, 596, 597), bar(S1, "10:20", 596, 600, 595, 599)];
    expect(measureSessionTouches(bars, 600)!.touches).toBe(2);
    expect(measureSessionTouches(bars, 596)!.touches).toBe(2);
  });
  it("counts zero touches when the level is outside every range, but still measures the session", () => {
    const m = measureSessionTouches([bar(S1, "10:00", 610, 612, 608, 611), bar(S1, "10:10", 611, 613, 610, 612)], 600);
    expect(m!.touches).toBe(0);
    expect(m!.firstTouchEt).toBeNull();
    expect(m!.lastTouchEt).toBeNull();
    expect(m!.close).toBe(612);
  });
  it("reports first and last touch times in ET HH:MM", () => {
    const bars = [bar(S1, "09:30", 599, 601, 598, 600), bar(S1, "11:40", 599, 600, 598, 599), bar(S1, "15:50", 598, 600, 597, 599)];
    const m = measureSessionTouches(bars, 600);
    expect(m!.firstTouchEt).toBe("09:30");
    expect(m!.lastTouchEt).toBe("15:50");
  });
  it("measures max excursion above from the session high", () => {
    const m = measureSessionTouches([bar(S1, "10:00", 598, 604, 597, 600), bar(S1, "10:10", 600, 602, 599, 601)], 600);
    expect(m!.maxExcursionSide).toBe("above");
    expect(m!.maxExcursionPrice).toBe(604);
    expect(m!.maxExcursionPct).toBeCloseTo(4 / 600, 12);
  });
  it("measures max excursion below from the session low", () => {
    const m = measureSessionTouches([bar(S1, "10:00", 601, 603, 596, 600), bar(S1, "10:10", 600, 602, 598, 601)], 600);
    expect(m!.maxExcursionSide).toBe("below");
    expect(m!.maxExcursionPrice).toBe(596);
    expect(m!.maxExcursionPct).toBeCloseTo(-4 / 600, 12);
  });
  it("measures close vs level from the last close", () => {
    const m = measureSessionTouches([bar(S1, "10:00", 600, 601, 599, 600), bar(S1, "10:10", 600, 600.5, 599.5, 600.24)], 600);
    expect(m!.closeVsLevelPct).toBeCloseTo(0.24 / 600, 12);
    expect(m!.close).toBe(600.24);
    expect(m!.low).toBe(599);
    expect(m!.high).toBe(601);
    expect(m!.bars).toBe(2);
  });
  it("returns null for empty bars and for a non-finite level", () => {
    expect(measureSessionTouches([], 600)).toBeNull();
    expect(measureSessionTouches([bar(S1, "10:00", 600, 601, 599, 600)], NaN)).toBeNull();
    expect(measureSessionTouches([bar(S1, "10:00", 600, 601, 599, 600)], Infinity)).toBeNull();
  });
});

describe("buildSessionReview", () => {
  const barsBySession = new Map(Object.entries({
    [S1]: [bar(S1, "10:00", 600, 601, 599, 600), bar(S1, "10:10", 600, 602, 599, 601)],
    [S2]: [bar(S2, "10:00", 608, 611, 607, 609), bar(S2, "10:10", 609, 610, 608, 609)],
  }));
  const frames = [frame(S1, "observed", 600, 622), frame(S2, "reconstructed", 610, -40), frame(S1, "current", 600, 10)];
  it("measures each row at its own frame level in dominant mode", () => {
    const review = buildSessionReview("SPY", frames, barsBySession, "dominant", null);
    expect(review.version).toBe(SESSION_REVIEW_VERSION);
    expect(review.tf).toBe("10m");
    expect(review.rows.map((r) => r.measure!.touches)).toEqual([2, 2, 2]);
    expect(review.rows.every((r) => !r.pinned)).toBe(true);
    expect(review.rows.map((r) => r.level)).toEqual([600, 610, 600]);
  });
  it("measures every row at the pinned level with pinned true, without refetching", () => {
    const review = buildSessionReview("SPY", frames, barsBySession, "pinned", 600);
    expect(review.rows.every((r) => r.pinned && r.level === 600)).toBe(true);
    expect(review.rows.map((r) => r.measure!.touches)).toEqual([2, 0, 2]);
    // The stored net belongs to each frame's own level, so a pinned re-measure shows none.
    expect(review.rows.every((r) => r.levelNetMn === null)).toBe(true);
  });
  it("marks a null level as no_level and an absent bucket as no_bars, never zero touches", () => {
    const review = buildSessionReview("SPY", [frame(S1, "observed", null), frame(S2, "observed", 610)], barsBySession, "dominant", null);
    expect(review.rows[0].measure).toBeNull();
    expect(review.rows[0].missing).toBe("no_level");
    const missing = buildSessionReview("SPY", [frame("2026-10-15", "observed", 600)], barsBySession, "dominant", null);
    expect(missing.rows[0].measure).toBeNull();
    expect(missing.rows[0].missing).toBe("no_bars");
  });
  it("counts current as observed and keeps reconstructed touches out of observedTouches", () => {
    const review = buildSessionReview("SPY", frames, barsBySession, "dominant", null);
    expect(review.totals).toEqual({ sessions: 3, observed: 2, reconstructed: 1, aggregate: 0, observedTouches: 4, reconstructedTouches: 2 });
    const relabelled = buildSessionReview("SPY", frames.map((f) => f.kind === "reconstructed" ? { ...f, kind: "observed" as const } : f), barsBySession, "dominant", null);
    expect(relabelled.totals.observedTouches).toBe(6); // relabelling moves the reconstructed row's 2 touches in
    expect(relabelled.totals.observed).toBe(3);
    const withAggregate = buildSessionReview("SPY", [...frames, frame(S2, "aggregate", 610)], barsBySession, "dominant", null);
    expect(withAggregate.totals.aggregate).toBe(1);
    expect(withAggregate.totals.reconstructedTouches).toBe(4);
    expect(withAggregate.totals.observedTouches).toBe(4);
  });
  it("keeps the input order (oldest first) untouched", () => {
    const review = buildSessionReview("SPY", [frame(S2, "observed", 610), frame(S1, "observed", 600)], barsBySession, "dominant", null);
    expect(review.rows.map((r) => r.session)).toEqual([S2, S1]);
  });
});
