import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = "0022_chart_layouts_team_sharing.sql";
const raw = readFileSync(path.join(process.cwd(), "..", "supabase", "migrations", FILE), "utf8");
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

describe("0022 chart_layouts team sharing migration contract", () => {
  it("carries both required header lines", () => {
    const first = raw.split("\n").slice(0, 2);
    expect(first[0]).toMatch(/^-- Ledger row: 0022_chart_layouts_team_sharing \/ PR #/);
    expect(first[1]).toMatch(/^-- Rollback: begin;/);
    expect(first[1]).toContain("drop policy if exists chart_layouts_team_read");
    expect(first[1]).toContain("drop column if exists visibility");
    expect(first[1]).toContain("drop column if exists team_id");
  });

  it("adds exactly two columns to chart_layouts and creates no table", () => {
    expect(flat).toMatch(/add column if not exists team_id uuid references public\.teams\(id\) on delete cascade/);
    expect(flat).toMatch(/add column if not exists visibility text not null default 'private'/);
    expect(flat).not.toMatch(/create table/i);
    const added = [...flat.matchAll(/add column if not exists ([a-z_]+)/g)].map((m) => m[1]);
    expect(added.sort()).toEqual(["team_id", "visibility"]);
  });

  it("never drops, renames or re-creates the 0001 owner policy", () => {
    expect(raw).not.toMatch(/chart_layouts_owner/);
  });

  it("contains no update or delete statement against chart_layouts", () => {
    expect(flat).not.toMatch(/\bupdate\s+public\.chart_layouts\b/i);
    expect(flat).not.toMatch(/\bdelete\s+from\s+public\.chart_layouts\b/i);
  });

  it("every index is if-not-exists and every policy is preceded by drop policy if exists", () => {
    expect(flat).toMatch(/create index if not exists chart_layouts_team/);
    expect(flat).toMatch(/create unique index if not exists chart_layouts_team_name/);
    const created = [...raw.matchAll(/create policy (\w+)/g)].map((m) => m[1]);
    expect(created.length).toBeGreaterThanOrEqual(6);
    for (const name of created) {
      expect(raw).toContain(`drop policy if exists ${name}`);
    }
  });

  it("the three restrictive guards name owner and admin and no other role", () => {
    for (const name of [
      "chart_layouts_share_insert_guard",
      "chart_layouts_share_update_guard",
      "chart_layouts_share_delete_guard",
    ]) {
      const match = flat.match(new RegExp(`create policy ${name}[\\s\\S]*?;`));
      expect(match).not.toBeNull();
      const body = match ? match[0] : "";
      expect(body).toMatch(/as restrictive/);
      expect(body).toMatch(/to authenticated/);
      expect(body).toMatch(/team_role\(team_id\) in \('owner','admin'\)/);
      expect(body).not.toMatch(/'viewer'/);
      expect(body).not.toMatch(/'member'/);
    }
    const update = (flat.match(/create policy chart_layouts_share_update_guard[\s\S]*?;/) || [""])[0];
    expect(update).toMatch(/\busing\b/);
  });

  it("the team-name unique index is partial on visibility = 'team'", () => {
    expect(flat).toMatch(
      /create unique index if not exists chart_layouts_team_name on public\.chart_layouts \(team_id, name\) where visibility = 'team'/,
    );
  });

  it("contains no grant, no revoke, no service_role, no execute format, no security definer", () => {
    expect(flat.toLowerCase()).not.toContain("grant ");
    expect(flat.toLowerCase()).not.toContain("revoke ");
    expect(flat.toLowerCase()).not.toContain("service_role");
    expect(flat.toLowerCase()).not.toContain("execute format");
    expect(flat.toLowerCase()).not.toContain("security definer");
  });

  it("carries a down block and a readback block", () => {
    expect(downBlock).toContain("chart_layouts_team_read");
    expect(downBlock).toContain("chart_layouts_share_insert_guard");
    expect(downBlock).toContain("chart_layouts_team_name");
    expect(readbackBlock).toMatch(/pg_polic/);
    expect(readbackBlock).toContain("pg_indexes");
    expect(readbackBlock).toContain("information_schema.columns");
    expect(readbackBlock).toContain("chart_layouts");
  });
});
