import { describe, expect, it } from "vitest";
import { toCompanySourceContextRef } from "@/lib/companySourceContext";
import type { CompanySourceSpan } from "@/lib/companySourceSearch";

const span = {
  span_id: `txs1_${"a".repeat(64)}`,
  ticker: "nvda",
  event_id: "cie_event_1",
  transcript_id: "2026Q1",
  document_sha256: "b".repeat(64),
  segment_index: 2,
  start_byte: 8,
  end_byte: 16,
  segment_text_sha256: "c".repeat(64),
  receipt: { revision_id: "rev_2026_1", document_sha256: "b".repeat(64), verification: "verified" as const },
};

const asSpan = (value: object) => value as CompanySourceSpan;

describe("toCompanySourceContextRef", () => {
  it("projects only the closed verified reference, never source text or receipt display fields", () => {
    expect(toCompanySourceContextRef(asSpan(span))).toEqual({
      schema: "mastermind.research-context-ref/v1",
      kind: "company_source_span",
      authority: "context_only",
      ticker: "NVDA",
      event_id: "cie_event_1",
      transcript_id: "2026Q1",
      revision_id: "rev_2026_1",
      document_sha256: "b".repeat(64),
      segment_index: 2,
      start_byte: 8,
      end_byte: 16,
      segment_text_sha256: "c".repeat(64),
      span_id: `txs1_${"a".repeat(64)}`,
    });
  });

  it("fails closed for stale or malformed spans", () => {
    expect(toCompanySourceContextRef(asSpan({ ...span, receipt: { ...span.receipt, verification: "stale_revision" } }))).toBeNull();
    expect(toCompanySourceContextRef(asSpan({ ...span, end_byte: 8 }))).toBeNull();
    expect(toCompanySourceContextRef(asSpan({ ...span, span_id: "untrusted-client-id" }))).toBeNull();
    expect(toCompanySourceContextRef(asSpan({ ...span, document_sha256: "not-a-sha" }))).toBeNull();
    expect(toCompanySourceContextRef(asSpan({ ...span, receipt: { ...span.receipt, revision_id: "bad" } }))).toBeNull();
  });
});
