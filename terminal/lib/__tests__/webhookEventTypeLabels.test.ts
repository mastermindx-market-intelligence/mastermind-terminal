import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WEBHOOK_EVENT_TYPE_LABEL, webhookEventTypeLabel } from "@/lib/webhookLabels";
import { LEGAL_EVENT_TYPES } from "@/lib/webhooks";

const raw = readFileSync(
  path.join(process.cwd(), "..", "supabase", "migrations", "0018_webhook_delivery.sql"),
  "utf8",
);

/**
 * The migration's check constraint is the source of truth for which event
 * types can ever reach the deliveries list. Reading it here is the forcing
 * function: widening `event_filter <@ array[...]` without adding the customer
 * -facing name to WEBHOOK_EVENT_TYPE_LABEL fails this suite loudly, instead of
 * shipping a row silently mislabelled as the old event.
 */
function legalEventTypesFromMigration(): string[] {
  const flat = raw.split("\n").map((l) => l.replace(/--.*$/, "")).join(" ").replace(/\s+/g, " ");
  const m = /check \(event_filter <@ array\[([^\]]*)\]::text\[\]\)/.exec(flat);
  if (!m) throw new Error("0018 no longer constrains event_filter to a closed vocabulary");
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("every legal event type has a customer-facing name", () => {
  it("reads a non-empty vocabulary out of the migration", () => {
    const legal = legalEventTypesFromMigration();
    expect(legal.length).toBeGreaterThan(0);
    expect(legal).toContain("webhook.test");
  });

  it("labels every value the migration allows, in both languages", () => {
    for (const type of legalEventTypesFromMigration()) {
      const pair = (WEBHOOK_EVENT_TYPE_LABEL as Readonly<Record<string, readonly [string, string] | undefined>>)[type];
      expect(pair, `event type ${type} is legal in 0018 but has no label pair`).toBeTruthy();
      expect(webhookEventTypeLabel(type, "en")).not.toBe(type);
      expect(webhookEventTypeLabel(type, "zh")).not.toBe(type);
      expect(webhookEventTypeLabel(type, "zh")).not.toMatch(/[a-z]+\.[a-z]+/);
    }
  });

  it("the route layer's vocabulary matches the migration's", () => {
    expect([...LEGAL_EVENT_TYPES].sort()).toEqual(legalEventTypesFromMigration().sort());
  });

  it("an unlabelled event type never leaks its slug on screen", () => {
    expect(webhookEventTypeLabel("webhook.something_new", "en")).toBe("Unknown event");
    expect(webhookEventTypeLabel("webhook.something_new", "zh")).toBe("未知事件");
    expect(webhookEventTypeLabel(null, "en")).toBe("Unknown event");
    expect(webhookEventTypeLabel("", "zh")).toBe("未知事件");
  });
});
