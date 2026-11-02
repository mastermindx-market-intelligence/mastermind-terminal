/**
 * 0047 investigation options selection evidence — SAVE ADMISSION contract (packet
 * OPT006-V3-SAVE-ADMISSION, seat ruling D111, Lane 1a).
 *
 * The migration ships two function definitions behind one guard, then one revoke and one grant (plus the guarded service_role revoke), in one transaction: the 0042 valid_investigation_manifest_v2
 * body widened by the single object_type options_matrix_selection — proven by a whitespace-
 * collapsed identity against the 0042 file, so any other drift fails — behind a leading do-block
 * guard on the 0042-only marker token, plus one boolean admission probe
 * investigation_evidence_admitted_v2(owner, object_type) that is stable security definer over an
 * empty search_path, reads no table, and is granted to authenticated only. The SQL allow-list and
 * INVESTIGATION_ADMISSION.evidence must stay exactly equal, because a save the Terminal admits
 * and the database refuses settles as a definitive invalid_payload; that registry-equality pin
 * moved here from the 0039 contract test, which now pins only 0039's own list as a subset.
 * No table, policy or row DDL, no retention, no entitlement, no source read, no result
 * computation, and no second save path may ride in this file.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { INVESTIGATION_ADMISSION } from "../investigations";
import { ledgerRowHeaderLine, migrationExists, readMigration, reservationRow } from "./helpers/reservations";

const FILE = "0047_investigation_options_selection_evidence.sql";
const FILE42 = "0042_investigation_scenario_reference.sql";
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
/** The one validator definition, from its `create or replace` line through its `end $function$;`. */
function validatorBody(text: string): string {
  const at = text.indexOf("create or replace function public.valid_investigation_manifest_v2");
  const end = text.indexOf("end $function$;", at);
  if (at === -1 || end === -1) throw new Error("valid_investigation_manifest_v2 definition not found");
  return text.slice(at, end + "end $function$;".length);
}
/** The probe body, between its `$$` delimiters. */
function probeBody(text: string): string {
  const at = text.indexOf("create or replace function public.investigation_evidence_admitted_v2");
  const open = text.indexOf("$$", at);
  const close = text.indexOf("$$", open + 2);
  if (at === -1 || open === -1 || close === -1) throw new Error("investigation_evidence_admitted_v2 definition not found");
  return text.slice(open + 2, close);
}
/** The raw validator source as PostgreSQL stores it in prosrc: the bytes between its two $function$ tags. */
function prosrc(text: string): string {
  const at = text.indexOf("create or replace function public.valid_investigation_manifest_v2(m jsonb)");
  const open = text.indexOf("$function$", at);
  const close = text.indexOf("$function$", open + "$function$".length);
  if (at === -1 || open === -1 || close === -1) throw new Error("valid_investigation_manifest_v2 source not found");
  return text.slice(open + "$function$".length, close);
}
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const QA = "begin; set local role authenticated; select public.investigation_evidence_admitted_v2('terminal.options_exposure','options_matrix_selection'); select public.investigation_evidence_admitted_v2('terminal.options_exposure','dealer_inventory'); rollback;";
const QN = "begin; set local role anon; select public.investigation_evidence_admitted_v2('terminal.options_exposure','options_matrix_selection'); select public.investigation_evidence_admitted_v2('terminal.options_exposure','dealer_inventory'); rollback;";
const QM = "select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure;";
const QL = "select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, pg_catalog.array_to_string(p.proconfig, ';'), pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_catalog.pg_proc p where p.oid = 'public.investigation_evidence_admitted_v2(text,text)'::pg_catalog.regprocedure;";

