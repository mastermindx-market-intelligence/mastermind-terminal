/**
 * Pure contracts for Research reading revision selection.
 *
 * A `ReadingSelection` pins one exact extracted revision of a document: the
 * document id, the source PDF sha256, the extracted-text sha256 and the
 * extractor/segmenter versions that produced it. Every surface below -
 * segment query, reopen URL, progress key - carries the full tuple, so a
 * cached segment or a stored progress entry can never be replayed against a
 * different revision. Pure module: no I/O, no network, nothing persisted,
 * and no request body is ever built.
 */

export type ReadingSelection = {
  docId: string;
  sourcePdfSha256: string;
  extractedTextSha256: string;
  extractorVersion: string;
  segmenterVersion: string;
};

/** A document was named, but its revision pins are unusable as-is. */
export type InvalidReadingRef = { docId: string; invalid: true };

/** null means no document was named at all. */
export type ParsedReadingUrl = ReadingSelection | InvalidReadingRef | null;

/** Segments requested per reading query. */
export const READING_MAX_SEGMENTS = 2;

const DOC_ID_PARAM = "doc_id";
const SOURCE_PDF_SHA256_PARAM = "source_pdf_sha256";
const EXTRACTED_TEXT_SHA256_PARAM = "extracted_text_sha256";
const EXTRACTOR_VERSION_PARAM = "extractor_version";
const SEGMENTER_VERSION_PARAM = "segmenter_version";
const SEGMENT_START_PARAM = "segment_start";
const MAX_SEGMENTS_PARAM = "max_segments";

const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

// "|" is excluded from every component pattern above, so joining with it
// keeps progress keys injective over the whole revision tuple.
const KEY_PREFIX = "reading-progress";
const KEY_SEPARATOR = "|";

function matchesEntire(value: string, pattern: RegExp): boolean {
  const match = pattern.exec(value);
  // "$" also matches just before one trailing newline, so a bare anchored
  // test would admit "doc\n"; comparing the full match rejects it.
  return match !== null && match[0] === value;
}

/** ASCII letters, digits, "_" and "-" with length 1..128. */
export function isDocId(value: unknown): value is string {
  return typeof value === "string" && matchesEntire(value, DOC_ID_PATTERN);
}

/** Exactly 64 lowercase hex characters. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && matchesEntire(value, SHA256_PATTERN);
}

/** Nonempty printable-ASCII version token, e.g. "extractor-1.4.2". */
export function isVersionToken(value: unknown): value is string {
  return typeof value === "string" && matchesEntire(value, VERSION_PATTERN);
}

/** Canonical hyphenated UUID, case-insensitive. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && matchesEntire(value, UUID_PATTERN);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSegmentStart(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates an unknown value as a complete ReadingSelection. Unknown extra
 * fields are dropped; a tuple missing or malforming any member is rejected
 * whole - partial pins are never upgraded to a selection.
 */
export function parseReadingSelection(input: unknown): ReadingSelection | null {
  if (!isRecord(input)) return null;
  const docId = input.docId;
  const sourcePdfSha256 = input.sourcePdfSha256;
  const extractedTextSha256 = input.extractedTextSha256;
  const extractorVersion = input.extractorVersion;
  const segmenterVersion = input.segmenterVersion;
  if (!isDocId(docId)) return null;
  if (!isSha256Hex(sourcePdfSha256) || !isSha256Hex(extractedTextSha256)) return null;
  if (!isVersionToken(extractorVersion) || !isVersionToken(segmenterVersion)) return null;
  return { docId, sourcePdfSha256, extractedTextSha256, extractorVersion, segmenterVersion };
}

function requireSelection(selection: ReadingSelection): void {
  if (parseReadingSelection(selection) === null) {
    throw new TypeError("readingContracts: invalid ReadingSelection tuple");
  }
}

/**
 * Builds the segment query for one exact revision. Throws TypeError unless
 * the selection is valid and `start` is a safe integer >= 0.
 *
 * The revision pins ride along on every page - including segment_start 0 -
 * so a fetch can never be answered from a different revision's cache.
 */
export function readingQuery(selection: ReadingSelection, start = 0): URLSearchParams {
  requireSelection(selection);
  if (!isSegmentStart(start)) {
    throw new TypeError("readingContracts: segment start must be a safe integer >= 0");
  }
  const params = new URLSearchParams();
  params.set(DOC_ID_PARAM, selection.docId);
  params.set(SOURCE_PDF_SHA256_PARAM, selection.sourcePdfSha256);
  params.set(EXTRACTED_TEXT_SHA256_PARAM, selection.extractedTextSha256);
  params.set(EXTRACTOR_VERSION_PARAM, selection.extractorVersion);
  params.set(SEGMENTER_VERSION_PARAM, selection.segmenterVersion);
  params.set(SEGMENT_START_PARAM, String(start));
  params.set(MAX_SEGMENTS_PARAM, String(READING_MAX_SEGMENTS));
  return params;
}

/**
 * Profile/origin-local progress key: one subject's position in one exact
 * revision. The key carries the whole validated tuple (account UUID, doc id,
 * both sha256 pins, extractor and segmenter versions) so distinct accounts,
 * documents, hashes or versions can never share a key. Only this key is
 * meant to persist in origin/profile-local storage - never a body. Throws
 * TypeError on an invalid subject or selection.
 */
export function progressKey(subject: string, selection: ReadingSelection): string {
  if (!isUuid(subject)) {
    throw new TypeError("readingContracts: subject must be a UUID");
  }
  requireSelection(selection);
  return [
    KEY_PREFIX,
    subject.toLowerCase(),
    selection.docId,
    selection.sourcePdfSha256,
    selection.extractedTextSha256,
    selection.extractorVersion,
    selection.segmenterVersion,
  ].join(KEY_SEPARATOR);
}

/**
 * Strictly reopens a reading from URL search params:
 *  - null when no document is named (no `doc_id`, or an empty one);
 *  - the validated selection when doc id, both sha256 pins and both
 *    extractor/segmenter versions are present and well-formed;
 *  - `{ docId, invalid: true }` when a document is named but any pin or
 *    version is missing or malformed - malformed or incomplete pins are
 *    surfaced to the caller, never silently dropped or defaulted.
 */
export function parseReadingUrl(params: URLSearchParams): ParsedReadingUrl {
  const docId = params.get(DOC_ID_PARAM);
  if (docId === null || docId.length === 0) return null;
  if (!isDocId(docId)) return { docId, invalid: true };
  const selection = parseReadingSelection({
    docId,
    sourcePdfSha256: params.get(SOURCE_PDF_SHA256_PARAM),
    extractedTextSha256: params.get(EXTRACTED_TEXT_SHA256_PARAM),
    extractorVersion: params.get(EXTRACTOR_VERSION_PARAM),
    segmenterVersion: params.get(SEGMENTER_VERSION_PARAM),
  });
  return selection ?? { docId, invalid: true };
}
