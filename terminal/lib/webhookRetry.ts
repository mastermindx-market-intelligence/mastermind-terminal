/** Attempts are 1-indexed after the claim increment. Five attempts total. */
export function backoffMs(attempt: number): number | null {
  if (attempt === 1) return 60_000;
  if (attempt === 2) return 5 * 60_000;
  if (attempt === 3) return 30 * 60_000;
  if (attempt === 4) return 4 * 60 * 60_000;
  return null;
}

export function failurePatch(
  attempt: number,
  now: Date,
): { status: "retrying" | "failed"; next_retry_at: string | null } {
  if (attempt >= 5) return { status: "failed", next_retry_at: null };
  const ms = backoffMs(attempt);
  if (ms == null) return { status: "failed", next_retry_at: null };
  return { status: "retrying", next_retry_at: new Date(now.getTime() + ms).toISOString() };
}

const STALE_LEASE_MS = 10 * 60_000;

export function isDueDelivery(
  row: { status: string; claimed_at: string | null; next_retry_at: string | null },
  nowMs: number,
): boolean {
  if (row.status === "pending" || row.status === "retrying") {
    if (!row.next_retry_at) return true;
    const at = Date.parse(row.next_retry_at);
    return Number.isFinite(at) && at <= nowMs;
  }
  if (row.status === "delivering" && row.claimed_at) {
    const claimed = Date.parse(row.claimed_at);
    return Number.isFinite(claimed) && claimed < nowMs - STALE_LEASE_MS;
  }
  return false;
}

export const STALE_LEASE_INTERVAL = "10 minutes";
