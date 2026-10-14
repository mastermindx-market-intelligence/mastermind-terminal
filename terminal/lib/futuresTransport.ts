import type { FuturesNamedLevel } from "./futuresGexLevels";
/** Bounded read-only view contract. Does not grant source rights or create publication receipts. */
import { isRecord, finiteNumber, validClockMs, isFuturesGexContract, FUTURES_GEX_UNIT } from "./futuresGexProjection";
import type { FuturesChartFrame, FuturesFootprintBar, FuturesDepthColumn } from "./futuresWorkspace";
import { futuresQuery, isSessionDate, parseFuturesRequest, type FuturesRequest } from "./futuresRequest";

export const FUTURES_MAX_BYTES = 4 * 1024 * 1024;
export type FuturesPublishedView = {
  schema: "terminal.futures_published_view/v1"; request: FuturesRequest;
  contract: string; sessionId: string; basis: "realtime" | "delayed" | "historical";
  availabilityBasis: "source_observed" | "vendor_capture_retrospective";
  definition: { id: string; contract: string; validFromNs: string; validUntilNs: string; availableAtNs: string };
  tradeCoverage: "complete" | "partial" | "gap";
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
function gamma(value: unknown, request: FuturesRequest, contract: string, endMs: number, definitionId: string): FuturesChartFrame["gex"] | null {
  if (!isRecord(value)) return null;
  if (value.status === "unavailable") return { status: "unavailable", reason: knownReasons.has(String(value.reason)) ? value.reason as never : "source_unavailable" };
  const p = value.projection, v = value.provenance;
  if (value.status !== "ok" || value.schema !== "terminal.futures_gex_frame/v1" || !isRecord(p) || !isRecord(v) ||
      p.pair !== request.pair || p.indexRoot !== (request.pair === "ES" ? "SPX" : "NDX") || p.futuresContract !== contract ||
      p.method !== request.method || p.exposureUnit !== FUTURES_GEX_UNIT || !finiteNumber(p.basis) || !finiteNumber(p.ratio) || p.ratio <= 0 ||
      !validClockMs(p.indexTimestampMs) || !validClockMs(p.futuresTimestampMs) || !validClockMs(p.observedAtMs) ||
      p.observedAtMs !== Math.max(p.indexTimestampMs, p.futuresTimestampMs) || p.observedAtMs > endMs ||
      p.skewMs !== Math.abs(p.indexTimestampMs - p.futuresTimestampMs) ||
      v.decisionTimeMs !== endMs || v.dealerPositioning !== "estimate" || !futuresRef(v.artifactId) || v.definitionId !== definitionId ||
      typeof v.sourceAsOf !== "string" || v.sourceAsOf.length > 64 ||
      !(v.inventoryBasis === null || typeof v.inventoryBasis === "string" && v.inventoryBasis.length <= 128) ||
      !validClockMs(v.sourceAsOfMs) || !validClockMs(v.sourceAvailableAtMs) || v.sourceAvailableAtMs < v.sourceAsOfMs || v.sourceAvailableAtMs > endMs ||
      !validClockMs(v.indexAvailableAtMs) || !validClockMs(v.futuresAvailableAtMs) ||
      v.indexAvailableAtMs < p.indexTimestampMs || v.futuresAvailableAtMs < p.futuresTimestampMs ||
      v.indexAvailableAtMs > endMs || v.futuresAvailableAtMs > endMs ||
      !["realtime", "delayed"].includes(String(v.indexFeedBasis)) || !["realtime", "delayed"].includes(String(v.futuresFeedBasis)) ||
      v.quoteAgeMs !== endMs - Math.min(p.indexTimestampMs, p.futuresTimestampMs) || !uint(v.exposureAgeMs) ||
      !Array.isArray(p.mapped) || p.mapped.length > 2048) return null;
  const expectedLens = ["all", "zero", "ex-zero"].includes(request.expiry) ? request.expiry : "one";
  if (v.expiryLens !== expectedLens) return null;
  if (v.selectedExpiries !== undefined && (!Array.isArray(v.selectedExpiries) || v.selectedExpiries.length > 400 || !v.selectedExpiries.every(isSessionDate))) return null;
  if (v.expirySessionDate !== undefined && !isSessionDate(v.expirySessionDate)) return null;
  if (expectedLens !== "all" && (!futuresRef(v.matrixArtifactId) || !validClockMs(v.matrixAvailableAtMs) || v.matrixAvailableAtMs > endMs ||
      !validClockMs(v.matrixAsOfMs) || v.matrixAsOfMs > v.matrixAvailableAtMs)) return null;
  const frameAvailableAtMs = Math.max(v.sourceAvailableAtMs, v.indexAvailableAtMs, v.futuresAvailableAtMs,
    expectedLens !== "all" ? v.matrixAvailableAtMs as number : 0);
  const exposureAgeMs = Math.max(endMs - v.sourceAsOfMs, expectedLens !== "all" ? endMs - (v.matrixAsOfMs as number) : 0);
  if (v.exposureAgeMs !== exposureAgeMs || (v.frameAvailableAtMs !== undefined && v.frameAvailableAtMs !== frameAvailableAtMs) ||
      (v.expiryCutBasis !== undefined && v.expiryCutBasis !== "source_session_date_not_trading_cutoff")) return null;
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
  const allowedProvenance = ["artifactId", "definitionId", "sourceAsOf", "sourceAsOfMs", "sourceAvailableAtMs", "decisionTimeMs", "indexAvailableAtMs", "futuresAvailableAtMs", "indexFeedBasis", "futuresFeedBasis", "quoteAgeMs", "exposureAgeMs", "inventoryBasis", "expiryLens", "dealerPositioning", "matrixArtifactId", "matrixAvailableAtMs", "matrixAsOfMs", "expirySessionDate", "selectedExpiries", "expiryCutBasis"];
  const landmarks: FuturesNamedLevel[] = [];
  if (value.landmarks !== undefined) {
    if (!Array.isArray(value.landmarks) || value.landmarks.length > 3) return null;
    const seen = new Set<string>();
    for (const level of value.landmarks) {
      if (!isRecord(level) || !["call_wall", "put_wall", "gamma_flip"].includes(String(level.key)) ||
          seen.has(String(level.key)) || level.expiryScope !== "all" ||
          !finiteNumber(level.sourcePrice) || level.sourcePrice <= 0 ||
          !finiteNumber(level.futuresPrice) || !finiteNumber(level.displayTickPrice)) return null;
      const expected = p.method === "ratio" ? level.sourcePrice * p.ratio : level.sourcePrice + p.basis;
      if (expected <= 0 || Math.abs(level.futuresPrice - expected) > 1e-8 || Math.abs(level.displayTickPrice - Math.round(expected * 4) / 4) > 1e-8) return null;
      seen.add(String(level.key)); landmarks.push({ key: level.key as FuturesNamedLevel["key"],
        sourcePrice: level.sourcePrice, futuresPrice: level.futuresPrice,
        displayTickPrice: level.displayTickPrice, expiryScope: "all" });
    }
  }
  return { status: "ok", schema: "terminal.futures_gex_frame/v1", landmarks, projection: {
    pair: request.pair, indexRoot: request.pair === "ES" ? "SPX" : "NDX", futuresContract: contract, method: request.method,
    exposureUnit: FUTURES_GEX_UNIT, basis: p.basis, ratio: p.ratio, observedAtMs: p.observedAtMs,
    skewMs: p.skewMs as number, indexTimestampMs: p.indexTimestampMs, futuresTimestampMs: p.futuresTimestampMs, mapped,
  }, provenance: { ...Object.fromEntries(allowedProvenance.filter(k => k in v).map(k => [k, v[k]])), frameAvailableAtMs } as never };
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
      raw.sourceAsOfMs > raw.publishedAtMs || raw.cutoffMs > raw.sourceAsOfMs || raw.publishedAtMs > nowMs || raw.cutoffMs > nowMs ||
      (request.cutoffMs !== null && raw.cutoffMs > request.cutoffMs) ||
      (request.cutoffMs === null && raw.basis !== "historical" && raw.sourceAsOfMs - raw.cutoffMs > request.intervalMinutes * 60000 + 15000) ||
      raw.freshUntilMs < raw.sourceAsOfMs || raw.freshUntilMs - raw.sourceAsOfMs > (raw.basis === "realtime" ? 15000 : 900000) ||
      !positive(raw.lowTick) || !positive(raw.highTick) || raw.highTick < raw.lowTick || raw.highTick - raw.lowTick >= 2048 ||
      !Array.isArray(raw.replayCutoffsMs) || raw.replayCutoffsMs.length > 192 ||
      raw.replayCutoffsMs.some((v, i, a) => !validClockMs(v) || v > nowMs || i > 0 && v <= a[i - 1]) ||
      !raw.replayCutoffsMs.includes(raw.cutoffMs) || !Array.isArray(raw.frames) || raw.frames.length > 240) return null;
  const definition = raw.definition;
  if (!isRecord(definition) || !futuresRef(definition.id) || definition.contract !== raw.contract ||
      !nano(definition.validFromNs) || !nano(definition.validUntilNs) || !nano(definition.availableAtNs) ||
      BigInt(definition.validFromNs) >= BigInt(definition.validUntilNs) ||
      BigInt(definition.availableAtNs) > nsm(raw.cutoffMs) ||
      !["complete", "partial", "gap"].includes(String(raw.tradeCoverage))) return null;
  if (raw.basis === "realtime" && request.cutoffMs === null &&
      (nsm(nowMs) < BigInt(definition.validFromNs) || nsm(nowMs) >= BigInt(definition.validUntilNs))) return null;
  let gammaPoints = 0;
  let previousEnd = BigInt(0), previousCvd = 0, cellsTotal = 0, depthTotal = 0, unknownTotal = 0, volumeTotal = 0;
  const cutoff = nsm(raw.cutoffMs), frames: FuturesChartFrame[] = [];
  for (const f of raw.frames) {
    if (!isRecord(f) || !validClockMs(f.endMs) || !isRecord(f.bar)) return null;
    const b = f.bar;
    const noTrades = b.kind === "no_captured_trades";
    if (b.kind !== undefined && b.kind !== "executed" && !noTrades) return null;
    const prices = [b.openTicks, b.highTicks, b.lowTicks, b.closeTicks];
    if (noTrades ? !prices.every(v => v === null) : !prices.every(positive)) return null;

    if (!nano(b.startNs) || !nano(b.endNs) || !nano(b.availableAtNs) || BigInt(b.endNs) <= BigInt(b.startNs) ||
        BigInt(b.startNs) < previousEnd || BigInt(b.startNs) < BigInt(definition.validFromNs) ||
        BigInt(b.endNs) > BigInt(definition.validUntilNs) || BigInt(b.endNs) < BigInt(definition.availableAtNs) ||
        BigInt(b.endNs) > cutoff || BigInt(b.availableAtNs) > cutoff ||
        BigInt(b.endNs) !== nsm(f.endMs) || BigInt(b.endNs) - BigInt(b.startNs) > BigInt(request.intervalMinutes * 60000000000) ||
        (!noTrades && ((b.lowTicks as number) > Math.min(b.openTicks as number, b.closeTicks as number) || (b.highTicks as number) < Math.max(b.openTicks as number, b.closeTicks as number))) ||
        ![b.buy, b.sell, b.unknown, b.total].every(uint) || !uint((b.buy as number) + (b.sell as number) + (b.unknown as number)) ||
        b.total !== (b.buy as number) + (b.sell as number) + (b.unknown as number) || b.deltaKnown !== (b.buy as number) - (b.sell as number) ||
        !Array.isArray(b.cells) || b.cells.length > 2048 || (cellsTotal += b.cells.length) > 40000) return null;
    if (noTrades && (b.total !== 0 || b.cells.length !== 0 || b.deltaKnown !== 0)) return null;
    if (!noTrades && (b.total === 0 || b.cells.length === 0)) return null;
    previousEnd = BigInt(b.endNs); previousCvd += b.deltaKnown as number; unknownTotal += b.unknown as number; volumeTotal += b.total as number;
    if (!uint(volumeTotal) || !uint(unknownTotal)) return null;
    if (!Number.isSafeInteger(previousCvd) || b.cvdKnown !== previousCvd || !(b.cvd === null || b.cvd === previousCvd && unknownTotal === 0 && raw.tradeCoverage === "complete")) return null;
    let buy = 0, sell = 0, unknown = 0; const seen = new Set<number>();
    const cells: FuturesFootprintBar["cells"] = [];
    for (const c of b.cells) {
      if (!isRecord(c) || !positive(c.priceTicks) || c.priceTicks % request.priceStepTicks !== 0 || seen.has(c.priceTicks) ||
          ![c.buy, c.sell, c.unknown, c.total].every(uint) || c.total !== (c.buy as number) + (c.sell as number) + (c.unknown as number)) return null;
      seen.add(c.priceTicks); buy += c.buy as number; sell += c.sell as number; unknown += c.unknown as number;
      cells.push({ priceTicks: c.priceTicks, buy: c.buy as number, sell: c.sell as number, unknown: c.unknown as number, total: c.total as number,
        buyImbalance: raw.tradeCoverage === "complete" && c.unknown === 0 && c.buyImbalance === true, sellImbalance: raw.tradeCoverage === "complete" && c.unknown === 0 && c.sellImbalance === true });
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
    const gex = gamma(f.gex, request, raw.contract, f.endMs, definition.id); if (!gex) return null;
    if (gex.status === "ok" && (gammaPoints += gex.projection.mapped.length) > 40000) return null;
    const observations = { startNs: b.startNs, endNs: b.endNs, availableAtNs: b.availableAtNs,
      buy, sell, unknown, total: b.total as number, deltaKnown: b.deltaKnown as number, cvdKnown: previousCvd, cvd: b.cvd as number | null, cells };
    const bar: FuturesFootprintBar = noTrades
      ? { ...observations, kind: "no_captured_trades", openTicks: null, highTicks: null, lowTicks: null, closeTicks: null }
      : { ...observations, openTicks: b.openTicks as number, highTicks: b.highTicks as number, lowTicks: b.lowTicks as number, closeTicks: b.closeTicks as number };
    frames.push({ endMs: f.endMs, bar, depth, gex });
  }
  return { schema: "terminal.futures_published_view/v1", request, contract: raw.contract, sessionId: raw.sessionId,
    basis: raw.basis as FuturesPublishedView["basis"], availabilityBasis: raw.availabilityBasis as FuturesPublishedView["availabilityBasis"],
    definition: { id: definition.id, contract: definition.contract as string, validFromNs: definition.validFromNs, validUntilNs: definition.validUntilNs, availableAtNs: definition.availableAtNs },
    tradeCoverage: raw.tradeCoverage as "complete" | "partial" | "gap",
    sourceId: raw.sourceId, sourceAsOfMs: raw.sourceAsOfMs, publishedAtMs: raw.publishedAtMs, cutoffMs: raw.cutoffMs, freshUntilMs: raw.freshUntilMs,
    lowTick: raw.lowTick, highTick: raw.highTick, replayCutoffsMs: raw.replayCutoffsMs as number[], frames };
}

/** Read this view's JSON with a byte limit BEFORE buffering, including undeclared bodies. */
export async function readFuturesJson(response: Response, maxBytes = FUTURES_MAX_BYTES): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > FUTURES_MAX_BYTES || !response.body) throw Error("response_size");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await response.body.cancel(); throw Error("response_size");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error("response_size");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(""));
  } catch (error) {
    await reader.cancel().catch(() => {}); throw error;
  } finally { reader.releaseLock(); }
}
