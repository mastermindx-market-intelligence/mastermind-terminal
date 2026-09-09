import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const raw = readFileSync(path.join(process.cwd(), "..", "supabase", "migrations", "0019_team_role_changes.sql"), "utf8");
const flat = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .trim();

const downMatch = raw.match(/-- down:([\s\S]*?)(?:\n-- readback:|$)/);
const readbackMatch = raw.match(/-- readback:([\s\S]*?)(?:\n-- down:|$)/);
const downBlock = downMatch ? downMatch[1] : "";
const readbackBlock = readbackMatch ? readbackMatch[1] : "";

describe("0019 team role changes migration contract", () => {
  it("creates exactly one new table: team_role_changes", () => {
    const matches = [...flat.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(matches).toEqual(["team_role_changes"]);
  });

  it("the trigger function is security definer with set search_path = pg_catalog, public, auth", () => {
    expect(flat).toMatch(
      /create or replace function public\.log_team_role_change\(\) returns trigger\s+language plpgsql security definer set search_path = pg_catalog, public, auth/,
    );
  });

  it("team_role_changes has a SELECT policy and no insert/update/delete policy", () => {
    expect(flat).toMatch(/create policy trc_select_admin on public\.team_role_changes\s+for select/);
    expect(flat).not.toMatch(/create policy \w+ on public\.team_role_changes\s+for insert/);
    expect(flat).not.toMatch(/create policy \w+ on public\.team_role_changes\s+for update/);
    expect(flat).not.toMatch(/create policy \w+ on public\.team_role_changes\s+for delete/);
    expect(flat).toContain("grant select on table public.team_role_changes to authenticated");
    expect(flat).not.toMatch(/grant insert[^;]*team_role_changes/);
    expect(flat).not.toMatch(/grant update[^;]*team_role_changes/);
    expect(flat).not.toMatch(/grant delete[^;]*team_role_changes/);
  });

  it("contains no update public.team_members set role, no service_role, no execute format", () => {
    expect(flat).not.toContain("update public.team_members set role");
    expect(flat).not.toContain("service_role");
    expect(flat).not.toContain("execute format");
  });

  it("team_member_names selects only id and display_name and mentions neither is_pro nor is_admin nor email", () => {
    const start = flat.indexOf("create or replace function public.team_member_names");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = flat.slice(start);
    const end = rest.indexOf("revoke all on function public.team_member_names");
    const fn = end >= 0 ? rest.slice(0, end) : rest;
    expect(fn).toContain("select p.id, p.display_name");
    expect(fn).toContain("public.is_team_member(p_team)");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = pg_catalog, public, auth");
    expect(fn).not.toContain("is_pro");
    expect(fn).not.toContain("is_admin");
    expect(fn).not.toContain("email");
    expect(flat).not.toContain("is_pro");
    expect(flat).not.toContain("is_admin");
  });

  it("the three replaced 0014 policies are each dropped and recreated", () => {
    for (const name of ["tm_insert_admin", "tm_update_admin", "tm_delete_admin"]) {
      expect(flat).toContain(`drop policy if exists ${name} on public.team_members`);
      expect(flat).toContain(`create policy ${name} on public.team_members`);
    }
  });

  it("carries -- Ledger row: and -- Rollback: header lines", () => {
    expect(raw).toMatch(/^-- Ledger row: /m);
    expect(raw).toMatch(/^-- Rollback: /m);
  });

  it("carries -- down: and -- readback: blocks", () => {
    expect(downBlock.length).toBeGreaterThan(0);
    expect(readbackBlock.length).toBeGreaterThan(0);
    expect(downBlock).toContain("team_role_changes");
    expect(readbackBlock).toContain("team_role_changes");
  });
});
