/**
 * Transaction-only chart study. All source clocks are UTC epoch nanoseconds
 * encoded as decimal strings; prices are exact integers / priceScale.
 * No order count, candle-volume input, account identity or trade instruction.
 */
export type TradeSide = "buy" | "sell" | "unknown";
export type SideMethod = "exchange" | "resting_order" | "quote_rule" | "unknown";
export type DataMode = "live" | "delayed" | "historical" | "fixture" | "unavailable";
export interface TradeInstrument {
  symbol: string;
  instrumentId: string;
  assetClass: "equity" | "future" | "option";
  quantityUnit: "shares" | "contracts";
  priceScale: number;
  tickSizeInt: number | null;
  timezone: string;
}
export interface TradeProvenance {
  provider: string;
  dataset: string;
  venue: string;
  scope: "venue" | "consolidated";
  dataMode: DataMode;
  evidenceMode: "ACTUAL_AS_SEEN" | "HISTORICAL_REPLAY" | "FIXTURE";
  sourceId: string;
  sourceSha256: string | null;
  sourceRef: string;
  generatedAtNs: string;
  acquiredAtNs: string | null;
  receiptBasis: "original_receive" | "archive_acquisition" | "fixture";
  coverage: "complete" | "partial" | "unknown";
  sequenceGaps: number;
  delayMs: number | null;
  conditionPolicy: string;
  attribution: string;
  termsUrl: string | null;
}
export interface TradePrint {
  id: string;
  kind: "trade" | "cancel";
  targetId?: string;
  eventNs: string;
  availableNs: string;
  sourceSequence: string;
  session: string;
  priceInt: number;
  quantity: number;
  side: TradeSide;
  sideMethod: SideMethod;
  eligible: boolean;
  exclusionReason?: string;
  conditions: string[];
  sourceRecordType: string;
}
/** Supplied by the existing qualified quote/response owner, never inferred from candles. */
export interface ResponseObservation {
  id: string;
  eventNs: string;
  availableNs: string;
  priceInt: number;
  kind: "qualified_midpoint";
  eligible: boolean;
  sourceRef: string;
  quoteAgeMs: number | null;
}
export interface LargeTradesEnvelope {
  schema: "mastermind.large_trades.v1";
  instrument: TradeInstrument;
  provenance: TradeProvenance;
  range: { startNs: string; endNs: string };
  prints: TradePrint[];
  responses: ResponseObservation[];
  responseCoverage: "complete" | "partial" | "unavailable";
  responseKnownAtNs: string | null;
}
export interface LargeTradesSettings {
  minQuantity: number;
  aggregate: boolean;
  maxGapMs: number;
  maxSpanTicks: number;
  maxDurationMs: number;
  adaptive: boolean;
  percentile: number;
  baselineCount: number;
  minBaseline: number;
  responseWindowMs: number;
  maxResponseTicks: number;
  reversalTicks: number;
  showLabels: boolean;
  maxMarkers: number;
}
export const DEFAULT_LARGE_TRADES_SETTINGS: LargeTradesSettings = {
  minQuantity: 100, aggregate: true, maxGapMs: 250, maxSpanTicks: 2,
  maxDurationMs: 1000, adaptive: false, percentile: 95, baselineCount: 500,
  minBaseline: 30, responseWindowMs: 30000, maxResponseTicks: 2,
  reversalTicks: 2, showLabels: true, maxMarkers: 250,
};
/**
 * Both cutoffs are required. Archive replay uses historical market time and
 * later acquisition knowledge; it never claims a contemporaneous as-seen view.
 */
export interface LargeTradesClock {
  marketCutoffNs: string;
  knowledgeCutoffNs: string;
}
export type ResponseState = "pending" | "unobservable" | "limited_response"
  | "continued" | "failed_continuation" | "no_pattern";
export interface ClusterResponse {
  state: ResponseState;
  reason: string;
  knownAtNs: string | null;
  endpointNs: string | null;
  responseTicks: number | null;
  maxExcursionTicks?: number | null;
  pathEvidence?: "complete" | "unavailable";
  absorption: "candidate" | "unavailable";
  evidence: "qualified_midpoint" | "unavailable";
  predictiveSignal: false;
}
export interface LargeTradeCluster {
  id: string;
  session: string;
  startNs: string;
  endNs: string;
  knownAtNs: string;
  quantity: number;
  tradeCount: number;
  buyQuantity: number;
  sellQuantity: number;
  unknownQuantity: number;
  side: TradeSide;
  sideMethod: SideMethod;
  minPriceInt: number;
  maxPriceInt: number;
  weightedPrice: number;
  lastPriceInt: number;
  notionalNumerator: string;
  threshold: number;
  thresholdKnownAtNs?: string;
  correctionIds?: string[];
  formationStartNs?: string;
  formationEndNs?: string;
  closedAtNs?: string | null;
  baselineSamples: number;
  calibrationReady: boolean;
  sourceIds: string[];
  orderCount: null;
  response: ClusterResponse;
}
export interface LargeTradesSnapshot {
  clusters: LargeTradeCluster[];
  visiblePrints: TradePrint[];
  diagnostics: {
    sourceRecords: number; eligibleTrades: number; excludedRecords: number;
    cancellations: number; unmatchedCancels: number; duplicateRecords: number;
    conflictingIds: number; unknownQuantity: number; eligibleQuantity: number;
    markerLimitApplied: boolean; calibrationPending: number; qualifyingClusters: number;
  };
  clock: LargeTradesClock;
  dataMode: DataMode;
  evidenceMode: TradeProvenance["evidenceMode"];
}