describe("0047 investigation options selection evidence admission contract", () => {
  it("ships the migration with the ledger-row and rollback header lines", () => {
    expect(migrationExists(FILE)).toBe(true);
    const head = sql.split("\n").slice(0, 40).join("\n");
    expect(head).toMatch(/^-- Ledger row:/m);
    expect(head).toMatch(/^-- Rollback:/m);
    expect(ledgerRowHeaderLine(sql)).toContain("OPT006-V3-SAVE-ADMISSION");
    expect(ledgerRowHeaderLine(sql)).toContain("PR #1222 (packet OPT006-V3-SAVE-ADMISSION)");
  });

  it("replaces exactly two functions: the widened validator and the admission probe", () => {
    const body = liveBody(sql);
    expect(body.match(/create or replace function/gi)?.length).toBe(2);
    expect(body.match(/create or replace function public\.valid_investigation_manifest_v2\(m jsonb\)/g)?.length).toBe(1);
    expect(body).toMatch(/\n\s*immutable\n/);
    expect(body).toMatch(/set search_path to 'pg_catalog', 'public'/);
    expect(body).toMatch(/create or replace function public\.investigation_evidence_admitted_v2\(owner text, object_type text\)/);
  });

  it("probes admission as a stable security definer over an empty search_path, granted to authenticated only", () => {
    const body = liveBody(sql);
    const probe = probeBody(sql);
    expect(body).toMatch(/\n\s*stable\n/);
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = ''/);
    const grants = body.match(/grant execute on function [^;]+;/gi) ?? [];
    expect(grants.length).toBe(1);
    const grant = (grants[0] ?? "").toLowerCase();
    expect(grant.replace(/;\s*$/, "").endsWith("to authenticated")).toBe(true);
    expect(grant).not.toMatch(/,\s*(public|anon|service_role)/);
    expect(body).toContain("revoke all on function public.investigation_evidence_admitted_v2(text,text) from public, anon");
    expect(body.match(/^\s*grant\b/gim) ?? []).toHaveLength(1);
    expect(body).toContain("do $$ begin\n  revoke all on function public.investigation_evidence_admitted_v2(text,text)\n    from service_role;\nexception when undefined_object then null; end $$;");
    // The probe reads no table: its whole body is one schema-qualified validator call over a
    // jsonb_build_object manifest — no `from`, and every called function is public. or pg_catalog.
    expect(probe).toMatch(/^\s*select public\.valid_investigation_manifest_v2\(/);
    expect(probe).not.toMatch(/\bfrom\b/i);
    const calls = [...probe.matchAll(/([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)].map(m => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const name of calls) {
      expect(["valid_investigation_manifest_v2", "jsonb_build_object", "jsonb_build_array"]).toContain(name);
    }
    expect(probe).not.toMatch(/[^.]\b(?:valid_investigation_manifest_v2|jsonb_build_object|jsonb_build_array)\(/);
    expect(probe).toMatch(/public\.valid_investigation_manifest_v2\(/);
  });

  it("ships no table, policy or row DDL; the only drop is the commented rollback of the probe", () => {
    const body = liveBody(sql);
    expect(body).not.toMatch(/\b(create table|create policy|alter table|alter function|insert|update|delete|drop table|drop policy)\b/i);
    expect(body.toLowerCase()).not.toContain("drop function");
    expect(downBody(sql).toLowerCase()).toContain("drop function if exists public.investigation_evidence_admitted_v2(text,text);");
  });

  it("keeps the SQL allow-list and the Terminal registry exactly equal", () => {
    const fromSql = allowList(liveBody(sql));
    const fromRegistry = registry();
    expect(Object.keys(fromSql).sort()).toEqual(Object.keys(fromRegistry).sort());
    expect(fromSql).toEqual(fromRegistry);
    expect(fromSql["terminal.options_exposure"]).toEqual(["exposure_chart_request", "options_matrix_selection", "rotation_measurement", "sector_origin"]);
    expect(fromSql["earnings.workspace_generation"]).toEqual(["event_workspace"]);
  });

  it("differs from the 0042 validator by the one allow-list widening only", () => {
    // Whitespace-collapsed comparison: same discipline as the 0039 contract, but against the
    // 0042 FILE (merged, not the installed 0040 body), because 0047 composes over 0042.
    const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
    const oldToken = "'rotation_measurement')))";
    const newToken = "'rotation_measurement','options_matrix_selection')))";
    const v42 = validatorBody(readMigration(FILE42));
    const v47 = validatorBody(sql);
    const c42 = collapse(v42);
    expect(c42.split(oldToken).length - 1).toBe(1);
    const widened = c42.replace(oldToken, newToken);
    expect(widened).not.toEqual(c42);
    expect(widened).toEqual(collapse(v47));
    expect(collapse(validatorBody(downBody(sql)))).toEqual(c42);
  });

  it("guards on the 0042-only marker before touching anything, with the marker as the substring", () => {
    const body = liveBody(sql);
    expect(body).toMatch(/do \$\$[\s\S]*raise exception[\s\S]*valid_investigation_scenario_reference_v1[\s\S]*end \$\$/);
    // position(<substring> in <string>): the marker is the substring, the installed body is the string.
    expect(body).toMatch(/position\('valid_investigation_scenario_reference_v1' in pg_catalog\.pg_get_functiondef\('public\.valid_investigation_manifest_v2\(jsonb\)'::pg_catalog\.regprocedure\)\) = 0/);
    // The two-argument call form is string-first: marker-first returns 0 on every database (seat falsifier, PostgreSQL 17.11).
    expect(body).not.toMatch(/pg_catalog\.position\(\s*'valid_investigation_scenario_reference_v1'\s*,/);
  });

  it("reserves the prefix in the ledger as taken, source only, unapplied", () => {
    const row = reservationRow("0047");
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("OPT006-V3-SAVE-ADMISSION");
    expect(row.applied_in_production).toBe(false);
    expect(row.pr).toBe(1222);
    expect(row.pr_state).toBe("open");
  });
  it("refuse-closes in one transaction behind the exact-body md5 guard", () => {
    const live = liveBody(sql).trim();
    expect(live.startsWith("begin;")).toBe(true);
    expect(live.endsWith("commit;")).toBe(true);
    expect(sql).toContain("-- split-on-semicolon Management API endpoint.");
    expect(sql.split("\n")[2]).toBe("-- Requires 0042 applied and 0043 (#804) NOT applied; if 0043 is installed, recompose this widening over it in a new prefix. Until this file is applied, every save carrying object_type options_matrix_selection answers invalid_payload (0039 pattern).");
    const m42 = md5(prosrc(readMigration(FILE42)));
    const m47 = md5(prosrc(sql));
    expect(m42).toMatch(/^[0-9a-f]{32}$/);
    expect(m47).toMatch(/^[0-9a-f]{32}$/);
    expect(m47).not.toBe(m42);
    expect(live).toContain("select pg_catalog.md5(p.prosrc) into observed from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure;");
    expect(live).toContain(`or observed is null or observed not in ('${m42}', '${m47}') then`);
    expect(live).toContain("observed md5 %', observed;");
  });
  it("ships executable role-scoped probe readbacks, the md5 readback and the ACL readback", () => {
    const readback = sql.slice(sql.indexOf("-- readback:"));
    for (const query of [QA, QN, QM, QL]) expect(readback).toContain(`-- ${query}`);
    expect(readback).toContain("permission denied for function investigation_evidence_admitted_v2");
    expect(readback).not.toContain("run as authenticated");
  });
});
