/**
 * 0025 thesis amendment proposals — migration + ledger contract (B-F11-5 / MO-PAID-054).
 *
 * Pins the next prefix after 0024, the .sql the row names, the 0015+ header lines, and the
 * agreement between that file and supabase/migrations/RESERVATIONS.json. The ledger is read
 * through helpers/reservations.ts, which never logs the document, so the project reference
 * cannot reach a test log.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  headerPrNumber,
  ledgerRowHeaderLine,
  migrationExists,
  readMigration,
  readmePath,
  reservationRow,
} from "./helpers/reservations";

const PREFIX = "0025";
const FILE = "0025_thesis_amendment_proposals.sql";

const row = reservationRow(PREFIX);
const sql = readMigration(FILE);
const flat = sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();
const readbackBlock = (sql.split(/^-- readback:/m)[1] ?? "").split(/^-- down:/m)[0].toLowerCase();
const downBlock = (sql.split(/^-- down:/m)[1] ?? "").toLowerCase();

describe("0025 thesis amendment proposals migration contract", () => {
  it("creates exactly one table, thesis_amendment_proposals, with the frozen columns", () => {
    expect([...flat.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]))
      .toEqual(["thesis_amendment_proposals"]);
    expect(flat).toContain("proposal_id uuid primary key");
    expect(flat).toContain("thesis_id uuid not null references public.theses");
    expect(flat).toContain("amended_from uuid not null references public.thesis_versions");
    expect(flat).toContain("body text not null");
    expect(flat).toContain("evidence_refs jsonb not null default '[]'");
    expect(flat).toContain("proposed_by text not null check (proposed_by = 'assistant')");
    expect(flat).toContain("state in ('proposed', 'accepted', 'rejected', 'superseded')");
    expect(flat).toContain("created_at timestamptz not null default now()");
  });

  it("guards that amended_from belongs to thesis_id, and that body/evidence_refs/amended_from/created_at are immutable", () => {
    expect(flat).toContain("tv.id = new.amended_from and tv.thesis_id = new.thesis_id");
    expect(flat).toContain("new.body is distinct from old.body");
    expect(flat).toContain("new.evidence_refs is distinct from old.evidence_refs");
    expect(flat).toContain("new.amended_from is distinct from old.amended_from");
    expect(flat).toContain("new.created_at is distinct from old.created_at");
    expect(flat).toContain("thesis amendment proposal fields are immutable");
  });

  it("reuses the 0012 thesis ownership predicate for owner-only RLS and insert", () => {
    expect(sql).toMatch(/0012_thesis_objects\.sql:59-61/);
    expect(flat).toContain("t.user_id = auth.uid()");
    expect(flat).toContain("create policy thesis_amendment_proposals_select_own");
    expect(flat).toContain("create policy thesis_amendment_proposals_insert_own");
    expect(flat).not.toMatch(/create policy \w+ on public\.thesis_amendment_proposals for delete/);
    expect(flat).not.toMatch(/create policy \w+ on public\.thesis_amendment_proposals for update/);
    expect(flat).toContain("grant select, insert on table public.thesis_amendment_proposals to authenticated");
    expect(flat).not.toMatch(/\bgrant\s+(update|delete|all)\b[^;]*thesis_amendment_proposals/);
  });

  it("moves state only through security-definer set_thesis_amendment_state", () => {
    expect(flat).toMatch(/create or replace function public\.set_thesis_amendment_state\(\s*p_proposal_id uuid,\s*p_new_state text\s*\)/);
    expect(flat).toContain("security definer");
    expect(flat).toContain("p_new_state not in ('accepted', 'rejected')");
    expect(flat).toContain("v_row.state <> 'proposed'");
    expect(flat).toContain("set state = 'superseded'");
    expect(flat).toContain("and amended_from = v_row.amended_from");
    expect(flat).toContain("grant execute on function public.set_thesis_amendment_state(uuid, text) to authenticated");
  });

  it("enables row level security and is re-runnable", () => {
    expect(flat).toContain("alter table public.thesis_amendment_proposals enable row level security");
    expect((sql.match(/exception when duplicate_object then null/g) || []).length).toBe(2);
    expect(flat).toContain("drop trigger if exists thesis_amendment_proposals_guard");
    expect(flat).toContain("create index if not exists thesis_amendment_proposals_thesis");
  });

  it("carries the ledger-row and rollback header lines required from 0015 up", () => {
    const head = sql.split("\n").slice(0, 40).join("\n");
    expect(head).toMatch(/^-- Ledger row:/m);
    expect(head).toMatch(/^-- Rollback:/m);
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0024 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("MO-PAID-054");
    expect(line!).toContain("B-F11-5");
    expect(headerPrNumber(line!)).toBeNull();
  });

  it("down and readback blocks name every object the up block creates", () => {
    expect(downBlock.length).toBeGreaterThan(50);
    expect(readbackBlock.length).toBeGreaterThan(50);
    for (const name of [
      "thesis_amendment_proposals",
      "set_thesis_amendment_state",
      "thesis_amendment_proposals_guard",
      "thesis_amendment_proposals_select_own",
      "thesis_amendment_proposals_insert_own",
    ]) {
      expect(readbackBlock, `readback block never mentions "${name}"`).toContain(name);
      expect(downBlock, `down block never mentions "${name}"`).toContain(name);
    }
  });

  it("claims prefix 0024 in RESERVATIONS.json as taken and not applied", () => {
    expect(migrationExists(FILE)).toBe(true);
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F11-5");
    expect(row.pr).toBe(577);
    expect(row.pr_state).toBe("open");
    expect(row.applied_in_production).toBe(false);
    expect(row.applied_date).toBeNull();
  });

  it("README reservations table carries 0025 as an open claim, not applied", () => {
    const readme = readFileSync(readmePath, "utf8");
    const resRow = readme.split("\n").find((line) => line.startsWith("| `0025` |"));
    expect(resRow, "README is missing the 0025 row").toBeTruthy();
    expect(resRow!).toContain("B-F11-5");
    expect(resRow!.toLowerCase()).toMatch(/not applied|open/);
  });
});
