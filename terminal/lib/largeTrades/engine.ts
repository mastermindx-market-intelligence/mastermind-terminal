import {
  DEFAULT_LARGE_TRADES_SETTINGS, type ClusterResponse, type LargeTradeCluster,
  type LargeTradesClock, type LargeTradesEnvelope, type LargeTradesSettings,
  type LargeTradesSnapshot, type ResponseObservation, type TradePrint,
} from "./types";

const NS_MS = BigInt(1000000);
const ZERO = BigInt(0);
const MAX_RECORDS = 100000;
const MAX_QUOTE_AGE_NS = BigInt(5000) * NS_MS;
const nsPattern = /^(0|[1-9][0-9]{0,19})$/;
const idPattern = /^[A-Za-z0-9_.:/@+\-]{1,240}$/;
const isNs = (x: unknown): x is string => typeof x === "string" && nsPattern.test(x);
const integer = (x: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= min && x <= max;
const text = (x: unknown, max = 500): x is string =>
  typeof x === "string" && x.length > 0 && x.length <= max && !/[\x00-\x1f]/.test(x);
const id = (x: unknown): x is string => typeof x === "string" && idPattern.test(x);
const obj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const member = (x: unknown, values: readonly string[]): boolean =>
  typeof x === "string" && values.includes(x);
const maxNs = (...values: string[]) => values.reduce((a, b) => BigInt(a) >= BigInt(b) ? a : b);
const cmpNs = (a: string, b: string) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;

function validPrint(p: unknown): p is TradePrint {
  if (!obj(p) || !id(p.id) || !member(p.kind, ["trade", "cancel"])
      || !isNs(p.eventNs) || !isNs(p.availableNs) || BigInt(p.availableNs) < BigInt(p.eventNs)
      || !isNs(p.sourceSequence) || !text(p.session, 32)
      || !integer(p.priceInt, 1) || !integer(p.quantity, 1)
      || !member(p.side, ["buy", "sell", "unknown"])
      || !member(p.sideMethod, ["exchange", "resting_order", "quote_rule", "unknown"])
      || typeof p.eligible !== "boolean"
      || !Array.isArray(p.conditions) || p.conditions.length > 16
      || !p.conditions.every(c => typeof c === "string" && c.length <= 32)
      || (p.exclusionReason !== undefined && !text(p.exclusionReason, 240))) return false;
  if ((p.side === "unknown") !== (p.sideMethod === "unknown")) return false;
  // Source-native execution records only. Quote, book, fill and bar updates cannot be relabelled volume.
  if (p.kind === "trade" && !member(p.sourceRecordType, ["L", "T", "CME_TRADE_SUMMARY", "MASSIVE_T", "BOATS_T"])) return false;
  if (p.kind === "cancel" && (!id(p.targetId) || !member(p.sourceRecordType, ["B", "CANCEL"]))) return false;
  return true;
}
function validResponse(r: unknown): r is ResponseObservation {
  return obj(r) && id(r.id) && isNs(r.eventNs) && isNs(r.availableNs)
    && BigInt(r.availableNs) >= BigInt(r.eventNs) && integer(r.priceInt, 1)
    && r.kind === "qualified_midpoint" && typeof r.eligible === "boolean"
    && text(r.sourceRef) && (r.quoteAgeMs === null || integer(r.quoteAgeMs, 0, 86400000));
}
/** Strict public boundary. A provenance assertion is not a license or capture attestation. */
export function validateLargeTradesEnvelope(value: unknown): value is LargeTradesEnvelope {
  if (!obj(value) || value.schema !== "mastermind.large_trades.v1"
      || !obj(value.instrument) || !obj(value.provenance) || !obj(value.range)) return false;
  const i = value.instrument, p = value.provenance, range = value.range;
  if (typeof i.symbol !== "string" || !/^[A-Za-z0-9^][A-Za-z0-9.^=_!\-]{0,31}$/.test(i.symbol) || !id(i.instrumentId)
      || !member(i.assetClass, ["equity", "future", "option"])
      || !member(i.quantityUnit, ["shares", "contracts"])
      || (i.assetClass === "equity" ? i.quantityUnit !== "shares" : i.quantityUnit !== "contracts")
      || !integer(i.priceScale, 1, 1000000000)
      || !(i.tickSizeInt === null || integer(i.tickSizeInt, 1))
      || !text(i.timezone, 80)) return false;
  if (!text(p.provider, 120) || !text(p.dataset, 120) || !text(p.venue, 80)
      || !member(p.scope, ["venue", "consolidated"])
      || !member(p.dataMode, ["live", "delayed", "historical", "fixture", "unavailable"])
      || !member(p.evidenceMode, ["ACTUAL_AS_SEEN", "HISTORICAL_REPLAY", "FIXTURE"])
      || !id(p.sourceId) || !(p.sourceSha256 === null || typeof p.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(p.sourceSha256))
      || !text(p.sourceRef) || !isNs(p.generatedAtNs)
      || !(p.acquiredAtNs === null || isNs(p.acquiredAtNs))
      || !member(p.receiptBasis, ["original_receive", "archive_acquisition", "fixture"])
      || !member(p.coverage, ["complete", "partial", "unknown"])
      || !integer(p.sequenceGaps) || !(p.delayMs === null || integer(p.delayMs, 0))
      || !text(p.conditionPolicy) || !text(p.attribution, 1000)
      || !(p.termsUrl === null || typeof p.termsUrl === "string" && /^https:\/\/[^\s]{1,400}$/.test(p.termsUrl))) return false;
  if (p.dataMode === "live" && (p.evidenceMode !== "ACTUAL_AS_SEEN"
      || p.receiptBasis !== "original_receive" || p.delayMs !== 0)) return false;
  if (p.dataMode === "delayed" && (p.evidenceMode !== "ACTUAL_AS_SEEN"
      || p.receiptBasis !== "original_receive" || !integer(p.delayMs, 1))) return false;
  if (p.evidenceMode === "FIXTURE" && p.dataMode !== "fixture") return false;
  if (p.evidenceMode === "HISTORICAL_REPLAY" && p.dataMode !== "historical") return false;
  if (p.receiptBasis === "original_receive" && p.evidenceMode !== "ACTUAL_AS_SEEN") return false;
  if (p.dataMode === "historical" && (p.evidenceMode !== "HISTORICAL_REPLAY"
      || p.receiptBasis !== "archive_acquisition" || !isNs(p.acquiredAtNs))) return false;
  if (p.dataMode === "fixture" && (p.evidenceMode !== "FIXTURE" || p.receiptBasis !== "fixture")) return false;
  if (p.receiptBasis === "fixture" && p.dataMode !== "fixture") return false;
  if (p.receiptBasis === "archive_acquisition" && p.dataMode !== "historical") return false;
  if (!isNs(range.startNs) || !isNs(range.endNs) || BigInt(range.startNs) > BigInt(range.endNs)
      || !Array.isArray(value.prints) || value.prints.length > MAX_RECORDS
      || !Array.isArray(value.responses) || value.responses.length > MAX_RECORDS
      || !value.prints.every(validPrint) || !value.responses.every(validResponse)
      || !member(value.responseCoverage, ["complete", "partial", "unavailable"])
      || !(value.responseKnownAtNs === null || isNs(value.responseKnownAtNs))) return false;
  if (p.dataMode === "unavailable" && (value.prints.length || value.responses.length)) return false;
  const generated = BigInt(p.generatedAtNs);
  if ([...value.prints, ...value.responses].some(r => BigInt(r.availableNs) > generated)) return false;
  if (p.receiptBasis === "archive_acquisition") {
    const acquired = BigInt(p.acquiredAtNs as string);
    if (acquired > generated || [...value.prints, ...value.responses].some(r =>
      BigInt(r.availableNs) < acquired || BigInt(r.eventNs) > acquired)) return false;
  }
  return true;
}
export function settingsFromParams(params: Record<string, unknown> = {}): LargeTradesSettings {
  const defaults = DEFAULT_LARGE_TRADES_SETTINGS;
  const bound = (key: keyof LargeTradesSettings, min: number, max: number) => {
    const v = params[key];
    return typeof v === "number" && Number.isFinite(v)
      ? Math.min(max, Math.max(min, Math.round(v))) : defaults[key] as number;
  };
  const bool = (key: keyof LargeTradesSettings) =>
    typeof params[key] === "boolean" ? params[key] as boolean : defaults[key] as boolean;
  return {
    minQuantity: bound("minQuantity", 1, 1000000000),
    aggregate: bool("aggregate"), maxGapMs: bound("maxGapMs", 0, 10000),
    maxSpanTicks: bound("maxSpanTicks", 0, 1000),
    maxDurationMs: bound("maxDurationMs", 1, 60000),
    adaptive: bool("adaptive"), percentile: bound("percentile", 50, 100),
    baselineCount: bound("baselineCount", 10, 5000),
    minBaseline: bound("minBaseline", 2, 5000),
    responseWindowMs: bound("responseWindowMs", 1000, 300000),
    maxResponseTicks: bound("maxResponseTicks", 0, 1000),
    reversalTicks: bound("reversalTicks", 1, 1000),
    showLabels: bool("showLabels"), maxMarkers: bound("maxMarkers", 1, 1000),
  };
}
const unavailable = (reason: string, pending = false): ClusterResponse => ({
  state: pending ? "pending" : "unobservable", reason, knownAtNs: null, endpointNs: null,
  responseTicks: null, absorption: "unavailable", evidence: "unavailable", predictiveSignal: false,
});
function economicIdentity(p: TradePrint): string {
  return JSON.stringify([p.kind, p.targetId ?? null, p.eventNs, p.session, p.priceInt,
    p.quantity, p.side, p.sideMethod, p.eligible, p.exclusionReason ?? null,
    p.conditions, p.sourceRecordType]);
}
function qualifiedResponse(
  c: LargeTradeCluster, e: LargeTradesEnvelope, settings: LargeTradesSettings,
  clock: LargeTradesClock, responses: ResponseObservation[], integrityIssue: boolean,
): ClusterResponse {
  const tick = e.instrument.tickSizeInt;
  const responseStart = BigInt(c.formationStartNs ?? c.startNs);
  const deadline = BigInt(c.formationEndNs ?? c.endNs) + BigInt(settings.responseWindowMs) * NS_MS;
  if (!c.closedAtNs) return unavailable("Execution cluster is still open", true);
  if (BigInt(clock.marketCutoffNs) < deadline) return unavailable("Response window has not matured", true);
  if (c.side === "unknown") return unavailable("Aggressor side is unknown");
  if (tick === null) return unavailable("Instrument tick size is not qualified");
  if (e.provenance.coverage !== "complete") return unavailable("Transaction coverage is incomplete");
  if (integrityIssue || e.provenance.sequenceGaps > 0) return unavailable("Source corrections or sequence integrity are unresolved");
  if (e.responseCoverage !== "complete" || !e.responseKnownAtNs)
    return unavailable("Qualified quote-response coverage is unavailable");
  if (BigInt(e.responseKnownAtNs) > BigInt(clock.knowledgeCutoffNs))
    return unavailable("Response evidence was not yet available", true);
  if (deadline > BigInt(e.range.endNs)) return unavailable("Response window exceeds source coverage");
  // Choose the latest observation, then check eligibility: an invalid latest update
  // must never fall back to a convenient older quote.
  const latest = (eventLimit: bigint, availableLimit: bigint) => {
    let left = 0, right = responses.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (BigInt(responses[mid].eventNs) <= eventLimit) left = mid + 1;
      else right = mid;
    }
    let chosen: ResponseObservation | undefined, tie = false;
    for (let j = left - 1; j >= 0; j--) {
      const r = responses[j];
      if (chosen && r.eventNs !== chosen.eventNs) break;
      if (!chosen && eventLimit - BigInt(r.eventNs) > MAX_QUOTE_AGE_NS) break;
      if (BigInt(r.availableNs) > availableLimit) continue;
      if (chosen) tie = true;
      else chosen = r;
    }
    return { chosen, tie };
  };
  const a = latest(responseStart - BigInt(1), BigInt(c.knownAtNs));
  const z = latest(deadline, BigInt(clock.knowledgeCutoffNs));
  const anchor = a.chosen, endpoint = z.chosen, anchorTie = a.tie, endpointTie = z.tie;
  if (!anchor || !endpoint || anchorTie || endpointTie || !anchor.eligible || !endpoint.eligible)
    return unavailable("Qualified prior and endpoint midpoints are unavailable");
  if (anchor.quoteAgeMs === null || endpoint.quoteAgeMs === null
      || responseStart - BigInt(anchor.eventNs) + BigInt(anchor.quoteAgeMs) * NS_MS > MAX_QUOTE_AGE_NS
      || deadline - BigInt(endpoint.eventNs) + BigInt(endpoint.quoteAgeMs) * NS_MS > MAX_QUOTE_AGE_NS)
    return unavailable("Quote evidence is stale or has no qualified age");
  const path = responses.filter(r => BigInt(r.eventNs) >= responseStart
    && BigInt(r.eventNs) <= deadline);
  let pathValid = path.length > 0, maxExcursion = 0, pathKnown = endpoint.availableNs;
  let lastEvent: string | null = null;
  for (const r of path) {
    if (!r.eligible || r.quoteAgeMs === null || r.quoteAgeMs > 5000 || r.eventNs === lastEvent) pathValid = false;
    maxExcursion = Math.max(maxExcursion, Math.abs(r.priceInt - anchor.priceInt) / tick);
    pathKnown = maxNs(pathKnown, r.availableNs); lastEvent = r.eventNs;
  }
  const knownAt = maxNs(c.knownAtNs, c.closedAtNs, deadline.toString(), e.responseKnownAtNs,
    anchor.availableNs, endpoint.availableNs, pathKnown);
  if (BigInt(knownAt) > BigInt(clock.knowledgeCutoffNs))
    return unavailable("Response evidence was not yet available", true);
  const responseTicks = (endpoint.priceInt - anchor.priceInt) / tick;
  const directed = responseTicks * (c.side === "buy" ? 1 : -1);
  const failed = directed <= -settings.reversalTicks;
  const limited = Math.abs(responseTicks) <= settings.maxResponseTicks;
  const candidate = limited && !failed && pathValid && maxExcursion <= settings.maxResponseTicks;
  const state = failed ? "failed_continuation" : directed > settings.maxResponseTicks
    ? "continued" : limited ? "limited_response" : "no_pattern";
  return {
    state, reason: failed ? "Price reversed against the executed-side pressure after the fixed window"
      : state === "continued" ? "Price continued in the executed-side direction"
      : candidate ? "Large sided execution with limited qualified midpoint excursion throughout the window"
      : limited ? "Net response was limited; the full path does not establish an absorption candidate"
      : "The predeclared response conditions were not met",
    knownAtNs: knownAt, endpointNs: endpoint.eventNs, responseTicks,
    maxExcursionTicks: pathValid ? maxExcursion : null, pathEvidence: pathValid ? "complete" : "unavailable",
    absorption: candidate ? "candidate" : "unavailable",
    evidence: "qualified_midpoint", predictiveSignal: false,
  };
}
/**
 * Pure as-of projection. Caller supplies market and knowledge cutoffs explicitly.
 * The function never obtains time, data, classification or authority itself.
 */
