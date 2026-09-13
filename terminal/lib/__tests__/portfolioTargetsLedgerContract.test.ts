/**
 * 0023 portfolio targets — LEDGER contract.
 *
 * 0023 had no vitest pin of any kind before this file: no migration-contract test names its `.sql`,
 * so the pytest snapshot in tests/test_supabase_migration_namespace.py was its only pin. This file
 * closes that gap in the shape `resourceGrantsMigrationContract.test.ts` uses for 0021: the row in
 * supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names, and the
 * agreement between that file's `-- Ledger row:` header line and the row.
 *
 * 0023 was on master and unapplied for days after #552 merged as 9022e0138. The seat applied it on
 * 2026-09-13 at 06:57:13Z, in ledger order after 0019/0020/0021/0022, with a readback receipt held
 * in the seat's handoff kit (ddl/receipt_0023.json); the project ref is never written. The row is
 * asserted exactly as the ledger records it now.
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
  it("claims prefix 0023 in RESERVATIONS.json as merged and applied", () => {
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F08-B5-1");
    expect(row.pr).toBe(552);
    expect(row.pr_state).toBe("merged");
    expect(row.merged_sha).toBe("9022e0138");
    // 0023 was applied on 2026-09-13 at 06:57:13Z, in ledger order after 0019/0020/0021/0022.
    // Readback receipt is held in the seat's handoff kit at ddl/receipt_0023.json; the project
    // ref is never written.
    expect(row.applied_in_production).toBe(true);
    expect(row.applied_date).toBe("2026-09-13");
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

  it("the -- Ledger row: header names the packet, addresses the lane by ledger-row id, and records the apply date", () => {
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0023 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("MO-DELTA-003");
    expect(line!).toContain(row.packet!);
    // Like 0017 and 0021, this header addresses its lane by ledger-row id rather than by pull
    // request, so it makes no pull-request or application claim that could go stale. The owning
    // pull request is recorded in the ledger row alone.
    expect(headerPrNumber(line!)).toBeNull();
    // After the seat applied 0023 on 2026-09-13, the header carries the apply date; it never
    // claims "not applied" because that phrasing is reserved for prefixes still on master.
    expect(line!).toContain(`applied ${row.applied_date}`);
    expect(line!).not.toMatch(/not applied/);
    expect(row.pr).toBe(552);
  });

  it("README carries 0023 as merged and applied in both the reservations and application tables", () => {
    const readme = readFileSync(readmePath, "utf8");
    // The application-status table lists applied files; 0023 is applied, so its .sql filename
    // appears there exactly once. The reservations table row names the same packet and merge sha.
    const fileMentions = readme.split("\n").filter((line) => line.includes(FILE));
    expect(fileMentions.length).toBeGreaterThan(0);
    const appRow = readme.split("\n").find((line) => line.includes("`0023_portfolio_targets.sql`"));
    expect(appRow, "application table is missing the 0023 row").toBeTruthy();
    expect(appRow!).toContain("yes — applied 2026-09-13");
    const resRow = readme.split("\n").find((line) => line.startsWith("| `0023` |"));
    expect(resRow, "reservations table is missing the 0023 row").toBeTruthy();
    expect(resRow!).toContain("PR #552");
    expect(resRow!).toContain("9022e0138");
    expect(resRow!).toContain("merged + applied 2026-09-13");
  });
});