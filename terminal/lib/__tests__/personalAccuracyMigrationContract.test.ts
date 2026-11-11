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

  it("the -- Ledger row: header agrees with the row on pull request, merge sha and apply date", () => {
    // 0017's header keeps the lane id it was written with — MO-DELTA-007 (F13-OPS-LEARNING) — and
    // now carries the facts the ledger records beside it. It used to end "packet B-F13-5; not
    // applied", written while #547 was open: a statement that stopped being true when #547 merged
    // as b7aa0981 and the seat applied the DDL on 2026-09-10. A pin must never assert a sentence
    // known to be false, so the header was corrected to the ledger's truth and this assertion —
    // read out of the row, never spelled out as a literal — is what keeps the two together.
    const row = (JSON.parse(readFileSync(reservationsPath, "utf8")) as {
      prefixes: Record<string, { pr: number; pr_state: string; merged_sha?: string; applied_date?: string | null }>;
    }).prefixes["0017"];
    const line = sql.split("\n").slice(0, 40).find((l) => l.startsWith("-- Ledger row:"));
    expect(line, "0017 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("0017_personal_accuracy_ledger");
    expect(line!).toContain("MO-DELTA-007 (F13-OPS-LEARNING)");
    expect(line!).toContain("packet B-F13-5");
    expect(line!).toContain(`PR #${row.pr}`);
    expect(line!).toContain(`${row.pr_state} ${row.merged_sha}`);
    expect(line!).toContain(`applied ${row.applied_date}`);
    expect(line!).not.toMatch(/not applied/);
    expect(line!).not.toMatch(/\(open[,)]/);
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
    expect(row.pr_state).toBe("merged");
    expect((row as { merged_sha?: string }).merged_sha).toBe("b7aa0981");
    expect(row.pr).toBe(547);
    expect(row.applied_in_production).toBe(true);

    expect(doc.prefixes["0011"]).toMatchObject({ state: "historical", file: "0011_analytics_eid.sql", packet: "CA1A", pr: 507, pr_state: "merged" });
    expect(doc.prefixes["0012"]).toMatchObject({ state: "taken", file: "0012_thesis_objects.sql", packet: "F11-1", pr: 502 });
    expect(doc.prefixes["0013"]).toMatchObject({ state: "taken", file: "0013_alert_runs_outbox.sql", packet: "B-F08-2", pr: 513, pr_state: "merged" });
    expect(doc.prefixes["0014"]).toMatchObject({ state: "taken", file: "0014_tenancy_foundation.sql", packet: "B-F12-1", pr: 514, pr_state: "merged" });
    expect(doc.prefixes["0015"]).toMatchObject({ state: "taken", file: "0015_team_roles_invitations.sql", packet: "B-F12-3", pr: 514, pr_state: "merged" });
    expect(doc.prefixes["0016"]).toMatchObject({ state: "taken", file: "0016_account_lifecycle_requests.sql", packet: "B-F12-4", pr: 527, pr_state: "merged" });
  });

  it("records 0017 as applied in the README application table", () => {
    // The seat applied 0017 in production on 2026-09-10 at 20:57:38Z, from master's copy at
    // b7aa0981, with the readback receipt on PR #547 (comment 5625342890). RESERVATIONS.json
    // records that above; the README's application table is the human-readable half of the same
    // fact, so it moves with it.
    const readme = readFileSync(readmePath, "utf8");
    expect(readme).toMatch(/0017_personal_accuracy_ledger\.sql/);
    const appRow = readme.split("\n").find((line) => line.includes("0017_personal_accuracy_ledger.sql"));
    expect(appRow, "application-status table is missing the 0017 row").toBeTruthy();
    expect(appRow!.toLowerCase()).not.toMatch(/not applied/);
    expect(appRow!.toLowerCase()).toMatch(/yes — applied 2026-09-10/);
    expect(appRow!).toContain("5625342890");
    expect(readme).toMatch(/\|\s*`0017`\s*\|/);
  });
});
