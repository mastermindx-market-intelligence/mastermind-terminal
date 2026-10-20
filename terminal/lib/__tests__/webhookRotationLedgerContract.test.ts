/**
 * 0026 webhook rotation + alert-fire — LEDGER contract.
 *
 * `webhookRotationMigrationContract.test.ts` pins what the SQL does. This file pins what the
 * ledger says about it, in the same shape as webhookDeliveryLedgerContract.test.ts (0018):
 * the row in supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names,
 * and the agreement between that file's `-- Ledger row:` header line and the row.
 *
 * PR #582 merged and its exact 0026 bytes were applied once on 2026-10-19.
 * This follow-up reconciles the reservation, application tables and header to the native receipt.
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
  it("records the protected merge and actual application for prefix 0026", () => {
    const row = reservationRow(PREFIX);
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F12-11");
    expect(typeof row.pr).toBe("number");
    expect(row.pr).toBeGreaterThan(0);
    expect(row.pr).toBe(582);
    expect(row.pr_state).toBe("merged");
    expect(row.merged_sha).toBe("d20dc37e287d03cf4eaa394e0c38ee4a861c6346");
    expect(row.applied_in_production).toBe(true);
    expect(row.applied_date).toBe("2026-10-19");
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

  it("the -- Ledger row: header agrees with the row on pull request, packet, and application date", () => {
    const row = reservationRow(PREFIX);
    const sql = readMigration(FILE);
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0026 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("0026_webhook_rotation_alert_fires");
    expect(headerPrNumber(line!)).toBe(row.pr);
    expect(line!).toContain(`packet ${row.packet}`);
    expect(line!).toContain(`applied ${row.applied_date}`);
  });

  it("the header line is exactly the line the row derives, so no stale claim can survive in it", () => {
    const row = reservationRow(PREFIX);
    const sql = readMigration(FILE);
    expect(ledgerRowHeaderLine(sql)).toBe(ledgerHeaderLineFromRow(row));
  });

  it("keeps both README application and reservation rows consistent", () => {
    const row = reservationRow(PREFIX);
    const readme = readFileSync(readmePath, "utf8");
    const rows = readme.split("\n").filter((line) => line.startsWith("|") && line.includes(PREFIX) && line.includes("webhook_rotation_alert_fires"));
    expect(rows, "application and reservation tables must both carry 0026").toHaveLength(2);
    for (const line of rows) {
      expect(line.toLowerCase()).toContain("merged");
      expect(line.toLowerCase()).toContain("applied once");
      expect(line).toContain(row.applied_date!);
      expect(line).toContain(row.merged_sha!);
      expect(line).toContain(String(row.pr));
      expect(line).toContain(row.packet ?? "");
      expect(line.toLowerCase()).not.toMatch(/not applied|reserved —/);
    }
  });
});
