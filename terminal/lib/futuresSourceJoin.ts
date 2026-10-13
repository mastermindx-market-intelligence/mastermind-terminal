import "server-only";
/** Server consumer of the existing capture publisher's immutable projections. No publisher/clock issuer. */
import { createHash } from "node:crypto";
import { buildFuturesGexFrame, type FuturesGexFrameInput } from "./futuresGexFrame";
import { isRecord, validClockMs } from "./futuresGexProjection";
import { parseFuturesPublishedView, futuresRef, FUTURES_MAX_BYTES, type FuturesPublishedView } from "./futuresTransport";
import { requestExpiryLens, type FuturesRequest } from "./futuresRequest";

export type FuturesSourceResult = { status: "data"; data: FuturesPublishedView } | {
  status: "unavailable"; reason: "source_unavailable" | "source_restricted" | "source_invalid" | "no_replay_frame" | "stale_source";
};
const refused = (reason: Extract<FuturesSourceResult, { status: "unavailable" }>["reason"]): FuturesSourceResult => ({ status: "unavailable", reason });
function boundJson(object: unknown): unknown {
  if (!isRecord(object) || typeof object.json !== "string" || object.json.length > 524288 ||
      typeof object.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(object.sha256) ||
      createHash("sha256").update(object.json, "utf8").digest("hex") !== object.sha256) throw Error("source_digest");
  return JSON.parse(object.json);
}
/** Bad gamma must not erase independently valid observed futures flow. */
function joinGamma(raw: unknown, request: FuturesRequest, contract: string, endMs: number, definition: unknown) {
  const missing = { status: "unavailable" as const, reason: "source_unavailable" as const };
  if (!isRecord(raw)) return missing;
  if (raw.cashSession !== "open") return { status: "unavailable" as const, reason: "cash_closed" as const };
  if (!isRecord(raw.input) || !isRecord(raw.input.quotes) || raw.input.quotes.futuresContract !== contract ||
      raw.input.quotes.pair !== request.pair || !isRecord(raw.input.sourceReceipt)) return missing;
  try {
    const c = raw.input.contract;
    // The quote attachment must use the SAME admitted futures definition, not merely
    // a matching display symbol. A narrower millisecond validity range is safe.
    if (!isRecord(c) || !isRecord(definition) || c.symbol !== contract || c.definitionId !== definition.id ||
        !validClockMs(c.validFromMs) || !validClockMs(c.validUntilMs) ||
        typeof definition.validFromNs !== "string" || typeof definition.validUntilNs !== "string" ||
        BigInt(c.validFromMs) * BigInt(1000000) < BigInt(definition.validFromNs) ||
        BigInt(c.validUntilMs) * BigInt(1000000) > BigInt(definition.validUntilNs)) return missing;
    const source = boundJson(raw.payload);
    const input = structuredClone(raw.input) as unknown as FuturesGexFrameInput;
    input.source = source;
    input.expiryLens = requestExpiryLens(request);
    // Source/raw binding is checked here, outside the pure coordinate engine. Hashes prove
    // byte correspondence, not market-data rights; the trusted publisher owns those decisions.
    if (raw.input.sourceReceipt.payloadSha256 !== (raw.payload as Record<string, unknown>).sha256) return missing;
    input.policy = { decisionTimeMs: endMs, maxQuoteAgeMs: 5000, maxExposureAgeMs: 120000,
      maxClockSkewMs: 2000, method: request.method };
    if (request.expiry !== "all") {
      if (!isRecord(raw.matrix) || !isRecord(raw.matrix.receipt) || raw.matrix.receipt.payloadSha256 !== raw.matrix.sha256) return missing;
      input.matrix = { payload: boundJson(raw.matrix), receipt: raw.matrix.receipt as never };
    } else { delete input.matrix; }
    return buildFuturesGexFrame(input);
  } catch { return missing; }
}

/** Consume a published snapshot; never fetch live vendors, relabel history, or manufacture receipts. */
export function joinFuturesSource(raw: unknown, request: FuturesRequest, nowMs: number): FuturesSourceResult {
  if (!isRecord(raw) || raw.schema !== "hub.futures_workspace_source/v1") return refused("source_invalid");
  // This is the upstream publisher's distribution decision, not a customer entitlement.
  // The API independently checks the canonical customer feature before reading this object.
  if (raw.audience !== "subscriber_display" || !futuresRef(raw.distributionEvidenceRef)) return refused("source_restricted");
  if (raw.pair !== request.pair || !validClockMs(nowMs) || !validClockMs(raw.publishedAtMs) || raw.publishedAtMs > nowMs ||
      !validClockMs(raw.sourceAsOfMs) || !validClockMs(raw.freshUntilMs) || !Array.isArray(raw.views) || raw.views.length > 192) return refused("source_invalid");
  if (request.cutoffMs !== null && request.cutoffMs > nowMs) return refused("no_replay_frame");
  if (raw.basis !== "historical" && nowMs > raw.freshUntilMs && request.cutoffMs === null) return refused("stale_source");
  const cutoff = request.cutoffMs ?? nowMs;
  const eligible = raw.views.filter(v => isRecord(v) && v.intervalMinutes === request.intervalMinutes &&
    v.priceStepTicks === request.priceStepTicks && validClockMs(v.cutoffMs) && v.cutoffMs <= cutoff);
  eligible.sort((a, b) => (b as Record<string, number>).cutoffMs - (a as Record<string, number>).cutoffMs);
  const selected = eligible[0];
  if (!isRecord(selected) || !validClockMs(selected.cutoffMs) || !Array.isArray(selected.frames) || selected.frames.length > 240) return refused("no_replay_frame");
  if (eligible.length > 1 && (eligible[1] as Record<string, unknown>).cutoffMs === selected.cutoffMs) return refused("source_invalid");
  const replayCutoffsMs = [...new Set(raw.views.filter(v => isRecord(v) && v.intervalMinutes === request.intervalMinutes &&
    v.priceStepTicks === request.priceStepTicks && validClockMs(v.cutoffMs) && v.cutoffMs <= nowMs).map(v => (v as Record<string, number>).cutoffMs))].sort((a, b) => a - b);
  const frames = selected.frames.map(f => isRecord(f) ? {
    endMs: f.endMs, bar: f.bar, depth: f.depth,
    gex: joinGamma(f.gammaAttachment ?? (futuresRef(f.gammaAttachmentRef) && isRecord(raw.gammaAttachments) ? raw.gammaAttachments[f.gammaAttachmentRef] : null), request, String(raw.contract), Number(f.endMs), raw.definition),
  } : null);
  const candidate = { schema: "terminal.futures_published_view/v1", request,
    contract: raw.contract, sessionId: raw.sessionId, definition: raw.definition, tradeCoverage: selected.tradeCoverage, basis: raw.basis, availabilityBasis: raw.availabilityBasis,
    sourceId: raw.sourceId, sourceAsOfMs: raw.sourceAsOfMs, publishedAtMs: raw.publishedAtMs,
    cutoffMs: selected.cutoffMs, freshUntilMs: raw.freshUntilMs, lowTick: raw.lowTick, highTick: raw.highTick, replayCutoffsMs, frames };
  const data = parseFuturesPublishedView(candidate, request, nowMs);
  return data && Buffer.byteLength(JSON.stringify(data), "utf8") <= FUTURES_MAX_BYTES
    ? { status: "data", data } : refused("source_invalid");
}
