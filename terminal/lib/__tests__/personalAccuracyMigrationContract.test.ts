import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repo = path.resolve(__dirname, "../../..");
const migrationPath = path.join(repo, "supabase/migrations/0017_personal_accuracy_ledger.sql");
const reservationsPath = path.join(repo, "supabase/migrations/RESERVATIONS.json");
const readmePath = path.join(repo, "supabase/migrations/README.md");

const sql = readFileSync(migrationPath, "utf8");
const flat = sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();
const downBlock = (sql.split(/^-- down:$/m)[1] ?? "").split(/^-- readback:$/m)[0].toLowerCase();
const readbackBlock = (sql.split(/^-- readback:$/m)[1] ?? "").toLowerCase();

describe("0017 personal accuracy ledger migration contract", () => {
  it("creates exactly one table and gives it no team_id column", () => {
    expect([...flat.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]))
      .toEqual(["user_claims"]);
    expect(flat).not.toContain("team_id");
  });

  it("references auth.users and never public.teams or public.team_members", () => {
    expect(flat).toContain("references auth.users");
    expect(flat).not.toMatch(/public\.teams\b/);
    expect(flat).not.toMatch(/public\.team_members\b/);
  });

  it("enables row level security with owner-only select and owner-only insert", () => {
    expect(flat).toContain("alter table public.user_claims enable row level security");
    expect(flat).toContain("create policy \"user_claims_select_own\"");
    expect(flat).toContain("create policy \"user_claims_insert_own\"");
    expect(flat).toMatch(/for select to authenticated using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/);
    expect(flat).toMatch(/for insert to authenticated\s+with check\s*\(\s*auth\.uid\(\)\s*=\s*user_id/);
  });

  it("grants no update and no delete to authenticated, and nothing at all to anon", () => {
    expect(flat).toContain("revoke all on table public.user_claims from public, anon");
    expect(flat).toContain("grant select, insert on table public.user_claims to authenticated");
    expect(flat).not.toMatch(/grant\s+(update|delete|all)[^;]*to\s+authenticated/);
    expect(flat).not.toMatch(/grant\s+\w+[^;]*to\s+anon/);
  });

  it("carries the ledger-row and rollback header lines required from 0015 up", () => {
    const head = sql.split("\n").slice(0, 40).join("\n");
    expect(head).toMatch(/^-- Ledger row:/m);
    expect(head).toMatch(/^-- Rollback:/m);
  });

  it("is re-runnable: every create is if-not-exists or duplicate_object guarded", () => {
    expect(flat).toContain("create table if not exists public.user_claims");
    expect(flat).toMatch(/create index if not exists user_claims_owner_stated_idx/);
    expect(flat).toMatch(/create index if not exists user_claims_owner_episode_idx/);
    expect(flat).toMatch(/create index if not exists user_claims_maturity_idx/);
    expect(flat).toMatch(/create index if not exists user_claims_supersedes_idx/);
    expect(sql).toContain("exception when duplicate_object then null");
    expect((flat.match(/create policy/g) || []).length).toBe(2);
  });

  it("indexes the five-part episode key the scorer groups on", () => {
    expect(flat).toContain("user_claims_owner_episode_idx");
    expect(flat).toContain("(subject->>'id')");
    expect(flat).toContain("(condition->>'metric')");
    expect(flat).toContain("(condition->>'comparator')");
    expect(flat).toContain("(condition->>'threshold')");
  });

  it("down and readback blocks name every object the up block creates", () => {
    expect(downBlock.length).toBeGreaterThan(50);
    expect(readbackBlock.length).toBeGreaterThan(50);
    for (const name of [
      "user_claims",
      "user_claims_select_own",
      "user_claims_insert_own",
      "user_claims_owner_stated_idx",
      "user_claims_owner_episode_idx",
      "user_claims_maturity_idx",
      "user_claims_supersedes_idx",
    ]) {
      expect(downBlock, `down block never mentions "${name}"`).toContain(name);
      expect(readbackBlock, `readback block never mentions "${name}"`).toContain(name);
    }
    expect(downBlock).toContain("drop table if exists public.user_claims");
  });

  it("claims prefix 0017 in RESERVATIONS.json and leaves 0011 through 0016 untouched", () => {
    const doc = JSON.parse(readFileSync(reservationsPath, "utf8")) as {
      prefixes: Record<string, { state: string; file: string | null; packet: string | null; pr: number | null; pr_state: string | null; applied_in_production?: boolean | null }>;
    };
    const row = doc.prefixes["0017"];
    expect(row.state).toBe("taken");
    expect(row.file).toBe("0017_personal_accuracy_ledger.sql");
    expect(row.packet).toBe("B-F13-5");
    expect(row.pr_state).toBe("open");
    expect(row.pr).toBe(547);
    expect(row.applied_in_production).toBe(false);

    expect(doc.prefixes["0011"]).toMatchObject({ state: "historical", file: "0011_analytics_eid.sql", packet: "CA1A", pr: 507, pr_state: "merged" });
    expect(doc.prefixes["0012"]).toMatchObject({ state: "taken", file: "0012_thesis_objects.sql", packet: "F11-1", pr: 502 });
    expect(doc.prefixes["0013"]).toMatchObject({ state: "taken", file: "0013_alert_runs_outbox.sql", packet: "B-F08-2", pr: 513, pr_state: "merged" });
    expect(doc.prefixes["0014"]).toMatchObject({ state: "taken", file: "0014_tenancy_foundation.sql", packet: "B-F12-1", pr: 514, pr_state: "merged" });
    expect(doc.prefixes["0015"]).toMatchObject({ state: "taken", file: "0015_team_roles_invitations.sql", packet: "B-F12-3", pr: 514, pr_state: "merged" });
    expect(doc.prefixes["0016"]).toMatchObject({ state: "taken", file: "0016_account_lifecycle_requests.sql", packet: "B-F12-4", pr: 527, pr_state: "merged" });
  });

  it("records 0017 as not applied in the README application table", () => {
    const readme = readFileSync(readmePath, "utf8");
    expect(readme).toMatch(/0017_personal_accuracy_ledger\.sql/);
    const appRow = readme.split("\n").find((line) => line.includes("0017_personal_accuracy_ledger.sql"));
    expect(appRow, "application-status table is missing the 0017 row").toBeTruthy();
    expect(appRow!.toLowerCase()).toMatch(/no — not applied|not applied/);
    expect(readme).toMatch(/\|\s*`0017`\s*\|/);
  });
});
