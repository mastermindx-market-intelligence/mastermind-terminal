import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  ALIGN_MIN_SHARED_TERMS,
  alignComparePassages,
  buildTranscriptComparisonReceipt,
  compareContentTerms,
  compareOverlapScore,
  comparePassageSection,
  compareSpeakers,
  parseTranscriptComparisonReceipt,
  readTranscriptCompareParams,
  reconstructTranscriptComparison,
  selectComparePassages,
  TRANSCRIPT_COMPARE_URL_KEYS,
  writeTranscriptCompareParams,
  type CompareFilter,
  type ComparePassage,
  type TranscriptComparisonReceipt,
} from "../transcriptCompare";
import { TRANSCRIPT_COMPARE_LEX } from "../transcriptCompareLex";
import {
  canonicalTranscriptBodySha256,
  getRevisionVerifiedTranscripts,
  TRANSCRIPT_REVISION_ROOT_URL,
  type RevisionVerifiedTranscript,
} from "../transcriptSearch";

type Segment = { speaker: string; role: string; text: string };
type Body = {
  schema: "mastermind.tx/v1";
  ticker: string;
  id: string;
  period: string;
  date: string | null;
  title: string;
  segments: Segment[];
};

function body(ticker: string, id: string, segments: Segment[]): Body {
  return {
    schema: "mastermind.tx/v1",
    ticker,
    id,
    period: `Q${id.slice(5)} FY${id.slice(0, 4)}`,
    date: "2026-07-31",
    title: `${ticker} Earnings Call`,
    segments,
  };
}

function gzipResponse(payload: unknown): Response {
  return new Response(gzipSync(JSON.stringify(payload)), { status: 200, headers: { "content-type": "application/gzip" } });
}

async function rootFor(bodies: readonly Body[], options: { advertise?: Record<string, string> } = {}) {
  const symbols: Record<string, string[]> = {};
  const revisions: Record<string, string> = {};
  const dates: Record<string, string> = {};
  for (const value of bodies) {
    symbols[value.ticker] ??= [];
    symbols[value.ticker].push(value.id);
    const pair = `${value.ticker}/${value.id}`;
    const hash = await canonicalTranscriptBodySha256(value);
    if (!hash) throw new Error("test environment has no WebCrypto SHA-256");
    revisions[pair] = options.advertise?.[pair] ?? hash;
    dates[pair] = "2026-07-31";
  }
  return {
    schema: "mastermind.tx-index/v1",
    generated_at: "2026-08-01T00:00:00Z",
    body_count: bodies.length,
    symbols,
    revisions,
    dates,
  };
}

function archiveFetch(root: unknown, bodies: readonly Body[]) {
  const byUrl = new Map(bodies.map((value) => [`/data/tx/${value.ticker}/${value.id}.json.gz`, value]));
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === TRANSCRIPT_REVISION_ROOT_URL) return new Response(JSON.stringify(root), { status: 200 });
    const value = byUrl.get(url);
    return value ? gzipResponse(value) : new Response("missing", { status: 404 });
  });
}

function requestedUrls(fetcher: ReturnType<typeof archiveFetch>): string[] {
  return fetcher.mock.calls.map(([input]) => (typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url));
}

const OPERATOR = "Operator";

/** A year-ago call: data-center wording, a Q&A boundary, one analyst. */
const callA = (): Body => body("NVDA", "2026Q1", [
  { speaker: OPERATOR, role: OPERATOR, text: "Good afternoon and welcome to the first quarter conference call." },
  { speaker: "Jensen Huang", role: "CEO", text: "Data center demand remains extraordinary as hyperscale customers expand accelerated computing infrastructure across every region." },
  { speaker: "Colette Kress", role: "CFO", text: "Revenue reached $26.0 billion, up 262%." },
  { speaker: "Colette Kress", role: "CFO", text: "Thanks. We will now transition to Q&A. Operator, please poll for questions." },
  { speaker: OPERATOR, role: OPERATOR, text: "Our first question comes from Vivek Arya with Bank of America." },
  { speaker: "Vivek Arya", role: "Analyst", text: "How should we think about networking attach rates for Spectrum-X Ethernet deployments?" },
  { speaker: "Jensen Huang", role: "CEO", text: "Spectrum-X Ethernet networking attach keeps rising with every large cluster deployment we ship." },
]);

