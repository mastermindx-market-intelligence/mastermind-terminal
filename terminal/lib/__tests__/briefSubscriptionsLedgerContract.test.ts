/**
 * 0024 brief subscriptions — LEDGER contract.
 *
 * Same shape as portfolioTargetsLedgerContract.test.ts for 0023: the row in
 * supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names,
 * and the agreement between that file's `-- Ledger row:` header line and the row.
 *
 * 0024 ships UNAPPLIED. The header addresses the lane by ledger-row id (MO-PAID-032)
 * rather than by pull request, so it makes no pull-request or application claim that
 * could go stale.
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

const PREFIX = "0024";
const FILE = "0024_brief_subscriptions.sql";

const row = reservationRow(PREFIX);
const sql = readMigration(FILE);

describe("0024 brief subscriptions ledger contract", () => {
  it("claims prefix 0024 in RESERVATIONS.json as taken and not yet applied", () => {
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F11-7");
    expect(row.pr).toBe(579);
    expect(row.pr_state).toBe("open");
    expect(row.applied_in_production).toBe(false);
    expect(row.applied_date).toBeNull();
  });

  it("ships the .sql file the row names", () => {
    expect(migrationExists(FILE)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it("carries the ledger-row and rollback header lines required from 0015 up", () => {
    const head = sql.split("\n").slice(0, 40).join("\n");
    expect(head).toMatch(/^-- Ledger row:/m);
    expect(head).toMatch(/^-- Rollback:/m);
  });

  it("the -- Ledger row: header names the packet and addresses the lane by ledger-row id", () => {
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0024 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("MO-PAID-032");
    expect(line!).toContain(row.packet!);
    expect(headerPrNumber(line!)).toBeNull();
    expect(line!).not.toMatch(/not applied/);
  });

  it("creates both brief tables with owner RLS and deliveries select-only", () => {
    const flat = sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();
    expect(flat).toContain("create table if not exists public.brief_subscriptions");
    expect(flat).toContain("create table if not exists public.brief_deliveries");
    expect(flat).toContain("alter table public.brief_subscriptions enable row level security");
    expect(flat).toContain("alter table public.brief_deliveries enable row level security");
    expect(flat).toContain("grant select, insert, update, delete on table public.brief_subscriptions to authenticated");
    expect(flat).toContain("grant select on table public.brief_deliveries to authenticated");
    expect(flat).not.toMatch(/grant\s+insert[^;]*brief_deliveries[^;]*authenticated/);
    expect(sql).toMatch(/create policy brief_deliveries_select_owner/);
    expect(sql).toMatch(/-- readback:/);
  });

  it("README carries 0024 as open and not applied", () => {
    const readme = readFileSync(readmePath, "utf8");
    const resRow = readme.split("\n").find((line) => line.startsWith("| `0024` |"));
    expect(resRow, "reservations table is missing the 0024 row").toBeTruthy();
    expect(resRow!).toContain("B-F11-7");
    expect(resRow!).toMatch(/open — not applied/);
  });
});
