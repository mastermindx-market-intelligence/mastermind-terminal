import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const raw = readFileSync(
  path.join(process.cwd(), "..", "supabase", "migrations", "0020_team_ownership_transfer.sql"),
  "utf8",
);
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

describe("0020 team ownership transfer migration contract", () => {
  it("defines transfer_team_ownership as security definer with the required search_path and return table", () => {
    expect(flat).toMatch(
      /create or replace function public\.transfer_team_ownership\(\s*p_team uuid,\s*p_new_owner_user_id uuid\s*\)\s*returns table \(\s*success boolean,\s*message text\s*\)\s*language plpgsql\s*security definer\s*set search_path = pg_catalog, public, auth/,
    );
  });

  it("serializes concurrent calls with pg_advisory_xact_lock before the post-lock owner re-read", () => {
    expect(flat).toContain("pg_advisory_xact_lock(hashtext(p_team::text))");
    const lockAt = flat.indexOf("pg_advisory_xact_lock");
    const rereadAt = flat.indexOf("for update");
    expect(lockAt).toBeGreaterThan(0);
    expect(rereadAt).toBeGreaterThan(lockAt);
  });

  it("never writes team_role_changes itself and never inserts a membership row", () => {
    expect(flat).not.toMatch(/insert into public\.team_role_changes/);
    expect(flat).not.toMatch(/update public\.team_role_changes/);
    expect(flat).not.toMatch(/delete from public\.team_role_changes/);
    expect(flat).not.toMatch(/insert into public\.team_members/);
  });

  it("returns exactly the contracted message codes", () => {
    for (const code of [
      "not_signed_in",
      "team_not_found",
      "owner_only",
      "same_owner",
      "not_on_team",
      "transfer_requires_admin",
      "conflict",
      "transfer_success",
    ]) {
      expect(flat).toContain(`'${code}'`);
    }
  });

  it("grants execute only to authenticated", () => {
    expect(flat).toContain("revoke execute on function public.transfer_team_ownership(uuid, uuid) from public, anon");
    expect(flat).toContain("grant execute on function public.transfer_team_ownership(uuid, uuid) to authenticated");
  });

  it("carries -- Ledger row: and -- Rollback: header lines", () => {
    expect(raw).toMatch(/^-- Ledger row: /m);
    expect(raw).toMatch(/^-- Rollback: /m);
    expect(raw).toContain("0006-style warning");
  });

  it("carries -- down: and -- readback: blocks naming the function", () => {
    expect(downBlock.length).toBeGreaterThan(0);
    expect(readbackBlock.length).toBeGreaterThan(0);
    expect(downBlock).toContain("transfer_team_ownership");
    expect(readbackBlock).toContain("transfer_team_ownership");
  });

  it("does not create a team_ownership_transfers table (audit lives on 0019's team_role_changes)", () => {
    expect(flat).not.toMatch(/create table if not exists public\.team_ownership_transfers/);
  });

  it("a failed restore after a failed promote raises P0001 so the statement rolls back", () => {
    // Seat ruling M1: RED on 75916e59 because the restore UPDATE returned conflict
    // with no GET DIAGNOSTICS and no RAISE, so a 0-row restore could commit zero owners.
    expect(flat).toMatch(/get diagnostics restored = row_count/i);
    expect(flat).toMatch(/if restored <> 1 then/i);
    expect(flat).toContain("ownership transfer restore failed for team");
    expect(flat).toMatch(/errcode = 'P0001'/i);
  });
});
