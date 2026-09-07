import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const raw = readFileSync(path.join(process.cwd(), "..", "supabase", "migrations", "0015_team_roles_invitations.sql"), "utf8");
const flat = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .trim();

const downMatch = raw.match(/-- down:([\s\S]*?)(?:\n-- readback:|$)/);
const readbackMatch = raw.match(/-- readback:([\s\S]*)$/);
const downBlock = downMatch ? downMatch[1] : "";
const readbackBlock = readbackMatch ? readbackMatch[1] : "";

describe("0015 migration contract", () => {
  it("creates exactly one new table: workspace_settings (never re-creates 0014's tables)", () => {
    const matches = [...flat.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(matches).toEqual(["workspace_settings"]);
  });

  it("defines accept_team_invite exactly once with the required shape", () => {
    const occurrences = flat.match(/create or replace function public\.accept_team_invite/g) || [];
    expect(occurrences.length).toBe(1);
    expect(flat).toContain("security definer");
    expect(flat).toContain("set search_path = pg_catalog, public, auth");
    expect(flat).toContain("auth.uid()");
    expect(flat).toContain("for update");
    expect(flat).toContain("encode(sha256(convert_to(p_token");
  });

  it("refuses to mint an owner via acceptance, regardless of what role the invite row carries (round-2 review MAJOR-3)", () => {
    expect(flat).toMatch(/if v_inv\.role = 'owner' then\s*return jsonb_build_object\('ok', false, 'reason', 'invalid_role'\)/);
  });

  it("never forwards a caller-supplied identity or uses dynamic SQL / service_role / a second owner path", () => {
    expect(flat).not.toContain("p_user_id");
    expect(flat).not.toContain("execute format");
    expect(flat).not.toContain("service_role");
    // The insert into team_members takes its role from v_inv.role, never a literal — no
    // path in the accept function can mint an owner (policy checks legitimately mention
    // 'owner' as an allowed team_role() value; that is not the same invariant).
    const insertStmt = (flat.match(/insert into public\.team_members[^;]*;/) || [""])[0];
    expect(insertStmt).not.toMatch(/'owner'/);
  });

  it("accept_team_invite's identity args are exactly p_token text", () => {
    expect(flat).toMatch(/accept_team_invite\s*\(\s*p_token text\s*\)/);
  });

  it("enables RLS and defines the four ws_* policies plus the grant/revoke pairs", () => {
    expect(flat).toContain("alter table public.workspace_settings enable row level security");
    for (const p of ["ws_select", "ws_insert", "ws_update", "ws_delete"]) {
      expect(flat).toContain(`create policy ${p} on public.workspace_settings`);
    }
    expect(flat).toContain("revoke all on table public.workspace_settings from public, anon, authenticated");
    expect(flat).toContain("grant select, insert, update, delete on table public.workspace_settings to authenticated");
    expect(flat).toContain("revoke all on function public.accept_team_invite");
    expect(flat).toContain("grant execute on function public.accept_team_invite(text) to authenticated");
  });

  it("down block names every object the up block creates", () => {
    for (const p of ["ws_select", "ws_insert", "ws_update", "ws_delete"]) {
      expect(downBlock).toContain(p);
    }
    expect(downBlock).toMatch(/workspace_settings_scope_owner_key/);
    expect(downBlock).toContain("drop table if exists public.workspace_settings");
    expect(downBlock).toContain("drop function if exists public.accept_team_invite(text)");
  });

  it("readback block checks pg_policy and function identity args", () => {
    expect(readbackBlock).toContain("pg_policy");
    expect(readbackBlock).toContain("pg_get_function_identity_arguments");
  });

  it("is a single begin/commit block with every create policy preceded by a drop policy if exists", () => {
    expect((raw.match(/^begin;/m) || []).length).toBe(1);
    expect((raw.match(/^commit;/m) || []).length).toBe(1);
    const createPolicyLines = [...raw.matchAll(/create policy (\w+)/g)].map((m) => m[1]);
    for (const name of createPolicyLines) {
      expect(raw).toContain(`drop policy if exists ${name}`);
    }
  });

  it("does not renumber, edit, or re-declare 0011-0014's tables/policies", () => {
    for (const forbidden of ["create table if not exists public.teams", "create table if not exists public.team_members", "create table if not exists public.team_invites"]) {
      expect(flat).not.toContain(forbidden);
    }
  });

  it("user_id is a nullable last-writer attribution column, never a cascading owner (round-2 review MAJOR-2)", () => {
    // Ownership of a workspace-scope row is owner_id/team_id, never the writer -- a workspace's
    // settings must survive the deletion of whichever account last wrote them. That requires
    // user_id to be (a) nullable and (b) ON DELETE SET NULL, never NOT NULL / ON DELETE CASCADE.
    expect(flat).toMatch(/user_id\s+uuid references auth\.users\(id\) on delete set null/);
    expect(flat).not.toMatch(/user_id\s+uuid not null/);
    expect(flat).not.toContain("references auth.users(id) on delete cascade");
  });

  it("ws_update's WITH CHECK pins user_id = auth.uid() on the workspace branch, not just the user branch (round-2 review MAJOR-2)", () => {
    // Without this pin, USING alone let any owner/admin UPDATE a workspace_settings row and
    // re-attribute it to an arbitrary user_id -- minting a false attribution for a write that
    // user never made. Pull just the ws_update policy body so a pin on ws_insert cannot satisfy
    // this test by coincidence.
    const wsUpdateMatch = flat.match(/create policy ws_update on public\.workspace_settings[\s\S]*?;/);
    expect(wsUpdateMatch).not.toBeNull();
    const wsUpdate = wsUpdateMatch ? wsUpdateMatch[0] : "";
    expect(wsUpdate).toMatch(/with check\s*\(/);
    const withCheck = wsUpdate.slice(wsUpdate.indexOf("with check"));
    expect(withCheck).toMatch(/scope = 'workspace' and user_id = auth\.uid\(\) and public\.team_role\(team_id\) in \('owner','admin'\)/);
  });
});
