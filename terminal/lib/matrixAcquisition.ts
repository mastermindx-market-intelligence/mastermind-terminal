/**
 * matrixAcquisition.ts — expected ORIGINAL producer byte identity for `matrix:{ROOT}`.
 *
 * The R2 matrix object is the producer's own bytes. When the server's GET reader opens
 * that exact object it may name what it read: a closed six-field
 * `options_structure.acquired_bytes/v1` marker carrying the ORIGINAL bytes' sha256 and
 * length — hashed once from the response bytes, never from any reserialization. The
 * backend's matrix answer is a reserialization and the backend has no Matrix identity
 * producer, so it never carries this marker (the GET reader strips any supplied one).
 *
 * This module is the read/validate side only, safe for server and client callers alike:
 * no fs, no fetch, no hashing, no clocks, no retention or rights assertions. An acquired
 * marker is EXPECTED source identity only — the actual server reopens the producer object
 * and authorizes that read separately. The payload contract itself
 * (options_structure.matrix/v1) is read by the desk (components/gexdesk/matrixDoc.ts);
 * this module deliberately repeats only the schema literal so it stays free of
 * component-land imports.
 */

/** The matrix payload schema this seam may speak for (matrixDoc's MATRIX_DOC_SCHEMA). */
export const MATRIX_SOURCE_SCHEMA = "options_structure.matrix/v1" as const;

/** The closed marker schema minted beside a directly acquired matrix payload. */
export const MATRIX_ACQUIRED_SCHEMA = "options_structure.acquired_bytes/v1" as const;

/** Identity capture is bounded by the protected source contract (16 MiB). A larger
 * valid payload stays fully displayable — it just names no bytes. */
export const MATRIX_ACQUIRED_BYTES_MAX = 16 * 1024 * 1024;

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * A real Gregorian calendar date in exact YYYY-MM-DD form. It must round-trip through
 * the calendar, so 2026-02-30 and 2026-13-01 fail while 2024-02-29 passes. Pure calendar
 * math — no wall clock, no freshness window.
 */
export function isGregorianDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const t = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/**
 * The matrix payload's own SESSION date — `_build_meta.asof_date`. The top-level `asof`
 * is the build clock and must never stand in for the session, so it is not read here at
 * all. Null when the payload carries no valid session date.
 */
export function matrixDocSession(value: unknown): string | null {
  if (!object(value)) return null;
  const meta = value._build_meta;
  if (!object(meta)) return null;
  return isGregorianDate(meta.asof_date) ? meta.asof_date : null;
}

/**
 * Expected ORIGINAL producer byte identity carried by a directly acquired `matrix:{ROOT}`
 * payload. Validates the exact closed six-field marker against the payload it rides on:
 * schema, root and source session must match the question, the session must be the
 * payload's own Gregorian `_build_meta.asof_date`, the stale field must be absent or boolean false, and
 * the byte identity must be a lowerhex sha256 plus a safe integer length within 16 MiB.
 * Returns null when any of that fails — including when the payload simply carries no
 * marker, which is an ordinary display read.
 *
 * This is expected source identity ONLY: not a retention, rights or freshness receipt,
 * and never a substitute for the server reopening and authorizing the actual bytes.
 */
export function acquiredMatrixBytes(raw: unknown, root: string, session: string): { sha256: string; bytes: number } | null {
  if (!object(raw) || (raw.stale !== undefined && raw.stale !== false)) return null;
  if (raw.schema !== MATRIX_SOURCE_SCHEMA || raw.root !== root) return null;
  if (matrixDocSession(raw) !== session) return null;
  const value = raw._matrix_source_identity;
  if (!object(value) || Object.keys(value).sort().join(",") !== "byte_length,kind,root,schema,session,sha256"
    || value.schema !== MATRIX_ACQUIRED_SCHEMA || value.kind !== "matrix" || value.root !== root
    || value.session !== session
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.byte_length) || Number(value.byte_length) < 1
    || Number(value.byte_length) > MATRIX_ACQUIRED_BYTES_MAX) return null;
  return { sha256: value.sha256, bytes: Number(value.byte_length) };
}
