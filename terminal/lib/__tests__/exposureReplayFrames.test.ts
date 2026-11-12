import { describe, expect, it } from "vitest";
import datedProducerV2 from "./fixtures/exposure-projection-dated-v2.json";
import producerV2 from "./fixtures/exposure-projection-v2.json";
import {
  buildReplayFrameSet, reduceReplayFrame, replayTier, selectReplaySessions, REPLAY_FRAMES_VERSION,
  type ReplayColumn, type ReplayFrame,
} from "../exposureReplayFrames";
import { reportedGammaBook } from "./fixtures/reportedGammaBooks";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const TODAY = "2026-10-21";
const ALL = { kind: "all" } as const;
const reduce = (raw: unknown, session: string, metric: "gamma" | "delta" = "gamma", current = false) =>
  reduceReplayFrame(raw, "SPY", session, metric, ALL, TODAY, NOW, current);

const frameColumn = (session: string, values: Record<number, number | null>, over: Partial<ReplayFrame> = {}): ReplayColumn =>
  ({
    kind: "frame",
    frame: {
      session, kind: "observed", current: false, spot: 100,
      values: new Map(Object.entries(values).map(([k, v]) => [Number(k), v] as [number, number | null])),
      dominant: null, runnerUp: null, runnerUpRatio: null, contested: null, coverage: null, clocks: null, sourceRef: null,
      ...over,
    },
  });

