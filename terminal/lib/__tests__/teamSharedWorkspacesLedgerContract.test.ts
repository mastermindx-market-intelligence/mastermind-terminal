/**
 * 0022 team-shared saved workspaces — LEDGER contract.
 *
 * `teamSharedWorkflowMigration.test.ts` pins what the SQL does and the shape of its header lines;
 * it never opens the ledger. This file pins the ledger, in the shape
 * `resourceGrantsMigrationContract.test.ts` uses for 0021: the row in
 * supabase/migrations/RESERVATIONS.json, the presence of the `.sql` the row names, and the
 * agreement between that file's `-- Ledger row:` header line and the row.
 *
 * 0022 is on master and NOT applied. The row is asserted exactly as the ledger records it today —
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

const PREFIX = "0022";
const FILE = "0022_chart_layouts_team_sharing.sql";

const row = reservationRow(PREFIX);
const sql = readMigration(FILE);

describe("0022 team-shared saved workspaces ledger contract", () => {
  it("claims prefix 0022 in RESERVATIONS.json as merged and not yet applied", () => {
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("B-F12-B5-2");
    expect(row.pr).toBe(555);
    expect(row.pr_state).toBe("merged");
    expect(row.merged_sha).toBe("6cdbaa0a8");
    // Not applied, and the date is null because there is no application yet — never because a real
    // date was lost. The seat applies in ledger order and 0022 waits its turn behind 0017-0021.
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

  it("the -- Ledger row: header agrees with the row on file, packet, pull request and not-applied", () => {
    const line = ledgerRowHeaderLine(sql);
    expect(line, "0022 carries no -- Ledger row: header line").toBeTruthy();
    expect(line!).toContain("0022_chart_layouts_team_sharing");
    expect(line!).toContain(`packet ${row.packet}`);
    expect(headerPrNumber(line!)).toBe(row.pr);
    expect(line!).toContain("not applied");
    expect(row.applied_in_production).toBe(false);
  });

  it("records where the header and the row still disagree (reported, not edited here)", () => {
    // ANOMALY, carried deliberately: the header was written while #555 was open and says
    // "(open, packet B-F12-B5-2)", while the row records pr_state "merged" (6cdbaa0a8) since
    // 2026-09-09. The not-applied half of the header is still true. This lane ships tests and docs
    // only and edits no .sql file, so the disagreement is pinned rather than papered over: when the
    // seat corrects the header, this assertion fails and the pin is updated in the same change.
    const line = ledgerRowHeaderLine(sql)!;
    expect(line).toContain("(open, packet B-F12-B5-2)");
    expect(row.pr_state).toBe("merged");
    expect(row.merged_sha).toBe("6cdbaa0a8");
  });

  it("README carries 0022 as merged but not applied, and gives it no application-table row", () => {
    const readme = readFileSync(readmePath, "utf8");
    // The application-status table lists applied files; 0022 is not applied, so it has no row there
    // and no README line names its .sql at all.
    expect(readme.split("\n").filter((line) => line.includes(FILE))).toEqual([]);
    const resRow = readme.split("\n").find((line) => line.startsWith("| `0022` |"));
    expect(resRow, "reservations table is missing the 0022 row").toBeTruthy();
    expect(resRow!).toContain("PR #555");
    expect(resRow!).toContain("6cdbaa0a8");
    expect(resRow!).toContain("merged — not applied");
  });
});
