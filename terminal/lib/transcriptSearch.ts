/**
 * Revision-verified, lexical transcript retrieval.
 *
 * The public archive's root index is the commit marker.  A body is usable only
 * when its canonical JSON hash equals the root's advertised revision.  This is
 * intentionally a small, deterministic foundation for the richer reader: no
 * model call, embedding, inferred citation, or opaque relevance score lives
 * here.
 */

import { normalizeCompanyIntelligenceSymbol } from "./companyIntelligence";
import { normalizeTranscript, transcriptBodyUrl, type Transcript, type TxSegment } from "./fund";

export const TRANSCRIPT_REVISION_ROOT_URL = "/data/tx/index.json";
export const TRANSCRIPT_SPAN_SCHEMA = "mastermind.tx-span/v1" as const;
export const TRANSCRIPT_SPAN_LOCATOR_SCHEMA = "mastermind.tx-span-locator/v1" as const;

const TRANSCRIPT_ID = /^\d{4}Q[1-4]$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROOT_SYMBOLS = 20_000;
const MAX_ROOT_BODIES = 200_000;
const MAX_CALLS_PER_SYMBOL = 256;
const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 12 * 1024 * 1024;
const MAX_SEARCH_DOCUMENTS = 48;
const MAX_SEARCH_RESULTS = 160;
const MAX_QUERY_CHARS = 240;

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

export interface TranscriptRevisionRef {
  ticker: string;
  id: string;
  /** Canonical, decompressed `mastermind.tx/v1` JSON SHA-256. */
  body_sha256: string | null;
  date: string | null;
}

export interface TranscriptRevisionRoot {
  schema: "mastermind.tx-index/v1";
  generated_at: string;
  calls_by_ticker: ReadonlyMap<string, readonly TranscriptRevisionRef[]>;
}

/**
 * Server-resolvable source coordinates. They deliberately remain beside the
 * opaque receipt ID: an ID alone must never be parsed into authority.
 */
export interface TranscriptSpanLocator {
  schema: typeof TRANSCRIPT_SPAN_LOCATOR_SCHEMA;
  /** Stable public document key: `<ticker>/<fiscal-period>`. */
  document_key: string;
  body_sha256: string;
  segment_index: number;
  start_byte: number;
  end_byte: number;
  /** SHA-256 of the full UTF-8 segment text used by this byte range. */
  segment_text_sha256: string;
}

export type TranscriptSpan = Omit<TranscriptSpanLocator, "schema"> & {
  schema: typeof TRANSCRIPT_SPAN_SCHEMA;
  /** Opaque `txs1_<sha256(canonical locator)>` source reference. */
  span_id: string;
  ticker: string;
  transcript_id: string;
};

/** A source-search result can open the existing reader at an exact verified segment. */
export interface TranscriptOpenTarget {
  id: string;
  segment_index?: number;
  expected_document_sha256?: string;
  query?: string;
}

export interface RevisionVerifiedTranscript {
  transcript: Transcript;
  revision: TranscriptRevisionRef;
  transition_index: number | null;
  qa_start_index: number | null;
  transition_reason: TranscriptQaChapter["transition_reason"];
  qa_start_reason: TranscriptQaChapter["qa_start_reason"];
}

export type TranscriptRevisionResult =
  | { status: "ready"; document: RevisionVerifiedTranscript }
  | { status: "not_covered"; ticker: string; id: string }
  | { status: "stale_revision"; ticker: string; id: string; reason: TranscriptStaleRevisionReason }
  | { status: "unavailable"; message: string };

export type TranscriptStaleRevisionReason =
  | "root_revision_missing"
  | "body_missing"
  | "body_invalid"
  | "body_hash_mismatch";

export interface TranscriptQaChapter {
  /** The management/IR handoff into Q&A, which is not itself a question turn. */
  transition_index: number | null;
  /** The first confirmed operator intake or explicit analyst turn. */
  qa_start_index: number | null;
  transition_reason: "explicit_transition" | "none";
  qa_start_reason: "operator_intake" | "analyst_turn" | "standalone_operator_intake" | "standalone_analyst_turn" | "none";
}

