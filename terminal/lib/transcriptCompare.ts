/**
 * Two-period transcript comparison (E12).
 *
 * Pure, deterministic helpers over the revision-verified transcript loader in
 * `transcriptSearch.ts`. Nothing here acquires, stores, or rewrites corpus
 * text. A comparison is two exact calls of ONE company, each bound to the
 * `body_sha256` the archive commit marker advertises, plus segment-level span
 * references that anyone can re-resolve against the same archive.
 *
 * Laws this module keeps:
 * - A requested call that is absent or stale is reported for that side; no
 *   neighbouring fiscal period is ever substituted (`selectComparePassages`
 *   only reads the document it is handed; the loader resolves IDs exactly).
 * - Alignment is lexical overlap of content words, nothing more. It never
 *   compares numbers, never pairs by speaker, and carries no causal or
 *   economic label. Digits are excluded from the vocabulary on purpose, so a
 *   pair can never be "about" a changed figure.
 * - A receipt carries references only (IDs, hashes, offsets, filter, scores),
 *   never passage text, and `reconstructTranscriptComparison` rebuilds every
 *   reference from the live archive. A corrected body changes the root hash,
 *   so an outdated receipt fails as `revision_changed` instead of silently
 *   pointing its offsets at different words.
 */
import {
  canonicalTranscriptBodySha256,
  getRevisionVerifiedTranscripts,
  makeTranscriptSpan,
  normalizeTranscriptSearchId,
  type RevisionVerifiedTranscript,
  type TranscriptSpan,
  type TranscriptStaleRevisionReason,
} from "./transcriptSearch";

export const TRANSCRIPT_COMPARE_SCHEMA = "mastermind.tx-compare/v1" as const;
export const TRANSCRIPT_COMPARE_ALIGNMENT_METHOD = "lexical-content-jaccard/v1" as const;
export const MAX_COMPARE_QUERY_CHARS = 240;
export const MAX_COMPARE_SPEAKER_CHARS = 160;
/** A pair needs at least this many shared content words AND this overlap score. */
export const ALIGN_MIN_SHARED_TERMS = 4;
export const ALIGN_MIN_SCORE = 0.08;
const MAX_SHARED_TERMS_SHOWN = 8;
/** A receipt freezes at most this many passages per call. */
export const MAX_RECEIPT_SPANS_PER_SIDE = 512;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA12 = /^[a-f0-9]{12}$/;
const TICKER = /^[A-Z0-9](?:[A-Z0-9.-]{0,14}[A-Z0-9])?$/;
const CALL_ID = /^\d{4}Q[1-4]$/;
const SPAN_ID = /^txs1_[a-f0-9]{64}$/;
const RECEIPT_ID = /^txc1_[a-f0-9]{64}$/;

type FetchLike = typeof fetch;

export type CompareSide = "a" | "b";
export type CompareSection = "all" | "prepared" | "qa";
export type ComparePassageSection = "prepared" | "qa_transition" | "qa" | "unknown";
export type CompareMode = "side" | "align";

export interface CompareFilter {
  /** Literal, case-insensitive substring of the passage text. Empty = no topic filter. */
  query: string;
  /** Exact (trimmed) source speaker string, or null for every speaker. */
  speaker: string | null;
  section: CompareSection;
}

export interface ComparePassage {
  side: CompareSide;
  ticker: string;
  call_id: string;
  period: string;
  date: string | null;
  body_sha256: string;
  segment_index: number;
  speaker: string;
  role: string;
  section: ComparePassageSection;
  text: string;
  /** UTF-16 [start, end) ranges of the topic query inside `text`, for highlighting only. */
  matches: Array<[number, number]>;
}

export type ComparePassageSelection =
  | { status: "ok"; passages: ComparePassage[]; total: number }
  /** The chosen speaker has no turn in this call; nobody else is substituted. */
  | { status: "speaker_absent"; total: number }
  /** A Prepared/Q&A filter was asked of a call with no verified Q&A boundary. */
  | { status: "section_unidentified"; total: number };

export interface CompareAlignmentPair {
  a: ComparePassage;
  b: ComparePassage;
  score: number;
  /** Number of distinct shared content words. */
  shared_count: number;
  /** Up to eight of them, longest first, for display. */
  shared_terms: string[];
}

