/** Bounded read-only view contract. Does not grant source rights or create publication receipts. */
import { isRecord, finiteNumber, validClockMs, isFuturesGexContract, FUTURES_GEX_UNIT } from "./futuresGexProjection";
import type { FuturesChartFrame, FuturesFootprintBar, FuturesDepthColumn } from "./futuresWorkspace";
import { futuresQuery, isSessionDate, parseFuturesRequest, type FuturesRequest } from "./futuresRequest";

export const FUTURES_MAX_BYTES = 4 * 1024 * 1024;
export type FuturesPublishedView = {
  schema: "terminal.futures_published_view/v1"; request: FuturesRequest;
  contract: string; sessionId: string; basis: "realtime" | "delayed" | "historical";
  availabilityBasis: "source_observed" | "vendor_capture_retrospective";
  sourceId: string; sourceAsOfMs: number; publishedAtMs: number; cutoffMs: number; freshUntilMs: number;
  lowTick: number; highTick: number; replayCutoffsMs: number[]; frames: FuturesChartFrame[];
};
export const futuresRef = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v);
export const uint = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => uint(v) && v > 0;
const nano = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d{0,19})$/.test(v) && BigInt(v) < BigInt("18446744073709551615");
const nsm = (ms: number) => BigInt(ms) * BigInt(1000000);
const knownReasons = new Set(["source_unavailable", "invalid_input", "invalid_policy", "invalid_contract", "contract_inactive", "missing_receipt", "invalid_clock", "not_yet_available", "stale_quote", "stale_exposure", "source_schema", "source_root", "source_session", "source_rows", "empty_source", "invalid_projection", "matrix_unavailable", "matrix_invalid", "matrix_clock", "matrix_session", "matrix_empty", "cash_closed"]);

/** Strict projection check and whitelisting: raw source records never pass to the client. */
function gamma(value: unknown, request: FuturesRequest, contract: string, endMs: number): FuturesChartFrame["gex"] | null {
  if (!isRecord(value)) return null;
  if (value.status === "unavailable") return { status: "unavailable", reason: knownReasons.has(String(value.reason)) ? value.reason as never : "source_unavailable" };
  const p = value.projection, v = value.provenance;
  if (value.status !== "ok" || value.schema !== "terminal.futures_gex_frame/v1" || !isRecord(p) || !isRecord(v) ||
      p.pair !== request.pair || p.indexRoot !== (request.pair === "ES" ? "SPX" : "NDX") || p.futuresContract !== contract ||
      p.method !== request.method || p.exposureUnit !== FUTURES_GEX_UNIT || !finiteNumber(p.basis) || !finiteNumber(p.ratio) || p.ratio <= 0 ||
      !validClockMs(p.indexTimestampMs) || !validClockMs(p.futuresTimestampMs) || !validClockMs(p.observedAtMs) ||
      p.observedAtMs !== Math.max(p.indexTimestampMs, p.futuresTimestampMs) || p.observedAtMs > endMs ||
      p.skewMs !== Math.abs(p.indexTimestampMs - p.futuresTimestampMs) ||
      v.decisionTimeMs !== endMs || v.dealerPositioning !== "estimate" || !futuresRef(v.artifactId) || !futuresRef(v.definitionId) ||
      !validClockMs(v.sourceAsOfMs) || !validClockMs(v.sourceAvailableAtMs) || v.sourceAvailableAtMs < v.sourceAsOfMs || v.sourceAvailableAtMs > endMs ||
      !validClockMs(v.indexAvailableAtMs) || !validClockMs(v.futuresAvailableAtMs) ||
      v.indexAvailableAtMs < p.indexTimestampMs || v.futuresAvailableAtMs < p.futuresTimestampMs ||
      v.indexAvailableAtMs > endMs || v.futuresAvailableAtMs > endMs ||
      !["realtime", "delayed"].includes(String(v.indexFeedBasis)) || !["realtime", "delayed"].includes(String(v.futuresFeedBasis)) ||
      v.quoteAgeMs !== endMs - Math.min(p.indexTimestampMs, p.futuresTimestampMs) || !uint(v.exposureAgeMs) ||
      !Array.isArray(p.mapped) || p.mapped.length > 2048) return null;
  const expectedLens = ["all", "zero", "ex-zero"].includes(request.expiry) ? request.expiry : "one";
  if (v.expiryLens !== expectedLens) return null;
  if (expectedLens !== "all" && (!futuresRef(v.matrixArtifactId) || !validClockMs(v.matrixAvailableAtMs) || v.matrixAvailableAtMs > endMs)) return null;
  const strikes = new Set<number>();
  const mapped = [];
  for (const row of p.mapped) {
    if (!isRecord(row) || !finiteNumber(row.sourceStrike) || row.sourceStrike <= 0 || strikes.has(row.sourceStrike) ||
        !finiteNumber(row.futuresPrice) || row.futuresPrice <= 0 || row.displayTickPrice !== Math.round(row.futuresPrice * 4) / 4 ||
        !(row.gammaNetMn === null || finiteNumber(row.gammaNetMn))) return null;
    const expected = p.method === "ratio" ? row.sourceStrike * p.ratio : row.sourceStrike + p.basis;
    if (Math.abs(row.futuresPrice - expected) > Math.max(1, expected) * 1e-12) return null;
    strikes.add(row.sourceStrike);
    mapped.push({ sourceStrike: row.sourceStrike, futuresPrice: row.futuresPrice, displayTickPrice: row.displayTickPrice as number, gammaNetMn: row.gammaNetMn as number | null });
  }
  const allowedProvenance = ["artifactId", "definitionId", "sourceAsOf", "sourceAsOfMs", "sourceAvailableAtMs", "decisionTimeMs", "indexAvailableAtMs", "futuresAvailableAtMs", "indexFeedBasis", "futuresFeedBasis", "quoteAgeMs", "exposureAgeMs", "inventoryBasis", "expiryLens", "dealerPositioning", "matrixArtifactId", "matrixAvailableAtMs", "matrixAsOfMs", "expirySessionDate", "selectedExpiries"];
  return { status: "ok", schema: "terminal.futures_gex_frame/v1", projection: {
    pair: request.pair, indexRoot: request.pair === "ES" ? "SPX" : "NDX", futuresContract: contract, method: request.method,
    exposureUnit: FUTURES_GEX_UNIT, basis: p.basis, ratio: p.ratio, observedAtMs: p.observedAtMs,
    skewMs: p.skewMs as number, indexTimestampMs: p.indexTimestampMs, futuresTimestampMs: p.futuresTimestampMs, mapped,
  }, provenance: Object.fromEntries(allowedProvenance.filter(k => k in v).map(k => [k, v[k]])) as never };
}

