/**
 * R8 flow projection — deterministic projection over canonical, already-filtered flow events.
 * It creates no second event identity and no scoring authority.
 */

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
  softBuyPremium: number;
  softSellPremium: number;
  mixedPremium: number;
  roots: string[];
}

export interface FlowProjection {
  intervalMinutes: FlowProjectionIntervalMinutes;
  inputEventCount: number;
  validEventCount: number;
  invalidTimestampCount: number;
  invalidValueCount: number;
  buckets: FlowProjectionBucket[];
}

function validMagnitude(event: FlowProjectionSource): boolean {
  return Number.isFinite(event.premium) && event.premium >= 0
    && Number.isFinite(event.size) && event.size >= 0
    && Number.isFinite(event.n_prints) && event.n_prints >= 0;
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
  const byStart = new Map<number, T[]>();
  let invalidTimestampCount = 0;
  let invalidValueCount = 0;

  for (const event of events) {
    const tsMs = Date.parse(event.ts);
    if (!Number.isFinite(tsMs)) {
      invalidTimestampCount += 1;
      continue;
    }
    if (!validMagnitude(event)) {
      invalidValueCount += 1;
      continue;
    }
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
      let softBuyPremium = 0;
      let softSellPremium = 0;
      let mixedPremium = 0;

      for (const event of ordered) {
        roots.add(event.root);
        printCount += event.n_prints;
        contractCount += event.size;
        grossPremium += event.premium;
        if (event.right === "C") callPremium += event.premium;
        else putPremium += event.premium;
        if (event.side === "~buy") softBuyPremium += event.premium;
        else if (event.side === "~sell") softSellPremium += event.premium;
        else mixedPremium += event.premium;
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
        softBuyPremium,
        softSellPremium,
        mixedPremium,
        roots: [...roots].sort(),
      };
    });

  return {
    intervalMinutes,
    inputEventCount: events.length,
    validEventCount: events.length - invalidTimestampCount - invalidValueCount,
    invalidTimestampCount,
    invalidValueCount,
    buckets,
  };
}

export function selectFlowProjectionBucket<T extends FlowProjectionSource>(
  events: readonly T[],
  bucket: FlowProjectionBucket | null,
): T[] {
  if (!bucket) return [...events];
  const ids = new Set(bucket.eventIds);
  return events.filter((event) => ids.has(event.id));
}
