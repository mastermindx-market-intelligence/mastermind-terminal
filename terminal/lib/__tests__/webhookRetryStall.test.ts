import { describe, expect, it } from "vitest";
import { hasBadRetryTimestamp, isDueDelivery } from "@/lib/webhookRetry";
import { deliverOne, type DeliveryRow, type EndpointRow } from "../../../ingest/webhook_delivery";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");

function retrying(next_retry_at: string | null) {
  return { status: "retrying", claimed_at: null, next_retry_at };
}

describe("an unreadable next_retry_at is due now, never parked forever", () => {
  it("isDueDelivery returns true for a timestamp no Date can read", () => {
    expect(isDueDelivery(retrying("not-a-timestamp"), NOW)).toBe(true);
    expect(isDueDelivery(retrying(""), NOW)).toBe(true);
    expect(isDueDelivery(retrying("2026-13-45T99:99:99Z"), NOW)).toBe(true);
  });

  it("still honours a timestamp it can read", () => {
    expect(isDueDelivery(retrying(new Date(NOW - 1000).toISOString()), NOW)).toBe(true);
    expect(isDueDelivery(retrying(new Date(NOW + 1000).toISOString()), NOW)).toBe(false);
  });

  it("hasBadRetryTimestamp names exactly the unreadable case", () => {
    expect(hasBadRetryTimestamp({ next_retry_at: "not-a-timestamp" })).toBe(true);
    expect(hasBadRetryTimestamp({ next_retry_at: null })).toBe(false);
    expect(hasBadRetryTimestamp({ next_retry_at: new Date(NOW).toISOString() })).toBe(false);
  });
});

describe("the worker records the bad timestamp instead of stalling in silence", () => {
  const ENDPOINT: EndpointRow = {
    id: "ep-1",
    url: "https://hooks.example.com/mastermind",
    secret: "not-a-real-secret",
    enabled: true,
  };

  function rowWith(next_retry_at: string | null): DeliveryRow {
    return {
      id: "d1",
      endpoint_id: "ep-1",
      team_id: "team-1",
      event_id: "e1",
      event_type: "webhook.test",
      payload: {},
      attempt: 1,
      status: "retrying",
      claimed_at: null,
      next_retry_at,
    };
  }

  function harness() {
    const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
    return {
      patches,
      supa: {
        patch: async (path: string, body: Record<string, unknown>) => {
          patches.push({ path, body });
          return [{ id: "d1" }];
        },
      },
      hooks: {
        resolve: async () => ({ address: "203.0.113.10", family: 4 }),
        post: async () => ({ status: 200 }),
      },
    };
  }

  it("writes last_error bad_retry_timestamp on the claim", async () => {
    const h = harness();
    await deliverOne(h.supa, rowWith("not-a-timestamp"), ENDPOINT, false, h.hooks);
    const claim = h.patches.find((p) => p.path.includes("status=in.("));
    expect(claim, "the row is still claimed and still sent").toBeTruthy();
    expect(claim?.body.last_error).toBe("bad_retry_timestamp");
    expect(claim?.body.status).toBe("delivering");
  });

  it("says nothing extra when the timestamp is readable", async () => {
    const h = harness();
    await deliverOne(h.supa, rowWith(new Date(NOW).toISOString()), ENDPOINT, false, h.hooks);
    const claim = h.patches.find((p) => p.path.includes("status=in.("));
    expect(claim?.body).not.toHaveProperty("last_error");
  });
});