/** The latest call: some reused wording, different figures, a different analyst. */
const callB = (): Body => body("NVDA", "2027Q1", [
  { speaker: OPERATOR, role: OPERATOR, text: "Good afternoon and welcome to the conference call for the first quarter." },
  { speaker: "Colette Kress", role: "CFO", text: "Revenue reached $44.1 billion, up 69%." },
  { speaker: "Jensen Huang", role: "CEO", text: "Hyperscale customers keep expanding accelerated computing infrastructure, and data center demand remains extraordinary in every region." },
  { speaker: "Colette Kress", role: "CFO", text: "We will now transition to Q&A. Operator, please poll for questions." },
  { speaker: OPERATOR, role: OPERATOR, text: "Our first question comes from Joseph Moore with Morgan Stanley." },
  { speaker: "Joseph Moore", role: "Analyst", text: "Can you describe sovereign customer pipelines for Blackwell systems in Europe?" },
  { speaker: "Jensen Huang", role: "CEO", text: "Sovereign pipelines for Blackwell systems in Europe are broadening across many governments." },
]);

/** The adjacent fiscal call that must never stand in for 2026Q1. */
const callAdjacent = (): Body => body("NVDA", "2026Q2", [
  { speaker: "Jensen Huang", role: "CEO", text: "Data center demand remains extraordinary as hyperscale customers expand accelerated computing infrastructure." },
]);

const ALL: CompareFilter = { query: "", speaker: null, section: "all" };

async function loadPair(bodies: Body[], ids: [string, string], options: { advertise?: Record<string, string>; serve?: Body[] } = {}) {
  const root = await rootFor(bodies, options);
  const fetcher = archiveFetch(root, options.serve ?? bodies);
  const loaded = await getRevisionVerifiedTranscripts("NVDA", ids, { fetcher: fetcher as unknown as typeof fetch });
  return { root, fetcher, loaded };
}

function ready(result: Awaited<ReturnType<typeof getRevisionVerifiedTranscripts>>, index: number): RevisionVerifiedTranscript {
  if (result.status !== "ready") throw new Error("archive unavailable");
  const entry = result.results[index];
  if (entry.status !== "ready") throw new Error(`side ${index} is ${entry.status}`);
  return entry.document;
}

function okPassages(document: RevisionVerifiedTranscript, side: "a" | "b", filter: CompareFilter = ALL): ComparePassage[] {
  const selection = selectComparePassages(document, side, filter);
  if (selection.status !== "ok") throw new Error(selection.status);
  return selection.passages;
}

async function resign(receipt: TranscriptComparisonReceipt): Promise<TranscriptComparisonReceipt> {
  const { receipt_id: _old, ...rest } = receipt;
  void _old;
  const hash = await canonicalTranscriptBodySha256(rest);
  return { ...rest, receipt_id: `txc1_${hash}` };
}

async function freeze(bodies: Body[], ids: [string, string], filter: CompareFilter = ALL, align = false) {
  const { loaded } = await loadPair(bodies, ids);
  const a = ready(loaded, 0);
  const b = ready(loaded, 1);
  const pa = okPassages(a, "a", filter);
  const pb = okPassages(b, "b", filter);
  const alignment = align ? alignComparePassages(pa, pb) : null;
  const receipt = await buildTranscriptComparisonReceipt({
    archive_generated_at: loaded.status === "ready" ? loaded.generated_at : "",
    a: { document: a, passages: pa },
    b: { document: b, passages: pb },
    filter,
    alignment,
  });
  if (!receipt) throw new Error("receipt was not minted");
  return { receipt, a, b, pa, pb, alignment };
}

