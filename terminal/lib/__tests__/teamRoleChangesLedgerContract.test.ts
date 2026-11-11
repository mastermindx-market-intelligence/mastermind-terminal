/**
 * 0019 team role changes — LEDGER contract.
 *
 * `teamRoleChangesMigration.test.ts` pins what the SQL does and that the header lines exist; it
 * never opens the ledger. This file pins the ledger, in the shape
 * `resourceGrantsMigrationContract.test.ts` uses for 0021: the row in
 * supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names, and the
 * agreement between that file's `-- Ledger row:` header line and the row.
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

const PREFIX = "0019";
const FILE = "0019_team_role_changes.sql";

const row = reservationRow(PREFIX);
const sql = readMigration(FILE);

describe("0019 team role changes ledger contract", () => {
  it("claims prefix 0019 in RESERVATIONS.json as merged and applied", () => {
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F12-8");
    expect(row.pr).toBe(550);
    expect(row.pr_state).toBe("merged");
    // 0019 and 0020 rode PR #550 to master in one squash, so both rows carry the same sha.
    expect(row.merged_sha).toBe("3cdcd746");
    expect(row.applied_in_production).toBe(true);
    expect(row.applied_date).toBe("2026-09-11");
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

  it("the -- Ledger row: header agrees with the row on pull request, merge sha and apply date", () => {
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0019 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("0019_team_role_changes");
    expect(headerPrNumber(line!)).toBe(row.pr);
    expect(line!).toContain(`${row.pr_state} ${row.merged_sha}`);
    expect(line!).toContain(`packet ${row.packet}`);
    expect(line!).toContain(`applied ${row.applied_date}`);
    expect(line!).not.toMatch(/not applied/);
    expect(line!).not.toMatch(/\(open[,)]/);
  });

  it("records 0019 as merged and applied in the README application table", () => {
    const readme = readFileSync(readmePath, "utf8");
    const appRow = readme.split("\n").find((line) => line.includes(FILE));
    expect(appRow, "application-status table is missing the 0019 row").toBeTruthy();
    expect(appRow!).toContain("3cdcd746");
    expect(appRow!.toLowerCase()).not.toMatch(/not applied/);
    expect(appRow!.toLowerCase()).toMatch(/yes — applied 2026-09-11/);
    expect(appRow!).toContain("5630176327");
    expect(readme).toMatch(/\|\s*`0019`\s*\|/);
  });
});
