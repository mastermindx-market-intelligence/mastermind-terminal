import "server-only";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { searchTickerTranscripts, type TranscriptSearchHit } from "@/lib/transcriptSearch";

export const EVIDENCE_TO_THESIS_SCHEMA = "mastermind.evidence-to-thesis/v1" as const;
export const MAX_EVIDENCE_TO_THESIS_QUESTION = 240;
const MAX_HITS = 8;
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const MAX_PREFLIGHT_BYTES = 16 * 1024 * 1024;
const ARCHIVE_ORIGIN = "https://app.mastermind-x.com";

type PublicSourceMatch = {
  term: string;
  span: {
    schema: "mastermind.tx-span/v1";
    span_id: string;
    ticker: string;
    transcript_id: string;
    document_key: string;
    body_sha256: string;
    segment_index: number;
    start_byte: number;
    end_byte: number;
    segment_text_sha256: string;
  };
};

export type EvidenceToThesisResult = {
  schema: typeof EVIDENCE_TO_THESIS_SCHEMA;
  symbol: string;
  question: string;
  state: "generation_held" | "insufficient_evidence" | "unavailable";
  reason: "invalid_request" | "archive_unavailable" | "symbol_not_covered" | "no_matches"
    | "stale_evidence" | "partial_coverage" | "temporary_generation_unavailable";
  evidence: Array<{
    ticker: string;
    transcriptId: string;
    period: string;
    date: string | null;
    title: string;
    speaker: string;
    role: string;
    section: TranscriptSearchHit["section"];
    /** Match locators only; this preflight does not redistribute source bodies. */
    matches: PublicSourceMatch[];
  }>;
  coverage: {
    searchedDocuments: number | null;
    totalDocuments: number | null;
    /** Known omissions, a lower bound if the underlying reader capped its results. */
    omittedHits: number;
    unavailableDocuments: string[];
    staleDocuments: string[];
    truncated: boolean;
  } | null;
};

export function validEvidenceQuestion(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && value.length <= MAX_EVIDENCE_TO_THESIS_QUESTION
    && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
}

// The existing reader accepts relative archive paths. Bound both its JSON root
// and compressed bodies, prohibit redirects, and never forward account headers.
function archiveFetcher(fetcher: typeof fetch, signal: AbortSignal, abort: () => void): typeof fetch {
  let aggregateBytes = 0;
  return async (input, init) => {
    signal.throwIfAborted();
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ARCHIVE_ORIGIN);
    if (url.origin !== ARCHIVE_ORIGIN || !url.pathname.startsWith("/data/tx/")
      || url.search || url.hash || url.username || url.password) throw new Error("archive origin rejected");
    const response = await fetcher(url, {
      method: "GET", cache: "no-store", redirect: "error", signal,
      headers: { accept: init?.headers ? new Headers(init.headers).get("accept") ?? "application/json" : "application/json" },
    });
    if (!response.ok || response.redirected || (response.url && response.url !== url.href)) {
      await response.body?.cancel();
      throw new Error("archive response rejected");
    }
    const stated = response.headers.get("content-length");
    if (stated !== null && (!Number.isSafeInteger(Number(stated)) || Number(stated) < 0 || Number(stated) > MAX_ARCHIVE_BYTES)) {
      await response.body?.cancel();
      throw new Error("archive response too large");
    }
    if (!response.body) throw new Error("archive body missing");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) break;
        size += next.value.byteLength;
        aggregateBytes += next.value.byteLength;
        if (size > MAX_ARCHIVE_BYTES || aggregateBytes > MAX_PREFLIGHT_BYTES) {
          abort();
          await reader.cancel();
          throw new Error("archive response too large");
        }
        chunks.push(next.value);
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" } });
  };
}

/**
 * Authenticated read-only preflight. There is deliberately no model adapter:
 * the current signed-in Brain endpoint persists turns before an explicit save.
 * Macro #7100 owns that seam. A lexical match does not establish answer support.
 */
export async function preflightEvidenceToThesis(
  symbolInput: unknown,
  questionInput: unknown,
  dependencies: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<EvidenceToThesisResult> {
  const symbol = typeof symbolInput === "string" ? normalizeAnalysisSymbol(symbolInput) : null;
  const question = validEvidenceQuestion(questionInput) ? questionInput.trim() : null;
  const base = { schema: EVIDENCE_TO_THESIS_SCHEMA, symbol: symbol ?? "", question: question ?? "", evidence: [], coverage: null };
  if (!symbol || !question) return { ...base, state: "unavailable", reason: "invalid_request" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const signal = dependencies.signal ? AbortSignal.any([dependencies.signal, controller.signal]) : controller.signal;
  try {
    const search = await searchTickerTranscripts(symbol, question, {
      fetcher: archiveFetcher(dependencies.fetcher ?? fetch, signal, () => controller.abort()), signal, maxDocuments: 12,
    });
    signal.throwIfAborted();
    if (search.status === "not_covered") return { ...base, state: "insufficient_evidence", reason: "symbol_not_covered" };
    if (search.status === "stale_revision") return {
      ...base, state: "insufficient_evidence", reason: "stale_evidence",
      coverage: {
        searchedDocuments: 0, totalDocuments: null, omittedHits: 0, unavailableDocuments: [],
        staleDocuments: search.stale_revisions.map((item) => item.id), truncated: true,
      },
    };
    if (search.status !== "ready") return { ...base, state: "unavailable", reason: "archive_unavailable" };
    const evidence = search.hits.slice(0, MAX_HITS).map((hit) => ({
      ticker: hit.ticker, transcriptId: hit.transcript_id, period: hit.period, date: hit.date,
      title: hit.title, speaker: hit.speaker, role: hit.role, section: hit.section,
      matches: hit.matches.map(({ term, span }) => ({ term, span: {
        schema: span.schema, span_id: span.span_id, ticker: span.ticker,
        transcript_id: span.transcript_id, document_key: span.document_key,
        body_sha256: span.body_sha256, segment_index: span.segment_index,
        start_byte: span.start_byte, end_byte: span.end_byte,
        segment_text_sha256: span.segment_text_sha256,
      } })),
    }));
    const coverage = {
      searchedDocuments: search.searched_documents, totalDocuments: search.total_documents,
      omittedHits: Math.max(0, search.hits.length - MAX_HITS),
      unavailableDocuments: search.unavailable_documents,
      staleDocuments: search.stale_revisions.map((item) => item.id),
      truncated: search.truncated || search.hits.length > MAX_HITS,
    };
    const result = { ...base, evidence, coverage };
    if (coverage.staleDocuments.length) return { ...result, state: "insufficient_evidence", reason: "stale_evidence" };
    if (coverage.truncated || coverage.unavailableDocuments.length) return { ...result, state: "insufficient_evidence", reason: "partial_coverage" };
    if (!evidence.length) return { ...result, state: "insufficient_evidence", reason: "no_matches" };
    return { ...result, state: "generation_held", reason: "temporary_generation_unavailable" };
  } catch {
    return { ...base, state: "unavailable", reason: "archive_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