describe("AC-E12-01 exact call, revision and segment binding", () => {
  it("binds every passage to its own call id, advertised body hash and source segment", async () => {
    const bodies = [callA(), callB()];
    const { root, loaded } = await loadPair(bodies, ["2026Q1", "2027Q1"]);
    const a = ready(loaded, 0);
    const b = ready(loaded, 1);
    for (const [document, side, source] of [[a, "a", bodies[0]], [b, "b", bodies[1]]] as const) {
      const passages = okPassages(document, side);
      expect(passages).toHaveLength(source.segments.length);
      for (const passage of passages) {
        expect(passage.side).toBe(side);
        expect(passage.ticker).toBe("NVDA");
        expect(passage.call_id).toBe(source.id);
        expect(passage.body_sha256).toBe(root.revisions[`NVDA/${source.id}`]);
        expect(passage.text).toBe(source.segments[passage.segment_index].text);
        expect(passage.speaker).toBe(source.segments[passage.segment_index].speaker);
      }
    }
  });

  it("labels sections only from the verified Q&A boundary", async () => {
    const { loaded } = await loadPair([callA(), callB()], ["2026Q1", "2027Q1"]);
    const a = ready(loaded, 0);
    expect(a.qa_start_index).toBe(4);
    expect([0, 1, 2, 3, 4, 5].map((index) => comparePassageSection(a, index)))
      .toEqual(["prepared", "prepared", "prepared", "qa_transition", "qa", "qa"]);
    const qa = okPassages(a, "a", { query: "", speaker: null, section: "qa" });
    expect(qa.map((passage) => passage.segment_index)).toEqual([4, 5, 6]);
    const prepared = okPassages(a, "a", { query: "", speaker: null, section: "prepared" });
    expect(prepared.map((passage) => passage.segment_index)).toEqual([0, 1, 2]);
  });

  it("filters by an exact speaker and a literal topic, recording highlight offsets", async () => {
    const { loaded } = await loadPair([callA(), callB()], ["2026Q1", "2027Q1"]);
    const b = ready(loaded, 1);
    const topic = okPassages(b, "b", { query: "Data Center", speaker: null, section: "all" });
    expect(topic.map((passage) => passage.segment_index)).toEqual([2]);
    const [start, end] = topic[0].matches[0];
    expect(topic[0].text.slice(start, end).toLowerCase()).toBe("data center");
    const speaker = okPassages(b, "b", { query: "", speaker: "  Jensen Huang ", section: "all" });
    expect(speaker.every((passage) => passage.speaker === "Jensen Huang")).toBe(true);
    expect(speaker.map((passage) => passage.segment_index)).toEqual([2, 6]);
  });

  it("lists speakers per call without merging them into a continuity claim", async () => {
    const { loaded } = await loadPair([callA(), callB()], ["2026Q1", "2027Q1"]);
    const speakers = compareSpeakers(ready(loaded, 0), ready(loaded, 1));
    expect(speakers.find((entry) => entry.name === "Vivek Arya")).toEqual({ name: "Vivek Arya", in_a: true, in_b: false });
    expect(speakers.find((entry) => entry.name === "Joseph Moore")).toEqual({ name: "Joseph Moore", in_a: false, in_b: true });
    expect(speakers.find((entry) => entry.name === "Jensen Huang")).toEqual({ name: "Jensen Huang", in_a: true, in_b: true });
  });
});

