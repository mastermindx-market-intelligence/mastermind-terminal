import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { WEBHOOK_EVENT_TYPE_LABEL, webhookEventTypeLabel } from "@/lib/webhookLabels";
import { LEGAL_EVENT_TYPES } from "@/lib/webhooks";

/**
 * The effective vocabulary is the LAST `check (event_filter <@ array[...]::text[])`
 * found across supabase/migrations/*.sql sorted by prefix (0018, then later
 * files). Widening that constraint without adding the customer-facing name to
 * WEBHOOK_EVENT_TYPE_LABEL fails this suite loudly.
 */
function legalEventTypesFromMigration(): string[] {
  const dir = path.join(process.cwd(), "..", "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  let last: string[] | null = null;
  for (const file of files) {
    const raw = readFileSync(path.join(dir, file), "utf8");
    const flat = raw.split("\n").map((l) => l.replace(/--.*$/, "")).join(" ").replace(/\s+/g, " ");
    const matches = [...flat.matchAll(/check \(event_filter <@ array\[([^\]]*)\]::text\[\]\)/g)];
    for (const m of matches) {
      last = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
  }
  if (!last || last.length === 0) {
    throw new Error("no migration constrains event_filter to a closed vocabulary");
  }
  return last;
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
      expect(pair, `event type ${type} is legal in the effective migration vocabulary but has no label pair`).toBeTruthy();
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
