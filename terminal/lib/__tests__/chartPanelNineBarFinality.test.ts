import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { suiteFormingBarIndex, suiteSessionIdentity } from "../suiteChartContext";

const display = (isoLocal: string): number => Date.parse(`${isoLocal}Z`) / 1000;
const daily = (...dates: string[]) => dates.map((time, i) => ({ time, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1_000 }));
const intraday = (tailLocal: string, count = 13) => {
  const tail = display(tailLocal);
  return Array.from({ length: count }, (_, i) => ({
    time: tail - (count - 1 - i) * 300,
    o: 100 + i,
    h: 101 + i,
    l: 99 + i,
    c: 100 + i,
    v: 1_000,
  }));
};

describe("native-suite chart context", () => {
  it("marks an initial intraday provider tail forming until its clock/session close", () => {
    const bars = intraday("2026-10-15T10:30:00");
    expect(suiteFormingBarIndex({
      bars,
      timeframe: "5m",
      market: "us",
      extendedHours: false,
      replayActive: false,
      nowMs: Date.parse("2026-10-15T14:34:59Z"),
    })).toBe(12);
    expect(suiteFormingBarIndex({
      bars,
      timeframe: "5m",
      market: "us",
      extendedHours: false,
      replayActive: false,
      nowMs: Date.parse("2026-10-15T14:35:00Z"),
    })).toBeNull();
  });

  it("does not let quote arrival override actual bar finality and replay remains closed", () => {
    const bars = intraday("2026-10-15T10:30:00");
    const closed = {
      bars,
      timeframe: "5m",
      market: "us" as const,
      extendedHours: false,
      nowMs: Date.parse("2026-10-15T14:35:01Z"),
    };
    expect(suiteFormingBarIndex({ ...closed, replayActive: false })).toBeNull();
    expect(suiteFormingBarIndex({ ...closed, replayActive: true })).toBeNull();
  });

  it("keeps today's daily bar forming until the authoritative US session close", () => {
    const bars = daily("2026-10-13", "2026-10-14", "2026-10-15");
    expect(suiteFormingBarIndex({
      bars,
      dailyBars: bars,
      timeframe: "D",
      market: "us",
      extendedHours: false,
      replayActive: false,
      nowMs: Date.parse("2026-10-15T19:59:59Z"),
    })).toBe(2);
    expect(suiteFormingBarIndex({
      bars,
      dailyBars: bars,
      timeframe: "D",
      market: "us",
      extendedHours: false,
      replayActive: false,
      nowMs: Date.parse("2026-10-15T20:00:00Z"),
    })).toBeNull();
  });

  it("keeps incomplete daily-multiple and current weekly buckets forming", () => {
    const incomplete = daily("2026-10-12", "2026-10-13");
    expect(suiteFormingBarIndex({
      bars: [{ ...incomplete[0], closeTime: incomplete.at(-1)!.time }],
      dailyBars: incomplete,
      timeframe: "3D",
      market: "us",
      extendedHours: false,
      replayActive: false,
      nowMs: Date.parse("2026-10-20T21:00:00Z"),
      sessionAnchor: null,
    })).toBe(0);

    const complete = daily("2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15");
    expect(suiteFormingBarIndex({
      bars: [{ ...complete[0], closeTime: complete[0].time }, { ...complete[1], closeTime: complete.at(-1)!.time }],
      dailyBars: complete,
      timeframe: "3D",
      market: "us",
      extendedHours: false,
      replayActive: false,
      nowMs: Date.parse("2026-10-20T21:00:00Z"),
      sessionAnchor: null,
    })).toBeNull();

    const midweek = daily("2026-10-12", "2026-10-13", "2026-10-14");
    expect(suiteFormingBarIndex({
      bars: [{ ...midweek[0], time: "2026-10-14" }],
      dailyBars: midweek,
      timeframe: "W",
      market: "us",
      extendedHours: false,
      replayActive: false,
      nowMs: Date.parse("2026-10-14T21:00:00Z"),
    })).toBe(0);

    const friday = daily("2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16");
    expect(suiteFormingBarIndex({
      bars: [{ ...friday[0], time: "2026-10-16" }],
      dailyBars: friday,
      timeframe: "W",
      market: "us",
      extendedHours: false,
      replayActive: false,
      nowMs: Date.parse("2026-10-16T20:00:01Z"),
    })).toBeNull();
  });

  it("keeps market/session configuration in event identity", () => {
    expect(suiteSessionIdentity("crypto", false)).toBe("crypto-24h");
    expect(suiteSessionIdentity("us", false)).toBe("us-regular");
    expect(suiteSessionIdentity("us", true)).toBe("us-extended");
    expect(suiteSessionIdentity("hk", true)).toBe("hk-extended");
    expect(suiteSessionIdentity("us", true, false)).toBe("daily");
  });

  it("routes every ChartPanel suite computation through one clock/session-aware input helper", () => {
    const source = readFileSync(path.resolve(__dirname, "../../components/ChartPanel.tsx"), "utf8");
    const calls = source.match(/computeSuite\(def, suiteRenderParams\(k\), suiteHostInput\(/g) ?? [];
    expect(calls).toHaveLength(4);
    expect(source).toContain("dailyBars: dailyBarsRef.current");
    expect(source).toContain("timeframe: timeframeRef.current");
    expect(source).toContain("nowMs: Date.now()");
    expect(source).not.toContain("acceptedLiveTick: liveTickRef.current !== null");
    expect(source).not.toMatch(/computeSuite\(def, suiteRenderParams\(k\),\s*\{/);
  });
});