describe("AC-E12-02 no substitution for an absent or unverified call", () => {
  it("reports a missing call as not covered and never reads the adjacent fiscal period", async () => {
    const { loaded, fetcher } = await loadPair([callAdjacent(), callB()], ["2026Q1", "2027Q1"]);
    expect(loaded.status).toBe("ready");
    if (loaded.status !== "ready") return;
    expect(loaded.results[0]).toEqual({ status: "not_covered", ticker: "NVDA", id: "2026Q1" });
    expect(loaded.results[1].status).toBe("ready");
    expect(requestedUrls(fetcher)).not.toContain("/data/tx/NVDA/2026Q2.json.gz");
  });

  it("withholds a body whose bytes differ from the advertised revision", async () => {
    const a = callA();
    const { loaded } = await loadPair([a, callB()], ["2026Q1", "2027Q1"], { advertise: { "NVDA/2026Q1": "e".repeat(64) } });
    if (loaded.status !== "ready") throw new Error("archive unavailable");
    expect(loaded.results[0]).toMatchObject({ status: "stale_revision", id: "2026Q1", reason: "body_hash_mismatch" });
  });

  it("reports a speaker who did not speak, and an unverified section, instead of substituting", async () => {
    const unsectioned = body("NVDA", "2025Q4", [
      { speaker: "Jensen Huang", role: "CEO", text: "Prepared remark without any Q&A boundary." },
    ]);
    const { loaded } = await loadPair([unsectioned, callB()], ["2025Q4", "2027Q1"]);
    const a = ready(loaded, 0);
    const b = ready(loaded, 1);
    expect(selectComparePassages(b, "b", { query: "", speaker: "Vivek Arya", section: "all" }))
      .toEqual({ status: "speaker_absent", total: b.transcript.segments.length });
    expect(a.qa_start_index).toBeNull();
    expect(selectComparePassages(a, "a", { query: "", speaker: null, section: "qa" }))
      .toEqual({ status: "section_unidentified", total: 1 });
    expect(selectComparePassages(a, "a", ALL).status).toBe("ok");
  });

  it("refuses to mint a receipt that mixes a neighbouring call into a side", async () => {
    const { loaded } = await loadPair([callA(), callB(), callAdjacent()], ["2026Q1", "2027Q1"]);
    const a = ready(loaded, 0);
    const b = ready(loaded, 1);
    const adjacentLoad = await loadPair([callA(), callB(), callAdjacent()], ["2026Q2", "2027Q1"]);
    const adjacent = ready(adjacentLoad.loaded, 0);
    const smuggled = [...okPassages(a, "a"), ...okPassages(adjacent, "a")];
    await expect(buildTranscriptComparisonReceipt({
      archive_generated_at: "2026-08-01T00:00:00Z",
      a: { document: a, passages: smuggled },
      b: { document: b, passages: okPassages(b, "b") },
      filter: ALL,
      alignment: null,
    })).resolves.toBeNull();
  });
});

