/**
 * 0053 Prophet D05 investigation v3 admission — SOURCE-ONLY carrier contract.
 * Real-SQL behaviour is executed in tests/test_investigation_postgres.py against a disposable
 * PostgreSQL cluster; this file pins the static contract: stacking on the 0052 body, md5 pins,
 * closed vocabularies equal to the TS validator's, no table/policy/row DDL, the guarded down block
 * and the ledger row.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  INVESTIGATION_MAX_MILESTONES, INVESTIGATION_MAX_MILESTONE_EVIDENCE_INDEXES, INVESTIGATION_MAX_MEMBER_SHA256,
  INVESTIGATION_MILESTONE_STATES, INVESTIGATION_USER_DECISION_DISPOSITIONS, PROPHET_RESEARCH_EVIDENCE_TYPES,
} from "../investigationContracts";
import { ledgerHeaderLineFromRow, ledgerRowHeaderLine, readMigration, reservationRow } from "./helpers/reservations";

const FILE = "0053_investigation_v3_prophet_decision_admission.sql";
const S_BODY_MD5 = "75f2b7feba6b3c9f177f4cda6c3605e9"; // 0052 validator body
const sql = readMigration(FILE);
const live = sql.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
const md5 = (text: string) => createHash("md5").update(text).digest("hex");
function bodyOf(name: string): string {
  // The md5 pins cover the body byte-for-byte INCLUDING its comments, so the file is applied as ONE
  // request in the SQL editor (never through the comment-stripping statement splitter).
  const at = sql.indexOf(`create or replace function public.${name}(`);
  const open = sql.indexOf("$function$", at) + "$function$".length;
  return sql.slice(open, sql.indexOf("$function$", open));
}

describe("0053 investigation v3 carrier (source only)", () => {
  it("is stacked on the exact 0052 body and pins its own md5s", () => {
    const dispatcher = md5(bodyOf("valid_investigation_manifest_v2"));
    expect(live).toContain(`'${S_BODY_MD5}'`);
    expect(live).toContain(`'${dispatcher}'`);
    expect(sql).toContain(md5(bodyOf("valid_investigation_manifest_v3"))); // readback (i)
    expect(live).toMatch(/to_regprocedure\('public\.investigation_subject_admitted_v2\(text,text\)'\)/);
  });

  it("carries the ledger row and a header equal to it; applies nothing and replaces no table or apply function", () => {
    const row = reservationRow("0053");
    expect(row.file).toBe(FILE);
    expect(row.packet).toBe("SI-P16-LANE6-V3-INVESTIGATION-ADMISSION");
    expect(row.pr_state).toBe("open");
    expect(row.applied_in_production).toBe(false);
    expect(row.applied_date).toBeNull();
    expect(ledgerRowHeaderLine(sql)).toBe(ledgerHeaderLineFromRow(row));
    expect(live).not.toMatch(/create\s+(table|policy|index|trigger)|alter\s+table|insert\s+into|delete\s+from|update\s+public\./i);
    expect(live).not.toMatch(/create or replace function public\.apply_investigation_revision_v2/);
    expect(live.match(/create or replace function/gi)?.length).toBe(3); // v3, dispatcher, probe (+ core made dynamically)
  });

  it("closed vocabularies and limits equal the TypeScript validator's", () => {
    const body = bodyOf("valid_investigation_manifest_v3");
    for (const type of PROPHET_RESEARCH_EVIDENCE_TYPES) expect(body).toContain(`'${type}'`);
    expect(body).toContain(`('${PROPHET_RESEARCH_EVIDENCE_TYPES.join("','")}')`);
    expect(body).toContain(`('${INVESTIGATION_USER_DECISION_DISPOSITIONS.join("','")}')`);
    expect(body).toContain(`('${INVESTIGATION_MILESTONE_STATES.join("','")}')`);
    expect(body).toContain(`jsonb_array_length(d->'milestones')>${INVESTIGATION_MAX_MILESTONES}`);
    expect(body).toContain(`jsonb_array_length(ms->'supporting_evidence_indexes')>${INVESTIGATION_MAX_MILESTONE_EVIDENCE_INDEXES}`);
    expect(body).toContain(`(select count(*) from jsonb_each(r->'member_sha256'))>${INVESTIGATION_MAX_MEMBER_SHA256}`);
  });

  it("ACLs: only the probe is reachable by authenticated; validators are revoked from public/anon/authenticated", () => {
    expect(live).toMatch(/revoke all on function public\.valid_investigation_manifest_core_v2\(jsonb\) from public, anon, authenticated;/);
    expect(live).toMatch(/revoke all on function public\.valid_investigation_manifest_v3\(jsonb\) from public, anon, authenticated;/);
    expect(live).toMatch(/grant execute on function public\.investigation_evidence_admitted_v2\(text,text\) to authenticated;/);
  });

  it("down refuses with v3 records present, restores the exact 0052 body and has a readback", () => {
    const down = sql.slice(sql.indexOf("-- down:"), sql.indexOf("-- readback:"));
    expect(down).toContain("investigation_manifest.v3");
    expect(down).toContain("v3 records exist");
    expect(down).toContain(S_BODY_MD5);
    expect(down).toContain("drop function public.valid_investigation_manifest_v3(jsonb)");
    expect(down).toContain("drop function public.valid_investigation_manifest_core_v2(jsonb)");
    expect(sql).toContain("a14a4abf290ca9dc99f89b19617c7e9c"); // apply-body precondition readback
  });
});
