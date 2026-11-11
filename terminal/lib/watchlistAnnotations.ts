// E05 — the wire contract for cross-device watchlist notes and flags.
//
// Pure and dependency-free: the route, both store adapters and the client sync engine all import
// it, so one definition decides what a symbol, a note and a flag are. A note and a flag are two
// SEPARATE fields of one (account, symbol) record, each with its own revision, so edits to
// different fields never contend and edits to the same field go through a compare-and-set.
//
// Notes stay bounded user text (≤ 500, the length the context-menu textarea already enforces) and
// are kept apart from every signal/indicator field: nothing here reads or writes market data.

export const ANNOTATION_SCHEMA_VERSION = 1;
export const ANNOTATION_NOTE_MAX = 500;
export const ANNOTATION_SYMBOL_MAX = 128;
/** Writes per POST. The client chunks above this; the route refuses a larger batch. */
export const ANNOTATION_WRITE_BATCH_MAX = 100;
/** Rows per GET. A read that hits it is reported as INCOMPLETE, never as "everything else is empty". */
export const ANNOTATION_READ_LIMIT = 5000;
/**
 * Every request names the account the page believes it is syncing (its immutable user id). The
 * route refuses (409) when that is not the session's user, so a tab rendered for account A that
 * now carries account B's cookie can neither read B's rows into A's ledger nor write A's into B.
 */
export const ANNOTATION_OWNER_HEADER = "x-mm-annotation-owner";

export type AnnotationField = "note" | "flag";
export const ANNOTATION_FIELDS: readonly AnnotationField[] = ["note", "flag"];

/** One server record as the API serves it. A cleared field is `null` with its revision kept. */
export type AnnotationRecord = {
  symbol: string;
  note: string | null;
  noteRevision: number;
  noteUpdatedAt: string | null;
  flag: string | null;
  flagRevision: number;
  flagUpdatedAt: string | null;
};

/** One field write: "set `field` of `symbol` to `value`, provided the server is still at `baseRevision`". */
export type AnnotationWrite = {
  symbol: string;
  field: AnnotationField;
  /** `null` clears the field. */
  value: string | null;
  baseRevision: number;
};

export type AnnotationWriteStatus = "ok" | "conflict" | "invalid" | "error";

/**
 * Per-write answer. For `ok` the revision/value are what the server now holds for that field (the
 * write's own result, or — when the identical value was already there — the existing revision).
 * For `conflict` they are the CURRENT server field, so the client can show both texts.
 */
export type AnnotationWriteResult = {
  symbol: string;
  field: AnnotationField;
  status: AnnotationWriteStatus;
  revision: number;
  value: string | null;
  updatedAt: string | null;
};

export type AnnotationReadResponse = {
  schemaVersion: number;
  annotations: AnnotationRecord[];
  /** False when the read hit ANNOTATION_READ_LIMIT: absent rows are then unknown, not empty. */
  complete: boolean;
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// Notes are multi-line (the editor is a textarea), so newline and tab are the only control
// characters they may carry.
const NOTE_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FLAG_RE = /^#[0-9a-f]{6}$/;

/** The canonical symbol key (trimmed, upper-case, bounded). `null` when unusable. */
export function normalizeAnnotationSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  if (!symbol || symbol.length > ANNOTATION_SYMBOL_MAX || CONTROL_CHARS.test(symbol)) return null;
  return symbol;
}

export function isAnnotationField(value: unknown): value is AnnotationField {
  return value === "note" || value === "flag";
}

/**
 * The stored form of a field value. `undefined` means INVALID (refuse the write); `null` means
 * "clear". An empty or whitespace-only note is a clear, exactly as the note editor treats it.
 */
export function normalizeAnnotationValue(field: AnnotationField, value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (field === "flag") {
    const flag = value.trim().toLowerCase();
    return FLAG_RE.test(flag) ? flag : undefined;
  }
  if (!value.trim()) return null;
  // JS length counts UTF-16 units and Postgres counts code points, so ≤ 500 here implies ≤ 500
  // there; a CJK note of 500 characters is exactly 500 units.
  if (value.length > ANNOTATION_NOTE_MAX || NOTE_FORBIDDEN.test(value)) return undefined;
  return value;
}

export function normalizeRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_000_000_000 ? value : null;
}

