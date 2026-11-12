/**
 * R8 flow projection — deterministic projection over canonical, already-filtered flow events.
 * It creates no second event identity and no scoring authority.
 */
import { measuredInstant } from "@/components/prophet/optionsAlphaMeasuredEvidence";

export type FlowProjectionIntervalMinutes = 5 | 15 | 30 | 60;

export interface FlowProjectionSource {
  id: string;
  ts: string;
  root: string;
  right: "C" | "P";
  premium: number;
  size: number;
  n_prints: number;
  side: "~buy" | "~sell" | "mixed";
}

export interface FlowProjectionBucket {
  key: string;
  start: string;
  end: string;
  eventIds: string[];
  eventCount: number;
  printCount: number;
  contractCount: number;
  grossPremium: number;
  callPremium: number;
  putPremium: number;
  unknownRightPremium: number;
  softBuyPremium: number;
  softSellPremium: number;
  mixedPremium: number;
  unknownSidePremium: number;
  roots: string[];
}

export interface FlowProjection {
  intervalMinutes: FlowProjectionIntervalMinutes;
  inputEventCount: number;
  validEventCount: number;
  invalidIdentityCount: number;
  invalidTimestampCount: number;
  invalidValueCount: number;
  buckets: FlowProjectionBucket[];
}

function validMagnitude(event: FlowProjectionSource): boolean {
  return Number.isFinite(event.premium) && event.premium >= 0
    && Number.isInteger(event.size) && event.size >= 0
    && Number.isInteger(event.n_prints) && event.n_prints >= 0;
}

function normalizedIdentity(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id === id.trim();
}

/** One admission policy for metrics and drill-down; the unselected Tape stays intact. */
function admittedMembers<T extends FlowProjectionSource>(events: readonly T[]) {
  const occurrences = new Map<string, number>();
  for (const event of events) {
    if (normalizedIdentity(event.id)) {
      occurrences.set(event.id, (occurrences.get(event.id) ?? 0) + 1);
    }
  }
  const members: { event: T; tsMs: number }[] = [];
  let invalidIdentityCount = 0;
  let invalidTimestampCount = 0;
  let invalidValueCount = 0;
  for (const event of events) {
    // Exclusive row counts: identity first, then clock, then magnitude. Count
    // duplicates before other admission so a malformed copy cannot choose a winner.
    if (!normalizedIdentity(event.id) || occurrences.get(event.id) !== 1) {
      invalidIdentityCount += 1;
      continue;
    }
    const instant = typeof event.ts === "string" ? measuredInstant(event.ts) : null;
    if (!instant) {
      invalidTimestampCount += 1;
      continue;
    }
    if (!validMagnitude(event)) {
      invalidValueCount += 1;
      continue;
    }
    // Minute boundaries do not need to discard or round the original wire clock.
    // The shared parser's whole second assigns its interval; the event stays exact.
    members.push({ event, tsMs: instant.secondMs });
  }
  return { members, invalidIdentityCount, invalidTimestampCount, invalidValueCount };
}

export function flowProjectionBucketKey(
  tsMs: number,
  intervalMinutes: FlowProjectionIntervalMinutes,
): number {
  const width = intervalMinutes * 60_000;
  return Math.floor(tsMs / width) * width;
}

export function buildFlowProjection<T extends FlowProjectionSource>(
  events: readonly T[],
  intervalMinutes: FlowProjectionIntervalMinutes,
): FlowProjection {
  const admitted = admittedMembers(events);
  const byStart = new Map<number, T[]>();
  for (const { event, tsMs } of admitted.members) {
    const startMs = flowProjectionBucketKey(tsMs, intervalMinutes);
    const bucket = byStart.get(startMs);
    if (bucket) bucket.push(event);
    else byStart.set(startMs, [event]);
  }

  const widthMs = intervalMinutes * 60_000;
  const buckets = [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startMs, members]): FlowProjectionBucket => {
      const ordered = [...members].sort((a, b) => {
        const delta = Date.parse(a.ts) - Date.parse(b.ts);
        return delta !== 0 ? delta : a.id.localeCompare(b.id);
      });
      const roots = new Set<string>();
      let printCount = 0;
      let contractCount = 0;
      let grossPremium = 0;
      let callPremium = 0;
      let putPremium = 0;
      let unknownRightPremium = 0;
      let softBuyPremium = 0;
      let softSellPremium = 0;
      let mixedPremium = 0;
      let unknownSidePremium = 0;

      for (const event of ordered) {
        roots.add(event.root);
        printCount += event.n_prints;
        contractCount += event.size;
        grossPremium += event.premium;
        if (event.right === "C") callPremium += event.premium;
        else if (event.right === "P") putPremium += event.premium;
        else unknownRightPremium += event.premium;
        if (event.side === "~buy") softBuyPremium += event.premium;
        else if (event.side === "~sell") softSellPremium += event.premium;
        else if (event.side === "mixed") mixedPremium += event.premium;
        else unknownSidePremium += event.premium;
      }

      return {
        key: new Date(startMs).toISOString(),
        start: new Date(startMs).toISOString(),
        end: new Date(startMs + widthMs).toISOString(),
        eventIds: ordered.map((event) => event.id),
        eventCount: ordered.length,
        printCount,
        contractCount,
        grossPremium,
        callPremium,
        putPremium,
        unknownRightPremium,
        softBuyPremium,
        softSellPremium,
        mixedPremium,
        unknownSidePremium,
        roots: [...roots].sort(),
      };
    });

  return {
    intervalMinutes,
    inputEventCount: events.length,
    validEventCount: admitted.members.length,
    invalidIdentityCount: admitted.invalidIdentityCount,
    invalidTimestampCount: admitted.invalidTimestampCount,
    invalidValueCount: admitted.invalidValueCount,
    buckets,
  };
}

export function selectFlowProjectionBucket<T extends FlowProjectionSource>(
  events: readonly T[],
  bucket: FlowProjectionBucket | null,
): T[] {
  if (!bucket) return [...events];
  const startMs = Date.parse(bucket.start);
  const endMs = Date.parse(bucket.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const ids = new Set(bucket.eventIds);
  return admittedMembers(events).members
    .filter(({ event, tsMs }) => ids.has(event.id) && tsMs >= startMs && tsMs < endMs)
    .map(({ event }) => event);
}
