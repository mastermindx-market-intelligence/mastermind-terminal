import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalTranscriptBodySha256,
  TRANSCRIPT_REVISION_ROOT_URL,
} from "@/lib/transcriptSearch";
import { composeEvidenceToThesis, thesisRevisionNote } from "@/lib/evidenceToThesis";

type Body = {
  schema: "mastermind.tx/v1";
  ticker: string;
  id: string;
  period: string;
  date: string;
  title: string;
  segments: Array<{ speaker: string; role: string; text: string }>;
};

function body(): Body {
  return {
    schema: "mastermind.tx/v1",
    ticker: "AAPL",
    id: "2026Q2",
    period: "Q2 FY2026",
    date: "2026-07-31",
    title: "AAPL Earnings Call",
    segments: [{ speaker: "CEO", role: "CEO", text: "Services demand remains durable while enterprise adoption is broadening." }],
  };
}

async function archiveFixture() {
  const document = body();
  const revision = await canonicalTranscriptBodySha256(document);
  if (!revision) throw new Error("missing WebCrypto");
  const root = {
    schema: "mastermind.tx-index/v1",
    generated_at: "2026-08-01T00:00:00Z",
    body_count: 1,
    symbols: { AAPL: [document.id] },
    revisions: { [`AAPL/${document.id}`]: revision },
    dates: { [`AAPL/${document.id}`]: document.date },
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith(TRANSCRIPT_REVISION_ROOT_URL)) return new Response(JSON.stringify(root), { status: 200 });
    if (url.endsWith(`/data/tx/AAPL/${document.id}.json.gz`)) return new Response(gzipSync(JSON.stringify(document)), { status: 200 });
    return new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetcher };
}

const modelDraft = (sourceSpanId: string) => ({
  schema: "mastermind.evidence-to-thesis/v1",
  title: "Services demand remains durable",
  statement: "Verified management commentary supports a durable services demand thesis, with enterprise adoption as an inference to monitor.",
  catalysts: ["Services demand remains durable"],
  falsifiers: ["A current call reports weakening services demand"],
  risks: ["The archive does not establish forward revenue quantities"],
  horizon: "quarters",
  claims: [
    { text: "Management said services demand remains durable.", kind: "fact", sourceSpanIds: [sourceSpanId] },
    { text: "Enterprise adoption is broadening is an inference from the cited passage.", kind: "inference", sourceSpanIds: [sourceSpanId] },
  ],
  uncertainty: ["The cited passage does not provide a numerical forecast."],
});

describe("evidence-to-thesis composition", () => {
  it("returns a cited, temporary draft from revision-verified evidence", async () => {
    const { fetcher } = await archiveFixture();
    const gatewayFetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const prompt = request.message as string;
      const spanId = prompt.match(/txs1_[a-f0-9]{64}/)?.[0];
      return new Response(JSON.stringify({ reply: JSON.stringify(modelDraft(spanId!)) }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await composeEvidenceToThesis("aapl", "What supports services demand?", { transcriptFetcher: fetcher, gatewayFetcher, gatewayUrl: "https://brain.test" });
    expect(result.state).toBe("ready");
    if (result.state === "ready") {
      expect(result.draft.claims.every((claim) => claim.sourceSpanIds.length > 0)).toBe(true);
      expect(thesisRevisionNote(result)).toContain("txs1_");
      expect(gatewayFetcher).toHaveBeenCalledWith("https://brain.test/api/brain/chat", expect.objectContaining({ method: "POST" }));
    }
  });

  it("refuses a model response with an unsupported citation", async () => {
    const { fetcher } = await archiveFixture();
    const gatewayFetcher = vi.fn(async () => new Response(JSON.stringify({ reply: JSON.stringify(modelDraft(`txs1_${"f".repeat(64)}`)) }), { status: 200 })) as unknown as typeof fetch;
    const result = await composeEvidenceToThesis("AAPL", "What supports services demand?", { transcriptFetcher: fetcher, gatewayFetcher });
    expect(result).toMatchObject({ state: "model_unusable", missing: ["citation-complete JSON draft"] });
  });

  it("stops with an explicit missing-evidence result when the archive has no symbol", async () => {
    const { fetcher } = await archiveFixture();
    const result = await composeEvidenceToThesis("MSFT", "What supports services demand?", { transcriptFetcher: fetcher, gatewayFetcher: vi.fn() as unknown as typeof fetch });
    expect(result).toMatchObject({ state: "insufficient_evidence", missing: ["a covered transcript for this symbol"] });
  });
});
