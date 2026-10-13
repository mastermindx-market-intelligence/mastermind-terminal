// T03 — future anchors: slot stability across generated counts (A01), cadence-switch
// determinism re-derived from the anchor's own openUtcMs with no accumulation drift
// (A02), business-day futures skipping weekends consistently with futureBarTimes()
// (A03), and the synthetic flag/frozen records that keep slots distinguishable from
// real bars.
import { describe, expect, it } from "vitest";
import {
  FUTURE_ANCHOR_BARS,
  futureBarTimes,
  futureCadence,
  futureSlotOf,
} from "@/lib/chart-engine/futureTime";
import { barTimeFacts, futureAnchors, type BarKey } from "@/lib/chart-engine/time";
import { liveDisplayEpoch } from "@/lib/liveCandle";

const DAY_MS = 86_400_000;
const BASE = 1_756_000_000; // 2025-08-24T01:46:40Z — abstract intraday origin
const hourly = [BASE, BASE + 3600, BASE + 7200, BASE + 10_800];
const hourlyCadence = futureCadence(hourly)!;
const lastHourly = barTimeFacts({ time: BASE + 10_800 }, "us", 3600)!;

// 2026-08-21 is a Friday; the following sessions are Mon 08-24 onward.
const dailyWeek = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
const dailyCadence = futureCadence(dailyWeek)!;
const lastDaily = barTimeFacts({ time: "2026-08-21" }, "us", 0)!;

const keysOf = (facts: readonly { key: BarKey }[]) => facts.map((f) => f.key);

describe("futureAnchors — intraday grid", () => {
  it("continues epoch-second keys by the cadence step", () => {
    const anchors = futureAnchors(lastHourly, "us", hourlyCadence, 3);
    expect(keysOf(anchors)).toEqual([BASE + 14_400, BASE + 18_000, BASE + 21_600]);
  });

  it("builds synthetic facts that still carry all six time facts", () => {
    const [first] = futureAnchors(lastHourly, "us", hourlyCadence, 1);
    expect(first).toBeDefined();
    expect(first!.isSynthetic).toBe(true);
    expect(first!.openUtcMs).toBe((BASE + 14_400) * 1000);
    expect(first!.closeUtcMs).toBe((BASE + 14_400) * 1000 + 3_600_000);
    expect(first!.cadenceSec).toBe(3600);
    expect(first!.displayEpochSec).toBe(liveDisplayEpoch(first!.openUtcMs, "us"));
    expect(first!.sessionId).toBe("2025-08-24"); // 05:46:40Z is 01:46:40 ET, same calendar day
  });

  it("returns frozen records in a frozen array", () => {
    const anchors = futureAnchors(lastHourly, "us", hourlyCadence, 2);
    expect(Object.isFrozen(anchors)).toBe(true);
    for (const f of anchors) expect(Object.isFrozen(f)).toBe(true);
  });

  it("crypto synthetic slots stay on the UTC identity display", () => {
    const [first] = futureAnchors(barTimeFacts({ time: BASE + 10_800 }, "crypto", 3600)!, "crypto", hourlyCadence, 1);
    expect(first!.displayEpochSec).toBe(BASE + 14_400);
    expect(first!.sessionId).toBe("2025-08-24");
  });
});

describe("T03-A01 — slot stability", () => {
  it("slot i's key is independent of how many anchors are generated", () => {
    const short = futureAnchors(lastHourly, "us", hourlyCadence, 5);
    const long = futureAnchors(lastHourly, "us", hourlyCadence, 200);
    expect(keysOf(short)).toEqual(keysOf(long.slice(0, 5)));
    expect(long[199]!.key).toBe(BASE + 10_800 + 3600 * 200);
  });

  it("agrees with futureSlotOf: anchor i sits on slot index i", () => {
    const long = futureAnchors(lastHourly, "us", hourlyCadence, 200);
    for (const i of [0, 1, 7, 42]) {
      expect(futureSlotOf(hourlyCadence, long[i]!.key as number, 200)).toBe(i);
    }
  });

  it("the same wall-clock future instant resolves to the same slot index at any budget", () => {
    const long = futureAnchors(lastHourly, "us", hourlyCadence, 200);
    const instant = long[7]!.openUtcMs; // one true wall-clock instant
    expect(futureSlotOf(hourlyCadence, instant / 1000, 8)).toBe(7);
    expect(futureSlotOf(hourlyCadence, instant / 1000, 200)).toBe(7);
  });
});

