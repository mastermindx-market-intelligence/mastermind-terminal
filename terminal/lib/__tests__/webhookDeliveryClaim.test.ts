import { describe, expect, it } from "vitest";
import { deliverOne, type DeliveryRow, type EndpointRow } from "../../../ingest/webhook_delivery";

const NOW = "2026-09-09T12:00:00.000Z";

const staleRow: DeliveryRow = {
  id: "del-1",
  endpoint_id: "ep-1",
  team_id: "team-1",
  event_id: "evt-1",
  event_type: "webhook.test",
  payload: { schema: "mastermind.webhook-test/v1" },
  attempt: 1,
  status: "delivering",
  claimed_at: new Date(Date.parse(NOW) - 11 * 60_000).toISOString(),
  next_retry_at: null,
};

const endpoint: EndpointRow = {
  id: "ep-1",
  url: "https://hooks.example.com/mastermind",
  secret: "whsec_test_not_a_real_secret",
  enabled: true,
};

function fakeSupa(claimRows: unknown[]) {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  return {
    patches,
    async patch(path: string, body: Record<string, unknown>) {
      patches.push({ path, body });
      if (path.includes("status=in.(pending,retrying,delivering)")) return claimRows as never[];
      return [{ id: "del-1" }];
    },
  };
}

describe("stale-lease claim does not double-send (spec §4.5)", () => {
  it("skips POST when the claim PATCH matches zero rows (original attempt succeeded out-of-band)", async () => {
    const posts: Array<{ url: string }> = [];
    const supa = fakeSupa([]);
    await deliverOne(supa, staleRow, endpoint, false, {
      resolve: async () => ({ address: "203.0.113.10", family: 4 }),
      post: async (url) => {
        posts.push({ url });
        return { status: 200 };
      },
    });
    expect(posts).toEqual([]);
    expect(supa.patches).toHaveLength(1);
    expect(supa.patches[0].path).toContain("status=in.(pending,retrying,delivering)");
    expect(supa.patches[0].path).toContain(`id=eq.${staleRow.id}`);
  });

  it("POSTs once when the claim PATCH wins", async () => {
    const posts: Array<{ url: string; body: string }> = [];
    const supa = fakeSupa([{ id: "del-1" }]);
    await deliverOne(supa, staleRow, endpoint, false, {
      resolve: async () => ({ address: "203.0.113.10", family: 4 }),
      post: async (url, _address, _family, _headers, rawBody) => {
        posts.push({ url, body: rawBody });
        return { status: 200 };
      },
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(endpoint.url);
    expect(supa.patches.some((p) => p.body.status === "delivered")).toBe(true);
  });
});
