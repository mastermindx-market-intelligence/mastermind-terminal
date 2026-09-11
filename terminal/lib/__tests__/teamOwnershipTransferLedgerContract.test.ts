/**
 * 0020 team ownership transfer — LEDGER contract.
 *
 * `teamOwnershipTransferMigration.test.ts` pins what the SQL does and that the header lines exist;
 * it never opens the ledger. This file pins the ledger, in the shape
 * `resourceGrantsMigrationContract.test.ts` uses for 0021: the row in
 * supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names, and the
 * agreement between that file's `-- Ledger row:` header line and the row.
 *
 * 0020 is also the prefix whose evidence capture writes a `# Ledger row:` line of its own
 * (e2e/tools/capture_f12_9_team_ownership_transfer.cjs); that line is now derived from this same
 * row rather than hard-coded, so the two can no longer drift apart.
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

const PREFIX = "0020";
const FILE = "0020_team_ownership_transfer.sql";

const row = reservationRow(PREFIX);
const sql = readMigration(FILE);

describe("0020 team ownership transfer ledger contract", () => {
  it("claims prefix 0020 in RESERVATIONS.json as merged and applied", () => {
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F12-9");
    // The row names PR #550, not #557: the file originated in #557, was squash-merged into #550's
    // branch at 29257a43, and rode #550 to master.
    expect(row.pr).toBe(550);
    expect(row.pr_state).toBe("merged");
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
    expect(line, "0020 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("0020_team_ownership_transfer");
    // headerPrNumber reads the owning "PR #550"; the bare "#557" later on the line is the pull
    // request the file originated in and is deliberately not matched.
    expect(headerPrNumber(line!)).toBe(row.pr);
    expect(line!).toContain(`${row.pr_state} ${row.merged_sha}`);
    expect(line!).toContain(`packet ${row.packet}`);
    expect(line!).toContain(`applied ${row.applied_date}`);
    expect(line!).not.toMatch(/not applied/);
    expect(line!).not.toMatch(/\(open[,)]/);
  });

  it("records 0020 as merged and applied in the README application table", () => {
    const readme = readFileSync(readmePath, "utf8");
    const appRow = readme.split("\n").find((line) => line.includes(FILE));
    expect(appRow, "application-status table is missing the 0020 row").toBeTruthy();
    expect(appRow!).toContain("3cdcd746");
    expect(appRow!.toLowerCase()).not.toMatch(/not applied/);
    expect(appRow!.toLowerCase()).toMatch(/yes — applied 2026-09-11/);
    expect(appRow!).toContain("5630176327");
    expect(readme).toMatch(/\|\s*`0020`\s*\|/);
  });
});
