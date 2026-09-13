/**
 * 0026 webhook rotation + alert-fire — LEDGER contract.
 *
 * `webhookRotationMigrationContract.test.ts` pins what the SQL does. This file pins what the
 * ledger says about it, in the same shape as webhookDeliveryLedgerContract.test.ts (0018):
 * the row in supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names,
 * and the agreement between that file's `-- Ledger row:` header line and the row.
 *
 * 0026 is the B-F12-11 packet (MO-PAID-056 + MO-DELTA-038, frozen 2026-09-13). The row is added
 * in the SAME PR that carries the file (rule (b)) and the seat applies the DDL after merge;
 * applied_in_production is therefore false at head time. The PR number is filled in once the
 * draft PR is opened — see `git push origin HEAD:refs/heads/claude/mo-b-f12-11-signed-webhooks`
 * and the second commit that updates the row and the migration's `-- Ledger row:` header line.
 *
 * The header line itself is asserted against a line DERIVED from the row, not against a literal
 * that could go stale in its turn — same pattern 0018/0019/0020 use.
 */
import { describe, expect, it } from "vitest";
import {
  headerPrNumber,
  ledgerHeaderLineFromRow,
  ledgerRowHeaderLine,
  migrationExists,
  readMigration,
  readmePath,
  reservationRow,
} from "./helpers/reservations";
import { readFileSync } from "node:fs";

const PREFIX = "0026";
const FILE = "0026_webhook_rotation_alert_fires.sql";

describe("0026 webhook rotation ledger contract", () => {
  it("claims prefix 0026 in RESERVATIONS.json as taken and open (DDL not applied)", () => {
    const row = reservationRow(PREFIX);
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F12-11");
    expect(typeof row.pr).toBe("number");
    expect(row.pr).toBeGreaterThan(0);
    expect(row.pr_state).toBe("open");
    expect(row.applied_in_production).toBe(false);
  });

  it("ships the .sql file the row names", () => {
    expect(migrationExists(FILE)).toBe(true);
    const sql = readMigration(FILE);
    expect(sql.length).toBeGreaterThan(0);
  });

  it("carries the ledger-row and rollback header lines required from 0015 up", () => {
    const sql = readMigration(FILE);
    const head = sql.split("\n").slice(0, 40).join("\n");
    expect(head).toMatch(/^-- Ledger row:/m);
    expect(head).toMatch(/^-- Rollback:/m);
  });

  it("the -- Ledger row: header agrees with the row on pull request, packet, and 'not applied'", () => {
    const row = reservationRow(PREFIX);
    const sql = readMigration(FILE);
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0026 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("0026_webhook_rotation_alert_fires");
    expect(headerPrNumber(line!)).toBe(row.pr);
    expect(line!).toContain(`packet ${row.packet}`);
    expect(line!).toContain("not applied");
  });

  it("the header line is exactly the line the row derives, so no stale claim can survive in it", () => {
    const row = reservationRow(PREFIX);
    const sql = readMigration(FILE);
    expect(ledgerRowHeaderLine(sql)).toBe(ledgerHeaderLineFromRow(row));
  });

  it("records 0026 as 'open PR — not applied' in the README Reservations table", () => {
    const row = reservationRow(PREFIX);
    const readme = readFileSync(readmePath, "utf8");
    const resRow = readme.split("\n").find((line) => line.includes(PREFIX) && line.includes("webhook_rotation_alert_fires"));
    expect(resRow, "Reservations table is missing the 0026 row").toBeTruthy();
    expect(resRow!.toLowerCase()).toMatch(/open pr|open\b/);
    expect(resRow!.toLowerCase()).toContain("not applied");
    expect(resRow!).toContain(String(row.pr));
    expect(resRow!).toContain(row.packet ?? "");
  });
});