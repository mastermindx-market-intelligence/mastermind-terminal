import { describe, expect, it } from "vitest";
import {
  createLiveCandleState, liveCandleRemaining, mutateLiveCandle,
  type LiveCandleBar, type LiveCandleQuote,
} from "@/lib/liveCandle";

const DAY = "2026-10-21";
const POST = Date.parse("2026-10-21T22:02:11Z"); // 18:02:11 EDT.
const display = (time: string, date = DAY) => Date.parse(date + "T" + time + "Z") / 1000;
type SnapshotQuote = LiveCandleQuote & { open?: number; high?: number; low?: number; vol?: number };
const snapshot = (asOfMs = POST, last = 221.8, patch: Partial<SnapshotQuote> = {}): SnapshotQuote => ({
  source: "polygon-snapshot-rt", basis: "REALTIME", marketSession: "post", last, asOfMs,
  ts: Math.floor(asOfMs / 1000), extSource: "polygon-delayed", extBasis: "DELAYED_15M",
  extSession: "post", extPrice: 221.61, extTs: (asOfMs - 900_000) / 1000,
  // Daily OHLCV must never seed a snapshot-driven intraday candle.
  open: 211, high: 239, low: 204, vol: 99_999_999, ...patch,
});
const history = (time = "18:02:00", date = DAY): LiveCandleBar[] => [
  { time: display(time, date), o: 221.6, h: 221.7, l: 221.55, c: 221.61, v: 500 },
];

