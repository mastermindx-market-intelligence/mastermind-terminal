/**
 * 0022 team-shared saved workspaces — LEDGER contract.
 *
 * `teamSharedWorkflowMigration.test.ts` pins what the SQL does and the shape of its header lines;
 * it never opens the ledger. This file pins the ledger, in the shape
 * `resourceGrantsMigrationContract.test.ts` uses for 0021: the row in
 * supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names, and the
 * agreement between that file's `-- Ledger row:` header line and the row.
 *
 * 0022 was on master and unapplied for days after #555 merged as 6cdbaa0a8. The seat applied it
 * on 2026-09-13 at 06:57:09Z, in ledger order after 0019/0020/0021, with a readback receipt held
 * in the seat's handoff kit (ddl/receipt_0022.json); the project ref is never written. The row is
 * asserted exactly as the ledger records it now.
 *
 * The header line was half stale when this pin was first written — it read "(open, packet
 * B-F12-B5-2)" long after #555 merged as 6cdbaa0a8. A pin must never assert a statement known to
 * be false, so the header was corrected to the ledger's truth in the same change that added this
 * file, exactly as PR #568 did for 0019 and 0020, and the agreement is asserted below against a
 * line DERIVED from the row rather than against a literal that could go stale in its turn.
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

const PREFIX = "0022";
const FILE = "0022_chart_layouts_team_sharing.sql";

const row = reservationRow(PREFIX);
const sql = readMigration(FILE);

describe("0022 team-shared saved workspaces ledger contract", () => {
  it("claims prefix 0022 in RESERVATIONS.json as merged and applied", () => {
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F12-B5-2");
    expect(row.pr).toBe(555);
    expect(row.pr_state).toBe("merged");
    expect(row.merged_sha).toBe("6cdbaa0a8");
    // 0022 was applied on 2026-09-13 at 06:57:09Z, in ledger order after 0019/0020/0021.
    // Readback receipt is held in the seat's handoff kit at ddl/receipt_0022.json; the project
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

  it("the -- Ledger row: header agrees with the row on file, packet, merge sha and applied date", () => {
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0022 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("0022_chart_layouts_team_sharing");
    expect(headerPrNumber(line!)).toBe(row.pr);
    expect(line!).toContain(`${row.pr_state} ${row.merged_sha}`);
    expect(line!).toContain(`packet ${row.packet}`);
    expect(line!).toContain(`applied ${row.applied_date}`);
    expect(line!).not.toMatch(/not applied/);
    expect(line!).not.toMatch(/\(open[,)]/);
  });

  it("the header line is exactly the line the row derives, so no stale claim can survive in it", () => {
    // The whole line, not a handful of substrings: the header is reconstructed from the row and
    // compared byte for byte. When the seat applies 0022 and flips applied_in_production, this test
    // fails until the header's "not applied" moves with the row.
    expect(ledgerRowHeaderLine(sql)).toBe(ledgerHeaderLineFromRow(row));
  });

  it("README carries 0022 as merged and applied in both the reservations and application tables", () => {
    const readme = readFileSync(readmePath, "utf8");
    // The application-status table lists applied files; 0022 is applied, so its .sql filename
    // appears there exactly once. The reservations table row names the same packet and merge sha.
    const fileMentions = readme.split("\n").filter((line) => line.includes(FILE));
    expect(fileMentions.length).toBeGreaterThan(0);
    const appRow = readme.split("\n").find((line) => line.includes("`0022_chart_layouts_team_sharing.sql`"));
    expect(appRow, "application table is missing the 0022 row").toBeTruthy();
    expect(appRow!).toContain("yes — applied 2026-09-13");
    const resRow = readme.split("\n").find((line) => line.startsWith("| `0022` |"));
    expect(resRow, "reservations table is missing the 0022 row").toBeTruthy();
    expect(resRow!).toContain("PR #555");
    expect(resRow!).toContain("6cdbaa0a8");
    expect(resRow!).toContain("merged + applied 2026-09-13");
  });
});