export interface CompareAlignment {
  method: typeof TRANSCRIPT_COMPARE_ALIGNMENT_METHOD;
  pairs: CompareAlignmentPair[];
  unmatched_a: ComparePassage[];
  unmatched_b: ComparePassage[];
}

export interface CompareSpeaker {
  name: string;
  in_a: boolean;
  in_b: boolean;
}

export function normalizeCompareFilter(raw: Partial<CompareFilter> | null | undefined): CompareFilter {
  const query = typeof raw?.query === "string" ? raw.query.slice(0, MAX_COMPARE_QUERY_CHARS) : "";
  const speakerRaw = typeof raw?.speaker === "string" ? raw.speaker.trim().slice(0, MAX_COMPARE_SPEAKER_CHARS) : "";
  const section = raw?.section === "prepared" || raw?.section === "qa" ? raw.section : "all";
  return { query, speaker: speakerRaw || null, section };
}

/**
 * Section of one segment, by the verified Q&A chapter only. Without a verified
 * Q&A start the boundary is unknown, and the passage is never labelled
 * Prepared or Q&A on a guess.
 */
export function comparePassageSection(document: RevisionVerifiedTranscript, segmentIndex: number): ComparePassageSection {
  if (document.qa_start_index === null) return "unknown";
  if (document.transition_index === segmentIndex) return "qa_transition";
  return segmentIndex >= document.qa_start_index ? "qa" : "prepared";
}

function literalMatches(text: string, needle: string): Array<[number, number]> | null {
  if (!needle) return [];
  const lower = text.toLowerCase();
  if (!lower.includes(needle)) return null;
  // Case folding can change UTF-16 length (e.g. "İ"); then highlight nothing
  // rather than mark the wrong characters. The passage still matched.
  if (lower.length !== text.length) return [];
  const out: Array<[number, number]> = [];
  let at = lower.indexOf(needle);
  while (at >= 0 && out.length < 64) {
    out.push([at, at + needle.length]);
    at = lower.indexOf(needle, at + needle.length);
  }
  return out;
}

/** Passages of ONE verified document that satisfy the shared filter. */
export function selectComparePassages(
  document: RevisionVerifiedTranscript,
  side: CompareSide,
  rawFilter: CompareFilter,
): ComparePassageSelection {
  const filter = normalizeCompareFilter(rawFilter);
  const segments = document.transcript.segments;
  const total = segments.length;
  const bodySha = document.revision.body_sha256;
  if (!bodySha || !SHA256.test(bodySha)) return { status: "ok", passages: [], total };
  if (filter.speaker && !segments.some((segment) => segment.speaker.trim() === filter.speaker)) {
    return { status: "speaker_absent", total };
  }
  if (filter.section !== "all" && document.qa_start_index === null) return { status: "section_unidentified", total };
  const needle = filter.query.trim().toLowerCase();
  const passages: ComparePassage[] = [];
  segments.forEach((segment, index) => {
    const section = comparePassageSection(document, index);
    if (filter.section !== "all" && section !== filter.section) return;
    if (filter.speaker && segment.speaker.trim() !== filter.speaker) return;
    const matches = literalMatches(segment.text, needle);
    if (matches === null) return;
    passages.push({
      side,
      ticker: document.revision.ticker,
      call_id: document.revision.id,
      period: document.transcript.period,
      date: document.transcript.date,
      body_sha256: bodySha,
      segment_index: index,
      speaker: segment.speaker,
      role: segment.role,
      section,
      text: segment.text,
      matches,
    });
  });
  return { status: "ok", passages, total };
}

/** Every distinct trimmed speaker string, and which of the two calls contains it. */
export function compareSpeakers(
  a: RevisionVerifiedTranscript | null,
  b: RevisionVerifiedTranscript | null,
): CompareSpeaker[] {
  const names = new Map<string, CompareSpeaker>();
  const add = (document: RevisionVerifiedTranscript | null, key: "in_a" | "in_b") => {
    for (const segment of document?.transcript.segments ?? []) {
      const name = segment.speaker.trim();
      if (!name) continue;
      const entry = names.get(name) ?? { name, in_a: false, in_b: false };
      entry[key] = true;
      names.set(name, entry);
    }
  };
  add(a, "in_a");
  add(b, "in_b");
  return [...names.values()].sort((x, y) => x.name.localeCompare(y.name));
}

// ── lexical alignment ──────────────────────────────────────────────────────

