import type { CompanySourceSpan } from "./companySourceSearch";

export const COMPANY_SOURCE_CONTEXT_SCHEMA = "mastermind.research-context-ref/v1" as const;

const SAFE_TICKER = /^[A-Z0-9](?:[A-Z0-9.-]{0,14}[A-Z0-9])?$/;
const SAFE_EVENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_TRANSCRIPT = /^\d{4}Q[1-4]$/;
const SAFE_SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,159}$/;
const SAFE_SPAN_ID = /^txs1_[a-f0-9]{64}$/;
const MAX_SOURCE_COORDINATE_BYTES = 12 * 1024 * 1024;

export interface CompanySourceContextRef {
  schema: typeof COMPANY_SOURCE_CONTEXT_SCHEMA;
  kind: "company_source_span";
  authority: "context_only";
  ticker: string;
  event_id: string;
  transcript_id: string;
  revision_id: string;
  document_sha256: string;
  segment_index: number;
  start_byte: number;
  end_byte: number;
  segment_text_sha256: string;
  span_id: string;
}

/** Project a verified producer span to the closed, one-turn Macro resolver envelope. */
export function toCompanySourceContextRef(span: CompanySourceSpan): CompanySourceContextRef | null {
  if (span.receipt.verification !== "verified" || span.end_byte <= span.start_byte
    || !Number.isInteger(span.segment_index) || span.segment_index < 0
    || !Number.isInteger(span.start_byte) || span.start_byte < 0 || span.start_byte > MAX_SOURCE_COORDINATE_BYTES
    || !Number.isInteger(span.end_byte) || span.end_byte > MAX_SOURCE_COORDINATE_BYTES) return null;
  const ticker = span.ticker.trim().toUpperCase();
  if (!SAFE_TICKER.test(ticker) || !SAFE_EVENT.test(span.event_id) || !SAFE_TRANSCRIPT.test(span.transcript_id)
    || !SAFE_REVISION.test(span.receipt.revision_id) || !SAFE_SHA256.test(span.document_sha256)
    || !SAFE_SHA256.test(span.segment_text_sha256) || !SAFE_SPAN_ID.test(span.span_id)
    || span.receipt.document_sha256 !== span.document_sha256) return null;
  return {
    schema: COMPANY_SOURCE_CONTEXT_SCHEMA,
    kind: "company_source_span",
    authority: "context_only",
    ticker,
    event_id: span.event_id,
    transcript_id: span.transcript_id,
    revision_id: span.receipt.revision_id,
    document_sha256: span.document_sha256,
    segment_index: span.segment_index,
    start_byte: span.start_byte,
    end_byte: span.end_byte,
    segment_text_sha256: span.segment_text_sha256,
    span_id: span.span_id,
  };
}