describe("AC-E12-03 alignment pairs shared words only", () => {
  it("excludes every digit-bearing token and contraction from the matching vocabulary", () => {
    const terms = compareContentTerms("Revenue was $26.0 billion, up 262% — we're at 78.4% margin in FY2027 and Q1'26.");
    expect([...terms].some((term) => /\d/.test(term))).toBe(false);
    expect(terms.has("we're")).toBe(false);
    expect(terms.has("revenue")).toBe(true);
  });

  it("does not pair passages whose only common ground is changed figures", async () => {
    const { loaded } = await loadPair([callA(), callB()], ["2026Q1", "2027Q1"]);
    const pa = okPassages(ready(loaded, 0), "a");
    const pb = okPassages(ready(loaded, 1), "b");
    const revenueA = pa.find((passage) => passage.segment_index === 2)!;
    const revenueB = pb.find((passage) => passage.segment_index === 1)!;
    expect(compareOverlapScore(revenueA.text, revenueB.text).shared_terms).toBeLessThan(ALIGN_MIN_SHARED_TERMS);
    const alignment = alignComparePassages(pa, pb);
    expect(alignment.pairs.some((pair) => pair.a.segment_index === 2 && pair.b.segment_index === 1)).toBe(false);
    for (const pair of alignment.pairs) for (const term of pair.shared_terms) expect(term).not.toMatch(/\d/);
    // Figures neither add to nor subtract from a score: only the words are compared.
    const words = "Gross margin expanded across datacenter networking products";
    expect(compareOverlapScore(`${words} 78.4% in 2026`, `${words} 61.0% in 2027`)).toEqual(compareOverlapScore(words, words));
  });

  it("pairs by shared wording regardless of speaker and never by speaker alone", async () => {
    const { loaded } = await loadPair([callA(), callB()], ["2026Q1", "2027Q1"]);
    const pa = okPassages(ready(loaded, 0), "a");
    const pb = okPassages(ready(loaded, 1), "b");
    const alignment = alignComparePassages(pa, pb);
    const demand = alignment.pairs.find((pair) => pair.a.segment_index === 1);
    expect(demand?.b.segment_index).toBe(2);
    expect(demand!.shared_count).toBeGreaterThanOrEqual(ALIGN_MIN_SHARED_TERMS);
    // Jensen Huang answers in both Q&As about unrelated subjects: same speaker, no pair.
    expect(alignment.pairs.some((pair) => pair.a.segment_index === 6 && pair.b.segment_index === 6)).toBe(false);
    // A pair claims shared words and a score only — no change, causation or continuity field.
    for (const pair of alignment.pairs) {
      expect(Object.keys(pair).sort()).toEqual(["a", "b", "score", "shared_count", "shared_terms"]);
    }
    const covered = new Set([...alignment.pairs.map((pair) => pair.a.segment_index), ...alignment.unmatched_a.map((passage) => passage.segment_index)]);
    expect(covered.size).toBe(pa.length);
  });

  it("is one-to-one and independent of input order", async () => {
    const { loaded } = await loadPair([callA(), callB()], ["2026Q1", "2027Q1"]);
    const pa = okPassages(ready(loaded, 0), "a");
    const pb = okPassages(ready(loaded, 1), "b");
    const key = (alignment: ReturnType<typeof alignComparePassages>) => alignment.pairs.map((pair) => `${pair.a.segment_index}:${pair.b.segment_index}:${pair.score}`);
    const forward = alignComparePassages(pa, pb);
    const reversed = alignComparePassages([...pa].reverse(), [...pb].reverse());
    expect(key(reversed)).toEqual(key(forward));
    const aUsed = forward.pairs.map((pair) => pair.a.segment_index);
    const bUsed = forward.pairs.map((pair) => pair.b.segment_index);
    expect(new Set(aUsed).size).toBe(aUsed.length);
    expect(new Set(bUsed).size).toBe(bUsed.length);
  });
});

