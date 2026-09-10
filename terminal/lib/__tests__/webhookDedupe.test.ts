import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WEBHOOK_DEDUPE_EXPRESSION, webhookDedupeKey } from "@/lib/webhookDedupe";

const EP_A = "11111111-1111-1111-1111-111111111111";
const EP_B = "22222222-2222-2222-2222-222222222222";

describe("webhook delivery dedupe key", () => {
  it("two enqueue calls with the same (endpoint_id, event_id) collide on dedupe_key", () => {
    expect(webhookDedupeKey(EP_A, "evt-1")).toBe(webhookDedupeKey(EP_A, "evt-1"));
    expect(webhookDedupeKey(EP_A, "evt-1")).toBe(`${EP_A}:evt-1`);
  });

  it("two different event_ids for the same endpoint never collide", () => {
    expect(webhookDedupeKey(EP_A, "evt-1")).not.toBe(webhookDedupeKey(EP_A, "evt-2"));
  });

  it("the generated-column expression in the migration matches the string-built key", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "..", "supabase", "migrations", "0018_webhook_delivery.sql"),
      "utf8",
    );
    expect(sql.replace(/\s+/g, " ")).toContain(WEBHOOK_DEDUPE_EXPRESSION);
    // The expression is endpoint_id::text || ':' || event_id — the JS builder is the same join.
    expect(WEBHOOK_DEDUPE_EXPRESSION).toBe("endpoint_id::text || ':' || event_id");
    expect(webhookDedupeKey(EP_A, "evt-1")).not.toBe(webhookDedupeKey(EP_B, "evt-1"));
  });
});