const STOPWORDS = new Set(
  (
    "about above after again against all also although among and another any are around as at back be because been before being "
    + "below between both but by can cannot come could did does doing done down during each either else even ever every few for from "
    + "further get gets getting give go goes going gone good got great had has have having he her here hers him his how however "
    + "i if in into is it its itself just know kind let like lot lots made make makes making many may maybe me might more most much "
    + "must my need next no nor not now of off on once one only or other others our ours out over own per perhaps put quite rather "
    + "really right said same say says see seen she should since so some something sort still such sure take than thank thanks that "
    + "the their theirs them then there these they thing things think this those though through thus to together too toward under "
    + "until up upon us use used very want was way ways we well were what whatever when where whether which while who whom whose why "
    + "will with within without would yeah yes yet you your yours okay ok question questions answer call today year years quarter "
    + "quarters time times first second third last new also little bit look looking"
  ).split(/\s+/),
);

/**
 * Lower-cased content words of a passage. Words containing a digit are
 * excluded so the alignment can never be driven by — or read as a statement
 * about — numbers.
 */
export function compareContentTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
    const word = raw.replace(/['’-]+$/u, "").replace(/['’]s$/u, "");
    // A remaining apostrophe marks a contraction (we're, don't): a function word.
    if (word.length < 3 || /\p{N}/u.test(word) || /['’]/u.test(word) || STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  const shared: string[] = [];
  for (const term of a) if (b.has(term)) shared.push(term);
  const union = a.size + b.size - shared.length;
  return { score: union > 0 ? shared.length / union : 0, shared };
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Recompute the overlap score of two passage texts exactly as the alignment does. */
export function compareOverlapScore(aText: string, bText: string): { score: number; shared_terms: number } {
  const result = overlap(compareContentTerms(aText), compareContentTerms(bText));
  return { score: roundScore(result.score), shared_terms: result.shared.length };
}

/**
 * Deterministic one-to-one shared-wording alignment. Candidates are scored by
 * Jaccard overlap of content words and assigned greedily (highest score
 * first, then earliest A segment, then earliest B segment). A pair is a
 * statement about shared words only.
 */
export function alignComparePassages(a: readonly ComparePassage[], b: readonly ComparePassage[]): CompareAlignment {
  const aTerms = a.map((passage) => compareContentTerms(passage.text));
  const bTerms = b.map((passage) => compareContentTerms(passage.text));
  const candidates: Array<{ i: number; j: number; score: number; shared: string[] }> = [];
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      const result = overlap(aTerms[i], bTerms[j]);
      const score = roundScore(result.score);
      if (result.shared.length >= ALIGN_MIN_SHARED_TERMS && score >= ALIGN_MIN_SCORE) {
        candidates.push({ i, j, score, shared: result.shared });
      }
    }
  }
  candidates.sort((x, y) => y.score - x.score
    || a[x.i].segment_index - a[y.i].segment_index
    || b[x.j].segment_index - b[y.j].segment_index);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: CompareAlignmentPair[] = [];
  for (const candidate of candidates) {
    if (usedA.has(candidate.i) || usedB.has(candidate.j)) continue;
    usedA.add(candidate.i);
    usedB.add(candidate.j);
    pairs.push({
      a: a[candidate.i],
      b: b[candidate.j],
      score: candidate.score,
      shared_count: candidate.shared.length,
      shared_terms: [...candidate.shared]
        .sort((x, y) => y.length - x.length || x.localeCompare(y))
        .slice(0, MAX_SHARED_TERMS_SHOWN),
    });
  }
  pairs.sort((x, y) => x.a.segment_index - y.a.segment_index || x.b.segment_index - y.b.segment_index);
  return {
    method: TRANSCRIPT_COMPARE_ALIGNMENT_METHOD,
    pairs,
    unmatched_a: a.filter((_, index) => !usedA.has(index)),
    unmatched_b: b.filter((_, index) => !usedB.has(index)),
  };
}

// ── source references ──────────────────────────────────────────────────────

/** The revision-bound whole-segment span reference behind one visible passage. */
export function comparePassageSpan(passage: Pick<ComparePassage, "ticker" | "call_id" | "body_sha256" | "segment_index" | "text">): Promise<TranscriptSpan | null> {
  return makeTranscriptSpan(
    { ticker: passage.ticker, id: passage.call_id, body_sha256: passage.body_sha256 },
    passage.segment_index,
    passage.text,
    0,
    passage.text.length,
  );
}