describe("falsifier: a comparison is reconstructed from its two exact references alone", () => {
  it("carries no transcript text and rebuilds the identical passages and pair scores", async () => {
    const bodies = [callA(), callB()];
    const { receipt, pa, pb, alignment } = await freeze(bodies, ["2026Q1", "2027Q1"], ALL, true);
    const serialized = JSON.stringify(receipt);
    for (const segment of [...bodies[0].segments, ...bodies[1].segments]) {
      expect(serialized).not.toContain(segment.text.slice(0, 32));
    }
    expect(alignment!.pairs.length).toBeGreaterThan(0);
    expect(receipt.alignment?.pairs).toHaveLength(alignment!.pairs.length);

    // Only the serialized receipt crosses the boundary; the archive is re-read from scratch.
    const fetcher = archiveFetch(await rootFor(bodies), bodies);
    const rebuilt = await reconstructTranscriptComparison(JSON.parse(serialized), { fetcher: fetcher as unknown as typeof fetch });
    expect(rebuilt.status).toBe("verified");
    if (rebuilt.status !== "verified") return;
    expect(rebuilt.sides.a.call_id).toBe("2026Q1");
    expect(rebuilt.sides.b.call_id).toBe("2027Q1");
    expect(rebuilt.sides.a.passages.map((passage) => passage.text)).toEqual(pa.map((passage) => passage.text));
    expect(rebuilt.sides.b.passages.map((passage) => passage.text)).toEqual(pb.map((passage) => passage.text));
    expect(rebuilt.pairs.map((pair) => pair.score)).toEqual(alignment!.pairs.map((pair) => pair.score));
  });

  it("rejects a receipt whose identifier no longer matches its references", async () => {
    const bodies = [callA(), callB()];
    const { receipt } = await freeze(bodies, ["2026Q1", "2027Q1"]);
    const tampered = structuredClone(receipt);
    tampered.spans.a[0].segment_index = 1;
    const fetcher = archiveFetch(await rootFor(bodies), bodies);
    const rebuilt = await reconstructTranscriptComparison(tampered, { fetcher: fetcher as unknown as typeof fetch });
    expect(rebuilt).toMatchObject({ status: "failed", problems: [{ kind: "invalid_receipt" }] });
    expect(parseTranscriptComparisonReceipt({ ...receipt, schema: "other" })).toBeNull();
  });

  it("names a re-signed reference that points at different source words", async () => {
    const bodies = [callA(), callB()];
    const { receipt } = await freeze(bodies, ["2026Q1", "2027Q1"]);
    const moved = structuredClone(receipt);
    moved.spans.a[1].segment_index = 2;
    const missing = structuredClone(receipt);
    missing.spans.b[0].segment_index = 99;
    const fetcher = archiveFetch(await rootFor(bodies), bodies);
    const movedResult = await reconstructTranscriptComparison(await resign(moved), { fetcher: fetcher as unknown as typeof fetch });
    expect(movedResult).toMatchObject({ status: "failed", problems: [{ kind: "span_mismatch", side: "a" }] });
    const missingResult = await reconstructTranscriptComparison(await resign(missing), { fetcher: fetcher as unknown as typeof fetch });
    expect(missingResult).toMatchObject({ status: "failed", problems: [{ kind: "segment_missing", side: "b" }] });
  });

  it("names a claimed pair whose score the source text does not support", async () => {
    const bodies = [callA(), callB()];
    const { receipt } = await freeze(bodies, ["2026Q1", "2027Q1"], ALL, true);
    const inflated = structuredClone(receipt);
    inflated.alignment!.pairs[0].score = 0.99;
    const fetcher = archiveFetch(await rootFor(bodies), bodies);
    const rebuilt = await reconstructTranscriptComparison(await resign(inflated), { fetcher: fetcher as unknown as typeof fetch });
    expect(rebuilt).toMatchObject({ status: "failed", problems: [{ kind: "pair_unsupported" }] });
  });
});

describe("AC-E12-04 a source correction voids outdated offsets", () => {
  it("fails a receipt as revision_changed when the archive now advertises a corrected body", async () => {
    const bodies = [callA(), callB()];
    const { receipt } = await freeze(bodies, ["2026Q1", "2027Q1"]);
    const corrected = callB();
    corrected.segments[2] = { ...corrected.segments[2], text: `Correction: ${corrected.segments[2].text}` };
    const fetcher = archiveFetch(await rootFor([bodies[0], corrected]), [bodies[0], corrected]);
    const rebuilt = await reconstructTranscriptComparison(receipt, { fetcher: fetcher as unknown as typeof fetch });
    expect(rebuilt.status).toBe("failed");
    if (rebuilt.status !== "failed") return;
    expect(rebuilt.problems).toEqual([{
      kind: "revision_changed",
      side: "b",
      receipt_body_sha256: receipt.calls.b.body_sha256,
      current_body_sha256: await canonicalTranscriptBodySha256(corrected),
    }]);
  });

  it("fails as stale when the corrected body is served before the archive marker is republished", async () => {
    const bodies = [callA(), callB()];
    const { receipt } = await freeze(bodies, ["2026Q1", "2027Q1"]);
    const corrected = callB();
    corrected.segments[2] = { ...corrected.segments[2], text: `Correction: ${corrected.segments[2].text}` };
    const fetcher = archiveFetch(await rootFor(bodies), [bodies[0], corrected]);
    const rebuilt = await reconstructTranscriptComparison(receipt, { fetcher: fetcher as unknown as typeof fetch });
    expect(rebuilt).toMatchObject({ status: "failed", problems: [{ kind: "stale_revision", side: "b", reason: "body_hash_mismatch" }] });
  });

  it("fails as not covered when a call leaves the archive", async () => {
    const bodies = [callA(), callB()];
    const { receipt } = await freeze(bodies, ["2026Q1", "2027Q1"]);
    const fetcher = archiveFetch(await rootFor([bodies[1], callAdjacent()]), [bodies[1], callAdjacent()]);
    const rebuilt = await reconstructTranscriptComparison(receipt, { fetcher: fetcher as unknown as typeof fetch });
    expect(rebuilt).toMatchObject({ status: "failed", problems: [{ kind: "not_covered", side: "a" }] });
  });
});