/** Validate math, time, identity and cell budgets. Unknown depth/greeks stay unknown. */
export function parseFuturesPublishedView(raw: unknown, request: FuturesRequest, nowMs: number): FuturesPublishedView | null {
  if (!validClockMs(nowMs) || !isRecord(raw) || raw.schema !== "terminal.futures_published_view/v1" || !isRecord(raw.request)) return null;
  let parsed: FuturesRequest | null;
  try { parsed = parseFuturesRequest(new URLSearchParams(futuresQuery(raw.request as FuturesRequest))); } catch { return null; }
  if (!parsed || futuresQuery(parsed) !== futuresQuery(request) || !isFuturesGexContract(raw.contract, request.pair) ||
      !isSessionDate(raw.sessionId) || !futuresRef(raw.sourceId) || !["realtime", "delayed", "historical"].includes(String(raw.basis)) ||
      !["source_observed", "vendor_capture_retrospective"].includes(String(raw.availabilityBasis)) ||
      (raw.basis !== "historical" && raw.availabilityBasis !== "source_observed") ||
      !validClockMs(raw.sourceAsOfMs) || !validClockMs(raw.publishedAtMs) || !validClockMs(raw.cutoffMs) || !validClockMs(raw.freshUntilMs) ||
      raw.sourceAsOfMs > raw.publishedAtMs || raw.publishedAtMs > nowMs || raw.cutoffMs > nowMs ||
      (request.cutoffMs !== null && raw.cutoffMs > request.cutoffMs) ||
      raw.freshUntilMs < raw.sourceAsOfMs || raw.freshUntilMs - raw.sourceAsOfMs > (raw.basis === "realtime" ? 15000 : 900000) ||
      !positive(raw.lowTick) || !positive(raw.highTick) || raw.highTick < raw.lowTick || raw.highTick - raw.lowTick >= 2048 ||
      !Array.isArray(raw.replayCutoffsMs) || raw.replayCutoffsMs.length > 192 ||
      raw.replayCutoffsMs.some((v, i, a) => !validClockMs(v) || v > nowMs || i > 0 && v <= a[i - 1]) ||
      !raw.replayCutoffsMs.includes(raw.cutoffMs) || !Array.isArray(raw.frames) || raw.frames.length > 240) return null;
  let previousEnd = BigInt(0), previousCvd = 0, cellsTotal = 0, depthTotal = 0, unknownTotal = 0;
  const cutoff = nsm(raw.cutoffMs), frames: FuturesChartFrame[] = [];
  for (const f of raw.frames) {
    if (!isRecord(f) || !validClockMs(f.endMs) || !isRecord(f.bar)) return null;
    const b = f.bar;
    if (!nano(b.startNs) || !nano(b.endNs) || !nano(b.availableAtNs) || BigInt(b.endNs) <= BigInt(b.startNs) ||
        BigInt(b.startNs) < previousEnd || BigInt(b.endNs) > cutoff || BigInt(b.availableAtNs) > cutoff ||
        BigInt(b.endNs) !== nsm(f.endMs) || BigInt(b.endNs) - BigInt(b.startNs) > BigInt(request.intervalMinutes * 60000000000) ||
        ![b.openTicks, b.highTicks, b.lowTicks, b.closeTicks].every(positive) ||
        (b.lowTicks as number) > Math.min(b.openTicks as number, b.closeTicks as number) || (b.highTicks as number) < Math.max(b.openTicks as number, b.closeTicks as number) ||
        ![b.buy, b.sell, b.unknown, b.total].every(uint) || !uint((b.buy as number) + (b.sell as number) + (b.unknown as number)) ||
        b.total !== (b.buy as number) + (b.sell as number) + (b.unknown as number) || b.deltaKnown !== (b.buy as number) - (b.sell as number) ||
        !Array.isArray(b.cells) || b.cells.length > 2048 || (cellsTotal += b.cells.length) > 40000) return null;
    previousEnd = BigInt(b.endNs); previousCvd += b.deltaKnown as number; unknownTotal += b.unknown as number;
    if (!Number.isSafeInteger(previousCvd) || b.cvdKnown !== previousCvd || !(b.cvd === null || b.cvd === previousCvd && unknownTotal === 0)) return null;
    let buy = 0, sell = 0, unknown = 0; const seen = new Set<number>();
    const cells: FuturesFootprintBar["cells"] = [];
    for (const c of b.cells) {
      if (!isRecord(c) || !positive(c.priceTicks) || c.priceTicks % request.priceStepTicks !== 0 || seen.has(c.priceTicks) ||
          ![c.buy, c.sell, c.unknown, c.total].every(uint) || c.total !== (c.buy as number) + (c.sell as number) + (c.unknown as number)) return null;
      seen.add(c.priceTicks); buy += c.buy as number; sell += c.sell as number; unknown += c.unknown as number;
      cells.push({ priceTicks: c.priceTicks, buy: c.buy as number, sell: c.sell as number, unknown: c.unknown as number, total: c.total as number,
        buyImbalance: c.buyImbalance === true, sellImbalance: c.sellImbalance === true });
    }
    if (buy !== b.buy || sell !== b.sell || unknown !== b.unknown) return null;
    let depth: FuturesDepthColumn | null = null;
    if (f.depth !== null) {
      const d = f.depth;
      if (!isRecord(d) || d.startNs !== b.startNs || d.endNs !== b.endNs || !finiteNumber(d.coverageFraction) || d.coverageFraction < 0 || d.coverageFraction > 1 ||
          d.coverage !== (d.coverageFraction === 0 ? "gap" : d.coverageFraction === 1 ? "full" : "partial") ||
          !Array.isArray(d.levels) || d.levels.length > 2048 || (depthTotal += d.levels.length) > 80000) return null;
      const levels: FuturesDepthColumn["levels"] = []; const priceSet = new Set<number>();
      for (const l of d.levels) {
        if (!isRecord(l) || !positive(l.priceTicks) || l.priceTicks < raw.lowTick || l.priceTicks > raw.highTick || priceSet.has(l.priceTicks) ||
            ![l.bidMean, l.askMean].every(v => d.coverage === "gap" ? v === null : finiteNumber(v) && v >= 0)) return null;
        priceSet.add(l.priceTicks); levels.push({ priceTicks: l.priceTicks, bidMean: l.bidMean as number | null, askMean: l.askMean as number | null });
      }
      depth = { startNs: d.startNs as string, endNs: d.endNs as string, coverage: d.coverage as string, coverageFraction: d.coverageFraction, levels };
    }
    const gex = gamma(f.gex, request, raw.contract, f.endMs); if (!gex) return null;
    frames.push({ endMs: f.endMs, bar: { startNs: b.startNs, endNs: b.endNs, availableAtNs: b.availableAtNs,
      openTicks: b.openTicks as number, highTicks: b.highTicks as number, lowTicks: b.lowTicks as number, closeTicks: b.closeTicks as number,
      buy, sell, unknown, total: b.total as number, deltaKnown: b.deltaKnown as number, cvdKnown: previousCvd, cvd: b.cvd as number | null, cells }, depth, gex });
  }
  return { schema: "terminal.futures_published_view/v1", request, contract: raw.contract, sessionId: raw.sessionId,
    basis: raw.basis as FuturesPublishedView["basis"], availabilityBasis: raw.availabilityBasis as FuturesPublishedView["availabilityBasis"],
    sourceId: raw.sourceId, sourceAsOfMs: raw.sourceAsOfMs, publishedAtMs: raw.publishedAtMs, cutoffMs: raw.cutoffMs, freshUntilMs: raw.freshUntilMs,
    lowTick: raw.lowTick, highTick: raw.highTick, replayCutoffsMs: raw.replayCutoffsMs as number[], frames };
}