describe("qualified snapshot candles", () => {
  it("preserves history open/volume, expands observed extremes and marks partial coverage", () => {
    const bars = history();
    bars[0].liveCoverage = "complete";
    const before = structuredClone(bars);
    const state = createLiveCandleState();
    const first = mutateLiveCandle(bars, snapshot(), "1m", "us", true, false, state, POST + 1000)!;
    expect(first).toMatchObject({ kind: "tick", direction: "up", coverage: "partial" });
    expect(first.bar).toEqual({
      time: display("18:02:00"), o: 221.6, h: 221.8, l: 221.55, c: 221.8, v: 500,
      liveCoverage: "partial",
    });
    expect(first.bars).not.toBe(bars);
    expect(bars).toEqual(before);
    const second = mutateLiveCandle(first.bars, snapshot(POST + 8000, 221.4), "1m", "us", true, false, state, POST + 9000)!;
    expect(second).toMatchObject({ direction: "down", coverage: "partial" });
    expect(second.bar).toEqual({
      time: display("18:02:00"), o: 221.6, h: 221.8, l: 221.4, c: 221.4, v: 500,
      liveCoverage: "partial",
    });
    expect(first.bar.c).toBe(221.8);
  });

  it.each([
    { tf: "1m", open: "18:02:00", remaining: 48 },
    { tf: "15m", open: "18:00:00", remaining: 768 },
    { tf: "4h", open: "16:00:00", remaining: 7068 },
  ])("updates the existing $tf ETH bucket and countdown", ({ tf, open, remaining }) => {
    const result = mutateLiveCandle(history(open), snapshot(), tf, "us", true, false, createLiveCandleState(), POST + 1000)!;
    expect(result).toMatchObject({ kind: "tick", coverage: "partial", bar: {
      time: display(open), c: 221.8, liveCoverage: "partial",
    } });
    expect(liveCandleRemaining(Number(result.bar.time), tf, "us", false, POST + 1000, true)).toBe(remaining);
  });

  it.each([
    { tf: "1m", oldOpen: "18:02:00", newOpen: "18:03:00", before: "2026-10-21T22:02:59Z", after: "2026-10-21T22:03:02Z", session: "post" },
    { tf: "15m", oldOpen: "18:00:00", newOpen: "18:15:00", before: "2026-10-21T22:14:59Z", after: "2026-10-21T22:15:02Z", session: "post" },
    // 4h ETH is anchored at 04:00; 20:00 would enter the separate overnight lane.
    { tf: "4h", oldOpen: "04:00:00", newOpen: "08:00:00", before: "2026-10-21T11:59:59Z", after: "2026-10-21T12:00:02Z", session: "pre" },
  ])("rolls $tf with zero unknown volume", ({ tf, oldOpen, newOpen, before, after, session }) => {
    const state = createLiveCandleState(), t1 = Date.parse(before), t2 = Date.parse(after);
    const patch = { marketSession: session, extSession: session };
    const first = mutateLiveCandle(history(oldOpen), snapshot(t1, 221.8, patch), tf, "us", true, false, state, t1 + 100)!;
    const prior = structuredClone(first.bars);
    const next = mutateLiveCandle(first.bars, snapshot(t2, 222, patch), tf, "us", true, false, state, t2 + 100)!;
    expect(next).toMatchObject({ kind: "new-bar", coverage: "partial" });
    expect(next.bars).toHaveLength(2);
    expect(next.bars[0]).toEqual(prior[0]);
    expect(first.bars).toEqual(prior);
    expect(next.bar).toEqual({ time: display(newOpen), o: 222, h: 222, l: 222, c: 222, v: 0, liveCoverage: "partial" });
  });

  it("does not fabricate missing buckets", () => {
    const now = Date.parse("2026-10-21T22:07:02Z");
    const result = mutateLiveCandle(history(), snapshot(now), "1m", "us", true, false, createLiveCandleState(), now)!;
    expect(result.bars.map(b => b.time)).toEqual([display("18:02:00"), display("18:07:00")]);
    expect(result.bar).toMatchObject({ o: 221.8, h: 221.8, l: 221.8, c: 221.8, v: 0, liveCoverage: "partial" });
  });

  it("also accepts pre/post observations in explicit 24H mode", () => {
    expect(mutateLiveCandle(history(), snapshot(), "1m", "us", false, true, createLiveCandleState(), POST))
      .toMatchObject({ coverage: "partial", bar: { c: 221.8 } });
  });

  it("is idempotent and advances ordering on a newer same-price no-op", () => {
    const state = createLiveCandleState();
    const first = mutateLiveCandle(history(), snapshot(), "1m", "us", true, false, state, POST)!;
    const before = structuredClone(first.bars);
    expect(mutateLiveCandle(first.bars, snapshot(), "1m", "us", true, false, state, POST + 1000)).toBeNull();
    expect(mutateLiveCandle(first.bars, snapshot(POST + 20_000), "1m", "us", true, false, state, POST + 20_100)).toBeNull();
    expect(mutateLiveCandle(first.bars, snapshot(POST + 15_000, 210), "1m", "us", true, false, state, POST + 20_100)).toBeNull();
    expect(first.bars).toEqual(before);
  });

  it("resets observation ordering when authoritative history replaces the array", () => {
    const state = createLiveCandleState();
    mutateLiveCandle(history(), snapshot(), "1m", "us", true, false, state, POST);
    const replaced = history();
    replaced[0] = { ...replaced[0], h: 230, l: 215, v: 1500 };
    expect(mutateLiveCandle(replaced, snapshot(POST - 1000, 222), "1m", "us", true, false, state, POST + 1000))
      .toMatchObject({ bar: { o: 221.6, h: 230, l: 215, c: 222, v: 1500, liveCoverage: "partial" } });
  });

  it("scopes the observation floor to the selected timeframe/session", () => {
    const state = createLiveCandleState();
    const first = mutateLiveCandle(history("18:00:00"), snapshot(), "1m", "us", true, false, state, POST)!;
    expect(mutateLiveCandle(first.bars, snapshot(POST - 1000, 222), "1m", "us", false, true, state, POST + 1000))
      .toMatchObject({ bar: { c: 222 } });
  });

  it("preserves an explicit qualified LIVE extended observation's precedence", () => {
    const quote = snapshot(POST, 221.8, {
      extSource: "polygon-live-second", extBasis: "LIVE", extPrice: 222.25, extTs: POST / 1000,
    });
    expect(mutateLiveCandle(history(), quote, "1m", "us", true, false, createLiveCandleState(), POST))
      .toMatchObject({ bar: { c: 222.25, h: 222.25, v: 500 } });
  });
});

