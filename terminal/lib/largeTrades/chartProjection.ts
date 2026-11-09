import { localDisplay } from "@/lib/intradaySources";
import { classify, isIntradayTf, tfSeconds } from "@/lib/intradayShared";
import { isMacroSymbol, macroDisplayTz } from "@/lib/macroSymbols";
import type { ReplayCutoff } from "@/lib/replayContract";
import type { LargeTradeCluster, LargeTradesClock, LargeTradesEnvelope } from "./types";

/** Rendering conversion only; the source and inference engine retain true UTC nanoseconds. */
export function chartDisplayTimezone(symbol: string): string {
  if (isMacroSymbol(symbol)) return macroDisplayTz(symbol);
  const market = classify(symbol);
  if (market === "cn") return "Asia/Shanghai";
  if (market === "hk") return "Asia/Hong_Kong";
  // The existing Polygon equity/crypto chart reader uses the ET display axis for both.
  return "America/New_York";
}

export function utcMsToDisplayEpoch(ms: number, timezone: string): number {
  if (!Number.isFinite(ms) || ms < 0) throw new Error("invalid UTC time");
  const minute = localDisplay(ms, timezone).epoch;
  return minute + (ms % 60_000) / 1000;
}

/**
 * Invert the existing display-epoch convention. A DST fold has TWO answers and a
 * spring gap has none: refuse either instead of silently selecting a later instant.
 */
export function displayEpochToUtcMs(displayMs: number, timezone: string): number | null {
  if (!Number.isFinite(displayMs) || displayMs < 0) return null;
  const offsets = new Set<number>();
  try {
    for (const hours of [-36, 0, 36]) {
      const sample = displayMs + hours * 3_600_000;
      offsets.add(Math.round(utcMsToDisplayEpoch(sample, timezone) * 1000 - sample));
    }
    const candidates = [...offsets].map((offset) => displayMs - offset)
      .filter((utc) => Math.abs(utcMsToDisplayEpoch(utc, timezone) * 1000 - displayMs) < 0.5);
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? unique[0] : null;
  } catch {
    return null;
  }
}

export type ClockResolution =
  | { state: "ready"; clock: LargeTradesClock }
  | { state: "unsupported_replay_clock" | "ambiguous_replay_time" };

export function resolveLargeTradesClock(
  envelope: LargeTradesEnvelope,
  replay: ReplayCutoff | null,
  displayTimezone: string,
  nowMs: number,
): ClockResolution {
  const nowNs = BigInt(Math.trunc(nowMs)) * BigInt(1000000);
  let market = nowNs;
  if (replay) {
    if (replay.clock !== "intraday") return { state: "unsupported_replay_clock" };
    const utc = displayEpochToUtcMs(replay.at, displayTimezone);
    if (utc == null) return { state: "ambiguous_replay_time" };
    market = BigInt(Math.trunc(utc)) * BigInt(1000000);
  }
  if (market > nowNs) market = nowNs;
  // A historical reconstruction may use an archive acquired later; it is never
  // labeled as evidence actually observed at that historic decision instant.
  const knowledge = replay && envelope.provenance.evidenceMode === "ACTUAL_AS_SEEN"
    ? market : nowNs;
  return { state: "ready", clock: {
    marketCutoffNs: market.toString(), knowledgeCutoffNs: knowledge.toString(),
  } };
}

export type ProjectionBar = { time: unknown };
export type ProjectedCluster = {
  cluster: LargeTradeCluster;
  chartTime: number;
  exactDisplayEpoch: number;
  price: number;
  diameter: number;
};

/** Anchor a transaction to a real existing bar interval, never to the nearest future bar. */
export function projectLargeTradeClusters(
  clusters: readonly LargeTradeCluster[],
  bars: readonly ProjectionBar[],
  timeframe: string,
  displayTimezone: string,
  minQuantity: number,
): ProjectedCluster[] {
  if (!isIntradayTf(timeframe)) return [];
  const seconds = tfSeconds(timeframe);
  if (!(seconds > 0)) return [];
  const times = bars.map((bar) => typeof bar.time === "number" ? bar.time : NaN);
  if (!times.length || times.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= times[i - 1]))) return [];
  const result: ProjectedCluster[] = [];
  for (const cluster of clusters) {
    const at = utcMsToDisplayEpoch(Number(BigInt(cluster.endNs) / BigInt(1000000)), displayTimezone);
    let lo = 0, hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (times[mid] <= at) lo = mid + 1; else hi = mid;
    }
    const index = lo - 1;
    if (index < 0 || at >= times[index] + seconds) continue;
    const price = cluster.weightedPrice;
    if (!Number.isFinite(price) || price <= 0) continue;
    result.push({
      cluster, chartTime: times[index], exactDisplayEpoch: at, price,
      // Circle area, rather than radius, grows with executed quantity. Size remains
      // bounded for crowded charts; the exact uncapped quantity is always the label.
      diameter: Math.min(64, Math.max(24, 24 * Math.sqrt(cluster.quantity / Math.max(1, minQuantity)))),
    });
  }
  return result;
}

/** A stopped or old live producer cannot keep a Live badge through its last snapshot. */
export function largeTradesModeLabel(
  envelope: LargeTradesEnvelope, nowMs: number,
): "live" | "delayed" | "historical" | "fixture" | "unavailable" | "stale" {
  const mode = envelope.provenance.dataMode;
  if (mode !== "live") return mode;
  const lastEvent = Number(BigInt(envelope.range.endNs) / BigInt(1000000));
  const generated = Number(BigInt(envelope.provenance.generatedAtNs) / BigInt(1000000));
  return lastEvent > nowMs || generated > nowMs || nowMs - lastEvent > 60_000 || nowMs - generated > 60_000 ? "stale" : "live";
}
