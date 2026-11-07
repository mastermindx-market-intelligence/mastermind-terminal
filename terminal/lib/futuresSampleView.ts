import { isRecord, finiteNumber } from "./futuresGexProjection";
import type { FuturesChartFrame } from "./futuresWorkspace";

export type FuturesPublicSampleView = {
  schema: "terminal.futures_public_sample_view/v1"; live: false; synthetic: false; contract: string;
  source: string; availabilityBasis: "vendor_capture_retrospective"; referenceDefinition: "diagnostic_sample_window_only";
  gammaAvailability: "not_in_source_sample"; subscriberDisplayRights: "not_established";
  baseMs: number; lowTick: number; highTick: number; framesByCutoff: FuturesChartFrame[][];
  sourceRawSha256: string; referenceRawSha256: string; depthSampling: "every_completed_source_event";
  comparison: { compared: number; exact: number; mismatches: number; unmatched: number; tradeConservation: boolean };
};
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const ns = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d{0,19})$/.test(v);

/** Validate the local diagnostic bundle; no historical gamma/venue-definition permission implied. */
export function parseFuturesSampleView(raw: unknown): FuturesPublicSampleView | null {
  if (!isRecord(raw) || raw.schema !== "terminal.futures_public_sample_view/v1" || raw.live !== false || raw.synthetic !== false ||
      raw.availabilityBasis !== "vendor_capture_retrospective" || raw.referenceDefinition !== "diagnostic_sample_window_only" ||
      raw.gammaAvailability !== "not_in_source_sample" || raw.subscriberDisplayRights !== "not_established" ||
      raw.depthSampling !== "every_completed_source_event" || typeof raw.source !== "string" ||
      typeof raw.contract !== "string" || !/^(ES|NQ)[HMUZ]\d{1,4}$/.test(raw.contract) ||
      !finiteNumber(raw.baseMs) || !Number.isSafeInteger(raw.baseMs) || raw.baseMs <= 0 ||
      !finiteNumber(raw.lowTick) || !finiteNumber(raw.highTick) || !Number.isSafeInteger(raw.lowTick) ||
      !Number.isSafeInteger(raw.highTick) || raw.lowTick <= 0 || raw.highTick < raw.lowTick || raw.highTick - raw.lowTick >= 2048 ||
      !digest(raw.sourceRawSha256) || !digest(raw.referenceRawSha256) || !isRecord(raw.comparison) ||
      raw.comparison.compared !== raw.comparison.exact || raw.comparison.mismatches !== 0 || raw.comparison.unmatched !== 0 ||
      raw.comparison.tradeConservation !== true || !finiteNumber(raw.comparison.compared) || raw.comparison.compared <= 0 ||
      !Array.isArray(raw.framesByCutoff) || raw.framesByCutoff.length < 1 || raw.framesByCutoff.length > 15) return null;
  for (let i = 0; i < raw.framesByCutoff.length; i++) {
    const frames = raw.framesByCutoff[i];
    if (!Array.isArray(frames) || frames.length > 15) return null;
    const cutoff = BigInt(raw.baseMs + (i + 1) * 60000) * BigInt(1000000);
    let previous = 0;
    for (const f of frames) {
      if (!isRecord(f) || !finiteNumber(f.endMs) || !Number.isSafeInteger(f.endMs) || f.endMs <= previous ||
          BigInt(f.endMs) * BigInt(1000000) > cutoff || !isRecord(f.gex) || f.gex.status !== "unavailable" ||
          f.gex.reason !== "source_unavailable" || !isRecord(f.bar)) return null;
      previous = f.endMs;
      const b = f.bar;
      if (!ns(b.startNs) || !ns(b.endNs) || !ns(b.availableAtNs) || BigInt(b.availableAtNs) > cutoff ||
          BigInt(b.endNs) > cutoff || BigInt(b.startNs) >= BigInt(b.endNs) ||
          Number(BigInt(b.endNs) / BigInt(1000000)) !== f.endMs || !Array.isArray(b.cells) || b.cells.length > 2048 ||
          ![b.openTicks, b.highTicks, b.lowTicks, b.closeTicks, b.total, b.buy, b.sell, b.unknown, b.deltaKnown, b.cvdKnown]
            .every(v => finiteNumber(v) && Number.isSafeInteger(v))) return null;
      let volume = 0;
      for (const c of b.cells) {
        if (!isRecord(c) || ![c.priceTicks, c.buy, c.sell, c.unknown, c.total].every(v => finiteNumber(v) && Number.isSafeInteger(v) && v >= 0) ||
            c.total !== (c.buy as number) + (c.sell as number) + (c.unknown as number)) return null;
        volume += c.total as number;
      }
      if (volume !== b.total) return null;
      if (!isRecord(f.depth) || f.depth.startNs !== b.startNs || f.depth.endNs !== b.endNs ||
          !["full", "partial", "gap"].includes(String(f.depth.coverage)) || !finiteNumber(f.depth.coverageFraction) ||
          f.depth.coverageFraction < 0 || f.depth.coverageFraction > 1 || !Array.isArray(f.depth.levels) || f.depth.levels.length > 2048) return null;
      for (const l of f.depth.levels) if (!isRecord(l) || !Number.isSafeInteger(l.priceTicks) ||
        ![l.bidMean, l.askMean].every(v => v === null || finiteNumber(v) && v >= 0)) return null;
    }
  }
  return raw as unknown as FuturesPublicSampleView;
}