describe("snapshot admission guards", () => {
  it("requires explicit ETH or 24H selection", () => {
    expect(mutateLiveCandle(history(), snapshot(), "1m", "us", false, false, createLiveCandleState(), POST)).toBeNull();
  });
  it.each(["1s", "5s", "15s", "30s", "D", "W"])("does not enable %s", tf => {
    expect(mutateLiveCandle(history(), snapshot(), tf, "us", true, false, createLiveCandleState(), POST)).toBeNull();
  });
  it.each([
    { name: "delayed source", patch: { source: "polygon-snapshot" } },
    { name: "unknown source", patch: { source: "another-realtime-source" } },
    { name: "missing source", patch: { source: undefined } },
    { name: "delayed basis", patch: { basis: "DELAYED_15M" } },
    { name: "unmeasured LIVE basis", patch: { basis: "LIVE" } },
    { name: "missing print clock despite ts", patch: { asOfMs: undefined } },
    { name: "null print clock despite ts", patch: { asOfMs: null } },
    { name: "NaN print clock", patch: { asOfMs: NaN } },
    { name: "infinite print clock", patch: { asOfMs: Infinity } },
    { name: "zero print clock", patch: { asOfMs: 0 } },
    { name: "zero price", patch: { last: 0 } },
    { name: "negative price", patch: { last: -1 } },
    { name: "NaN price", patch: { last: NaN } },
    { name: "infinite price", patch: { last: Infinity } },
  ] satisfies { name: string; patch: Partial<SnapshotQuote> }[])("refuses $name", ({ patch }) => {
    expect(mutateLiveCandle(history(), snapshot(POST, 221.8, patch), "1m", "us", true, false, createLiveCandleState(), POST)).toBeNull();
  });
  it.each([
    { name: "older than 120s", event: POST - 120_001 },
    { name: "more than 5s future", event: POST + 5001 },
  ])("refuses $name without poisoning the next valid print", ({ event }) => {
    const state = createLiveCandleState(), bars = history("18:00:00");
    expect(mutateLiveCandle(bars, snapshot(event), "15m", "us", true, false, state, POST)).toBeNull();
    expect(mutateLiveCandle(bars, snapshot(), "15m", "us", true, false, state, POST)).toMatchObject({ bar: { c: 221.8 } });
  });
  it.each([
    { name: "RTH event behind a current post label", event: "2026-10-21T19:59:59Z", now: "2026-10-21T20:00:01Z", date: DAY, open: "15:59:00" },
    { name: "overnight event in 24H mode", event: "2026-10-22T00:00:01Z", now: "2026-10-22T00:00:02Z", date: DAY, open: "19:59:00" },
    { name: "closed Sunday daytime", event: "2026-10-25T18:00:00Z", now: "2026-10-25T18:00:01Z", date: "2026-10-25", open: "13:59:00" },
    { name: "unknown calendar", event: "2029-01-01T23:02:11Z", now: "2029-01-01T23:02:12Z", date: "2029-01-01", open: "18:02:00" },
  ])("refuses $name using actual event time", ({ event, now, date, open }) => {
    expect(mutateLiveCandle(history(open, date), snapshot(Date.parse(event)), "1m", "us", true, true, createLiveCandleState(), Date.parse(now))).toBeNull();
  });
});

describe("native source handoff after snapshot observations", () => {
  const native = (asOfMs: number, price: number, time = display("18:02:00")): LiveCandleQuote => ({
    source: "polygon-live-second", basis: "REALTIME", marketSession: "post", last: price, asOfMs, tickEndMs: asOfMs,
    formingCandles: { version: 1, source: "polygon-live-second", generation: "d4606eb2-61c0-43a9-b89e-ff8da926ebf4",
      generationStartedMs: POST - 1000, revision: 1, asOfMs, timeframes: "1m",
      series: { "extended:1m": [{ time, o: 221.6, h: Math.max(221.8, price), l: Math.min(221.55, price), c: price, v: 550, complete: true }] } },
  });
  it("rejects an older native revision before consuming it, then accepts a newer native handoff", () => {
    const state = createLiveCandleState();
    const first = mutateLiveCandle(history(), snapshot(), "1m", "us", true, false, state, POST)!;
    expect(mutateLiveCandle(first.bars, snapshot(POST + 20_000), "1m", "us", true, false, state, POST + 20_000)).toBeNull();
    expect(mutateLiveCandle(first.bars, native(POST + 15_000, 220), "1m", "us", true, false, state, POST + 21_000)).toBeNull();
    expect(state.revision).toBe(-1);
    expect(mutateLiveCandle(first.bars, native(POST + 21_000, 222), "1m", "us", true, false, state, POST + 21_000))
      .toMatchObject({ coverage: "complete", bar: { c: 222, v: 550 } });
    expect(state.revision).toBe(1);
  });

  it("uses an admissible explicit extended tick's own timestamp after older forming data", () => {
    const state = createLiveCandleState();
    const first = mutateLiveCandle(history(), snapshot(), "1m", "us", true, false, state, POST)!;
    mutateLiveCandle(first.bars, snapshot(POST + 20_000), "1m", "us", true, false, state, POST + 20_000);
    const quote = { ...native(POST + 15_000, 220), extSource: "polygon-live-second", extBasis: "LIVE",
      extPrice: 223, extTs: (POST + 21_000) / 1000 };
    expect(mutateLiveCandle(first.bars, quote, "1m", "us", true, false, state, POST + 21_000))
      .toMatchObject({ coverage: "partial", bar: { c: 223, h: 223 } });
  });
});

