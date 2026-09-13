import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const raw = readFileSync(
  path.join(process.cwd(), "..", "supabase", "migrations", "0026_webhook_rotation_alert_fires.sql"),
  "utf8",
);
const flat = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .trim();

describe("0026 webhook rotation + alert-fire migration contract", () => {
  it("adds the four rotation columns to webhook_endpoints idempotently", () => {
    const matches = [
      ...flat.matchAll(/add column if not exists (\w+)/g),
    ].map((m) => m[1]);
    expect(matches).toContain("secret_previous");
    expect(matches).toContain("secret_version");
    expect(matches).toContain("secret_rotated_at");
    expect(matches).toContain("secret_previous_expires_at");
  });

  it("widens event_filter exactly to {'webhook.test','alert.fired'} on the named constraint", () => {
    expect(flat).toContain(
      "alter table public.webhook_endpoints drop constraint if exists webhook_endpoints_event_filter_check",
    );
    const add = /alter table public\.webhook_endpoints add\s+constraint webhook_endpoints_event_filter_check check \(event_filter <@ array\[([^\]]*)\]::text\[\]\)/.exec(
      flat,
    );
    expect(add, "0026 does not re-create the widened event_filter constraint by name").toBeTruthy();
    const types = [...(add?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(types).toEqual(["alert.fired", "webhook.test"]);
  });

  it("re-issues the column grant listing every safe column and never secret / secret_previous", () => {
    expect(flat).toContain("revoke select on table public.webhook_endpoints from authenticated");
    const grant = /grant select\s*\(([^)]*)\)\s*on table public\.webhook_endpoints to authenticated/.exec(
      flat,
    );
    expect(grant, "0026 does not narrow-grant the safe column set").toBeTruthy();
    const cols = (grant?.[1] ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .sort();
    expect(cols).toEqual(
      [
        "created_at",
        "created_by",
        "enabled",
        "event_filter",
        "id",
        "secret_rotated_at",
        "secret_version",
        "team_id",
        "url",
      ].sort(),
    );
    expect(cols).not.toContain("secret");
    expect(cols).not.toContain("secret_previous");
  });

  it("creates the per-team opt-in table with RLS and NO delete policy", () => {
    expect(flat).toContain("create table if not exists public.webhook_alert_optins");
    expect(flat).toContain("alter table public.webhook_alert_optins enable row level security");
    expect(flat).toMatch(/create policy wao_select_own on public\.webhook_alert_optins/);
    expect(flat).toMatch(/create policy wao_insert_own on public\.webhook_alert_optins/);
    expect(flat).toMatch(/create policy wao_update_own on public\.webhook_alert_optins/);
    expect(flat).toMatch(/create policy wao_service_role_all on public\.webhook_alert_optins/);
    // No delete policy: consent revocation is enabled=false, not row removal.
    expect(flat).not.toMatch(/create policy \w+ on public\.webhook_alert_optins for delete/);
  });

  it("rotate_webhook_secret is security definer and mints a base64url secret of the same shape as newWebhookSecret()", () => {
    expect(flat).toMatch(/create or replace function public\.rotate_webhook_secret\(p_endpoint_id uuid\) returns jsonb/);
    expect(flat).toContain("language plpgsql volatile security definer");
    // gen_random_bytes(32) -> base64 -> strip '=' -> translate +/ to -_ : the same shape as
    // newWebhookSecret() in terminal/lib/webhooks.ts (32 random bytes, base64url).
    expect(flat).toContain("encode(gen_random_bytes(32), 'base64')");
    expect(flat).toContain("translate(");
    // The exact shape: translate( rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+/', '-_' )
    // — i.e. 32 random bytes → base64 → strip '=' → swap +/ to -_ for URL-safe signing material.
    expect(flat).toContain(
      "translate( rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+/', '-_' )",
    );
    expect(flat).toContain("public.team_role(v_ep.team_id)");
    // Returns the new secret exactly once; never echoes the previous secret.
    expect(flat).toMatch(/jsonb_build_object\(\s*'ok',\s*true,\s*'secret',\s*v_new_secret/);
    expect(flat).not.toMatch(/v_ep\.secret_previous/);
    // Sets the 24-hour dual-signature window.
    expect(flat).toContain("interval '24 hours'");
  });

  it("requeue_failed_webhook_delivery is security definer, checks team_role, and resets the failed row", () => {
    expect(flat).toMatch(/create or replace function public\.requeue_failed_webhook_delivery\(p_delivery_id uuid\) returns jsonb/);
    expect(flat).toContain("language plpgsql volatile security definer");
    expect(flat).toContain("public.team_role(v_d.team_id)");
    expect(flat).toMatch(/if v_d\.status <> 'failed' then/);
    expect(flat).toContain("return jsonb_build_object('ok', false, 'reason', 'not_failed')");
    expect(flat).toContain("return jsonb_build_object('ok', false, 'reason', 'not_found')");
    // After flattening (--.*$ comments stripped, all whitespace collapsed), the
    // UPDATE statement looks like: ... set status = 'pending', attempt = 0, next_retry_at = null,
    // last_error = null, claimed_at = null where ...
    expect(flat).toContain("status = 'pending'");
    expect(flat).toContain("attempt = 0");
    expect(flat).toContain("next_retry_at = null");
    expect(flat).toContain("last_error = null");
    expect(flat).toContain("claimed_at = null");
  });

  it("alert_outbox_project_webhooks trigger fires after insert and never fails the outbox insert", () => {
    expect(flat).toMatch(/create or replace function public\.project_alert_fire_to_webhooks\(\)/);
    expect(flat).toContain("language plpgsql security definer");
    expect(flat).toMatch(/create trigger alert_outbox_project_webhooks\s+after insert on public\.alert_outbox\s+for each row execute function public\.project_alert_fire_to_webhooks\(\)/);
    // The exception wrapper guarantees the alert_outbox insert is never failed by a webhook
    // misconfiguration — that is the whole point of (R1)'s trigger design.
    expect(flat).toMatch(/exception when others then\s*raise warning/);
    expect(flat).toContain("return new");
  });

  it("the trigger body widens only on the four consent gates and inserts idempotently", () => {
    // R2's four gates: enabled, event_filter contains 'alert.fired', membership, optin enabled.
    expect(flat).toContain("e.enabled = true");
    expect(flat).toContain("'alert.fired' = any(e.event_filter)");
    expect(flat).toMatch(/from public\.team_members m\s+where m\.team_id = e\.team_id and m\.user_id = new\.user_id/);
    expect(flat).toMatch(/from public\.webhook_alert_optins o\s+where o\.team_id = e\.team_id and o\.user_id = new\.user_id and o\.enabled = true/);
    // Dedupe by the existing webhook_deliveries_dedupe_key unique index (R5).
    expect(flat).toContain("on conflict (dedupe_key) do nothing");
    // The delivery row carries event_id = new.fire_event_id so Mastermind-Webhook-Event-Id IS the fire id.
    expect(flat).toContain("'alert.fired'");
    expect(flat).toContain("new.fire_event_id");
  });

  it("carries both required header lines for 0026", () => {
    const head = raw.split("\n").slice(0, 5).join("\n");
    expect(head).toMatch(/^-- Ledger row: 0026_webhook_rotation_alert_fires /m);
    expect(head).toMatch(/^-- Rollback: drop function if exists public\.requeue_failed_webhook_delivery\(uuid\);/m);
  });
});