export interface TranscriptCompareSpanRef {
  span_id: string;
  document_key: string;
  body_sha256: string;
  segment_index: number;
  start_byte: number;
  end_byte: number;
  segment_text_sha256: string;
}

export interface TranscriptCompareCallRef {
  id: string;
  period: string;
  date: string | null;
  body_sha256: string;
}

export interface TranscriptComparisonReceipt {
  schema: typeof TRANSCRIPT_COMPARE_SCHEMA;
  /** `txc1_<sha256(canonical receipt without receipt_id)>`. */
  receipt_id: string;
  ticker: string;
  archive_generated_at: string;
  calls: Record<CompareSide, TranscriptCompareCallRef>;
  filter: { query: string; speaker: string | null; section: CompareSection };
  alignment: {
    method: typeof TRANSCRIPT_COMPARE_ALIGNMENT_METHOD;
    min_shared_terms: number;
    min_score: number;
    pairs: Array<{ a: string; b: string; score: number }>;
  } | null;
  spans: Record<CompareSide, TranscriptCompareSpanRef[]>;
}

function spanRef(span: TranscriptSpan): TranscriptCompareSpanRef {
  return {
    span_id: span.span_id,
    document_key: span.document_key,
    body_sha256: span.body_sha256,
    segment_index: span.segment_index,
    start_byte: span.start_byte,
    end_byte: span.end_byte,
    segment_text_sha256: span.segment_text_sha256,
  };
}

async function receiptId(body: Omit<TranscriptComparisonReceipt, "receipt_id">): Promise<string | null> {
  const hash = await canonicalTranscriptBodySha256(body);
  return hash ? `txc1_${hash}` : null;
}

export interface BuildReceiptSide {
  document: RevisionVerifiedTranscript;
  passages: readonly ComparePassage[];
}

/**
 * Freeze a visible comparison as references only. Returns null when either
 * side lacks a verified revision or a span cannot be derived — a receipt that
 * cannot be reconstructed is never minted.
 */