describe("selectReplaySessions", () => {
  const dates = ["2026-10-20", "2026-10-19", "2026-10-17", "2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"];

  it("returns the newest max−1 sessions strictly before the live session, oldest first", () => {
    expect(selectReplaySessions(dates, "2026-10-21", 4)).toEqual(["2026-10-17", "2026-10-19", "2026-10-20"]);
  });

  it("excludes the live session itself and tolerates index holes", () => {
    expect(selectReplaySessions(["2026-10-21", "2026-10-20", "2026-10-19", "2026-10-17"], "2026-10-21", 7))
      .toEqual(["2026-10-17", "2026-10-19", "2026-10-20"]);
  });

  it("copes with fewer than max, a null live session and non-date entries", () => {
    expect(selectReplaySessions(["2026-10-16", "2026-10-15"], "2026-10-21", 7)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(selectReplaySessions(dates, "2026-10-21", 1)).toEqual([]);
    expect(selectReplaySessions(dates, null, 3)).toEqual(["2026-10-19", "2026-10-20"]);
    expect(selectReplaySessions(["2026-10-20", "garbage", 12345 as unknown as string], "2026-10-21", 3)).toEqual(["2026-10-20"]);
  });
});

describe("reduceReplayFrame", () => {
  const modeled = () => {
    const p = structuredClone(producerV2);
    return { schema: "options_hub.gex/v1", root: "SPY", asof: p.clocks.source_session, spot_ref: 100,
      net_gex_bn: null, by_strike: [], exposure_projection: p };
  };

  it("reads a stored qualified (modeled) book as an observed frame with its own nodes", () => {
    const book = modeled();
    const column = reduce(book, String(book.asof));
    expect(column.kind).toBe("frame");
    if (column.kind !== "frame") return;
    expect(column.frame.kind).toBe("observed");
    expect(column.frame.current).toBe(false);
    expect(column.frame.session).toBe(String(book.asof));
    expect(column.frame.values.size).toBeGreaterThan(0);
    expect([...column.frame.values.values()].some((v) => v != null)).toBe(true);
  });

  it("reads a dated-provider capture as a reconstructed frame, never as observed", () => {
    const book = { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-15", spot_ref: 999,
      net_gex_bn: null, by_strike: [], exposure_projection: structuredClone(datedProducerV2) };
    const column = reduce(book, "2026-10-15");
    expect(column.kind).toBe("frame");
    if (column.kind !== "frame") return;
    expect(column.frame.kind).toBe("reconstructed");
    expect(column.frame.current).toBe(false);
    expect(column.frame.sourceRef).toBe("owner:immutable-snapshot-1");
  });

  // The reportedGammaBook fixture embeds a dated_provider_approximation receipt,
  // so the desk reader labels it dated — reconstructed, not observed.
  it("labels a stored book carrying a dated receipt as reconstructed even when reported", () => {
    const column = reduce(reportedGammaBook("2026-10-16"), "2026-10-16");
    if (column.kind !== "frame") { throw new Error("expected a frame"); }
    expect(column.frame.kind).toBe("reconstructed");
  });

  it("reads a legacy by_strike book as an aggregate frame and refuses other metrics with scope", () => {
    const book = { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-13", spot_ref: 100,
      net_gex_bn: 1.1, by_strike: [{ strike: 95, gamma_net: -4 }, { strike: 100, gamma_net: 8 }, { strike: 105, gamma_net: 0 }] };
    const column = reduce(book, "2026-10-13");
    expect(column).toMatchObject({ kind: "frame", frame: { kind: "aggregate", dominant: 100, runnerUp: 95,
      runnerUpRatio: 0.5, contested: false, coverage: null, spot: 100 } });
    if (column.kind !== "frame") return;
    expect(column.frame.values.get(95)).toBe(-4);
    expect(column.frame.values.get(105)).toBe(0);
    expect(reduce(book, "2026-10-13", "delta")).toEqual({ kind: "gap", gap: { session: "2026-10-13", reason: "scope" } });
  });

  it("marks identity and session mismatches and non-books as gaps, never as frames", () => {
    const qqq = { schema: "options_hub.gex/v1", root: "QQQ", asof: "2026-10-16", spot_ref: 100,
      by_strike: [{ strike: 100, gamma_net: 3 }] };
    expect(reduce(qqq, "2026-10-16")).toEqual({ kind: "gap", gap: { session: "2026-10-16", reason: "identity" } });
    const otherSession = { schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-14", spot_ref: 100,
      by_strike: [{ strike: 100, gamma_net: 3 }] };
    expect(reduce(otherSession, "2026-10-16")).toEqual({ kind: "gap", gap: { session: "2026-10-16", reason: "session" } });
    expect(reduce(null, "2026-10-16")).toEqual({ kind: "gap", gap: { session: "2026-10-16", reason: "unavailable" } });
    expect(reduce({ schema: "options_hub.gex/v1", root: "SPY", asof: "not-a-date", by_strike: [] }, "2026-10-16"))
      .toEqual({ kind: "gap", gap: { session: "2026-10-16", reason: "malformed" } });
  });

  it("marks the live book as current and carries the read's coverage", () => {
    const column = reduce(reportedGammaBook("2026-10-16"), "2026-10-16", "gamma", true);
    if (column.kind !== "frame") { throw new Error("expected a frame"); }
    expect(column.frame.current).toBe(true);
    expect(column.frame.coverage).not.toBeNull();
    expect(Object.keys(column.frame.coverage ?? {}).sort()).toEqual(["expected", "qualified"]);
    expect(column.frame.spot).not.toBeNull();
  });
});

describe("buildReplayFrameSet", () => {
  const withinWindow = () => [
    frameColumn("2026-10-15", { 90: -30, 96: 10, 100: -8, 110: 40 }, { dominant: 96 }),
    frameColumn("2026-10-16", { 96: 20, 100: 50, 104: null }, { dominant: 100, runnerUp: 96, runnerUpRatio: 0.4 }),
  ];

  it("unions frame strikes within the window of the reference spot, descending", () => {
    const set = buildReplayFrameSet(withinWindow(), { root: "SPY", metric: "gamma", lens: "all", windowPct: 4, referenceSpot: 100 });
    expect(set.strikes).toEqual([104, 100, 96]);
    expect(set.version).toBe(REPLAY_FRAMES_VERSION);
    expect(set.referenceSpot).toBe(100);
  });

  it("normalizes against the set-wide max and falls back to the newest frame's spot", () => {
    const set = buildReplayFrameSet(withinWindow(), { root: "SPY", metric: "gamma", lens: "all", windowPct: 4, referenceSpot: null });
    expect(set.maxAbsMn).toBe(50);
    expect(set.referenceSpot).toBe(100);
    const wide = buildReplayFrameSet(withinWindow(), { root: "SPY", metric: "gamma", lens: "all", windowPct: 25, referenceSpot: 100 });
    expect(wide.strikes).toEqual([110, 104, 100, 96, 90]);
  });

  it("keeps gap columns in place with a null leader and no provenance across the gap", () => {
    const columns = [
      frameColumn("2026-10-15", { 96: 10, 100: -8 }, { dominant: 96, runnerUp: 100 }),
      { kind: "gap" as const, gap: { session: "2026-10-16", reason: "unavailable" as const } },
      frameColumn("2026-10-17", { 96: 12, 100: -8 }, { dominant: 96 }),
    ];
    const set = buildReplayFrameSet(columns, { root: "SPY", metric: "gamma", lens: "all", windowPct: 4, referenceSpot: 100 });
    expect(set.leaderPath).toEqual([96, null, 96]);
    expect(set.provenance[0]).toBeNull();
    expect(set.provenance[1]).toBeNull();
    expect(set.provenance[2]).toBeNull();
  });

  it("relates each column to the next: runner-up promotion, held leader and a new leader", () => {
    const promote = buildReplayFrameSet([
      frameColumn("2026-10-15", { 96: 12, 100: 30 }, { dominant: 100, runnerUp: 96 }),
      frameColumn("2026-10-16", { 96: 24, 100: 18 }, { dominant: 96, runnerUp: 100 }),
    ], { root: "SPY", metric: "gamma", lens: "all", windowPct: 4, referenceSpot: 100 });
    expect(promote.provenance[0]).toEqual({ strike: 96, changeMn: 12, relation: "runner_up_to_leader" });

    const held = buildReplayFrameSet([
      frameColumn("2026-10-15", { 96: 12, 100: 30 }, { dominant: 100, runnerUp: 96 }),
      frameColumn("2026-10-16", { 96: 14, 100: 22 }, { dominant: 100, runnerUp: 96 }),
    ], { root: "SPY", metric: "gamma", lens: "all", windowPct: 4, referenceSpot: 100 });
    expect(held.provenance[0]).toEqual({ strike: 100, changeMn: -8, relation: "leader_held" });

    const newcomer = buildReplayFrameSet([
      frameColumn("2026-10-15", { 96: 12, 100: 30 }, { dominant: 100, runnerUp: 96 }),
      frameColumn("2026-10-16", { 96: 14, 100: 22, 104: 40 }, { dominant: 104, runnerUp: 100 }),
    ], { root: "SPY", metric: "gamma", lens: "all", windowPct: 4, referenceSpot: 100 });
    expect(newcomer.provenance[0]).toEqual({ strike: 104, changeMn: null, relation: "new_leader" });
    expect(newcomer.provenance[1]).toBeNull();
  });

  it("withholds a tier for unknown cells and matches the map's thresholds at the boundaries", () => {
    expect(replayTier(null, 100)).toBe("u");
    expect(replayTier(10, 0)).toBe("u");
    for (const [ratio, tier] of [[0.7, "5"], [0.6999, "4"], [0.45, "4"], [0.4499, "3"], [0.25, "3"],
      [0.2499, "2"], [0.12, "2"], [0.1199, "1"], [0.04, "1"], [0.0399, "0"]] as const) {
      expect(replayTier(ratio * 100, 100)).toBe(tier);
    }
    expect(replayTier(-70, 100)).toBe("5");
  });
});



