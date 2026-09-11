/**
 * 0018 webhook delivery — LEDGER contract.
 *
 * `webhookMigrationContract.test.ts` pins what the SQL does. This file pins what the ledger says
 * about it, in the shape `resourceGrantsMigrationContract.test.ts` uses for 0021: the row in
 * supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names, and the
 * agreement between that file's `-- Ledger row:` header line and the row. Before this file, 0018
 * was pinned on the vitest side by nothing at all — only by the pytest snapshot in
 * tests/test_supabase_migration_namespace.py.
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

const PREFIX = "0018";
const FILE = "0018_webhook_delivery.sql";

const row = reservationRow(PREFIX);
const sql = readMigration(FILE);

describe("0018 webhook delivery ledger contract", () => {
  it("claims prefix 0018 in RESERVATIONS.json as merged and applied", () => {
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F12-7");
    expect(row.pr).toBe(549);
    expect(row.pr_state).toBe("merged");
    expect(row.merged_sha).toBe("cd1269fe");
    // Merged to master 2026-09-10T19:13Z via merge-on-green (#549) and applied the same day, after
    // 0017 in ledger order, with the readback receipt on the owning pull request.
    expect(row.applied_in_production).toBe(true);
    expect(row.applied_date).toBe("2026-09-10");
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

  it("the -- Ledger row: header names the same file, packet and pull request as the row", () => {
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0018 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("0018_webhook_delivery");
    expect(line!).toContain(`packet ${row.packet}`);
    expect(headerPrNumber(line!)).toBe(row.pr);
  });

  it("records where the header and the row still disagree (reported, not edited here)", () => {
    // ANOMALY, carried deliberately: the header was written while #549 was open and unapplied and
    // has never been rewritten, so it still reads "(open, packet B-F12-7); not applied" while the
    // row records pr_state "merged" (cd1269fe) and applied_in_production true on 2026-09-10. This
    // lane ships tests and docs only and edits no .sql file, so the disagreement is pinned rather
    // than papered over: when the seat corrects the header, this assertion fails and the pin is
    // updated in the same change.
    const line = ledgerRowHeaderLine(sql)!;
    expect(line).toContain("(open, packet B-F12-7)");
    expect(line).toContain("not applied");
    expect(row.pr_state).toBe("merged");
    expect(row.applied_in_production).toBe(true);
  });

  it("records 0018 as merged and applied in the README application table", () => {
    const readme = readFileSync(readmePath, "utf8");
    const appRow = readme.split("\n").find((line) => line.includes(FILE));
    expect(appRow, "application-status table is missing the 0018 row").toBeTruthy();
    expect(appRow!.toLowerCase()).not.toMatch(/not applied/);
    expect(appRow!.toLowerCase()).toMatch(/yes — applied 2026-09-10/);
    expect(appRow!).toContain("5625353856");
    expect(readme).toMatch(/\|\s*`0018`\s*\|/);
  });
});