export async function buildTranscriptComparisonReceipt(input: {
  archive_generated_at: string;
  a: BuildReceiptSide;
  b: BuildReceiptSide;
  filter: CompareFilter;
  alignment: CompareAlignment | null;
}): Promise<TranscriptComparisonReceipt | null> {
  const ticker = input.a.document.revision.ticker;
  if (ticker !== input.b.document.revision.ticker || input.a.document.revision.id === input.b.document.revision.id) return null;
  const calls = {} as Record<CompareSide, TranscriptCompareCallRef>;
  const spans = {} as Record<CompareSide, TranscriptCompareSpanRef[]>;
  const idBySideSegment = new Map<string, string>();
  for (const side of ["a", "b"] as const) {
    const { document, passages } = input[side];
    const sha = document.revision.body_sha256;
    if (!sha || !SHA256.test(sha) || passages.length > MAX_RECEIPT_SPANS_PER_SIDE) return null;
    calls[side] = { id: document.revision.id, period: document.transcript.period, date: document.transcript.date, body_sha256: sha };
    const refs: TranscriptCompareSpanRef[] = [];
    for (const passage of passages) {
      if (passage.call_id !== document.revision.id || passage.body_sha256 !== sha) return null;
      const span = await comparePassageSpan(passage);
      if (!span) return null;
      refs.push(spanRef(span));
      idBySideSegment.set(`${side}:${passage.segment_index}`, span.span_id);
    }
    spans[side] = refs;
  }
  let alignment: TranscriptComparisonReceipt["alignment"] = null;
  if (input.alignment) {
    const pairs: Array<{ a: string; b: string; score: number }> = [];
    for (const pair of input.alignment.pairs) {
      const a = idBySideSegment.get(`a:${pair.a.segment_index}`);
      const b = idBySideSegment.get(`b:${pair.b.segment_index}`);
      if (!a || !b) return null;
      pairs.push({ a, b, score: pair.score });
    }
    alignment = { method: input.alignment.method, min_shared_terms: ALIGN_MIN_SHARED_TERMS, min_score: ALIGN_MIN_SCORE, pairs };
  }
  const filter = normalizeCompareFilter(input.filter);
  const body: Omit<TranscriptComparisonReceipt, "receipt_id"> = {
    schema: TRANSCRIPT_COMPARE_SCHEMA,
    ticker,
    archive_generated_at: input.archive_generated_at,
    calls,
    filter: { query: filter.query, speaker: filter.speaker, section: filter.section },
    alignment,
    spans,
  };
  const id = await receiptId(body);
  return id ? { ...body, receipt_id: id } : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Strict shape validation; returns null for anything that is not exactly a receipt. */
export function parseTranscriptComparisonReceipt(raw: unknown): TranscriptComparisonReceipt | null {
  const root = record(raw);
  if (!root || root.schema !== TRANSCRIPT_COMPARE_SCHEMA || typeof root.receipt_id !== "string" || !RECEIPT_ID.test(root.receipt_id)) return null;
  if (typeof root.ticker !== "string" || !TICKER.test(root.ticker) || typeof root.archive_generated_at !== "string") return null;
  const ticker = root.ticker;
  const callsRaw = record(root.calls);
  const spansRaw = record(root.spans);
  const filterRaw = record(root.filter);
  if (!callsRaw || !spansRaw || !filterRaw) return null;
  const calls = {} as Record<CompareSide, TranscriptCompareCallRef>;
  const spans = {} as Record<CompareSide, TranscriptCompareSpanRef[]>;
  const spanIds = { a: new Set<string>(), b: new Set<string>() };
  for (const side of ["a", "b"] as const) {
    const call = record(callsRaw[side]);
    if (!call || typeof call.id !== "string" || !CALL_ID.test(call.id) || typeof call.period !== "string"
      || (call.date !== null && typeof call.date !== "string") || typeof call.body_sha256 !== "string" || !SHA256.test(call.body_sha256)) return null;
    calls[side] = { id: call.id, period: call.period, date: call.date as string | null, body_sha256: call.body_sha256 };
    const list = spansRaw[side];
    if (!Array.isArray(list) || list.length > MAX_RECEIPT_SPANS_PER_SIDE) return null;
    const refs: TranscriptCompareSpanRef[] = [];
    for (const entry of list) {
      const span = record(entry);
      if (!span || typeof span.span_id !== "string" || !SPAN_ID.test(span.span_id)
        || span.document_key !== `${ticker}/${call.id}` || span.body_sha256 !== call.body_sha256
        || !nonNegativeInt(span.segment_index) || !nonNegativeInt(span.start_byte) || !nonNegativeInt(span.end_byte)
        || span.end_byte <= span.start_byte || typeof span.segment_text_sha256 !== "string" || !SHA256.test(span.segment_text_sha256)) return null;
      refs.push({
        span_id: span.span_id,
        document_key: span.document_key,
        body_sha256: span.body_sha256,
        segment_index: span.segment_index,
        start_byte: span.start_byte,
        end_byte: span.end_byte,
        segment_text_sha256: span.segment_text_sha256,
      });
      spanIds[side].add(span.span_id);
    }
    spans[side] = refs;
  }
  if (calls.a.id === calls.b.id) return null;
  const section = filterRaw.section;
  if (typeof filterRaw.query !== "string" || filterRaw.query.length > MAX_COMPARE_QUERY_CHARS
    || (filterRaw.speaker !== null && typeof filterRaw.speaker !== "string")
    || (section !== "all" && section !== "prepared" && section !== "qa")) return null;
  let alignment: TranscriptComparisonReceipt["alignment"] = null;
  if (root.alignment !== null) {
    const align = record(root.alignment);
    if (!align || align.method !== TRANSCRIPT_COMPARE_ALIGNMENT_METHOD || !Array.isArray(align.pairs)
      || align.min_shared_terms !== ALIGN_MIN_SHARED_TERMS || align.min_score !== ALIGN_MIN_SCORE) return null;
    const pairs: Array<{ a: string; b: string; score: number }> = [];
    for (const entry of align.pairs) {
      const pair = record(entry);
      if (!pair || typeof pair.a !== "string" || typeof pair.b !== "string" || !spanIds.a.has(pair.a) || !spanIds.b.has(pair.b)
        || typeof pair.score !== "number" || !Number.isFinite(pair.score)) return null;
      pairs.push({ a: pair.a, b: pair.b, score: pair.score });
    }
    alignment = { method: TRANSCRIPT_COMPARE_ALIGNMENT_METHOD, min_shared_terms: ALIGN_MIN_SHARED_TERMS, min_score: ALIGN_MIN_SCORE, pairs };
  }
  return {
    schema: TRANSCRIPT_COMPARE_SCHEMA,
    receipt_id: root.receipt_id,
    ticker,
    archive_generated_at: root.archive_generated_at,
    calls,
    filter: { query: filterRaw.query, speaker: filterRaw.speaker as string | null, section },
    alignment,
    spans,
  };
}

export type TranscriptReconstructionProblem =
  | { kind: "invalid_receipt"; side: null }
  | { kind: "archive_unavailable"; side: CompareSide | null }
  | { kind: "not_covered"; side: CompareSide }
  | { kind: "stale_revision"; side: CompareSide; reason: TranscriptStaleRevisionReason }
  /** The archive now advertises a different body for this call: every offset is void. */
  | { kind: "revision_changed"; side: CompareSide; receipt_body_sha256: string; current_body_sha256: string }
  | { kind: "segment_missing"; side: CompareSide; span_id: string }
  | { kind: "span_mismatch"; side: CompareSide; span_id: string }
  | { kind: "pair_unsupported"; side: null; a: string; b: string };

export interface ReconstructedPassage {
  span_id: string;
  segment_index: number;
  speaker: string;
  role: string;
  text: string;
}

export type TranscriptComparisonReconstruction =
  | {
    status: "verified";
    receipt_id: string;
    ticker: string;
    archive_generated_at: string;
    sides: Record<CompareSide, { call_id: string; body_sha256: string; passages: ReconstructedPassage[] }>;
    pairs: Array<{ a: string; b: string; score: number }>;
  }
  | { status: "failed"; receipt_id: string | null; problems: TranscriptReconstructionProblem[] };

function utf16Offset(text: string, byteOffset: number): number | null {
  const bytes = new TextEncoder().encode(text);
  if (byteOffset > bytes.byteLength) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, byteOffset)).length;
  } catch {
    return null;
  }
}