describe("T03-A02 — cadence determinism", () => {
  it("is pure: the same inputs produce the same grid", () => {
    expect(futureAnchors(lastHourly, "us", hourlyCadence, 6)).toEqual(
      futureAnchors(lastHourly, "us", hourlyCadence, 6),
    );
  });

  it("switching cadence 1h → 1d re-derives the slots from openUtcMs", () => {
    const dayCadence = { stepMs: DAY_MS, lastMs: (BASE + 10_800) * 1000 };
    const fromHourly = futureAnchors(lastHourly, "us", hourlyCadence, 3);
    const fromDaily = futureAnchors(lastHourly, "us", dayCadence, 3);
    expect(keysOf(fromDaily)).toEqual([
      BASE + 10_800 + 86_400,
      BASE + 10_800 + 2 * 86_400,
      BASE + 10_800 + 3 * 86_400,
    ]);
    expect(keysOf(fromDaily)).not.toEqual(keysOf(fromHourly));
    for (const f of fromDaily) expect(f.openUtcMs).toBeGreaterThanOrEqual(lastHourly.openUtcMs + DAY_MS);
  });

  it("ignores a stale cadence.lastMs — the anchor's own key is the origin", () => {
    const stale = { stepMs: 3_600_000, lastMs: (BASE + 7200) * 1000 }; // measured one bar early
    const anchors = futureAnchors(lastHourly, "us", stale, 2);
    expect(keysOf(anchors)).toEqual([BASE + 14_400, BASE + 18_000]);
  });

  it("chained generation accumulates no drift", () => {
    const long = futureAnchors(lastHourly, "us", hourlyCadence, 12);
    const chained = futureAnchors(long[4]!, "us", hourlyCadence, 7);
    expect(keysOf(chained)).toEqual(keysOf(long.slice(5)));
    expect(chained.map((f) => f.openUtcMs)).toEqual(long.slice(5).map((f) => f.openUtcMs));
  });
});

describe("T03-A03 — business-day futures", () => {
  it("skips weekends exactly as futureBarTimes does", () => {
    const anchors = futureAnchors(lastDaily, "us", dailyCadence, 4);
    expect(keysOf(anchors)).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"]);
    expect(keysOf(anchors)).toEqual(futureBarTimes(dailyWeek, 4));
  });

  it("never emits a weekend date on a daily cadence", () => {
    const anchors = futureAnchors(lastDaily, "us", dailyCadence, 40);
    expect(anchors).toHaveLength(40);
    for (const f of anchors) {
      const dow = new Date(`${f.key as string}T12:00:00Z`).getUTCDay();
      expect(dow).toBeGreaterThanOrEqual(1);
      expect(dow).toBeLessThanOrEqual(5);
    }
  });

  it("builds synthetic business-day facts on the same conventions as real ones", () => {
    const [first] = futureAnchors(lastDaily, "us", dailyCadence, 1);
    expect(first!.isSynthetic).toBe(true);
    expect(first!.sessionId).toBe(first!.key);
    expect(first!.openUtcMs).toBe(Date.UTC(2026, 7, 24, 12)); // canonical UTC noon
    expect(first!.closeUtcMs).toBe(first!.openUtcMs); // no producer closeTime: closes on its own session
    expect(first!.cadenceSec).toBe(0);
    expect(first!.isSynthetic).not.toBe(lastDaily.isSynthetic);
  });

  it("chains across a weekend without drift", () => {
    const long = futureAnchors(lastDaily, "us", dailyCadence, 7);
    expect(keysOf(long)).toEqual([
      "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31", "2026-09-01",
    ]);
    const chained = futureAnchors(long[4]!, "us", dailyCadence, 2); // anchored on Friday 08-28
    expect(keysOf(chained)).toEqual(["2026-08-31", "2026-09-01"]);
    expect(keysOf(chained)).toEqual(keysOf(long.slice(5, 7)));
  });
});

describe("futureAnchors — guards", () => {
  it("returns nothing without a usable cadence or count", () => {
    expect(futureAnchors(lastHourly, "us", null, 5)).toEqual([]);
    expect(futureAnchors(lastHourly, "us", { stepMs: 0, lastMs: 0 }, 5)).toEqual([]);
    expect(futureAnchors(lastHourly, "us", { stepMs: Number.NaN, lastMs: 0 }, 5)).toEqual([]);
    expect(futureAnchors(lastHourly, "us", hourlyCadence, 0)).toEqual([]);
    expect(futureAnchors(lastHourly, "us", hourlyCadence, -3)).toEqual([]);
  });

  it("defaults to the shared anchor budget and floors a fractional count", () => {
    expect(futureAnchors(lastDaily, "us", dailyCadence)).toHaveLength(FUTURE_ANCHOR_BARS);
    expect(futureAnchors(lastHourly, "us", hourlyCadence, 2.9)).toHaveLength(2);
  });
});