export function buildLargeTradesSnapshot(
  envelope: LargeTradesEnvelope,
  inputSettings: Partial<LargeTradesSettings> = {},
  clock: LargeTradesClock,
): LargeTradesSnapshot {
  if (!validateLargeTradesEnvelope(envelope)) throw new Error("INVALID_TRANSACTION_ENVELOPE");
  if (!isNs(clock.marketCutoffNs) || !isNs(clock.knowledgeCutoffNs))
    throw new Error("INVALID_REPLAY_CLOCK");
  const settings = settingsFromParams(inputSettings as Record<string, unknown>);
  const marketT = BigInt(clock.marketCutoffNs), knownT = BigInt(clock.knowledgeCutoffNs);
  if (envelope.provenance.evidenceMode === "ACTUAL_AS_SEEN" && marketT > knownT)
    throw new Error("MARKET_TIME_AFTER_KNOWLEDGE");
  const start = BigInt(envelope.range.startNs), end = BigInt(envelope.range.endNs);
  const visible = envelope.prints.filter(p =>
    BigInt(p.eventNs) >= start && BigInt(p.eventNs) <= end
    && BigInt(p.eventNs) <= marketT && BigInt(p.availableNs) <= knownT);
  visible.sort((a, b) => cmpNs(a.availableNs, b.availableNs)
    || a.session.localeCompare(b.session) || cmpNs(a.sourceSequence, b.sourceSequence) || a.id.localeCompare(b.id));
  const d: LargeTradesSnapshot["diagnostics"] = {
    sourceRecords: visible.length, eligibleTrades: 0, excludedRecords: 0, cancellations: 0,
    unmatchedCancels: 0, duplicateRecords: 0, conflictingIds: 0, unknownQuantity: 0,
    eligibleQuantity: 0, markerLimitApplied: false, calibrationPending: 0, qualifyingClusters: 0,
  };
  type Group = {
    first: TradePrint; members: Map<string, TradePrint>; quantity: number;
    knownAt: string; thresholdKnownAt: string; threshold: number;
    baselineSamples: number; ready: boolean; corrections: string[];
    low: number; high: number; start: bigint; end: bigint; last: TradePrint;
    dirty: boolean; inHistory: boolean; formationStart: bigint; formationEnd: bigint;
    lastObservedAvailable: string; closedAt: string | null;
  };
  type History = { items: Group[]; quantities: number[]; maxEnd: bigint };
  type RecordState = { print: TradePrint; active: boolean; group?: Group };
  const records = new Map<string, RecordState>();
  const conflicts = new Set<string>();
  const forcedQuarantine = new Set<string>();
  const pending = new Map<string, TradePrint[]>();
  const history = new Map<string, History>();
  const groups: Group[] = [];
  let open: Group | undefined;
  const tick = envelope.instrument.tickSizeInt;
  const sortedIndex = (values: number[], value: number) => {
    let left = 0, right = values.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (values[mid] < value) left = mid + 1; else right = mid;
    }
    return left;
  };
  const bounds = (g: Group) => {
    if (!g.dirty || !g.members.size) return;
    let low = Infinity, high = -Infinity, first: TradePrint | undefined, last: TradePrint | undefined;
    for (const p of g.members.values()) {
      low = Math.min(low, p.priceInt); high = Math.max(high, p.priceInt);
      if (!first || cmpNs(p.eventNs, first.eventNs) < 0) first = p;
      if (!last || cmpNs(p.eventNs, last.eventNs) >= 0) last = p;
    }
    g.low = low; g.high = high; g.start = BigInt(first!.eventNs); g.end = BigInt(last!.eventNs);
    g.last = last!; g.dirty = false;
  };
  const historyFor = (session: string) => {
    let h = history.get(session);
    if (!h) { h = { items: [], quantities: [], maxEnd: ZERO }; history.set(session, h); }
    return h;
  };
  const closeGroup = (g: Group, effect: TradePrint) => {
    g.closedAt = effect.availableNs;
    if (!settings.adaptive) return;
    bounds(g);
    const h = historyFor(g.first.session);
    h.items.push(g); g.inHistory = true;
    if (g.quantity) h.quantities.splice(sortedIndex(h.quantities, g.quantity), 0, g.quantity);
    if (g.end > h.maxEnd) h.maxEnd = g.end;
    if (h.items.length > settings.baselineCount) {
      const removed = h.items.shift()!; removed.inHistory = false;
      if (removed.quantity) h.quantities.splice(sortedIndex(h.quantities, removed.quantity), 1);
      if (removed.end === h.maxEnd)
        h.maxEnd = h.items.reduce((m, x) => m > x.end ? m : x.end, ZERO);
    }
  };
  const deactivate = (state: RecordState, effect: TradePrint) => {
    if (!state.active) return;
    state.active = false;
    const g = state.group;
    if (!g) return;
    const previousQuantity = g.quantity;
    g.members.delete(state.print.id); g.quantity -= state.print.quantity;
    g.knownAt = maxNs(g.knownAt, effect.availableNs); g.corrections.push(effect.id); g.dirty = true;
    if (g.inHistory) {
      const h = historyFor(g.first.session);
      h.quantities.splice(sortedIndex(h.quantities, previousQuantity), 1);
      if (g.quantity) h.quantities.splice(sortedIndex(h.quantities, g.quantity), 0, g.quantity);
      // A stale high maxEnd only triggers the conservative filtered path below.
    }
  };
  const validTarget = (cancel: TradePrint, target?: RecordState) => !!target
    && target.print.kind === "trade" && target.print.session === cancel.session
    && BigInt(target.print.eventNs) <= BigInt(cancel.eventNs)
    && target.print.priceInt === cancel.priceInt && target.print.quantity === cancel.quantity
    && !conflicts.has(target.print.id);
  const quarantine = (targetId: string | undefined, effect: TradePrint) => {
    if (!targetId) return;
    forcedQuarantine.add(targetId);
    const target = records.get(targetId);
    if (target?.print.kind === "trade") deactivate(target, effect);
  };
  // Process original availability first. A later correction can revise its own
  // execution cluster and FUTURE calibration, never an already frozen threshold.
  for (const p of visible) {
    const previous = records.get(p.id);
    if (previous) {
      if (economicIdentity(previous.print) === economicIdentity(p)) { d.duplicateRecords++; continue; }
      conflicts.add(p.id);
      if (previous.print.kind === "trade") deactivate(previous, p);
      else quarantine(previous.print.targetId, p);
      if (p.kind === "cancel") quarantine(p.targetId, p);
      continue;
    }
    const state: RecordState = { print: p, active: false };
    records.set(p.id, state);
    if (p.kind === "cancel") {
      d.cancellations++;
      const target = records.get(p.targetId!);
      if (validTarget(p, target)) deactivate(target!, p);
      else {
        const awaiting = pending.get(p.targetId!) ?? []; awaiting.push(p); pending.set(p.targetId!, awaiting);
      }
      continue;
    }
    if (!p.eligible || forcedQuarantine.has(p.id)) continue;
    const alreadyBroken = (pending.get(p.id) ?? []).some(c => !conflicts.has(c.id) && validTarget(c, state));
    if (alreadyBroken) continue;
    state.active = true;
    if (open) bounds(open);
    const event = BigInt(p.eventNs), available = BigInt(p.availableNs);
    const span = open ? Math.max(open.high, p.priceInt) - Math.min(open.low, p.priceInt) : 0;
    const joins = settings.aggregate && open && open.quantity > 0
      && p.session === open.first.session && p.side === open.first.side && p.sideMethod === open.first.sideMethod
      && event >= open.formationEnd && event - open.formationEnd <= BigInt(settings.maxGapMs) * NS_MS
      && available - BigInt(open.lastObservedAvailable) <= BigInt(settings.maxGapMs) * NS_MS
      && event - open.formationStart <= BigInt(settings.maxDurationMs) * NS_MS
      && (tick === null ? span === 0 : span <= settings.maxSpanTicks * tick);
    if (!joins) {
      if (open) closeGroup(open, p);
      let baseline: number[] = [];
      if (settings.adaptive) {
        const h = historyFor(p.session);
        baseline = h.maxEnd < event ? h.quantities.slice() : h.items.filter(g => {
          bounds(g); return g.quantity > 0 && g.end < event;
        }).map(g => g.quantity).sort((a, b) => a - b);
      }
      const quantile = baseline.length ? baseline[Math.max(0, Math.ceil(settings.percentile / 100 * baseline.length) - 1)] : 0;
      open = {
        first: p, members: new Map(), quantity: 0, knownAt: p.availableNs,
        thresholdKnownAt: p.availableNs,
        threshold: settings.adaptive ? Math.max(settings.minQuantity, quantile) : settings.minQuantity,
        baselineSamples: baseline.length, ready: !settings.adaptive || baseline.length >= settings.minBaseline,
        corrections: [], low: p.priceInt, high: p.priceInt, start: event, end: event,
        last: p, dirty: false, inHistory: false, formationStart: event, formationEnd: event,
        lastObservedAvailable: p.availableNs, closedAt: null,
      };
      groups.push(open);
    }
    const g = open!;
    const nextQuantity = g.quantity + p.quantity;
    if (!Number.isSafeInteger(nextQuantity)) throw new Error("QUANTITY_OVERFLOW");
    state.group = g; g.members.set(p.id, p); g.quantity = nextQuantity;
    g.knownAt = maxNs(g.knownAt, p.availableNs); g.last = p; g.end = event; g.formationEnd = event; g.lastObservedAvailable = p.availableNs;
    g.low = Math.min(g.low, p.priceInt); g.high = Math.max(g.high, p.priceInt);
  }
  d.conflictingIds = conflicts.size;
  for (const state of records.values()) {
    const p = state.print;
    if (p.kind === "cancel") {
      if (!conflicts.has(p.id) && !validTarget(p, records.get(p.targetId!))) d.unmatchedCancels++;
    } else if (!state.active) d.excludedRecords++;
  }
  const prints = [...records.values()].filter(s => s.active).map(s => s.print)
    .sort((a, b) => cmpNs(a.eventNs, b.eventNs) || cmpNs(a.sourceSequence, b.sourceSequence) || a.id.localeCompare(b.id));
  d.eligibleTrades = prints.length;
  for (const p of prints) {
    d.eligibleQuantity += p.quantity;
    if (p.side === "unknown") d.unknownQuantity += p.quantity;
    if (!Number.isSafeInteger(d.eligibleQuantity)) throw new Error("QUANTITY_OVERFLOW");
  }
  const clusters: LargeTradeCluster[] = [];
  for (const g of groups) {
    if (!g.quantity) continue;
    if (!g.ready) { d.calibrationPending++; continue; }
    if (g.quantity < g.threshold) continue;
    bounds(g);
    let numerator = ZERO;
    const members = [...g.members.values()];
    for (const p of members) numerator += BigInt(p.priceInt) * BigInt(p.quantity);
    const byGap = g.formationEnd + BigInt(settings.maxGapMs) * NS_MS;
    const byDuration = g.formationStart + BigInt(settings.maxDurationMs) * NS_MS;
    const closeMarket = byGap < byDuration ? byGap : byDuration;
    const closeKnowledge = BigInt(g.lastObservedAvailable) + BigInt(settings.maxGapMs) * NS_MS;
    const closedAt = g.closedAt ?? (marketT >= closeMarket && knownT >= closeKnowledge
      ? maxNs(closeMarket.toString(), closeKnowledge.toString()) : null);
    const c: LargeTradeCluster = {
      id: envelope.provenance.sourceId + ":" + g.first.session + ":" + g.first.id,
      session: g.first.session, startNs: g.start.toString(), endNs: g.end.toString(), knownAtNs: g.knownAt,
      quantity: g.quantity, tradeCount: members.length,
      buyQuantity: g.first.side === "buy" ? g.quantity : 0,
      sellQuantity: g.first.side === "sell" ? g.quantity : 0,
      unknownQuantity: g.first.side === "unknown" ? g.quantity : 0,
      side: g.first.side, sideMethod: g.first.sideMethod,
      minPriceInt: g.low, maxPriceInt: g.high,
      weightedPrice: Number(numerator) / g.quantity / envelope.instrument.priceScale,
      lastPriceInt: g.last.priceInt, notionalNumerator: numerator.toString(),
      threshold: g.threshold, thresholdKnownAtNs: g.thresholdKnownAt, correctionIds: g.corrections,
      formationStartNs: g.formationStart.toString(), formationEndNs: g.formationEnd.toString(), closedAtNs: closedAt,
      baselineSamples: g.baselineSamples, calibrationReady: g.ready,
      sourceIds: members.map(p => p.id), orderCount: null,
      response: unavailable("Response window has not matured", true),
    };
    clusters.push(c);
  }
  d.qualifyingClusters = clusters.length;
  d.markerLimitApplied = clusters.length > settings.maxMarkers;
  const retained = d.markerLimitApplied ? [...clusters].sort((a, b) => b.quantity - a.quantity
    || cmpNs(a.startNs, b.startNs) || a.id.localeCompare(b.id)).slice(0, settings.maxMarkers) : clusters;
  retained.sort((a, b) => cmpNs(a.startNs, b.startNs) || a.id.localeCompare(b.id));
  const responses = envelope.responses.filter(r => BigInt(r.eventNs) <= marketT && BigInt(r.availableNs) <= knownT)
    .sort((a, b) => cmpNs(a.eventNs, b.eventNs) || a.id.localeCompare(b.id));
  for (const c of retained) c.response = qualifiedResponse(c, envelope, settings, clock, responses,
    d.conflictingIds > 0 || d.unmatchedCancels > 0);
  return { clusters: retained, visiblePrints: prints, diagnostics: d, clock: { ...clock },
    dataMode: envelope.provenance.dataMode, evidenceMode: envelope.provenance.evidenceMode };
}
