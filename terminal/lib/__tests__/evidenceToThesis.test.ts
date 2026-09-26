import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalTranscriptBodySha256, TRANSCRIPT_REVISION_ROOT_URL } from "@/lib/transcriptSearch";
import * as transcriptSearch from "@/lib/transcriptSearch";
import { preflightEvidenceToThesis } from "@/lib/evidenceToThesis";

function document(text = "Services demand remains durable while enterprise adoption is broadening.", id = "2026Q2") {
  return {
    schema: "mastermind.tx/v1", ticker: "AAPL", id, period: "Q2 FY2026",
    date: "2026-07-31", title: "AAPL Earnings Call",
    segments: [{ speaker: "CEO", role: "CEO", text }],
  };
}

async function archiveFixture(options: { changedBody?: boolean; text?: string; count?: number; missingBody?: string } = {}) {
  const documents = Array.from({ length: options.count ?? 1 }, (_, i) => document(options.text, `${2026 - Math.floor(i / 4)}Q${4 - i % 4}`));
  const revisions: Record<string, string> = {};
  for (const item of documents) revisions[`AAPL/${item.id}`] = (await canonicalTranscriptBodySha256(item))!;
  const root = {
    schema: "mastermind.tx-index/v1", generated_at: "2026-08-01T00:00:00Z",
    body_count: documents.length, symbols: { AAPL: documents.map((item) => item.id) }, revisions,
    dates: Object.fromEntries(documents.map((item) => [`AAPL/${item.id}`, item.date])),
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(TRANSCRIPT_REVISION_ROOT_URL)) return new Response(JSON.stringify(root));
    const item = documents.find((d) => url.endsWith(`/data/tx/AAPL/${d.id}.json.gz`));
    if (!item || item.id === options.missingBody) return new Response("missing", { status: 503 });
    const returned = options.changedBody ? document("Corrected source text", item.id) : item;
    return new Response(gzipSync(JSON.stringify(returned)));
  });
  return { fetcher: fetcher as typeof fetch, spy: fetcher, documents, root };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("evidence-to-thesis read-only preflight", () => {
  it("holds generation even with matching evidence and makes only bounded archive reads", async () => {
    const { fetcher, spy, documents } = await archiveFixture();
    const outsideFetch = vi.fn();
    vi.stubGlobal("fetch", outsideFetch);
    const result = await preflightEvidenceToThesis("aapl", "services demand", { fetcher });
    expect(result).toMatchObject({ state: "generation_held", reason: "temporary_generation_unavailable", symbol: "AAPL" });
    expect(result).not.toHaveProperty("draft");
    expect(JSON.stringify(result)).not.toContain(documents[0].segments[0].text);
    expect(result.evidence[0]).not.toHaveProperty("excerpt");
    expect(outsideFetch).not.toHaveBeenCalled();
    for (const [url, init] of spy.mock.calls as unknown as [URL, RequestInit][]) {
      expect(url.origin).toBe("https://app.mastermind-x.com");
      expect(url.pathname).toMatch(/^\/data\/tx\//);
      expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
      expect(new Headers(init.headers).has("authorization")).toBe(false);
    }
    const hit = result.evidence[0];
    expect(hit.matches.length).toBeGreaterThan(0);
    for (const match of hit.matches) {
      expect(match.span).toMatchObject({ ticker: "AAPL", transcript_id: documents[0].id, document_key: `AAPL/${documents[0].id}`, segment_index: 0 });
      expect(match.span.body_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(match.span.segment_text_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Buffer.from(documents[0].segments[0].text).subarray(match.span.start_byte, match.span.end_byte).toString().toLowerCase()).toBe(match.term.toLowerCase());
    }
  });

  it("does not turn an uncovered symbol or unmatched question into a model answer", async () => {
    const { fetcher } = await archiveFixture();
    expect(await preflightEvidenceToThesis("MSFT", "services demand", { fetcher })).toMatchObject({ state: "insufficient_evidence", reason: "symbol_not_covered", evidence: [] });
    expect(await preflightEvidenceToThesis("AAPL", "unicorns", { fetcher })).toMatchObject({ state: "insufficient_evidence", reason: "no_matches", evidence: [] });
  });

  it("rejects a body changed without its canonical revision", async () => {
    const { fetcher } = await archiveFixture({ changedBody: true });
    expect(await preflightEvidenceToThesis("AAPL", "services", { fetcher })).toMatchObject({ state: "insufficient_evidence", reason: "stale_evidence", evidence: [], coverage: { staleDocuments: ["2026Q4"], totalDocuments: null } });
  });

  it("returns new coordinates after an explicit source correction and preserves the old receipt", async () => {
    const first = await archiveFixture();
    const before = await preflightEvidenceToThesis("AAPL", "services demand", { fetcher: first.fetcher });
    const snapshot = JSON.stringify(before);
    const corrected = await archiveFixture({ text: "Correction: services demand weakened." });
    const after = await preflightEvidenceToThesis("AAPL", "services demand", { fetcher: corrected.fetcher });
    expect(after.evidence[0].matches[0].span.body_sha256).not.toBe(before.evidence[0].matches[0].span.body_sha256);
    expect(after.evidence[0].matches[0].span.span_id).not.toBe(before.evidence[0].matches[0].span.span_id);
    expect(JSON.stringify(before)).toBe(snapshot);
    // This tests retrieval revisions, not historical Thesis correction rendering.
  });

  it("discloses archive and result truncation", async () => {
    const { fetcher } = await archiveFixture({ count: 13 });
    const result = await preflightEvidenceToThesis("AAPL", "services demand", { fetcher });
    expect(result).toMatchObject({ state: "insufficient_evidence", reason: "partial_coverage", coverage: { searchedDocuments: 12, totalDocuments: 13, truncated: true, omittedHits: 4 } });
    expect(result.evidence).toHaveLength(8);
  });

  it("discloses unreadable documents alongside any usable hits", async () => {
    const { fetcher } = await archiveFixture({ count: 2, missingBody: "2026Q3" });
    const result = await preflightEvidenceToThesis("AAPL", "services demand", { fetcher });
    expect(result).toMatchObject({ state: "insufficient_evidence", reason: "partial_coverage", coverage: { unavailableDocuments: ["2026Q3"] } });
    expect(result.evidence).toHaveLength(1);
  });

  it("bounds streamed root size even without Content-Length", async () => {
    const canceled = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); }, cancel: canceled,
    }))) as typeof fetch;
    expect(await preflightEvidenceToThesis("AAPL", "services", { fetcher })).toMatchObject({ state: "unavailable", reason: "archive_unavailable" });
    expect(canceled).toHaveBeenCalled();
  });

  it("refuses redirected and off-origin responses", async () => {
    for (const property of ["redirected", "url"] as const) {
      const fetcher = vi.fn(async () => {
        const response = new Response("{}");
        Object.defineProperty(response, property, { value: property === "redirected" ? true : "https://other.test/data/tx/index.json" });
        return response;
      }) as typeof fetch;
      expect(await preflightEvidenceToThesis("AAPL", "services", { fetcher })).toMatchObject({ state: "unavailable", reason: "archive_unavailable" });
    }
  });

  it("cancels an archive stream at the aggregate timeout", async () => {
    vi.useFakeTimers();
    const canceled = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel: canceled }))) as typeof fetch;
    const result = preflightEvidenceToThesis("AAPL", "services", { fetcher });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await result).toMatchObject({ state: "unavailable", reason: "archive_unavailable" });
    expect(canceled).toHaveBeenCalled();
  });

  it("does no read for invalid requests or a canceled caller", async () => {
    const fetcher = vi.fn() as typeof fetch;
    expect(await preflightEvidenceToThesis("AAPL", "x".repeat(241), { fetcher })).toMatchObject({ reason: "invalid_request" });
    const controller = new AbortController(); controller.abort();
    expect(await preflightEvidenceToThesis("AAPL", "services", { fetcher, signal: controller.signal })).toMatchObject({ reason: "archive_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("projects an explicit metadata allowlist even if the shared reader adds source fields", async () => {
    const { fetcher } = await archiveFixture();
    const source = await transcriptSearch.searchTickerTranscripts("AAPL", "services demand", { fetcher });
    if (source.status !== "ready") throw new Error("bad fixture");
    Object.assign(source.hits[0].matches[0], { preview: "private source fragment" });
    Object.assign(source.hits[0].matches[0].span, { source_text: "private source fragment" });
    vi.spyOn(transcriptSearch, "searchTickerTranscripts").mockResolvedValue(source);
    const result = await preflightEvidenceToThesis("AAPL", "services demand", { fetcher });
    const match = result.evidence[0].matches[0];
    expect(Object.keys(match).sort()).toEqual(["span", "term"]);
    expect(Object.keys(match.span).sort()).toEqual([
      "body_sha256", "document_key", "end_byte", "schema", "segment_index", "segment_text_sha256",
      "span_id", "start_byte", "ticker", "transcript_id",
    ]);
    expect(JSON.stringify(result)).not.toContain("private source fragment");
  });

  it("aborts all remaining reads when several individually small bodies exceed the total budget", async () => {
    const fixture = await archiveFixture({ count: 12 });
    let bodyReads = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith(TRANSCRIPT_REVISION_ROOT_URL)) return new Response(JSON.stringify(fixture.root));
      bodyReads += 1;
      return new Response(new Uint8Array(4 * 1024 * 1024));
    });
    expect(await preflightEvidenceToThesis("AAPL", "services", { fetcher })).toMatchObject({ reason: "archive_unavailable" });
    expect(bodyReads).toBeLessThanOrEqual(4);
    expect(bodyReads).toBeGreaterThan(1);
    for (const [, init] of fetcher.mock.calls) expect(init!.signal!.aborted).toBe(true);
  });
});
