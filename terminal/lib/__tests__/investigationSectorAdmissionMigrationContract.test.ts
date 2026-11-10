/**
 * 0049 sector intelligence investigation admission — SAVE ADMISSION contract
 * (packet SI-P16-LANE6-INVESTIGATION-ADMISSION, Lane 6).
 *
 * The migration composes over the exact 0047 body (never the installed 0040 body or the
 * 0042 body — the leading do-block guard pins the 0047 md5 and this test recomputes it)
 * and widens exactly three things: the valid_investigation_manifest_v2 subject allow-list
 * by the four packet-3.2 owner/kind pairs on their owner-resolved id grammars, the
 * evidence allow-list by macro.sector sector_observation/basket_observation and
 * theme_graph.curation_assertion curation_assertion, and the per-type pinned-only rules.
 * Both allow-lists must stay exactly equal to INVESTIGATION_ADMISSION, and the SQL cohort
 * exactly equal to SECTOR_INVESTIGATION_COHORT, because a save the Terminal admits and the
 * database refuses settles as a definitive invalid_payload. The evidence probe gains a
 * valid minimal example per NEW type (a generic Options-shaped placeholder returning false
 * is not proof of service absence) and a narrow subject probe rides the same owner shape,
 * both granted to authenticated only. No table, policy or row DDL, no retention, no
 * entitlement, no source read, no result computation, no second save path, and no
 * cross-owner id reinterpretation (native xlf and sector:financials stay distinct owners).
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { INVESTIGATION_ADMISSION } from "../investigations";
import { SECTOR_INVESTIGATION_COHORT, validateInvestigationManifest } from "../investigationContracts";
import { ledgerHeaderLineFromRow, ledgerRowHeaderLine, migrationExists, readMigration, reservationRow } from "./helpers/reservations";

const FILE = "0049_sector_intelligence_investigation_admission.sql";
const FILE47 = "0047_investigation_options_selection_evidence.sql";
const FILE42 = "0042_investigation_scenario_reference.sql";
const FILE40 = "0040_investigation_review.sql";
const sql = readMigration(FILE);
const sql47 = readMigration(FILE47);

function liveBody(text: string): string {
  return text.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
}
function downBody(text: string): string {
  const at = text.indexOf("-- down:");
  const end = text.indexOf("-- readback:");
  return text.slice(at, end === -1 ? undefined : end).split("\n").map(l => l.replace(/^--\s?/, "")).join("\n");
}
/** The raw down block: every line after its `-- down:` line, up to `-- readback:`, nothing stripped. */
function downRaw(text: string): string {
  const at = text.indexOf("-- down:");
  const end = text.indexOf("-- readback:");
  const from = at === -1 ? -1 : text.indexOf("\n", at);
  if (at === -1 || end === -1 || from === -1 || from > end) throw new Error("0049 down block not found");
  return text.slice(from + 1, end);
}
/** What the operator applies: exactly one leading "-- " off each line; a bare "--" line becomes empty. */
function uncomment(text: string): string {
  return text.split("\n").map(l => (l.startsWith("-- ") ? l.slice(3) : l === "--" ? "" : l)).join("\n");
}
/** Decodes one PostgreSQL E'' literal body exactly: '' to ', \\ to \, \n to LF; any other quote, escape or raw line break throws. */
function decodeE(body: string): string {
  const pairs: Record<string, string | undefined> = { "''": "'", "\\\\": "\\", "\\n": "\n" };
  let out = "";
  for (let i = 0; i < body.length; ) {
    const ch = body.charAt(i);
    if (ch !== "'" && ch !== "\\" && ch !== "\n" && ch !== "\r") {
      out += ch;
      i += 1;
      continue;
    }
    const decoded = pairs[body.slice(i, i + 2)];
    if (decoded === undefined) throw new Error(`E'' literal: unsupported quote, escape or line break at offset ${i}`);
    out += decoded;
    i += 2;
  }
  return out;
}
/** Every restore line of the uncommented down, decoded to the statement it executes (without its final ';'). */
function restoreStatements(text: string): string[] {
  const lines = uncomment(downRaw(text)).split("\n").filter(l => l.startsWith("do $down$"));
  return lines.map(line => {
    const m = /^do \$down\$ begin execute E'(.*)'; end \$down\$;$/.exec(line);
    if (!m) throw new Error("restore line is not do $down$ begin execute E'...'; end $down$;");
    return decodeE(m[1] ?? "");
  });
}
/** `(r->>'owner'='X' and r->>'object_type'='Y')` and `(... in ('a','b'))` → sorted owner → types.
 *  Scoped to the allow-list disjunction only: the per-type rule blocks repeat the same
 *  owner/type pairs and must not be counted as allow-list entries. */