export type NormalizedWriteBatch =
  | { ok: true; writes: AnnotationWrite[]; invalid: AnnotationWriteResult[] }
  | { ok: false; error: string };

/**
 * Parse a POST body. A malformed BODY is a 400; a malformed ITEM is answered as that item's
 * `invalid` result so one bad entry never sinks the batch around it. A batch that names the same
 * symbol+field twice is refused outright — two bases for one field cannot both be honest.
 */
export function normalizeWriteBatch(body: unknown): NormalizedWriteBatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid body" };
  const raw = (body as { writes?: unknown }).writes;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "writes required" };
  if (raw.length > ANNOTATION_WRITE_BATCH_MAX) return { ok: false, error: "batch too large" };
  const writes: AnnotationWrite[] = [];
  const invalid: AnnotationWriteResult[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const symbol = normalizeAnnotationSymbol(entry.symbol);
    const field = isAnnotationField(entry.field) ? entry.field : null;
    if (!symbol || !field) return { ok: false, error: "invalid write target" };
    const key = `${symbol}|${field}`;
    if (seen.has(key)) return { ok: false, error: "duplicate write target" };
    seen.add(key);
    const value = normalizeAnnotationValue(field, entry.value);
    const baseRevision = normalizeRevision(entry.baseRevision);
    if (value === undefined || baseRevision === null) {
      invalid.push({ symbol, field, status: "invalid", revision: 0, value: null, updatedAt: null });
      continue;
    }
    writes.push({ symbol, field, value, baseRevision });
  }
  return { ok: true, writes, invalid };
}

/** The current value/revision of one field of a record (absent record = never written). */
export function recordField(record: AnnotationRecord | null | undefined, field: AnnotationField): { value: string | null; revision: number; updatedAt: string | null } {
  if (!record) return { value: null, revision: 0, updatedAt: null };
  return field === "note"
    ? { value: record.note, revision: record.noteRevision, updatedAt: record.noteUpdatedAt }
    : { value: record.flag, revision: record.flagRevision, updatedAt: record.flagUpdatedAt };
}

/** Defensive parse of a GET body on the client. `null` = the body is not this contract. */
export function parseAnnotationReadResponse(body: unknown): AnnotationReadResponse | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (value.schemaVersion !== ANNOTATION_SCHEMA_VERSION || !Array.isArray(value.annotations)) return null;
  const annotations: AnnotationRecord[] = [];
  for (const item of value.annotations) {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const symbol = normalizeAnnotationSymbol(row.symbol);
    const noteRevision = normalizeRevision(row.noteRevision);
    const flagRevision = normalizeRevision(row.flagRevision);
    if (!symbol || noteRevision === null || flagRevision === null) return null;
    const note = row.note === null ? null : normalizeAnnotationValue("note", row.note);
    const flag = row.flag === null ? null : normalizeAnnotationValue("flag", row.flag);
    if (note === undefined || flag === undefined) return null;
    annotations.push({
      symbol,
      note,
      noteRevision,
      noteUpdatedAt: typeof row.noteUpdatedAt === "string" ? row.noteUpdatedAt : null,
      flag,
      flagRevision,
      flagUpdatedAt: typeof row.flagUpdatedAt === "string" ? row.flagUpdatedAt : null,
    });
  }
  return { schemaVersion: ANNOTATION_SCHEMA_VERSION, annotations, complete: value.complete !== false };
}

/** Defensive parse of a POST body on the client. `null` = the body is not this contract. */
export function parseAnnotationWriteResponse(body: unknown): AnnotationWriteResult[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { results?: unknown }).results)) return null;
  const results: AnnotationWriteResult[] = [];
  for (const item of (body as { results: unknown[] }).results) {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const symbol = normalizeAnnotationSymbol(row.symbol);
    const field = isAnnotationField(row.field) ? row.field : null;
    const status = row.status === "ok" || row.status === "conflict" || row.status === "invalid" || row.status === "error" ? row.status : null;
    const revision = normalizeRevision(row.revision);
    if (!symbol || !field || !status || revision === null) return null;
    const value = row.value === null || row.value === undefined ? null : normalizeAnnotationValue(field, row.value);
    if (value === undefined) return null;
    results.push({ symbol, field, status, revision, value, updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null });
  }
  return results;
}