/**
 * Independently rebuild a comparison from its receipt alone: re-read the
 * archive commit marker, re-resolve both exact calls, re-derive every span
 * from the current source text, and re-score every claimed pair. Any
 * divergence is a named problem; nothing is shifted to a nearby offset,
 * segment, or call.
 */
export async function reconstructTranscriptComparison(
  raw: unknown,
  options: { fetcher?: FetchLike; signal?: AbortSignal } = {},
): Promise<TranscriptComparisonReconstruction> {
  const receipt = parseTranscriptComparisonReceipt(raw);
  if (!receipt) return { status: "failed", receipt_id: null, problems: [{ kind: "invalid_receipt", side: null }] };
  const { receipt_id: claimedId, ...body } = receipt;
  if ((await receiptId(body)) !== claimedId) {
    return { status: "failed", receipt_id: claimedId, problems: [{ kind: "invalid_receipt", side: null }] };
  }
  const loaded = await getRevisionVerifiedTranscripts(receipt.ticker, [receipt.calls.a.id, receipt.calls.b.id], options);
  if (loaded.status !== "ready") {
    return { status: "failed", receipt_id: claimedId, problems: [{ kind: "archive_unavailable", side: null }] };
  }
  const problems: TranscriptReconstructionProblem[] = [];
  const sides = {} as Record<CompareSide, { call_id: string; body_sha256: string; passages: ReconstructedPassage[] }>;
  const textBySpan = new Map<string, string>();
  (["a", "b"] as const).forEach((side, index) => {
    sides[side] = { call_id: receipt.calls[side].id, body_sha256: receipt.calls[side].body_sha256, passages: [] };
    const result = loaded.results[index];
    if (result.status === "not_covered") problems.push({ kind: "not_covered", side });
    else if (result.status === "stale_revision") problems.push({ kind: "stale_revision", side, reason: result.reason });
    else if (result.status === "unavailable") problems.push({ kind: "archive_unavailable", side });
    else if (result.document.revision.body_sha256 !== receipt.calls[side].body_sha256) {
      problems.push({
        kind: "revision_changed",
        side,
        receipt_body_sha256: receipt.calls[side].body_sha256,
        current_body_sha256: result.document.revision.body_sha256 ?? "",
      });
    }
  });
  if (problems.length) return { status: "failed", receipt_id: claimedId, problems };
  for (const [index, side] of (["a", "b"] as const).entries()) {
    const result = loaded.results[index];
    if (result.status !== "ready") continue;
    const document = result.document;
    for (const ref of receipt.spans[side]) {
      const segment = document.transcript.segments[ref.segment_index];
      if (!segment) {
        problems.push({ kind: "segment_missing", side, span_id: ref.span_id });
        continue;
      }
      const start = utf16Offset(segment.text, ref.start_byte);
      const end = utf16Offset(segment.text, ref.end_byte);
      const rebuilt = start === null || end === null
        ? null
        : await makeTranscriptSpan(document.revision, ref.segment_index, segment.text, start, end);
      if (!rebuilt || rebuilt.span_id !== ref.span_id || rebuilt.segment_text_sha256 !== ref.segment_text_sha256) {
        problems.push({ kind: "span_mismatch", side, span_id: ref.span_id });
        continue;
      }
      const text = segment.text.slice(start!, end!);
      textBySpan.set(ref.span_id, text);
      sides[side].passages.push({ span_id: ref.span_id, segment_index: ref.segment_index, speaker: segment.speaker, role: segment.role, text });
    }
  }
  const pairs = receipt.alignment?.pairs ?? [];
  for (const pair of pairs) {
    const aText = textBySpan.get(pair.a);
    const bText = textBySpan.get(pair.b);
    if (aText === undefined || bText === undefined) continue; // already reported as a span problem
    const recomputed = compareOverlapScore(aText, bText);
    if (recomputed.score !== pair.score || recomputed.score < ALIGN_MIN_SCORE || recomputed.shared_terms < ALIGN_MIN_SHARED_TERMS) {
      problems.push({ kind: "pair_unsupported", side: null, a: pair.a, b: pair.b });
    }
  }
  if (problems.length) return { status: "failed", receipt_id: claimedId, problems };
  return {
    status: "verified",
    receipt_id: claimedId,
    ticker: receipt.ticker,
    archive_generated_at: loaded.generated_at,
    sides,
    pairs: pairs.map((pair) => ({ ...pair })),
  };
}