describe("AC-E12-05 share links carry references only", () => {
  it("round-trips calls, revision prefixes and filters, and nothing else", () => {
    const params = new URLSearchParams("symbol=NVDA&page=transcripts");
    writeTranscriptCompareParams(params, {
      ticker: "NVDA",
      a: { id: "2026Q1", sha12: "0123456789ab" },
      b: { id: "2027Q1", sha12: null },
      filter: { query: "data center", speaker: "Jensen Huang", section: "qa" },
      mode: "align",
    });
    expect(params.get("txc")).toBe("NVDA_2026Q1.0123456789ab_2027Q1");
    expect(readTranscriptCompareParams(params)).toEqual({
      ticker: "NVDA",
      a: { id: "2026Q1", sha12: "0123456789ab" },
      b: { id: "2027Q1", sha12: null },
      filter: { query: "data center", speaker: "Jensen Huang", section: "qa" },
      mode: "align",
    });
    writeTranscriptCompareParams(params, null);
    for (const key of TRANSCRIPT_COMPARE_URL_KEYS) expect(params.has(key)).toBe(false);
    expect(params.get("symbol")).toBe("NVDA");
  });

  it("applies no guessed call from a malformed or self-referential link", () => {
    for (const value of ["NVDA_2026Q1_2026Q1", "NVDA_2026Q5_2027Q1", "NVDA_2026Q1", "nvda_2026Q1_2027Q1", "NVDA_2026Q1.XYZ_2027Q1", "NVDA_2026Q1.0123_2027Q1"]) {
      expect(readTranscriptCompareParams(new URLSearchParams({ txc: value }))).toBeNull();
    }
    const doubled = new URLSearchParams();
    doubled.append("txc", "NVDA_2026Q1_2027Q1");
    doubled.append("txc", "NVDA_2025Q1_2027Q1");
    expect(readTranscriptCompareParams(doubled)).toBeNull();
  });

  it("ships matching English and Chinese copy with the same placeholders", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [key, [en, zh]] of Object.entries(TRANSCRIPT_COMPARE_LEX)) {
      expect(en.trim(), key).not.toBe("");
      expect(zh.trim(), key).not.toBe("");
      expect(placeholders(zh), key).toEqual(placeholders(en));
      expect(zh, key).not.toBe(en);
      expect(zh, key).toMatch(/[一-鿿]/u);
    }
    expect(TRANSCRIPT_COMPARE_LEX.tcRawLabel[0]).toMatch(/not translated/i);
    expect(TRANSCRIPT_COMPARE_LEX.tcRights[0]).toMatch(/never transcript text/i);
    // A copied link keeps its route; on the chart route a guest can open it. The copy must not
    // promise a member gate the link does not carry — it only re-checks what the opener can read.
    expect(TRANSCRIPT_COMPARE_LEX.tcRights[0]).not.toMatch(/member/i);
    expect(TRANSCRIPT_COMPARE_LEX.tcRights[1]).not.toMatch(/会员/u);
    expect(TRANSCRIPT_COMPARE_LEX.tcRights[0]).toMatch(/only what the opener can already read/i);
  });
});
