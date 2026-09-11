import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repo = path.resolve(__dirname, "../../..");
const migrationPath = path.join(repo, "supabase/migrations/0021_resource_grants.sql");
const reservationsPath = path.join(repo, "supabase/migrations/RESERVATIONS.json");
const readmePath = path.join(repo, "supabase/migrations/README.md");

const sql = readFileSync(migrationPath, "utf8");
const flat = sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();
// 0021 puts the readback receipt block first and the rollback block last, and both headers carry
// text on their own line, so the split is on the marker prefix rather than a bare marker line.
const readbackBlock = (sql.split(/^-- readback:/m)[1] ?? "").split(/^-- down:/m)[0].toLowerCase();
const downBlock = (sql.split(/^-- down:/m)[1] ?? "").toLowerCase();

describe("0021 resource grants migration contract", () => {
  it("creates exactly one table, and it is public.resource_grants", () => {
    expect([...flat.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]))
      .toEqual(["resource_grants"]);
  });

  it("keeps the share record: no delete policy, no delete grant, revocation is a column", () => {
    expect(flat).toContain("revoked_at");
    expect(flat).not.toMatch(/create policy \w+ on public\.resource_grants for delete/);
    expect(flat).not.toMatch(/\bgrant\s+delete\b/);
    expect(flat).not.toMatch(/\bdelete\s+from\s+public\.resource_grants\b/);
  });

  it("enables row level security on the new table", () => {
    expect(flat).toContain("alter table public.resource_grants enable row level security");
  });

  it("creates exactly the five policies the packet documents, on the three tables it touches", () => {
    const policies = [...flat.matchAll(/create policy (\w+) on public\.(\w+)/g)].map((m) => [m[1], m[2]]);
    expect(policies).toEqual([
      ["resource_grants_select_party", "resource_grants"],
      ["resource_grants_insert_owner", "resource_grants"],
      ["resource_grants_revoke_owner", "resource_grants"],
      ["watchlists_granted_read", "watchlists"],
      ["wls_granted_read", "watchlist_symbols"],
    ]);
    // Every policy is created inside the duplicate_object wrapper, so the file re-runs clean and
    // never drops a live policy off a shared table.
    expect((sql.match(/exception when duplicate_object then null/g) || []).length).toBe(policies.length);
  });

  it("reads on watchlists and watchlist_symbols go through has_active_grant, never a raw join", () => {
    expect(flat).toContain("using (public.has_active_grant('watchlist', id))");
    expect(flat).toContain("using (public.has_active_grant('watchlist', watchlist_id))");
  });

  it("defines the three security-definer functions with a fixed search_path", () => {
    expect(flat).toMatch(/create or replace function public\.has_active_grant\(p_kind text, p_resource uuid\) returns boolean/);
    expect(flat).toMatch(/create or replace function public\.owns_watchlist\(p_watchlist uuid\) returns boolean/);
    expect(flat).toMatch(/create or replace function public\.resource_grants_guard\(\) returns trigger/);
    expect((flat.match(/security definer/g) || []).length).toBe(3);
    expect((flat.match(/set search_path = pg_catalog, public, auth/g) || []).length).toBe(3);
    // Neither helper takes a user id: both read auth.uid() internally, so neither can be used to
    // probe what some other account can see.
    expect(flat).not.toMatch(/has_active_grant\([^)]*user[^)]*\)\s*returns/);
    expect(flat).not.toMatch(/owns_watchlist\([^)]*user[^)]*\)\s*returns/);
  });

  it("guards revocation with a before-update trigger that is re-runnable", () => {
    expect(flat).toContain("drop trigger if exists resource_grants_revoke_is_terminal on public.resource_grants");
    expect(flat).toContain(
      "create trigger resource_grants_revoke_is_terminal before update on public.resource_grants",
    );
    expect(flat).toContain("execute function public.resource_grants_guard()");
    const dropAt = flat.indexOf("drop trigger if exists resource_grants_revoke_is_terminal");
    const createAt = flat.indexOf("create trigger resource_grants_revoke_is_terminal");
    expect(createAt).toBeGreaterThan(dropAt);
  });

  it("is re-runnable: one live share per grantee, and every index is if-not-exists", () => {
    expect(flat).toContain(
      "create unique index if not exists resource_grants_live on public.resource_grants (resource_kind, resource_id, grantee_user_id) where revoked_at is null",
    );
    expect(flat).toMatch(/create index if not exists resource_grants_grantee/);
    expect(flat).toMatch(/create index if not exists resource_grants_owner/);
  });

  it("narrows the table grants to select, insert and a column-level update of revoked_at", () => {
    expect(flat).toContain("revoke all on table public.resource_grants from public");
    expect(flat).toContain("revoke all on table public.resource_grants from anon, authenticated");
    expect(flat).toContain("grant select, insert on table public.resource_grants to authenticated");
    expect(flat).toContain("grant update (revoked_at) on table public.resource_grants to authenticated");
    expect(flat).not.toMatch(/\bgrant\s+all\b[^;]*to authenticated/);
    expect(flat).toContain("grant execute on function public.has_active_grant(text, uuid), public.owns_watchlist(uuid) to authenticated");
  });

  it("does the whole thing in one transaction", () => {
    const beginAt = sql.indexOf("\nbegin;");
    const commitAt = sql.indexOf("\ncommit;");
    const tableAt = sql.indexOf("create table if not exists public.resource_grants");
    const lastPolicyAt = sql.indexOf("create policy wls_granted_read");
    expect(beginAt).toBeGreaterThan(-1);
    expect(tableAt).toBeGreaterThan(beginAt);
    expect(lastPolicyAt).toBeGreaterThan(tableAt);
    expect(commitAt).toBeGreaterThan(lastPolicyAt);
  });

  it("carries the ledger-row and rollback header lines required from 0015 up", () => {
    const head = sql.split("\n").slice(0, 40).join("\n");
    expect(head).toMatch(/^-- Ledger row:/m);
    expect(head).toMatch(/^-- Rollback:/m);
  });

  it("down and readback blocks name every object the up block creates", () => {
    expect(downBlock.length).toBeGreaterThan(50);
    expect(readbackBlock.length).toBeGreaterThan(50);
    // Everything the up block leaves behind OUTSIDE the new table has to be named in both blocks:
    // dropping resource_grants does not take these with it.
    for (const name of [
      "resource_grants",
      "watchlists_granted_read",
      "wls_granted_read",
      "has_active_grant",
      "owns_watchlist",
      "resource_grants_guard",
      "resource_grants_revoke_is_terminal",
    ]) {
      expect(readbackBlock, `readback block never mentions "${name}"`).toContain(name);
      expect(downBlock, `down block never mentions "${name}"`).toContain(name);
    }
    // The table's own policies die with the table, so the rollback line does not repeat them; the
    // readback still has to prove all three came back.
    for (const name of [
      "resource_grants_select_party",
      "resource_grants_insert_owner",
      "resource_grants_revoke_owner",
    ]) {
      expect(readbackBlock, `readback block never mentions "${name}"`).toContain(name);
    }
    expect(downBlock).toContain("drop table if exists public.resource_grants");
  });

  it("claims prefix 0021 in RESERVATIONS.json as merged and unapplied", () => {
    const doc = JSON.parse(readFileSync(reservationsPath, "utf8")) as {
      prefixes: Record<
        string,
        {
          state: string;
          file: string | null;
          packet: string | null;
          pr: number | null;
          pr_state: string | null;
          merged_sha?: string;
          applied_in_production?: boolean | null;
          applied_date?: string | null;
        }
      >;
    };
    const row = doc.prefixes["0021"];
    expect(row.state).toBe("taken");
    expect(row.file).toBe("0021_resource_grants.sql");
    expect(row.packet).toBe("B-F12-B5-1");
    expect(row.pr).toBe(548);
    expect(row.pr_state).toBe("merged");
    expect(row.merged_sha).toBe("bad423f5");
    // Ledger order: 0019 and 0020 are still open in PR #550, so 0021 cannot be applied yet. The
    // date is null because there is no application, never because a real date was lost.
    expect(row.applied_in_production).toBe(false);
    expect(row.applied_date).toBeNull();
  });

  it("records 0021 as merged and not applied in the README application table", () => {
    const readme = readFileSync(readmePath, "utf8");
    const appRow = readme
      .split("\n")
      .find((line) => line.includes("0021_resource_grants.sql"));
    expect(appRow, "application-status table is missing the 0021 row").toBeTruthy();
    expect(appRow!).toContain("bad423f5");
    expect(appRow!.toLowerCase()).toContain("not applied");
    expect(appRow!.toLowerCase()).not.toMatch(/yes — applied/);
    expect(readme).toMatch(/\|\s*`0021`\s*\|/);
  });
});
