import { describe, expect, it } from "vitest";
import { backoffMs, failurePatch, isDueDelivery } from "@/lib/webhookRetry";

describe("webhook retry schedule", () => {
  it("matches the 4-step backoff table (1m / 5m / 30m / 4h)", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(5 * 60_000);
    expect(backoffMs(3)).toBe(30 * 60_000);
    expect(backoffMs(4)).toBe(4 * 60 * 60_000);
  });

  it("attempt 5 failing produces status failed and never sets next_retry_at", () => {
    const now = new Date("2026-09-09T10:00:00.000Z");
    const patch = failurePatch(5, now);
    expect(patch.status).toBe("failed");
    expect(patch.next_retry_at).toBeNull();
  });

  it("attempts 1-4 failing always set status retrying and a future next_retry_at", () => {
    const now = new Date("2026-09-09T10:00:00.000Z");
    for (const attempt of [1, 2, 3, 4] as const) {
      const patch = failurePatch(attempt, now);
      expect(patch.status, `attempt ${attempt}`).toBe("retrying");
      expect(patch.next_retry_at, `attempt ${attempt}`).not.toBeNull();
      expect(Date.parse(patch.next_retry_at!), `attempt ${attempt}`).toBeGreaterThan(now.getTime());
      expect(Date.parse(patch.next_retry_at!)).toBe(now.getTime() + backoffMs(attempt)!);
    }
  });
});

describe("stale-lease recovery (spec §4.5)", () => {
  const now = new Date("2026-09-09T10:00:00.000Z").getTime();

  it("a row claimed then abandoned (claimed_at in the past) is due again", () => {
    const abandoned = {
      status: "delivering",
      claimed_at: new Date(now - 11 * 60_000).toISOString(),
      next_retry_at: null as string | null,
    };
    expect(isDueDelivery(abandoned, now)).toBe(true);
  });

  it("does not double-send if the original attempt already succeeded out-of-band", () => {
    const delivered = {
      status: "delivered",
      claimed_at: new Date(now - 11 * 60_000).toISOString(),
      next_retry_at: null as string | null,
    };
    expect(isDueDelivery(delivered, now)).toBe(false);
  });

  it("a freshly claimed delivering row is not due yet", () => {
    const live = {
      status: "delivering",
      claimed_at: new Date(now - 30_000).toISOString(),
      next_retry_at: null as string | null,
    };
    expect(isDueDelivery(live, now)).toBe(false);
  });
});
