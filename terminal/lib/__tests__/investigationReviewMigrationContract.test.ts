/**
 * 0040 investigation review — REVIEW PREDICATE contract.
 *
 * The Terminal validator (lib/investigationContracts.ts) and the installed SQL validator
 * (public.valid_investigation_manifest_v2, replaced by supabase/migrations/0040_investigation_
 * review.sql) must accept exactly the same optional review block, or a review the Terminal
 * saves is refused by the database as invalid_payload. This test proves 0040 is the 0039 body
 * plus the review predicate ONLY, and that its down block restores the 0039 body verbatim.
 */
import { describe, expect, it } from "vitest";
import { ledgerRowHeaderLine, readMigration } from "./helpers/reservations";

const FILE = "0040_investigation_review.sql";
const PREVIOUS = "0039_investigation_options_evidence.sql";
const sql = readMigration(FILE);

function liveBody(text: string): string {
  return text.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
}
function downBody(text: string): string {
  const at = text.indexOf("-- down:");
  const end = text.indexOf("-- readback:");
  return text.slice(at, end === -1 ? undefined : end).split("\n").map(l => l.replace(/^--\s?/, "")).join("\n");
}
const collapse = (s: string) => s.replace(/\s+/g, "").toLowerCase();

describe("0040 investigation review migration contract", () => {
  it("carries the ledger row and rollback header lines", () => {
    const head = sql.split("\n").slice(0, 40).join("\n");
    expect(head).toMatch(/^-- Ledger row:/m);
    expect(head).toMatch(/^-- Rollback:/m);
    expect(ledgerRowHeaderLine(sql)).toContain("OPTIONS-R1-W3C");
    expect(head).toContain("restore only valid_investigation_manifest_v2(jsonb) to the 0039 body");
  });

  it("differs from the 0039 live body in the review predicate only", () => {
    const live39 = liveBody(readMigration(PREVIOUS));
    const live40 = liveBody(sql);
    // Removing the inserted block and the one widened key list restores the 0039 body byte for byte.
    const reviewBlock = /\n if m \? 'review' then\n[\s\S]*?\n end if;\n/;
    expect(live40).toMatch(reviewBlock);
    const predicate = live40.match(reviewBlock)![0];
    expect(predicate).toContain("investigation_keys_v2(m->'review',array['assessment'],array['fire_event_id','note'])");
    expect(predicate).toContain("not in ('confirmed','contradicted','inconclusive')");
    expect(predicate).toContain("(m#>>'{review,fire_event_id}') !~ '^[0-9a-f]{64}$'");
    expect(predicate).toContain("investigation_text_v2(m#>'{review,note}',2000)");
    const withoutReview = live40.replace(reviewBlock, "").replace("array['review_baseline_ref','review']", "array['review_baseline_ref']");
    expect(collapse(withoutReview)).toEqual(collapse(live39));
  });

  it("restores the 0039 body in the down block and keeps a readback block", () => {
    const down = downBody(sql);
    const bodyLine = down.split("\n").find(l => /^CREATE OR REPLACE FUNCTION/i.test(l));
    expect(bodyLine).toBeTruthy();
    const live39 = liveBody(readMigration(PREVIOUS));
    expect(collapse(bodyLine!)).toEqual(collapse(live39));
    const readback = sql.slice(sql.indexOf("-- readback:"));
    expect(readback).toContain("admits_valid_review");
    expect(readback).toContain("rejects_invalid_assessment");
    expect(readback).toContain("valid_investigation_manifest_v2(m)");
  });
});