export interface TranscriptSearchQuery {
  raw: string;
  phrases: string[];
  tokens: string[];
}

export interface TranscriptSearchMatch {
  kind: "quoted_phrase" | "literal" | "token";
  term: string;
  span: TranscriptSpan;
}

export interface TranscriptSearchHit {
  ticker: string;
  transcript_id: string;
  period: string;
  date: string | null;
  title: string;
  revision: string;
  segment_index: number;
  speaker: string;
  role: string;
  section: "prepared" | "qa_transition" | "qa" | "unknown";
  excerpt: string;
  matches: TranscriptSearchMatch[];
  phrase_matches: number;
  token_coverage: number;
}

export type TickerTranscriptSearchResult =
  | {
    status: "ready";
    ticker: string;
    query: TranscriptSearchQuery;
    hits: TranscriptSearchHit[];
    searched_documents: number;
    total_documents: number;
    stale_revisions: Array<{ id: string; reason: TranscriptStaleRevisionReason }>;
    /** Root-listed bodies that could not be read at all; never silently omitted. */
    unavailable_documents: string[];
    truncated: boolean;
  }
  | { status: "not_covered"; ticker: string; query: TranscriptSearchQuery }
  | {
    status: "stale_revision";
    ticker: string;
    query: TranscriptSearchQuery;
    stale_revisions: Array<{ id: string; reason: TranscriptStaleRevisionReason }>;
  }
  | { status: "unavailable"; ticker: string; query: TranscriptSearchQuery; message: string };

function object(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeTranscriptTicker(value: unknown): string | null {
  return typeof value === "string" ? normalizeCompanyIntelligenceSymbol(value) : null;
}

export function normalizeTranscriptSearchId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim().toUpperCase() : "";
  return TRANSCRIPT_ID.test(id) ? id : null;
}

/**
 * Validates the archive-wide commit marker.  `revisions` is an extension of
 * the older public index; callers can still recognise true absence without it,
 * but cannot treat an unversioned document as current.
 */
export function normalizeTranscriptRevisionRoot(raw: unknown): TranscriptRevisionRoot | null {
  const root = object(raw);
  if (!root || root.schema !== "mastermind.tx-index/v1" || typeof root.generated_at !== "string") return null;
  const symbols = object(root.symbols);
  if (!symbols || Object.keys(symbols).length > MAX_ROOT_SYMBOLS) return null;
  const revisions = root.revisions === undefined ? null : object(root.revisions);
  const dates = root.dates === undefined ? null : object(root.dates);
  if ((root.revisions !== undefined && !revisions) || (root.dates !== undefined && !dates)) return null;

  const knownPairs = new Set<string>();
  const callsByTicker = new Map<string, readonly TranscriptRevisionRef[]>();
  let bodyCount = 0;
  for (const [rawTicker, rawIds] of Object.entries(symbols)) {
    const ticker = normalizeTranscriptTicker(rawTicker);
    if (!ticker || ticker !== rawTicker || !Array.isArray(rawIds) || rawIds.length > MAX_CALLS_PER_SYMBOL) return null;
    const ids = new Set<string>();
    const calls: TranscriptRevisionRef[] = [];
    for (const rawId of rawIds) {
      const id = normalizeTranscriptSearchId(rawId);
      if (!id || ids.has(id)) return null;
      ids.add(id);
      bodyCount += 1;
      if (bodyCount > MAX_ROOT_BODIES) return null;
      const pair = `${ticker}/${id}`;
      knownPairs.add(pair);
      const rawRevision = revisions?.[pair];
      const bodySha = rawRevision === undefined
        ? null
        : typeof rawRevision === "string" && SHA256.test(rawRevision) ? rawRevision : undefined;
      if (bodySha === undefined) return null;
      const rawDate = dates?.[pair];
      const date = rawDate === undefined ? null : validDate(rawDate) ? rawDate : undefined;
      if (date === undefined) return null;
      calls.push({ ticker, id, body_sha256: bodySha, date });
    }
    calls.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.id.localeCompare(a.id));
    callsByTicker.set(ticker, calls);
  }
  if (typeof root.body_count === "number" && (!Number.isInteger(root.body_count) || root.body_count !== bodyCount)) return null;

  // A revision/dates extension may not advertise detached or malformed pairs.
  for (const [pair, value] of Object.entries(revisions ?? {})) {
    if (!knownPairs.has(pair) || typeof value !== "string" || !SHA256.test(value)) return null;
  }
  for (const [pair, value] of Object.entries(dates ?? {})) {
    if (!knownPairs.has(pair) || !validDate(value)) return null;
  }
  return { schema: "mastermind.tx-index/v1", generated_at: root.generated_at, calls_by_ticker: callsByTicker };
}

