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
 * The header line itself was stale when this pin was first written — it still read
 * "(open, packet B-F12-7); not applied" long after #549 merged as cd1269fe and the seat applied the
 * DDL on 2026-09-10. A pin must never assert a statement known to be false, so the header was
 * corrected to the ledger's truth in the same change that added this file, exactly as PR #568 did
 * for 0019 and 0020, and the agreement is asserted below against a line DERIVED from the row rather
 * than against a literal that could go stale in its turn.
 *
 * The ledger is read through lib/__tests__/helpers/reservations.ts, which masks nothing and never
 * logs the document, so the project reference in its `project_ref` field cannot reach a test log.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  headerPrNumber,
  ledgerHeaderLineFromRow,
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

  it("the -- Ledger row: header agrees with the row on pull request, merge sha and apply date", () => {
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0018 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("0018_webhook_delivery");
    expect(headerPrNumber(line!)).toBe(row.pr);
    expect(line!).toContain(`${row.pr_state} ${row.merged_sha}`);
    expect(line!).toContain(`packet ${row.packet}`);
    expect(line!).toContain(`applied ${row.applied_date}`);
    expect(line!).not.toMatch(/not applied/);
    expect(line!).not.toMatch(/\(open[,)]/);
  });

  it("the header line is exactly the line the row derives, so no stale claim can survive in it", () => {
    // The whole line, not a handful of substrings: the header is reconstructed from the row and
    // compared byte for byte. Nothing about a pull request's state can be asserted here that the
    // ledger does not itself record, and the next flip of this row fails this test until the header
    // moves with it.
    expect(ledgerRowHeaderLine(sql)).toBe(ledgerHeaderLineFromRow(row));
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