function allowList(body: string): Record<string, string[]> {
  const at = body.indexOf("or not ((r->>'owner'='earnings");
  const end = body.indexOf("or not public.investigation_text_v2(r->'object_id',256,true)", at);
  if (at === -1 || end === -1) throw new Error("evidence allow-list disjunction not found");
  const out: Record<string, string[]> = {};
  const re = /r->>'owner'='([^']+)'\s+and\s+r->>'object_type'(?:='([^']+)'|\s+in\s+\(([^)]*)\))/g;
  for (const m of body.slice(at, end).matchAll(re)) {
    const types = m[2] ? [m[2]] : (m[3] ?? "").split(",").map(s => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
    out[m[1]] = [...(out[m[1]] ?? []), ...types].sort();
  }
  return out;
}
/** `(r->>'owner'='X' and r->>'kind'='Y' [and <id grammar>])` → sorted owner → kinds. */
function subjectAllowList(body: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = /r->>'owner'='([^']+)'\s+and\s+r->>'kind'(?:='([^']+)'|\s+in\s+\(([^)]*)\))/g;
  for (const m of body.matchAll(re)) {
    const kinds = m[2] ? [m[2]] : (m[3] ?? "").split(",").map(s => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
    out[m[1]] = [...(out[m[1]] ?? []), ...kinds].sort();
  }
  return out;
}
function registry(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const adapter of INVESTIGATION_ADMISSION.evidence ?? []) out[adapter.owner] = [...adapter.object_types].sort();
  return out;
}
function subjectRegistry(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const adapter of INVESTIGATION_ADMISSION.subjects ?? []) out[adapter.owner] = [...adapter.kinds].sort();
  return out;
}
/** The one validator definition, from its `create or replace` line through its `end $function$;`. */
function validatorBody(text: string): string {
  const at = text.indexOf("create or replace function public.valid_investigation_manifest_v2");
  const end = text.indexOf("end $function$;", at);
  if (at === -1 || end === -1) throw new Error("valid_investigation_manifest_v2 definition not found");
  return text.slice(at, end + "end $function$;".length);
}
/** A probe body, between its `$$` delimiters, for either probe name. */
function probeBody(text: string, name: string): string {
  const at = text.indexOf(`create or replace function public.${name}`);
  const open = text.indexOf("$$", at);
  const close = text.indexOf("$$", open + 2);
  if (at === -1 || open === -1 || close === -1) throw new Error(`${name} definition not found`);
  return text.slice(open + 2, close);
}
/** A full probe create-statement (what a restore executes), `create ... $$;`. */
function probeStatement(text: string, name: string): string {
  const at = text.indexOf(`create or replace function public.${name}`);
  const end = text.indexOf("$$;", at);
  if (at === -1 || end === -1) throw new Error(`${name} statement not found`);
  return text.slice(at, end + "$$;".length);
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
const QA = "begin; set local role authenticated; select public.investigation_evidence_admitted_v2('macro.sector','sector_observation'); select public.investigation_evidence_admitted_v2('macro.sector','basket_observation'); select public.investigation_evidence_admitted_v2('theme_graph.curation_assertion','curation_assertion'); select public.investigation_evidence_admitted_v2('terminal.options_exposure','options_matrix_selection'); select public.investigation_evidence_admitted_v2('macro.sector','dealer_inventory'); rollback;";
const QS = "begin; set local role authenticated; select public.investigation_subject_admitted_v2('macro.sector','sector'); select public.investigation_subject_admitted_v2('theme_graph.identity','theme'); select public.investigation_subject_admitted_v2('theme_graph.identity','basket'); select public.investigation_subject_admitted_v2('theme_graph.identity','company'); select public.investigation_subject_admitted_v2('data_os.security_master','issuer'); select public.investigation_subject_admitted_v2('macro.sector','industry'); rollback;";
const QN = "begin; set local role anon; select public.investigation_evidence_admitted_v2('macro.sector','sector_observation'); select public.investigation_subject_admitted_v2('macro.sector','sector'); rollback;";
const QM = "select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure;";
const QL = "select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, pg_catalog.array_to_string(p.proconfig, ';'), pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'), pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'), pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') from pg_catalog.pg_proc p where p.oid in ('public.investigation_evidence_admitted_v2(text,text)'::pg_catalog.regprocedure, 'public.investigation_subject_admitted_v2(text,text)'::pg_catalog.regprocedure);";

describe("0049 sector intelligence investigation admission contract", () => {
  it("ships the migration with the ledger-row and rollback header lines", () => {
    expect(migrationExists(FILE)).toBe(true);
    const head = sql.split("\n").slice(0, 40).join("\n");
    expect(head).toMatch(/^-- Ledger row:/m);
    expect(head).toMatch(/^-- Rollback:/m);
    expect(ledgerRowHeaderLine(sql)).toContain("SI-P16-LANE6-INVESTIGATION-ADMISSION");
    // Derived from the ledger row, so the header tracks every later flip (pr backfill,
    // merge, apply) instead of pinning one sentence; the pr integer itself is enforced
    // by the supabase migration namespace guard on the same ledger.
    expect(ledgerRowHeaderLine(sql)).toBe(ledgerHeaderLineFromRow(reservationRow("0049")));
  });

  it("replaces exactly three functions: the widened validator and both admission probes", () => {
    const body = liveBody(sql);
    expect(body.match(/create or replace function/gi)?.length).toBe(3);
    expect(body.match(/create or replace function public\.valid_investigation_manifest_v2\(m jsonb\)/g)?.length).toBe(1);
    expect(body).toMatch(/\n\s*immutable\n/);
    expect(body).toMatch(/set search_path to 'pg_catalog', 'public'/);
    expect(body).toMatch(/create or replace function public\.investigation_evidence_admitted_v2\(owner text, object_type text\)/);
    expect(body).toMatch(/create or replace function public\.investigation_subject_admitted_v2\(owner text, kind text\)/);
  });

  it("probes admission as a stable security definer over an empty search_path, granted to authenticated only", () => {
    const body = liveBody(sql);
    const evidence = probeBody(sql, "investigation_evidence_admitted_v2");
    const subject = probeBody(sql, "investigation_subject_admitted_v2");
    expect(body.match(/\n\s*stable\n/g)?.length).toBe(2);
    expect(body.match(/security definer/gi)?.length).toBe(2);
    expect(body.match(/set search_path = ''/g)?.length).toBe(2);
    const grants = body.match(/grant execute on function [^;]+;/gi) ?? [];
    expect(grants.length).toBe(2);
    for (const grant of grants) {
      const lowered = grant.toLowerCase();
      expect(lowered.replace(/;\s*$/, "").endsWith("to authenticated")).toBe(true);
      expect(lowered).not.toMatch(/,\s*(public|anon|service_role)/);
    }
    expect(body).toContain("revoke all on function public.investigation_evidence_admitted_v2(text,text) from public, anon");
    expect(body).toContain("revoke all on function public.investigation_subject_admitted_v2(text,text) from public, anon");
    expect(body.match(/(?:^|;)\s*grant\b/gim) ?? []).toHaveLength(2);
    for (const name of ["investigation_evidence_admitted_v2", "investigation_subject_admitted_v2"]) {
      expect(body).toContain(`do $$ begin\n  revoke all on function public.${name}(text,text)\n    from service_role;\nexception when undefined_object then null; end $$;`);
    }
    // Each probe reads no table: one schema-qualified validator call over a jsonb_build_object
    // manifest — no `from`, and every called name is public. or pg_catalog. (or the case-when
    // `in` list that switches the placeholder onto each new type's minimal example).
    for (const probe of [evidence, subject]) {
      expect(probe).toMatch(/^\s*select public\.valid_investigation_manifest_v2\(/);
      expect(probe).not.toMatch(/\bfrom\b/i);
      const calls = [...probe.matchAll(/([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)].map(m => m[1]);
      expect(calls.length).toBeGreaterThan(0);
      for (const name of calls) expect(["valid_investigation_manifest_v2", "jsonb_build_object", "jsonb_build_array", "in"]).toContain(name);
      expect(probe).not.toMatch(/[^.]\b(?:valid_investigation_manifest_v2|jsonb_build_object|jsonb_build_array)\(/);
      expect(probe).toMatch(/public\.valid_investigation_manifest_v2\(/);
    }
  });

  it("ships no table, policy or row DDL; the only drop is the commented rollback of the subject probe", () => {
    const body = liveBody(sql);
    expect(body).not.toMatch(/\b(create table|create policy|alter table|alter function|insert|update|delete|drop table|drop policy)\b/i);
    expect(body.toLowerCase()).not.toContain("drop function");
    expect(downBody(sql).toLowerCase()).toContain("drop function if exists public.investigation_subject_admitted_v2(text,text);");
  });

  it("keeps the SQL evidence allow-list and the Terminal registry exactly equal", () => {
    const fromSql = allowList(liveBody(sql));
    const fromRegistry = registry();
    expect(Object.keys(fromSql).sort()).toEqual(Object.keys(fromRegistry).sort());
    expect(fromSql).toEqual(fromRegistry);
    expect(fromSql["terminal.options_exposure"]).toEqual(["exposure_chart_request", "options_matrix_selection", "rotation_measurement", "sector_origin"]);
    expect(fromSql["earnings.workspace_generation"]).toEqual(["event_workspace"]);
    expect(fromSql["macro.sector"]).toEqual(["basket_observation", "sector_observation"]);
    expect(fromSql["theme_graph.curation_assertion"]).toEqual(["curation_assertion"]);
  });

  it("keeps the SQL subject allow-list, its cohort and the Terminal registry exactly equal", () => {
    const fromSql = subjectAllowList(liveBody(sql));
    const fromRegistry = subjectRegistry();
    expect(Object.keys(fromSql).sort()).toEqual(Object.keys(fromRegistry).sort());
    expect(fromSql).toEqual(fromRegistry);
    expect(fromSql["theme_graph.identity"]).toEqual(["basket", "company", "theme"]);
    expect(fromSql["macro.sector"]).toEqual(["sector"]);
    expect(fromSql["data_os.security_master"]).toEqual(["issuer", "security"]);
    // The SQL cohort in-list IS the TS SECTOR_INVESTIGATION_COHORT: the exact captured
    // 11-sector native cohort, never a ticker/name guess or a broad region inference.
    const m = liveBody(sql).match(/r->>'kind'='sector' and \(r->>'object_id'\) in \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const cohort = (m?.[1] ?? "").split(",").map(s => s.trim().replace(/^'|'$/g, "")).sort();
    expect(cohort).toEqual([...SECTOR_INVESTIGATION_COHORT].sort());
    expect(cohort).toHaveLength(11);
  });

  it("differs from the 0047 validator by the three packet-3.2 widenings only", () => {
    // Whitespace-collapsed identity against the 0047 FILE (merged, not the installed 0040
    // body): everything outside the three insertions must stay byte-equal after collapse,
    // so any other drift fails. The inserted bytes are sliced from the 0049 body between
    // unique anchors — the assertions are the anchors, occurrence counts and equality.
    const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
    const c47 = collapse(validatorBody(sql47));
    const c49 = collapse(validatorBody(sql));
    const sliceBetween = (text: string, startMarker: string, endMarker: string) => {
      expect(text.split(startMarker).length - 1).toBe(1);
      const at = text.indexOf(startMarker);
      const end = text.indexOf(endMarker, at + startMarker.length);
      expect(end).toBeGreaterThan(at);
      return text.slice(at + startMarker.length, end);
    };
    // (1) subject allow-list: four owner/kind disjuncts on their owner-resolved id grammars.
    // The outer `not ((` group closes after the LAST disjunct — after `issuer` in 0047,
    // after the company grammar in 0049 — so the insert carries that closing paren and
    // the 0047 anchor spans through the old closer.
    const subjAnchor = "in ('security','issuer'))";
    const subjTail = "or (r ? 'version_ref'";
    const subjAnchor47 = "in ('security','issuer'))) or (r ? 'version_ref'";
    const subjectInsert = sliceBetween(c49, subjAnchor, subjTail);
    expect(subjectInsert).toContain("r->>'owner'='macro.sector' and r->>'kind'='sector'");
    expect(subjectInsert).toContain("r->>'kind'='theme' and (r->>'object_id') ~ '^theme:[a-z0-9][a-z0-9_]{1,62}$'");
    expect(subjectInsert).toContain("basket:(baskets|baskets_china|baskets_china_ths|baskets_hk|baskets_canada|baskets_intl):");
    expect(subjectInsert).toContain("r->>'kind'='company' and (r->>'object_id') ~ '^co:(us|cn|hk|ca|intl):[A-Za-z0-9.-]+(#[0-9]+)?$'");
    // (2) evidence allow-list: the two new owner/type pairs.
    const evAnchor = "in ('exposure_chart_request','sector_origin','rotation_measurement','options_matrix_selection')))";
    const evTail = "or not public.investigation_text_v2(r->'object_id',256,true)";
    const evidenceInsert = sliceBetween(c49, "options_matrix_selection'))", evTail);
    expect(evidenceInsert).toContain("or (r->>'owner'='macro.sector' and r->>'object_type' in ('sector_observation','basket_observation'))");
    expect(evidenceInsert).toContain("or (r->>'owner'='theme_graph.curation_assertion' and r->>'object_type'='curation_assertion')");
    // (3) per-type pinned-only rules before the evidence identity bookkeeping.
    const ruleAnchor = "^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$')) then return false; end if;";
    const ruleTail = "n:=n+1;";
    const ruleInsert = sliceBetween(c49, ruleAnchor, ruleTail);
    expect(ruleInsert).toContain("if r->>'owner'='macro.sector' and r->>'object_type' in ('sector_observation','basket_observation') then");
    expect(ruleInsert).toContain("r->>'mode'<>'pinned' or not (r ? 'fingerprint') or (r ? 'selection')");
    expect(ruleInsert).toContain("(r->>'object_id') !~ '^b-[a-zA-Z0-9_-]{1,100}$'");
    expect(ruleInsert).toContain("(r->>'version_ref') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'");
    expect(ruleInsert).toContain("if r->>'owner'='theme_graph.curation_assertion' and r->>'object_type'='curation_assertion' then");
    expect(ruleInsert).toContain("(r->>'object_id') !~ '^ev:[0-9a-f]{16}$'");
    expect(ruleInsert).toContain("(r->>'version_ref') !~ '^gmirca_[0-9a-f]{32}$'");
    // Rebuild: 0047 plus exactly the three insertions must equal 0049 after collapse.
    // Function replacements throughout: the inserted SQL is full of $ characters, and a
    // string replacement would interpret $' / $& as match references.
    const rebuilt = c47
      .replace(subjAnchor47, () => subjAnchor + subjectInsert + subjTail)
      .replace(evAnchor, () => "in ('exposure_chart_request','sector_origin','rotation_measurement','options_matrix_selection'))" + evidenceInsert.trimEnd())
      .replace(ruleAnchor, () => ruleAnchor + ruleInsert.trimEnd());
    expect(rebuilt).not.toEqual(c47);
    expect(rebuilt).toEqual(c49);
    // And the down restores the exact 0047 validator bytes (pinned again below by md5).
    expect(collapse(validatorBody(restoreStatements(sql)[0] ?? ""))).toEqual(c47);
  });

  it("guards on the exact 0047 body before touching anything, refusing the installed 0040 and the 0042 shape", () => {
    const body = liveBody(sql);
    expect(body).toMatch(/do \$\$[\s\S]*raise exception[\s\S]*valid_investigation_scenario_reference_v1[\s\S]*end \$\$/);
    // position(<substring> in <string>): the markers are the substring, the installed body is the string.
    expect(body).toMatch(/position\('valid_investigation_scenario_reference_v1' in pg_catalog\.pg_get_functiondef\('public\.valid_investigation_manifest_v2\(jsonb\)'::pg_catalog\.regprocedure\)\) = 0/);
    expect(body).toMatch(/position\('options_matrix_selection' in pg_catalog\.pg_get_functiondef\('public\.valid_investigation_manifest_v2\(jsonb\)'::pg_catalog\.regprocedure\)\) = 0/);
    expect(body).not.toMatch(/pg_catalog\.position\(\s*'valid_investigation_scenario_reference_v1'\s*,/);
    // The installed-SQL preimage refusal: the pin set is exactly {0047 body, this body},
    // so applying over the installed 0040 body (production shape per source) or the 0042
    // body raises instead of silently composing over an unknown preimage.
    const m47 = md5(prosrc(sql47));
    const m49 = md5(prosrc(sql));
    const m42 = md5(prosrc(readMigration(FILE42)));
    const m40 = md5(prosrc(readMigration(FILE40)));
    expect(m47).toBe("a554c15c1ae58dfbd34d04bcda9b5e48");
    expect(m49).toBe("75f2b7feba6b3c9f177f4cda6c3605e9");
    expect(m42).toMatch(/^[0-9a-f]{32}$/);
    expect(m40).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set([m42, m40]).size).toBe(2);
    expect(m49).not.toBe(m47);
    expect(m49).not.toBe(m42);
    expect(m49).not.toBe(m40);
    expect(body).toContain(`or observed is null or observed not in ('${m47}', '${m49}') then`);
    for (const refused of [m42, m40]) expect(body).not.toContain(refused);
  });

  it("carries a valid minimal example for each new type, cross-checked against the TS validator", () => {
    // A generic Options-shaped placeholder returning false is not proof of service absence:
    // the probe must switch its placeholder onto each new type's own admitted example, and
    // those examples must be exactly what validateInvestigationManifest admits under
    // INVESTIGATION_ADMISSION — the same corpus witness values the parity suites pin.
    const evidence = probeBody(sql, "investigation_evidence_admitted_v2");
    const escapeRegExp = (value: string): string =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const example = (probe: string, owner: string, type: string): string => {
      const m = probe.match(new RegExp(`\\$1='${escapeRegExp(owner)}' and \\$2='${escapeRegExp(type)}'\\s*then\\s+'([^']+)'`));
      expect(m).not.toBeNull();
      return m?.[1] ?? "";
    };
    const sectorId = example(evidence, "macro.sector", "sector_observation");
    const basketId = example(evidence, "macro.sector", "basket_observation");
    expect(sectorId).toBe("xlf");
    expect(basketId).toBe("b-us_defensives");
    const evId = example(evidence, "theme_graph.curation_assertion", "curation_assertion");
    expect(evId).toBe("ev:0123456789abcdef");
    expect(evidence).toContain("'version_ref',case when");
    expect(evidence).toContain("$1='theme_graph.curation_assertion' and $2='curation_assertion' then 'gmirca_0123456789abcdef0123456789abcdef'");
    expect(evidence).toContain("$1='macro.sector' and $2 in ('sector_observation','basket_observation') then 'captured-sector-1'");
    // The TS validator admits each probe example under the Terminal admission registry.
    const probeManifest = (owner: string, object_type: string, object_id: string, version_ref: string, fingerprint: string) => ({
      schema: "investigation_manifest.v2",
      intent: { title: "Probe", question: "Is the example admitted?", subjects: [] },
      layout_refs: [],
      thesis_refs: [],
      evidence_refs: [{ owner, object_type, object_id, mode: "pinned", version_ref, fingerprint }],
      continuation: {},
    });
    const SHA = "a3573d7cefe87da155ef7575feb2071b4c32c9f562f42d5724b3ec54332d9eab";
    for (const [owner, type, id, version] of [
      ["macro.sector", "sector_observation", sectorId, "captured-sector-1"],
      ["macro.sector", "basket_observation", basketId, "captured-sector-1"],
      ["theme_graph.curation_assertion", "curation_assertion", evId, "gmirca_0123456789abcdef0123456789abcdef"],
    ] as const) {
      const result = validateInvestigationManifest(probeManifest(owner, type, id, version, SHA), INVESTIGATION_ADMISSION);
      expect(result.ok).toBe(true);
      // The generic Options-shaped placeholder for the SAME pair is refused: the probe
      // example must be type-specific, or it would return false and fake absence.
      const generic = validateInvestigationManifest(probeManifest(owner, type, "XLK/2026-10-16/450/gamma/one:2026-10-17", "exposure_chart_request.v1:7c1f5b2e9a3d4c6f8e0b1a2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6", SHA), INVESTIGATION_ADMISSION);
      expect(generic.ok).toBe(false);
    }
    // The subject probe carries one admitted example per owner/kind pair.
    const subject = probeBody(sql, "investigation_subject_admitted_v2");
    for (const [owner, kind, id] of [
      ["macro.sector", "sector", "xlf"],
      ["theme_graph.identity", "theme", "theme:ai_supply_chain"],
      ["theme_graph.identity", "basket", "basket:baskets:nuclear_power"],
      ["theme_graph.identity", "company", "co:us:AAPL"],
      ["terminal.analysis_symbol", "security", "AAPL"],
      ["data_os.security_master", "issuer", "AAPL"],
    ] as const) {
      expect(subject).toContain(`$1='${owner}' and $2='${kind}' then '${id}'`);
    }
    for (const [owner, kind, id] of [
      ["macro.sector", "sector", "xlf"],
      ["theme_graph.identity", "basket", "basket:baskets:nuclear_power"],
    ] as const) {
      const result = validateInvestigationManifest({
        schema: "investigation_manifest.v2",
        intent: { title: "Probe", question: "Is the subject admitted?", subjects: [{ kind, owner, object_id: id }] },
        layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {},
      }, INVESTIGATION_ADMISSION);
      expect(result.ok).toBe(true);
      // The research-label seam stays refused under the native owner: xlf and
      // sector:financials are distinct owners joined only by an explicit versioned crosswalk.
      const seam = validateInvestigationManifest({
        schema: "investigation_manifest.v2",
        intent: { title: "Probe", question: "Is the subject admitted?", subjects: [{ kind, owner, object_id: "sector:financials" }] },
        layout_refs: [], thesis_refs: [], evidence_refs: [], continuation: {},
      }, INVESTIGATION_ADMISSION);
      expect(seam.ok).toBe(false);
    }
  });

  it("records the reservation while keeping the migration unapplied", () => {
    const row = reservationRow("0049");
    expect(row.state).toBe("taken");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("SI-P16-LANE6-INVESTIGATION-ADMISSION");
    expect(row.pr_state).toBe("open");
    expect(row.applied_in_production).toBe(false);
    expect(row.applied_date).toBeNull();
    // The owning pull-request integer is enforced on this same row by the supabase
    // migration namespace guard (tests/test_supabase_migration_namespace.py), which is
    // red until the PR number is backfilled and green from that commit on.
  });
  it("refuse-closes in one transaction behind the exact-body md5 guard", () => {
    const live = liveBody(sql).trim();
    expect(live.startsWith("begin;")).toBe(true);
    expect(live.endsWith("commit;")).toBe(true);
    expect(live.match(/^\s*begin;/gim) ?? []).toHaveLength(1);
    expect(live.match(/^\s*commit;/gim) ?? []).toHaveLength(1);
    expect(sql).toContain("-- split-on-semicolon Management API endpoint.");
    expect(sql.split("\n")[2]).toBe("-- Requires the exact 0047 body installed (md5 pin below); it refuses the installed 0040 body, the 0042 body and any 0043/unknown shape -- recompose over a different preimage only in a new prefix. On the installed production ledger (0040 applied; 0042 and 0047 merged but UNAPPLIED) the operator sequence is: apply 0042, then 0047, then this file, each explicitly.");
    expect(live).toContain("select pg_catalog.md5(p.prosrc) into observed from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure;");
    expect(live).toContain("observed md5 %', observed;");
  });
  it("ships executable role-scoped probe readbacks, the md5 readback and the ACL readback", () => {
    const readback = sql.slice(sql.indexOf("-- readback:"));
    for (const query of [QA, QS, QN, QM, QL]) expect(readback).toContain(`-- ${query}`);
    expect(readback).toContain("permission denied for function investigation_evidence_admitted_v2 / investigation_subject_admitted_v2");
    expect(readback).not.toContain("run as authenticated");
    expect(readback).toContain('(migration role; expected postgres | t | search_path="" | f | t | f on each row):');
    // The functional readback proves the seam in SQL too: the sector template manifest is
    // admitted, its research-label rewrite (sector:financials) and its selection rewrite refused.
    expect(readback).toContain("refuses_research_label");
    expect(readback).toContain("'\"sector:financials\"'");
    expect(readback).toContain("refuses_selection");
  });
  it("rolls back in one guarded transaction of single-line statements the house parser keeps", () => {
    const m49 = md5(prosrc(sql));
    const down = uncomment(downRaw(sql));
    expect((down.split("\n")[0] ?? "").startsWith("-- Emergency rollback only: ")).toBe(true);
    const steps = liveBody(down).trim().split("\n");
    expect(steps).toHaveLength(6);
    expect(steps[0]).toBe("begin;");
    expect(steps[1]).toBe(`do $$ declare observed text; begin select pg_catalog.md5(p.prosrc) into observed from pg_catalog.pg_proc p where p.oid = 'public.valid_investigation_manifest_v2(jsonb)'::pg_catalog.regprocedure; if observed is distinct from '${m49}' then raise exception '0049 down requires the 0049 body; observed md5 %', observed; end if; end $$;`);
    expect((steps[2] ?? "")).toMatch(/^do \$down\$ begin execute E'.*'; end \$down\$;$/);
    expect((steps[3] ?? "")).toMatch(/^do \$down\$ begin execute E'.*'; end \$down\$;$/);
    expect(steps[4]).toBe("drop function if exists public.investigation_subject_admitted_v2(text,text);");
    expect(steps[5]).toBe("commit;");
    expect(down.match(/^begin;$/gm) ?? []).toHaveLength(1);
    expect(down.match(/^commit;$/gm) ?? []).toHaveLength(1);
  });
  it("restores the exact 0047 validator and probe bytes from escaped E'' literals", () => {
    expect(decodeE("a''b\\\\c\\nd")).toBe("a'b\\c\nd");
    for (const bad of ["a'b", "a\\tb", "a\\'b", "a\nb", "a\\"]) expect(() => decodeE(bad)).toThrow();
    const [validator, probe] = restoreStatements(sql);
    expect(validator.startsWith("create or replace function public.valid_investigation_manifest_v2(m jsonb)\n")).toBe(true);
    expect(validator.endsWith("\nend $function$;")).toBe(true);
    expect(md5(prosrc(validator))).toBe(md5(prosrc(sql47)));
    expect(probe.startsWith("create or replace function public.investigation_evidence_admitted_v2(owner text, object_type text)\n")).toBe(true);
    // The restored probe is the 0047 probe byte-for-byte: its placeholder is the Options
    // example again, so the down never leaves a Sector-shaped example behind.
    expect(probe).toBe(probeStatement(sql47, "investigation_evidence_admitted_v2"));
    expect(probe).toContain("'object_id','XLK/2026-10-16/450/gamma/one:2026-10-17'");
    expect(probe).not.toContain("case when");
  });
});