describe("BOATS stays confined to its overnight mode", () => {
  const ms = Date.parse("2026-10-22T00:00:10Z");
  const boats = (): SnapshotQuote => snapshot(ms, 250, {
    marketSession: "overnight", extSource: "tiingo_boats", extBasis: "LIVE", extSession: "overnight",
    extVenue: "BOATS", extPriceKind: "LAST_TRADE", extPrice: 222, extTs: ms / 1000,
    extReceivedTs: ms / 1000, extPublishedTs: ms / 1000, extExpiresTs: ms / 1000 + 30,
  });
  it("requires explicit 24H selection", () => {
    expect(mutateLiveCandle(history("19:59:00"), boats(), "1m", "us", true, false, createLiveCandleState(), ms)).toBeNull();
    expect(mutateLiveCandle(history("19:59:00"), boats(), "1m", "us", true, true, createLiveCandleState(), ms))
      .toMatchObject({ bar: { time: display("20:00:00"), o: 222, h: 222, l: 222, c: 222, v: 0 } });
  });
  it.each([
    { name: "expired BOATS", patch: { extExpiresTs: ms / 1000 } },
    { name: "unqualified venue", patch: { extVenue: "OTHER" } },
    { name: "non-BOATS overnight live lane", patch: { extSource: "polygon-live-second" } },
  ])("does not rescue $name with snapshot last", ({ patch }) => {
    expect(mutateLiveCandle(history("19:59:00"), { ...boats(), ...patch }, "1m", "us", true, true, createLiveCandleState(), ms)).toBeNull();
  });
});

it("does not let an overnight tick on an ETH-only pane bypass the native handoff fence", () => {
  const now = Date.parse("2026-10-22T00:00:05Z");
  const t30 = Date.parse("2026-10-21T23:59:30Z");
  const time = Date.UTC(2026, 9, 21, 19, 59) / 1000;
  const state = createLiveCandleState();
  const snapshot = (asOfMs: number) => ({ source: "polygon-snapshot-rt", basis: "REALTIME",
    marketSession: "post", last: 100, asOfMs });
  const first = mutateLiveCandle([{ time, o: 100, h: 100, l: 99, c: 99, v: 1200 }],
    snapshot(t30), "1m", "us", true, false, state, now)!;
  expect(mutateLiveCandle(first.bars, snapshot(t30 + 20000), "1m", "us", true, false, state, now)).toBeNull();
  const nativeMs = t30 + 10000, extTs = (now - 1000) / 1000;
  const native = { source: "polygon-live-second", basis: "REALTIME", marketSession: "overnight",
    last: 99, asOfMs: nativeMs, tickEndMs: nativeMs,
    extSource: "tiingo_boats", extBasis: "LIVE", extPrice: 101, extTs,
    extSession: "overnight", extVenue: "BOATS", extPriceKind: "LAST_TRADE",
    extReceivedTs: extTs, extPublishedTs: extTs, extExpiresTs: extTs + 30,
    formingCandles: { version: 1 as const, source: "polygon-live-second" as const,
      generation: "d4606eb2-61c0-43a9-b89e-ff8da926ebf4", generationStartedMs: t30 - 1000,
      revision: 1, asOfMs: nativeMs, timeframes: "1m",
      series: { "extended:1m": [{ time, o: 100, h: 100, l: 99, c: 99, v: 1200, complete: true }] } } };
  expect(mutateLiveCandle(first.bars, native, "1m", "us", true, false, state, now)).toBeNull();
  expect(state.revision).toBe(-1);
});
