import { buildLargeTradesSnapshot, validateLargeTradesEnvelope } from "./largeTrades/engine";
import type { LargeTradesEnvelope } from "./largeTrades/types";

export type IexDepthLevel = { priceInt: number; quantity: number };
export type IexDepthPoint = {
  marketNs: string; transportSendNs: string; availableNs: string;
  sourceSequence: string; session: string; status: "observed" | "unavailable";
  reason: string | null; bids: IexDepthLevel[]; asks: IexDepthLevel[];
  bidTotal: number; askTotal: number; orderCount: number; levelsTruncated: boolean;
};
export type IexDepthReplay = {
  schema: "mastermind.iex_depth_snapshots.v1"; symbol: string;
  sourceSha256: string; priceScale: number; quantityUnit: "shares"; venue: "IEX";
  coverage: "partial"; measurement: "discrete_observed_book_not_time_weighted";
  availabilityBasis: "archive_acquisition"; intervalMs: number;
  maxLevelsPerSide: number; samplingTruncated: boolean; samples: IexDepthPoint[];
};
export type IexDepthEnvelope = LargeTradesEnvelope & { depthReplay: IexDepthReplay };
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const uint = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const ns = (x: unknown): x is string => typeof x === "string" && /^(0|[1-9][0-9]{0,19})$/.test(x);
const REASONS = new Set(["source_gap_or_prefix", "incomplete_order_chain", "multiple_source_streams"]);

/** Format check, not a substitute for the incumbent server's source/rights gate. */
export function parseIexDepthEnvelope(input: unknown, symbol: string): IexDepthEnvelope | null {
  if (!validateLargeTradesEnvelope(input) || input.instrument.symbol !== symbol || !record(input)) return null;
  const envelope = input as LargeTradesEnvelope;
  const p = envelope.provenance, i = envelope.instrument, d = (input as Record<string, unknown>).depthReplay;
  if (p.provider !== "IEX" || p.dataset !== "HIST DEEP+ 1.0" || p.venue !== "IEX" || p.scope !== "venue" ||
      p.dataMode !== "historical" || p.evidenceMode !== "HISTORICAL_REPLAY" || p.receiptBasis !== "archive_acquisition" ||
      !ns(p.acquiredAtNs) || !p.sourceSha256 || i.assetClass !== "equity" || i.quantityUnit !== "shares" ||
      i.priceScale !== 10000 || !record(d) || d.schema !== "mastermind.iex_depth_snapshots.v1" ||
      d.symbol !== symbol || d.sourceSha256 !== p.sourceSha256 || d.priceScale !== i.priceScale ||
      d.quantityUnit !== "shares" || d.venue !== "IEX" || d.coverage !== "partial" ||
      d.measurement !== "discrete_observed_book_not_time_weighted" || d.availabilityBasis !== "archive_acquisition" ||
      !uint(d.intervalMs) || d.intervalMs < 1 || d.intervalMs > 60000 || !uint(d.maxLevelsPerSide) ||
      d.maxLevelsPerSide < 1 || d.maxLevelsPerSide > 64 || typeof d.samplingTruncated !== "boolean" ||
      !Array.isArray(d.samples) || d.samples.length > 2000 || !d.samples.length) return null;
  let lastNs = BigInt(0), lastSequence = BigInt(-1), session = "";
  for (const value of d.samples) {
    if (!record(value) || !ns(value.marketNs) || !ns(value.transportSendNs) || !ns(value.availableNs) ||
        !ns(value.sourceSequence) || value.availableNs !== p.acquiredAtNs ||
        BigInt(value.transportSendNs) > BigInt(value.marketNs) || BigInt(value.marketNs) > BigInt(value.availableNs) ||
        BigInt(value.marketNs) < lastNs || BigInt(value.sourceSequence) < lastSequence ||
        typeof value.session !== "string" || !/^[0-9]{8}\.[a-f0-9]{4}\.[a-f0-9]{8}\.[a-f0-9]{8}$/.test(value.session) ||
        (session && value.session !== session) || !["observed", "unavailable"].includes(String(value.status)) ||
        !uint(value.bidTotal) || !uint(value.askTotal) || !uint(value.orderCount) || typeof value.levelsTruncated !== "boolean") return null;
    if (value.status === "observed" ? value.reason !== null : !REASONS.has(String(value.reason))) return null;
    for (const side of ["bids", "asks"] as const) {
      const levels = value[side];
      if (!Array.isArray(levels) || levels.length > d.maxLevelsPerSide) return null;
      let sum = 0, previousPrice: number | null = null;
      for (const level of levels) {
        if (!record(level) || !uint(level.priceInt) || level.priceInt === 0 || !uint(level.quantity) || level.quantity === 0 ||
            (previousPrice !== null && (side === "bids" ? level.priceInt >= previousPrice : level.priceInt <= previousPrice))) return null;
        sum += level.quantity; previousPrice = level.priceInt;
        if (!Number.isSafeInteger(sum)) return null;
      }
      const total = side === "bids" ? value.bidTotal : value.askTotal;
      if (sum > total || (!value.levelsTruncated && sum !== total)) return null;
      if (value.status === "unavailable" && (levels.length || total !== 0 || value.orderCount !== 0)) return null;
    }
    lastNs = BigInt(value.marketNs); lastSequence = BigInt(value.sourceSequence); session = value.session;
  }
  return input as unknown as IexDepthEnvelope;
}

/** Reuse the transaction owner's correction accounting; never infer volume from orders. */
export function iexExecutionProfile(envelope: IexDepthEnvelope, point: IexDepthPoint) {
  const seq = BigInt(point.sourceSequence);
  // Source event timestamps can move backward; sequence gating prevents a later
  // old-timestamp execution/break being painted into an earlier observed book.
  const selected = { ...envelope, prints: envelope.prints.filter(row => row.session === point.session && BigInt(row.sourceSequence) <= seq) };
  const snapshot = buildLargeTradesSnapshot(selected, { minQuantity: 1, aggregate: false, maxMarkers: 1000 }, {
    marketCutoffNs: point.marketNs, knowledgeCutoffNs: point.availableNs,
  });
  const rows = new Map<number, { priceInt: number; buy: number; sell: number; unknown: number; total: number }>();
  for (const print of snapshot.visiblePrints) {
    const row = rows.get(print.priceInt) ?? { priceInt: print.priceInt, buy: 0, sell: 0, unknown: 0, total: 0 };
    row[print.side] += print.quantity; row.total += print.quantity;
    rows.set(print.priceInt, row);
  }
  return { rows: [...rows.values()].sort((a, b) => b.priceInt - a.priceInt),
    volume: snapshot.diagnostics.eligibleQuantity, unknown: snapshot.diagnostics.unknownQuantity,
    unmatchedCancels: snapshot.diagnostics.unmatchedCancels, accounting: snapshot.accounting };
}
