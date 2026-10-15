import { describe, expect, it } from "vitest";
import {
  NINE_BAR_ALGORITHM_VERSION,
  computeNineBarExhaustion,
  type NineBarInputBar,
  type NineBarOptions,
  type NineBarPoint,
} from "../nineBarExhaustion";

const bars = (closes: Array<number | null>, times?: number[]): NineBarInputBar[] => closes.map((c, i) => ({
  id: `b${i}`,
  t: times?.[i] ?? 1_700_000_000 + i * 60,
  availableT: (times?.[i] ?? 1_700_000_000 + i * 60) + 60,
  o: c ?? Number.NaN,
  h: c == null ? Number.NaN : c + 0.5,
  l: c == null ? Number.NaN : c - 0.5,
  c: c ?? Number.NaN,
  v: 100 + i,
}));

const rising = (comparisons: number) => bars(Array.from({ length: 4 + comparisons }, (_, i) => 100 + i));
const falling = (comparisons: number) => bars(Array.from({ length: 4 + comparisons }, (_, i) => 100 - i));

const opts = (overrides: Partial<NineBarOptions> = {}): NineBarOptions => ({
  symbol: "TEST",
  timeframe: "1m",
  session: "regular",
  displayPolicy: "retro6",
  density: "all",
  cycleMode: "single",
  requirePriceFlip: false,
  historyBars: 500,
  formingBarIndex: null,
  ...overrides,
});

const must = (closes: NineBarInputBar[], overrides: Partial<NineBarOptions> = {}) => {
  const out = computeNineBarExhaustion(closes, opts(overrides));
  expect(out.ok).toBe(true);
  if (!out.ok) throw new Error(out.error.message);
  return out;
};

const withoutDisplayEligibility = ({
  displayEligible,
  historicalDisplayEligible,
  ...point
}: NineBarPoint) => {
  void displayEligible;
  void historicalDisplayEligible;
  return point;
};

