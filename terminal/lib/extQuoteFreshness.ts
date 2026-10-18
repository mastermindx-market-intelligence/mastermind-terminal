/** BOATS is a distinct, expiring, single-venue qualifying trade display. */
export type ExtProvenance = {
  extSource?: string;
  extBasis?: "LIVE" | "DELAYED_15M" | "UNOFFICIAL";
  extVenue?: "BOATS";
  extPriceKind?: "LAST_TRADE";
  extReceivedTs?: number;
  extPublishedTs?: number;
  extExpiresTs?: number;
  extCaptureId?: string;
  extGeneration?: number;
};

type Candidate = {
  extSource?: unknown; extBasis?: unknown; extVenue?: unknown; extPriceKind?: unknown;
  extTs?: unknown; extReceivedTs?: unknown; extPublishedTs?: unknown; extExpiresTs?: unknown;
  extSession?: unknown; extCaptureId?: unknown; extGeneration?: unknown;
  extPrice?: unknown; extChg?: unknown;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function isExtQuoteCurrent(q: Candidate | null | undefined, nowMs = Date.now()): boolean {
  if (!q) return false;
  if (q.extSource !== "tiingo_boats") return true; // Existing providers keep their own policy.
  if (q.extBasis !== "LIVE" || q.extVenue !== "BOATS" || q.extPriceKind !== "LAST_TRADE" ||
      q.extSession !== "overnight" || !finite(q.extTs) || !finite(q.extReceivedTs) ||
      !finite(q.extPublishedTs) || !finite(q.extExpiresTs)) return false;
  const now = nowMs / 1000;
  return q.extTs > 0 && q.extTs <= q.extReceivedTs && q.extReceivedTs <= q.extPublishedTs &&
    q.extPublishedTs <= now && q.extTs <= now && now - q.extTs <= 30 && now < q.extExpiresTs &&
    q.extExpiresTs <= q.extTs + 30 && q.extExpiresTs > q.extTs;
}

export function extQuotePollMs(nowMs = Date.now()): number {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23",
  }).format(new Date(nowMs)));
  return hour >= 20 || hour < 4 ? 5_000 : 30_000;
}

/** Whole public extended-quote boundary: only Chairman-cleared BOATS facts. */
export function isPublicBoatsQuote(q: Candidate | null | undefined, nowMs = Date.now()): boolean {
  return !!q && q.extSource === "tiingo_boats" && isExtQuoteCurrent(q, nowMs) &&
    finite(q.extPrice) && q.extPrice > 0 && (q.extChg === null || finite(q.extChg)) &&
    typeof q.extCaptureId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(q.extCaptureId) &&
    Number.isSafeInteger(q.extGeneration) && (q.extGeneration as number) >= 1;
}