// ── share link (references and filter only, never text) ───────────────────

export const TRANSCRIPT_COMPARE_URL_KEYS = ["txc", "txcq", "txcs", "txcsec", "txcm"] as const;

export interface TranscriptCompareLinkCall {
  id: string;
  /** First 12 hex of the body SHA-256 the link was made against, when known. */
  sha12: string | null;
}

export interface TranscriptCompareLink {
  ticker: string;
  a: TranscriptCompareLinkCall;
  b: TranscriptCompareLinkCall;
  filter: CompareFilter;
  mode: CompareMode;
}

function encodeCall(call: TranscriptCompareLinkCall): string {
  return call.sha12 && SHA12.test(call.sha12) ? `${call.id}.${call.sha12}` : call.id;
}

function decodeCall(value: string): TranscriptCompareLinkCall | null {
  const match = /^(\d{4}Q[1-4])(?:\.([a-f0-9]{12}))?$/.exec(value);
  if (!match || !normalizeTranscriptSearchId(match[1])) return null;
  return { id: match[1], sha12: match[2] ?? null };
}

/** Write (or with `null`, remove) the comparison keys on a URLSearchParams. */
export function writeTranscriptCompareParams(params: URLSearchParams, link: TranscriptCompareLink | null): void {
  for (const key of TRANSCRIPT_COMPARE_URL_KEYS) params.delete(key);
  if (!link) return;
  params.set("txc", `${link.ticker}_${encodeCall(link.a)}_${encodeCall(link.b)}`);
  const filter = normalizeCompareFilter(link.filter);
  if (filter.query.trim()) params.set("txcq", filter.query);
  if (filter.speaker) params.set("txcs", filter.speaker);
  if (filter.section !== "all") params.set("txcsec", filter.section);
  if (link.mode === "align") params.set("txcm", "align");
}

/** Parse the comparison keys; any malformed identity yields null (never a guessed call). */
export function readTranscriptCompareParams(params: URLSearchParams): TranscriptCompareLink | null {
  const values = params.getAll("txc");
  if (values.length !== 1) return null;
  const parts = values[0].split("_");
  if (parts.length !== 3 || !TICKER.test(parts[0])) return null;
  const a = decodeCall(parts[1]);
  const b = decodeCall(parts[2]);
  if (!a || !b || a.id === b.id) return null;
  const section = params.get("txcsec");
  return {
    ticker: parts[0],
    a,
    b,
    filter: normalizeCompareFilter({
      query: params.get("txcq") ?? "",
      speaker: params.get("txcs"),
      section: section === "prepared" || section === "qa" ? section : "all",
    }),
    mode: params.get("txcm") === "align" ? "align" : "side",
  };
}