describe("nine-bar deterministic kernel", () => {
  it("starts the first comparison on the fifth available bar", () => {
    const out = must(rising(1), { displayPolicy: "progressive" });
    expect(out.points).toHaveLength(1);
    expect(out.points[0]).toMatchObject({
      i: 4,
      compareI: 0,
      direction: "rising",
      count: 1,
      absoluteStreak: 1,
      close: 104,
      compareClose: 100,
      confirmedAt: null,
    });
    expect(out.events).toEqual([]);
  });

  it("first completes on the thirteenth available bar and preserves availability", () => {
    const out = must(rising(9));
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({
      direction: "rising",
      reversalDir: "bear",
      i: 12,
      confirmedAt: 12,
      sourceT: 1_700_000_000 + 12 * 60,
      earliestObservableT: 1_700_000_000 + 13 * 60,
      algorithmVersion: NINE_BAR_ALGORITHM_VERSION,
    });
    expect(out.points.filter((point) => point.displayEligible).map((point) => point.count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("treats equality as an interruption and never fabricates a relation", () => {
    const input = rising(4);
    input.push({ ...input[input.length - 1], id: "equal", t: input.at(-1)!.t + 60, availableT: input.at(-1)!.availableT! + 60, c: input[4].c });
    const out = must(input, { displayPolicy: "progressive" });
    expect(out.points.map((point) => point.count)).toEqual([1, 2, 3, 4]);
    expect(out.current).toBeNull();
    expect(out.coverage.interruptions).toBe(1);
  });

  it("resets an interrupted direction and starts the immediate opposite direction", () => {
    const input = bars([100, 100, 100, 100, 101, 102, 103, 104, 99, 98, 97, 96, 95]);
    const out = must(input, { displayPolicy: "progressive" });
    const tail = out.points.slice(-5);
    expect(tail.map((point) => [point.direction, point.count])).toEqual([
      ["falling", 1], ["falling", 2], ["falling", 3], ["falling", 4], ["falling", 5],
    ]);
    expect(out.current).toMatchObject({ direction: "falling", absoluteStreak: 5, count: 5 });
  });

  it("emits one completion in single-cycle mode even when the trend persists", () => {
    const out = must(rising(15), { displayPolicy: "progressive", cycleMode: "single" });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].i).toBe(12);
    expect(out.points.filter((point) => point.count === 9)).toHaveLength(1);
    expect(out.current).toMatchObject({ direction: "rising", absoluteStreak: 15, count: 9, cycle: 1 });
  });

  it("segments sustained trends into non-overlapping optional repeat cycles", () => {
    const out = must(rising(20), { displayPolicy: "progressive", cycleMode: "repeat" });
    expect(out.events.map((event) => [event.i, event.cycle])).toEqual([[12, 1], [21, 2]]);
    expect(out.points.filter((point) => point.count === 9).map((point) => point.i)).toEqual([12, 21]);
    expect(out.current).toMatchObject({ absoluteStreak: 20, count: 2, cycle: 3 });
  });

  it("supports multiple completed episodes separated by an opposite run", () => {
    const input = [
      ...rising(9),
      ...falling(13).slice(4).map((bar, j) => ({ ...bar, id: `f${j}`, t: 1_700_001_000 + j * 60, availableT: 1_700_001_060 + j * 60 })),
    ];
    const out = must(input, { displayPolicy: "completed" });
    expect(out.events.map((event) => event.direction)).toEqual(["rising", "falling"]);
    expect(out.episodes.filter((episode) => episode.completedCycles > 0)).toHaveLength(2);
  });

  it("reveals 1–6 retroactively for the active episode", () => {
    const out = must(rising(6));
    expect(out.points.map((point) => point.count)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.points.map((point) => point.displayEligible)).toEqual([true, true, true, true, true, true]);
  });

  it("removes an incomplete retro6 sequence when the next bar fails", () => {
    const input = rising(6);
    const last = input.at(-1)!;
    input.push({ ...last, id: "break", t: last.t + 60, availableT: last.availableT! + 60, c: input[6].c });
    const out = must(input);
    expect(out.events).toEqual([]);
    expect(out.points.some((point) => point.displayEligible)).toBe(false);
  });

  it("keeps completed histories visible after a later interruption", () => {
    const input = rising(9);
    const last = input.at(-1)!;
    input.push({ ...last, id: "break", t: last.t + 60, availableT: last.availableT! + 60, c: 1 });
    const out = must(input);
    expect(out.points.filter((point) => point.displayEligible).map((point) => point.count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("offers progressive and completed-only display policies without changing events", () => {
    const partialProgressive = must(rising(3), { displayPolicy: "progressive" });
    const partialCompleted = must(rising(3), { displayPolicy: "completed" });
    expect(partialProgressive.points.every((point) => point.displayEligible)).toBe(true);
    expect(partialCompleted.points.every((point) => !point.displayEligible)).toBe(true);

    const fullA = must(rising(9), { displayPolicy: "progressive" });
    const fullB = must(rising(9), { displayPolicy: "completed" });
    expect(fullA.events).toEqual(fullB.events);
    expect(fullB.points.filter((point) => point.displayEligible)).toHaveLength(9);
  });

  it("marks a live ninth candle forming but withholds confirmation and alert identity", () => {
    const input = rising(9);
    const forming = must(input, { formingBarIndex: 12 });
    expect(forming.events).toEqual([]);
    expect(forming.points.at(-1)).toMatchObject({ count: 9, forming: true, completed: false, confirmedAt: null });

    const finalized = must(input, { formingBarIndex: null });
    expect(finalized.events).toHaveLength(1);
    expect(finalized.points.at(-1)).toMatchObject({ count: 9, forming: false, completed: true, confirmedAt: 12 });
    expect(finalized.events[0].id).toContain("TEST|1m|regular|rising");
  });

  it("recomputes deterministically after a source correction", () => {
    const original = rising(9);
    const first = must(original);
    const corrected = original.map((bar) => ({ ...bar }));
    corrected[8].c = corrected[4].c;
    const second = must(corrected);
    const third = must(corrected);
    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(0);
    expect(second).toEqual(third);
  });

  it("uses four observed bars on sparse intraday input, never four wall-clock minutes", () => {
    const sparseTimes = [0, 60, 600, 660, 3600, 7200, 7260, 9000, 20_000, 40_000, 41_000, 80_000, 160_000].map((x) => 1_700_000_000 + x);
    const out = must(bars(Array.from({ length: 13 }, (_, i) => 10 + i), sparseTimes));
    expect(out.events).toHaveLength(1);
    expect(out.points.at(-1)).toMatchObject({ i: 12, compareI: 8, sourceT: sparseTimes[12], compareT: sparseTimes[8] });
  });

  it("rejects duplicate and reverse chronological input rather than reordering it", () => {
    const duplicate = rising(2);
    duplicate[5].t = duplicate[4].t;
    const dupOut = computeNineBarExhaustion(duplicate, opts());
    expect(dupOut).toMatchObject({ ok: false, error: { code: "non_chronological", i: 5 } });

    const reverse = rising(2);
    reverse[5].t = reverse[4].t - 1;
    const reverseOut = computeNineBarExhaustion(reverse, opts());
    expect(reverseOut).toMatchObject({ ok: false, error: { code: "non_chronological", i: 5 } });
  });

  it("does not compare through missing closes", () => {
    const input = rising(9);
    input[6].c = Number.NaN;
    const out = must(input, { displayPolicy: "progressive" });
    expect(out.events).toEqual([]);
    expect(out.coverage.missingBars).toBeGreaterThan(0);
    expect(out.points.every((point) => Number.isFinite(point.close) && Number.isFinite(point.compareClose))).toBe(true);
  });

  it("requires an actual opposite relation when price-flip mode is selected", () => {
    const monotonic = must(rising(12), { requirePriceFlip: true, displayPolicy: "progressive" });
    expect(monotonic.points).toEqual([]);

    const input = bars([100, 101, 102, 103, 99, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]);
    const flipped = must(input, { requirePriceFlip: true, displayPolicy: "progressive" });
    expect(flipped.points[0]).toMatchObject({ direction: "rising", count: 1, i: 5 });
  });

  it("preserves prefix parity for replay and never grants future display eligibility", () => {
    const input = rising(9);
    for (let n = 5; n <= input.length; n++) {
      const prefix = must(input.slice(0, n));
      const full = must(input);
      const fullPrefix = full.points.filter((point) => point.i < n);
      // Formula/state fields are prefix-stable. Historical display eligibility may become true only
      // after a completed cycle; replay must retain the prefix decision instead of reading that future.
      expect(prefix.points.map(withoutDisplayEligibility)).toEqual(
        fullPrefix.map(withoutDisplayEligibility),
      );
      if (n < 10) expect(prefix.points.some((point) => point.displayEligible)).toBe(false);
    }
  });

  it("applies history and density only to display, never event formation", () => {
    const full = must(rising(9), { density: "all", historyBars: 500 });
    const sparse = must(rising(9), { density: "completion", historyBars: 2 });
    expect(sparse.events).toEqual(full.events);
    expect(sparse.points.filter((point) => point.displayEligible).map((point) => point.count)).toEqual([9]);
  });

  it("uses stable, context-qualified identities", () => {
    const input = rising(9);
    const a = must(input);
    const b = must(input);
    const c = must(input, { timeframe: "5m" });
    expect(a.events[0].id).toBe(b.events[0].id);
    expect(c.events[0].id).not.toBe(a.events[0].id);
    expect(new Set(a.points.map((point) => point.id)).size).toBe(a.points.length);
  });
});
