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

  it("the three replaced 0014 team_members policies are each dropped and recreated", () => {
    for (const name of ["tm_insert_admin", "tm_update_admin", "tm_delete_admin"]) {
      expect(flat).toContain(`drop policy if exists ${name} on public.team_members`);
      expect(flat).toContain(`create policy ${name} on public.team_members`);
    }
  });

  it("tm_update_admin USING lets an administrator attempt so WITH CHECK can raise 42501", () => {
    // PostgreSQL RLS treats a USING miss as 0-row success, not 42501. The house
    // canary rls:admin_cannot_change_peer_admin expects 42501, so USING must
    // match an administrator's UPDATE of a non-owner row, and WITH CHECK must
    // still require the owner. Ruling R1: do not weaken the canary.
    expect(flat).toMatch(
      /create policy tm_update_admin on public\.team_members\s+for update to authenticated\s+using \(\s*role <> 'owner'\s+and public\.team_role\(team_id\) in \('owner','admin'\)\s*\)\s+with check \(\s*role in \('admin','member'\)\s+and public\.team_role\(team_id\) = 'owner'\s+and user_id <> auth\.uid\(\)\s*\)/,
    );
  });

  it("tm_delete_admin raises 42501 via team_members_rls_deny on a forbidden DELETE", () => {
    // DELETE has no WITH CHECK. A USING miss is 0-row success, so the canary
    // rls:member_cannot_delete_other cannot see a deny unless the policy
    // raises 42501. Ruling R1: do not weaken the canary.
    expect(flat).toMatch(
      /create or replace function public\.team_members_rls_deny\(\)\s+returns boolean\s+language plpgsql/,
    );
    expect(flat).toContain("errcode = '42501'");
    expect(flat).toContain("else public.team_members_rls_deny()");
  });

  it("a membership row can never move between teams or between people (round-4 ruling R1)", () => {
    // USING reads the OLD row and WITH CHECK the NEW one, so team_role(team_id) resolves against
    // the SOURCE team in one and the DESTINATION team in the other. No policy text can tie them
    // together; a BEFORE UPDATE trigger can. Without it an administrator of team A who owns any
    // team B moves a peer administrator's row out of A by setting team_id = B, and the audit
    // trigger (`of role`) never fires. Both columns are pinned: team_id is the cross-team move,
    // user_id would move a membership between people.
    expect(flat).toMatch(
      /create or replace function public\.deny_team_member_move\(\) returns trigger\s+language plpgsql\s+set search_path = pg_catalog, public, auth as \$\$ begin if new\.team_id is distinct from old\.team_id or new\.user_id is distinct from old\.user_id then raise exception using errcode = '42501'/,
    );
    expect(flat).toContain("drop trigger if exists team_member_move_deny on public.team_members");
    expect(flat).toMatch(
      /create trigger team_member_move_deny\s+before update on public\.team_members\s+for each row execute function public\.deny_team_member_move\(\)/,
    );
  });

  it("tm_delete_admin protects the owner row BEFORE the owner-of-team branch and never raises at a stranger", () => {
    // Round-4 ruling R4(c) and R4(d). Two orderings are load-bearing and neither was pinned:
    // (c) `role = 'owner' then false` must precede `team_role(team_id) = 'owner' then true`, or a
    //     team owner could delete their own owner row and every other test would still pass;
    // (d) the `team_role(team_id) is null then false` branch must precede the raising ELSE, or a
    //     non-member's DELETE raises 42501 when the row exists and returns 0 rows when it does
    //     not — a membership-existence oracle for any authenticated caller holding two ids.
    expect(flat).toMatch(
      /create policy tm_delete_admin on public\.team_members\s+for delete to authenticated\s+using \(\s*case\s+when role = 'owner' then false\s+when public\.team_role\(team_id\) = 'owner' then true\s+when public\.team_role\(team_id\) = 'admin' and role = 'member' then true\s+when user_id = auth\.uid\(\) then true\s+when public\.team_role\(team_id\) is null then false\s+else public\.team_members_rls_deny\(\)\s+end\s*\)/,
    );
  });

  it("the actor_id column comment does not claim the founding-owner insert logs a null actor", () => {
    // Round-4 ruling R4(g). auth.uid() reads the request JWT setting, which SECURITY DEFINER does
    // not clear, so the row written inside handle_new_team records the team creator's id.
    const comment = raw.match(/comment on column public\.team_role_changes\.actor_id is\s+'([^']*)'/);
    expect(comment, "actor_id has no column comment").toBeTruthy();
    expect(comment![1]).not.toContain("Null for the founding-owner insert");
    expect(comment![1]).toContain("records the team creator");
  });

  it("ti_insert_admin is replaced so an administrator cannot invite an administrator (T1)", () => {
    expect(flat).toContain("drop policy if exists ti_insert_admin on public.team_invites");
    expect(flat).toContain("create policy ti_insert_admin on public.team_invites");
    expect(flat).toMatch(
      /create policy ti_insert_admin on public\.team_invites\s+for insert to authenticated\s+with check \(\s*invited_by = auth\.uid\(\)\s+and \(\s*\(public\.team_role\(team_id\) = 'owner' and role in \('admin','member'\)\)\s+or \(public\.team_role\(team_id\) = 'admin' and role = 'member'\)/,
    );
  });

  it("the audit trigger skips the insert when the subject account is already gone", () => {
    expect(flat).toMatch(
      /if tg_op = 'DELETE' and not exists \(select 1 from auth\.users where id = old\.user_id\) then\s+return old;/,
    );
  });

  it("the audit trigger skips the insert when the team is already gone (round-6 ruling R2)", () => {
    expect(flat).toMatch(
      /if tg_op = 'DELETE' and not exists \(\s*select 1 from public\.teams where id = coalesce\(new\.team_id, old\.team_id\)\s*\) then\s+return old;/,
    );
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
