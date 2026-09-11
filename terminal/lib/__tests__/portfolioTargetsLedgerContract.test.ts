/**
 * 0023 portfolio targets — LEDGER contract.
 *
 * 0023 had no vitest pin of any kind before this file: no migration-contract test names its `.sql`,
 * so the pytest snapshot in tests/test_supabase_migration_namespace.py was its only pin. This file
 * closes that gap in the shape `resourceGrantsMigrationContract.test.ts` uses for 0021: the row in
 * supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names, and the
 * agreement between that file's `-- Ledger row:` header line and the row.
 *
 * 0023 is on master and NOT applied. The row is asserted exactly as the ledger records it today —
 * this lane pins the ledger, it does not correct it.
 *
 * The ledger is read through lib/__tests__/helpers/reservations.ts, which masks nothing and never
 * logs the document, so the project reference in its `project_ref` field cannot reach a test log.
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

const PREFIX = "0023";
const FILE = "0023_portfolio_targets.sql";

const row = reservationRow(PREFIX);
const sql = readMigration(FILE);

describe("0023 portfolio targets ledger contract", () => {
  it("claims prefix 0023 in RESERVATIONS.json as merged and not yet applied", () => {
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F08-B5-1");
    expect(row.pr).toBe(552);
    expect(row.pr_state).toBe("merged");
    expect(row.merged_sha).toBe("9022e0138");
    // Ships UNAPPLIED: the builder never runs DDL against production, so applied_in_production is
    // false and the date is null because there is no application yet.
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
    expect(line, "0023 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("MO-DELTA-003");
    expect(line!).toContain(row.packet!);
    // Like 0017 and 0021, this header addresses its lane by ledger-row id rather than by pull
    // request, so it makes no pull-request or application claim that could go stale. The owning
    // pull request is recorded in the ledger row alone.
    expect(headerPrNumber(line!)).toBeNull();
    expect(line!).not.toMatch(/not applied/);
    expect(row.pr).toBe(552);
  });

  it("README carries 0023 as merged but not applied, and gives it no application-table row", () => {
    const readme = readFileSync(readmePath, "utf8");
    expect(readme.split("\n").filter((line) => line.includes(FILE))).toEqual([]);
    const resRow = readme.split("\n").find((line) => line.startsWith("| `0023` |"));
    expect(resRow, "reservations table is missing the 0023 row").toBeTruthy();
    expect(resRow!).toContain("PR #552");
    expect(resRow!).toContain("9022e0138");
    expect(resRow!).toContain("merged — not applied");
  });
});
