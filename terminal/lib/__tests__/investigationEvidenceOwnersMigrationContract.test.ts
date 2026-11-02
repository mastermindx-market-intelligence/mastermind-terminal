/**
 * 0039 investigation options evidence — OWNER ALLOW-LIST contract.
 *
 * The Terminal registry (INVESTIGATION_ADMISSION.evidence in lib/investigations.ts) and the
 * installed SQL validator (public.valid_investigation_manifest_v2, replaced by
 * supabase/migrations/0039_investigation_options_evidence.sql) must admit exactly the same
 * evidence owners and object types, or a save the Terminal accepts is refused by the
 * database as invalid_payload. This test parses the allow-list out of the migration's live
 * body (comment lines stripped, so the commented `-- down:` block does not count) and pins
 * it to the registry in both directions. It also proves the file is a widening: the
 * commented installed body it restores admits only the earnings owner.
 */
import { describe, expect, it } from "vitest";
import { INVESTIGATION_ADMISSION } from "../investigations";
import { ledgerRowHeaderLine, migrationExists, readMigration } from "./helpers/reservations";

const FILE = "0039_investigation_options_evidence.sql";
const sql = readMigration(FILE);

function liveBody(text: string): string {
  return text.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
}
function downBody(text: string): string {
  const at = text.indexOf("-- down:");
  const end = text.indexOf("-- readback:");
  return text.slice(at, end === -1 ? undefined : end).split("\n").map(l => l.replace(/^--\s?/, "")).join("\n");
}
/** `(r->>'owner'='X' and r->>'object_type'='Y')` and `(... in ('a','b'))` → sorted owner → types. */
function allowList(body: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = /r->>'owner'='([^']+)'\s+and\s+r->>'object_type'(?:='([^']+)'|\s+in\s+\(([^)]*)\))/g;
  for (const m of body.matchAll(re)) {
    const types = m[2] ? [m[2]] : (m[3] ?? "").split(",").map(s => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
    out[m[1]] = [...(out[m[1]] ?? []), ...types].sort();
  }
  return out;
}
function registry(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const adapter of INVESTIGATION_ADMISSION.evidence ?? []) out[adapter.owner] = [...adapter.object_types].sort();
  return out;
}

describe("0039 investigation options evidence owner contract", () => {
  it("ships the migration with the ledger-row and rollback header lines", () => {
    expect(migrationExists(FILE)).toBe(true);
    const head = sql.split("\n").slice(0, 40).join("\n");
    expect(head).toMatch(/^-- Ledger row:/m);
    expect(head).toMatch(/^-- Rollback:/m);
    expect(ledgerRowHeaderLine(sql)).toContain("OPTIONS-R1-W2C");
  });

  it("replaces only valid_investigation_manifest_v2(jsonb) and keeps it immutable with a fixed search_path", () => {
    const body = liveBody(sql);
    expect(body.match(/create or replace function/gi)?.length).toBe(1);
    expect(body).toMatch(/create or replace function public\.valid_investigation_manifest_v2\(m jsonb\)/);
    expect(body).toMatch(/\n\s*immutable\n/);
    expect(body).toMatch(/set search_path to 'pg_catalog', 'public'/);
    expect(body).not.toMatch(/\b(alter|drop|grant|revoke|create table|create policy|insert|update|delete)\b/i);
  });

  it("admits exactly the evidence owners and object types the Terminal registry admits", () => {
    const fromSql = allowList(liveBody(sql));
    const fromRegistry = registry();
    expect(Object.keys(fromSql).sort()).toEqual(Object.keys(fromRegistry).sort());
    expect(fromSql).toEqual(fromRegistry);
    expect(fromSql["terminal.options_exposure"]).toEqual(["exposure_chart_request", "rotation_measurement", "sector_origin"]);
    expect(fromSql["earnings.workspace_generation"]).toEqual(["event_workspace"]);
  });

  it("is a widening: the installed body it restores refuses the options owner", () => {
    const down = downBody(sql);
    expect(down).toMatch(/create or replace function public\.valid_investigation_manifest_v2\(m jsonb\)/i);
    expect(down).toContain("r->>'owner'<>'earnings.workspace_generation'");
    expect(down).not.toContain("terminal.options_exposure");
  });

  it("differs from the installed definition in the owner predicate only", () => {
    // Whitespace-free comparison: the down block is one commented line, the live body is indented.
    const collapse = (s: string) => s.replace(/\s+/g, "");
    const OLD = collapse("or r->>'owner'<>'earnings.workspace_generation' or r->>'object_type'<>'event_workspace'");
    const NEW = collapse("or not ((r->>'owner'='earnings.workspace_generation' and r->>'object_type'='event_workspace') or (r->>'owner'='terminal.options_exposure' and r->>'object_type' in ('exposure_chart_request','sector_origin','rotation_measurement')))");
    const live = collapse(liveBody(sql).slice(liveBody(sql).search(/create or replace function/i)));
    const installed = collapse(downBody(sql).slice(downBody(sql).search(/create or replace function/i)))
      .replace(/^CREATEORREPLACEFUNCTION/, "createorreplacefunction")
      .replace("RETURNSbooleanLANGUAGEplpgsqlIMMUTABLESETsearch_pathTO'pg_catalog','public'AS$function$",
        "returnsbooleanlanguageplpgsqlimmutablesetsearch_pathto'pg_catalog','public'as$function$");
    expect(installed).toContain(OLD);
    expect(live).toContain(NEW);
    expect(live).not.toContain(OLD);
    expect(installed.replace(OLD, NEW)).toEqual(live);
  });
});
