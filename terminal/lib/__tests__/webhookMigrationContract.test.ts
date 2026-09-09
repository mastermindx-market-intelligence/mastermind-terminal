import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const raw = readFileSync(
  path.join(process.cwd(), "..", "supabase", "migrations", "0018_webhook_delivery.sql"),
  "utf8",
);
const flat = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .trim();

describe("0018 webhook delivery migration contract", () => {
  it("creates exactly two new tables", () => {
    const matches = [...flat.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(matches).toEqual(["webhook_endpoints", "webhook_deliveries"]);
  });

  it("enables RLS on both tables", () => {
    expect(flat).toContain("alter table public.webhook_endpoints enable row level security");
    expect(flat).toContain("alter table public.webhook_deliveries enable row level security");
  });

  it("webhook_endpoints has no delete policy", () => {
    expect(flat).not.toMatch(/create policy \w+ on public\.webhook_endpoints for delete/);
  });

  it("webhook_deliveries' only non-select-member policy is wd_service_role_all", () => {
    const deliveriesPolicies = [...raw.matchAll(/create policy (\w+) on public\.webhook_deliveries([\s\S]*?);/g)];
    const names = deliveriesPolicies.map((m) => m[1]);
    expect(names).toContain("wd_select_member");
    expect(names).toContain("wd_service_role_all");
    expect(names.filter((n) => n !== "wd_select_member")).toEqual(["wd_service_role_all"]);
    for (const m of deliveriesPolicies) {
      if (m[1] === "wd_select_member") continue;
      expect(m[0].toLowerCase()).not.toContain("to authenticated");
    }
    expect(flat).not.toMatch(/create policy \w+ on public\.webhook_deliveries for insert to authenticated/);
    expect(flat).not.toMatch(/create policy \w+ on public\.webhook_deliveries for update to authenticated/);
    expect(flat).not.toMatch(/create policy \w+ on public\.webhook_deliveries for delete to authenticated/);
  });

  it("secret column revoke/grant lines are present, in order (revoke-all-then-narrow)", () => {
    const revokeAll = raw.indexOf(
      "revoke all on table public.webhook_endpoints, public.webhook_deliveries from public, anon, authenticated",
    );
    const revokeSelect = raw.indexOf("revoke select on table public.webhook_endpoints from authenticated");
    const grantNarrow = raw.indexOf(
      "grant select (id, team_id, url, enabled, event_filter, created_by, created_at)",
    );
    expect(revokeAll).toBeGreaterThan(-1);
    expect(revokeSelect).toBeGreaterThan(revokeAll);
    expect(grantNarrow).toBeGreaterThan(revokeSelect);
    expect(raw).toContain("on table public.webhook_endpoints to authenticated");
    expect(raw).not.toMatch(/grant select \(.*secret.*\) on table public\.webhook_endpoints to authenticated/);
  });

  it("enqueue_test_webhook_delivery is security definer, checks team_role, and inserts event_type 'webhook.test'", () => {
    expect(flat).toContain("security definer");
    expect(flat).toMatch(/enqueue_test_webhook_delivery\s*\(\s*p_endpoint_id uuid\s*\)/);
    expect(flat).not.toMatch(/enqueue_test_webhook_delivery\s*\(\s*p_endpoint_id uuid\s*,/);
    expect(flat).toContain("public.team_role(v_ep.team_id)");
    const insertStmt = (flat.match(/insert into public\.webhook_deliveries[^;]*;/) || [""])[0];
    expect(insertStmt).toMatch(/,\s*'webhook.test'\s*,/);
    expect(insertStmt).not.toMatch(/\bp_event_type\b/);
    expect(insertStmt).not.toContain("p_endpoint_id");
  });

  it("carries both required header lines for 0018", () => {
    const head = raw.split("\n").slice(0, 5).join("\n");
    expect(head).toMatch(/^-- Ledger row: 0018_webhook_delivery /m);
    expect(head).toMatch(/^-- Rollback: drop function if exists public\.enqueue_test_webhook_delivery\(uuid\);/m);
  });
});