function canonicalJson(value: unknown): string | null {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : null;
  if (Array.isArray(value)) {
    const entries = value.map(canonicalJson);
    return entries.every((entry): entry is string => entry !== null) ? `[${entries.join(",")}]` : null;
  }
  const record = object(value);
  if (!record) return null;
  const entries: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const serialized = canonicalJson(record[key]);
    if (serialized === null) return null;
    entries.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${entries.join(",")}}`;
}

async function sha256Utf8(value: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Canonical SHA-256 matches the producer's sorted UTF-8 JSON receipt. */
export async function canonicalTranscriptBodySha256(raw: unknown): Promise<string | null> {
  const canonical = canonicalJson(raw);
  return canonical === null ? null : sha256Utf8(canonical);
}

async function fetchRoot(fetcher: FetchLike, signal?: AbortSignal): Promise<TranscriptRevisionRoot | "unavailable"> {
  try {
    const response = await fetcher(TRANSCRIPT_REVISION_ROOT_URL, {
      cache: "no-store",
      headers: { accept: "application/json", "cache-control": "no-store" },
      signal,
    });
    if (!response.ok) return "unavailable";
    const raw: unknown = await response.json();
    return normalizeTranscriptRevisionRoot(raw) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

async function readBounded(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function decodeGzipJson(response: Response): Promise<unknown | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_COMPRESSED_BYTES) return null;
  }
  const Decompress = globalThis.DecompressionStream;
  if (!response.body || typeof Decompress !== "function") return null;
  try {
    const bytes = await readBounded(response.body.pipeThrough(new Decompress("gzip")), MAX_DECOMPRESSED_BYTES);
    if (!bytes) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function rootCall(root: TranscriptRevisionRoot, ticker: string, id: string): TranscriptRevisionRef | null {
  return root.calls_by_ticker.get(ticker)?.find((candidate) => candidate.id === id) ?? null;
}

async function fetchRevisionFromRoot(
  root: TranscriptRevisionRoot,
  ticker: string,
  id: string,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<TranscriptRevisionResult> {
  const revision = rootCall(root, ticker, id);
  if (!revision) return { status: "not_covered", ticker, id };
  if (!revision.body_sha256) return { status: "stale_revision", ticker, id, reason: "root_revision_missing" };
  const url = transcriptBodyUrl(ticker, id);
  if (!url) return { status: "not_covered", ticker, id };
  let response: Response;
  try {
    response = await fetcher(url, {
      cache: "no-store",
      headers: { accept: "application/gzip", "cache-control": "no-store" },
      signal,
    });
  } catch {
    return { status: "unavailable", message: "Transcript body could not be reached" };
  }
  if (response.status === 404) return { status: "stale_revision", ticker, id, reason: "body_missing" };
  if (!response.ok) return { status: "unavailable", message: "Transcript body could not be reached" };
  const raw = await decodeGzipJson(response);
  const transcript = raw === null ? null : normalizeTranscript(raw, ticker, id);
  if (!transcript) return { status: "stale_revision", ticker, id, reason: "body_invalid" };
  const actualHash = await canonicalTranscriptBodySha256(raw);
  if (!actualHash || actualHash !== revision.body_sha256) {
    return { status: "stale_revision", ticker, id, reason: "body_hash_mismatch" };
  }
  const chapter = classifyTranscriptQaChapter(transcript.segments);
  return {
    status: "ready",
    document: {
      transcript,
      revision,
      transition_index: chapter.transition_index,
      qa_start_index: chapter.qa_start_index,
      transition_reason: chapter.transition_reason,
      qa_start_reason: chapter.qa_start_reason,
    },
  };
}

/** Fetch one document only after resolving its advertised root revision. */
export async function getRevisionVerifiedTranscript(
  symbol: string,
  rawId: string,
  options: { fetcher?: FetchLike; signal?: AbortSignal } = {},
): Promise<TranscriptRevisionResult> {
  const ticker = normalizeTranscriptTicker(symbol);
  const id = normalizeTranscriptSearchId(rawId);
  if (!ticker || !id) return { status: "unavailable", message: "Invalid transcript identity" };
  const root = await fetchRoot(options.fetcher ?? fetch, options.signal);
  if (root === "unavailable") return { status: "unavailable", message: "Transcript archive commit marker is unavailable" };
  return fetchRevisionFromRoot(root, ticker, id, options.fetcher ?? fetch, options.signal);
}

/**
 * Resolve several exact calls of one company against ONE read of the commit
 * marker, so every document in a comparison is bound to the same archive
 * generation. Each requested ID keeps its own result; an absent or stale call
 * is reported for that ID and never replaced by a neighbouring period.
 */
export async function getRevisionVerifiedTranscripts(
  symbol: string,
  rawIds: readonly string[],
  options: { fetcher?: FetchLike; signal?: AbortSignal } = {},
): Promise<
  | { status: "ready"; generated_at: string; results: TranscriptRevisionResult[] }
  | { status: "unavailable"; message: string }
> {
  const ticker = normalizeTranscriptTicker(symbol);
  const ids = rawIds.map(normalizeTranscriptSearchId);
  if (!ticker || !ids.length || ids.length > 8 || ids.some((id) => !id)) {
    return { status: "unavailable", message: "Invalid transcript identity" };
  }
  const fetcher = options.fetcher ?? fetch;
  const root = await fetchRoot(fetcher, options.signal);
  if (root === "unavailable") return { status: "unavailable", message: "Transcript archive commit marker is unavailable" };
  const results = await Promise.all(ids.map((id) => fetchRevisionFromRoot(root, ticker, id!, fetcher, options.signal)));
  return { status: "ready", generated_at: root.generated_at, results };
}

function isOperator(segment: TxSegment): boolean {
  return segment.role.trim().toLowerCase() === "operator" || segment.speaker.trim().toLowerCase() === "operator";
}

function isAnalyst(segment: TxSegment): boolean {
  return /(?:^|\b)(?:analyst|research)(?:\b|$)/i.test(segment.role);
}

/**
 * Conservative Q&A chapter classifier.
 *
 * A management/IR transition is merely a handoff. It becomes Q&A only after a
 * real operator intake or explicit analyst turn appears within the bounded
 * confirmation window. This keeps a stale "we will take questions" sentence
 * from reclassifying the rest of a malformed call as Q&A.
 */
export function classifyTranscriptQaChapter(segments: readonly TxSegment[]): TranscriptQaChapter {
  const confirmationWindow = 4;
  const explicitTransition = /\b(?:we\s+(?:will|are(?:\s+now)?\s+going\s+to)|we'll)\s+(?:now\s+)?(?:transition|move|open|begin|start)\s+(?:to|into)\s+(?:the\s+)?(?:q\s*(?:&|and)\s*a|questions?\s*(?:&|and)\s*answers?)\b|\b(?:this\s+concludes?\s+(?:our\s+)?prepared\s+remarks?|(?:we(?:'re|\s+are)|i(?:'m|\s+am))\s+happy|(?:[a-z]+(?:\s+and\s+(?:i|[a-z]+))?\s+will\s+be\s+happy))\b[\s\S]{0,180}\b(?:open\s+(?:the\s+)?call\s+for|take)\s+(?:your\s+)?questions?\b/i;
  const operatorIntake = /\b(?:our|the|your)\s+(?:first|next|last)\s+question\s+(?:comes?|is|will\s+(?:come|be))\b|\b(?:we\s+will|we'll)\s+(?:go\s+ahead\s+and\s+)?take\s+(?:our|the|your)\s+(?:first|next|last)\s+question\b/i;
  const intakeAt = (index: number): TranscriptQaChapter["qa_start_reason"] | null => {
    const segment = segments[index];
    if (isOperator(segment) && operatorIntake.test(segment.text)) return "operator_intake";
    if (isAnalyst(segment)) return "analyst_turn";
    return null;
  };
  let unresolvedTransition: number | null = null;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!explicitTransition.test(segment.text)) continue;
    for (let candidate = index + 1; candidate <= Math.min(segments.length - 1, index + confirmationWindow); candidate += 1) {
      const reason = intakeAt(candidate);
      if (reason) {
        return {
          transition_index: index,
          qa_start_index: candidate,
          transition_reason: "explicit_transition",
          qa_start_reason: reason,
        };
      }
    }
    // Preserve the first unmatched transition as a visible chapter cue, but
    // do not promote any later prose into Q&A without a fresh confirmation.
    unresolvedTransition ??= index;
  }
  // A declared transition is an assertion with a bounded proof obligation.
  // Do not let a much later operator sentence retroactively make it Q&A.
  if (unresolvedTransition !== null) {
    return {
      transition_index: unresolvedTransition,
      qa_start_index: null,
      transition_reason: "explicit_transition",
      qa_start_reason: "none",
    };
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (isOperator(segment) && operatorIntake.test(segment.text)) {
      return {
        transition_index: null,
        qa_start_index: index,
        transition_reason: "none",
        qa_start_reason: "standalone_operator_intake",
      };
    }
    if (isAnalyst(segment)) {
      return {
        transition_index: null,
        qa_start_index: index,
        transition_reason: "none",
        qa_start_reason: "standalone_analyst_turn",
      };
    }
  }
  return {
    transition_index: unresolvedTransition,
    qa_start_index: null,
    transition_reason: unresolvedTransition === null ? "none" : "explicit_transition",
    qa_start_reason: "none",
  };
}

function tokenize(value: string): string[] {
  return [...new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).filter(Boolean))];
}

/** Parse exact quotes plus a literal unquoted phrase and exact word tokens. */
export function parseTranscriptSearchQuery(value: string): TranscriptSearchQuery {
  const raw = value.trim().slice(0, MAX_QUERY_CHARS);
  const quoted: string[] = [];
  const residual = raw.replace(/"([^"\r\n]{1,240})"/g, (_match, phrase: string) => {
    const clean = phrase.trim();
    if (clean) quoted.push(clean);
    return " ";
  }).trim();
  const phrases = [...new Set([
    ...quoted.map((phrase) => `q:${phrase}`),
    ...(residual ? [`l:${residual}`] : []),
  ])];
  return { raw, phrases, tokens: tokenize(raw.replaceAll('"', " ")) };
}

function hasUnsafeUtf16Boundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return true;
  if (offset === 0 || offset === text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function utf8Offset(text: string, utf16Offset: number): number | null {
  return hasUnsafeUtf16Boundary(text, utf16Offset) ? null : new TextEncoder().encode(text.slice(0, utf16Offset)).byteLength;
}

/**
 * Canonical source coordinates used to derive the opaque span receipt. This is
 * also the validation boundary for any server-side span resolver.
 */
export function canonicalTranscriptSpanLocator(locator: TranscriptSpanLocator): string | null {
  if (locator.schema !== TRANSCRIPT_SPAN_LOCATOR_SCHEMA
    || !/^[A-Z0-9](?:[A-Z0-9.-]{0,14}[A-Z0-9])?\/\d{4}Q[1-4]$/.test(locator.document_key)
    || !SHA256.test(locator.body_sha256)
    || !SHA256.test(locator.segment_text_sha256)
    || !Number.isSafeInteger(locator.segment_index) || locator.segment_index < 0
    || !Number.isSafeInteger(locator.start_byte) || locator.start_byte < 0
    || !Number.isSafeInteger(locator.end_byte) || locator.end_byte <= locator.start_byte) return null;
  return canonicalJson({
    schema: locator.schema,
    document_key: locator.document_key,
    body_sha256: locator.body_sha256,
    segment_index: locator.segment_index,
    start_byte: locator.start_byte,
    end_byte: locator.end_byte,
    segment_text_sha256: locator.segment_text_sha256,
  });
}

/** Create a revision-bound, UTF-8 byte range source pointer and receipt. */
export async function makeTranscriptSpan(
  revision: Pick<TranscriptRevisionRef, "ticker" | "id" | "body_sha256">,
  segmentIndex: number,
  text: string,
  startUtf16: number,
  endUtf16: number,
): Promise<TranscriptSpan | null> {
  if (normalizeTranscriptTicker(revision.ticker) !== revision.ticker || !normalizeTranscriptSearchId(revision.id)
    || !revision.body_sha256 || !SHA256.test(revision.body_sha256) || !Number.isInteger(segmentIndex) || segmentIndex < 0
    || startUtf16 > endUtf16 || hasUnsafeUtf16Boundary(text, startUtf16) || hasUnsafeUtf16Boundary(text, endUtf16)) return null;
  const startByte = utf8Offset(text, startUtf16);
  const endByte = utf8Offset(text, endUtf16);
  if (startByte === null || endByte === null || endByte <= startByte) return null;
  const locator: TranscriptSpanLocator = {
    schema: TRANSCRIPT_SPAN_LOCATOR_SCHEMA,
    document_key: `${revision.ticker}/${revision.id}`,
    body_sha256: revision.body_sha256,
    segment_index: segmentIndex,
    start_byte: startByte,
    end_byte: endByte,
    segment_text_sha256: await sha256Utf8(text) ?? "",
  };
  const canonicalLocator = canonicalTranscriptSpanLocator(locator);
  const receiptHash = canonicalLocator === null ? null : await sha256Utf8(canonicalLocator);
  if (!receiptHash) return null;
  return {
    ...locator,
    schema: TRANSCRIPT_SPAN_SCHEMA,
    span_id: `txs1_${receiptHash}`,
    ticker: revision.ticker,
    transcript_id: revision.id,
  };
}

export function isTranscriptSpanId(value: unknown): value is `txs1_${string}` {
  return typeof value === "string" && /^txs1_[a-f0-9]{64}$/.test(value);
}

function excerpt(text: string, start: number, end: number): string {
  const left = Math.max(0, start - 96);
  const right = Math.min(text.length, end + 176);
  return `${left > 0 ? "…" : ""}${text.slice(left, right).trim()}${right < text.length ? "…" : ""}`;
}

function sectionForSegment(document: RevisionVerifiedTranscript, segmentIndex: number): TranscriptSearchHit["section"] {
  if (document.transition_index === segmentIndex) return "qa_transition";
  if (document.qa_start_index !== null && segmentIndex >= document.qa_start_index) return "qa";
  if (document.transition_index !== null || document.qa_start_index !== null) return "prepared";
  return "unknown";
}

async function searchDocument(document: RevisionVerifiedTranscript, query: TranscriptSearchQuery): Promise<TranscriptSearchHit[]> {
  if (!query.raw || (!query.phrases.length && !query.tokens.length)) return [];
  const output: TranscriptSearchHit[] = [];
  for (let segmentIndex = 0; segmentIndex < document.transcript.segments.length; segmentIndex += 1) {
    const segment = document.transcript.segments[segmentIndex];
    const lower = segment.text.toLocaleLowerCase();
    const tokenSet = new Set(tokenize(segment.text));
    const matches: TranscriptSearchMatch[] = [];
    let phraseMatches = 0;
    for (const phraseRef of query.phrases) {
      const kind = phraseRef.startsWith("q:") ? "quoted_phrase" : "literal";
      const phrase = phraseRef.slice(2);
      const start = lower.indexOf(phrase.toLocaleLowerCase());
      if (start < 0) continue;
      const span = await makeTranscriptSpan(document.revision, segmentIndex, segment.text, start, start + phrase.length);
      if (!span) continue;
      phraseMatches += 1;
      matches.push({ kind, term: phrase, span });
    }
    const matchedTokens = query.tokens.filter((token) => tokenSet.has(token));
    for (const token of matchedTokens) {
      const start = lower.indexOf(token);
      const span = start < 0 ? null : await makeTranscriptSpan(document.revision, segmentIndex, segment.text, start, start + token.length);
      if (span) matches.push({ kind: "token", term: token, span });
    }
    const tokenCoverage = query.tokens.length ? matchedTokens.length / query.tokens.length : 0;
    if (!phraseMatches && !tokenCoverage) continue;
    const first = matches[0]?.span;
    const matchStart = first ? (() => {
      const bytes = new TextEncoder().encode(segment.text);
      const decoder = new TextDecoder();
      return decoder.decode(bytes.slice(0, first.start_byte)).length;
    })() : 0;
    output.push({
      ticker: document.transcript.ticker,
      transcript_id: document.transcript.id,
      period: document.transcript.period,
      date: document.transcript.date,
      title: document.transcript.title,
      revision: document.revision.body_sha256!,
      segment_index: segmentIndex,
      speaker: segment.speaker,
      role: segment.role,
      section: sectionForSegment(document, segmentIndex),
      excerpt: excerpt(segment.text, matchStart, matchStart + 1),
      matches,
      phrase_matches: phraseMatches,
      token_coverage: tokenCoverage,
    });
  }
  return output;
}

async function mapConcurrent<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const run = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

/**
 * Exact, per-ticker lexical search. Ranking is intentionally fixed:
 * phrase matches, then token coverage, then newest fiscal call, then segment.
 */
export async function searchTickerTranscripts(
  symbol: string,
  rawQuery: string,
  options: { fetcher?: FetchLike; signal?: AbortSignal; maxDocuments?: number } = {},
): Promise<TickerTranscriptSearchResult> {
  const query = parseTranscriptSearchQuery(rawQuery);
  const ticker = normalizeTranscriptTicker(symbol);
  if (!ticker) return { status: "unavailable", ticker: String(symbol || ""), query, message: "Invalid ticker" };
  const fetcher = options.fetcher ?? fetch;
  const root = await fetchRoot(fetcher, options.signal);
  if (root === "unavailable") return { status: "unavailable", ticker, query, message: "Transcript archive commit marker is unavailable" };
  const calls = root.calls_by_ticker.get(ticker);
  if (!calls?.length) return { status: "not_covered", ticker, query };
  const limit = Math.max(1, Math.min(options.maxDocuments ?? MAX_SEARCH_DOCUMENTS, MAX_SEARCH_DOCUMENTS));
  const selected = calls.slice(0, limit);
  const results = await mapConcurrent(selected, 4, (ref) => fetchRevisionFromRoot(root, ticker, ref.id, fetcher, options.signal));
  const staleRevisions: Array<{ id: string; reason: TranscriptStaleRevisionReason }> = [];
  const unavailableDocuments: string[] = [];
  const documents: RevisionVerifiedTranscript[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "ready") documents.push(result.document);
    else if (result.status === "stale_revision") staleRevisions.push({ id: result.id, reason: result.reason });
    else if (result.status === "unavailable") unavailableDocuments.push(selected[index].id);
  }
  if (!documents.length && staleRevisions.length) return { status: "stale_revision", ticker, query, stale_revisions: staleRevisions };
  if (!documents.length) return { status: "unavailable", ticker, query, message: "Transcript bodies could not be reached" };
  const hits = (await Promise.all(documents.map((document) => searchDocument(document, query)))).flat().sort((a, b) =>
    b.phrase_matches - a.phrase_matches
    || b.token_coverage - a.token_coverage
    || (b.date ?? "").localeCompare(a.date ?? "")
    || b.transcript_id.localeCompare(a.transcript_id)
    || a.segment_index - b.segment_index
    || a.speaker.localeCompare(b.speaker),
  ).slice(0, MAX_SEARCH_RESULTS);
  return {
    status: "ready",
    ticker,
    query,
    hits,
    searched_documents: documents.length,
    total_documents: calls.length,
    stale_revisions: staleRevisions,
    unavailable_documents: [...new Set(unavailableDocuments)].sort((a, b) => b.localeCompare(a)),
    truncated: calls.length > selected.length,
  };
}
