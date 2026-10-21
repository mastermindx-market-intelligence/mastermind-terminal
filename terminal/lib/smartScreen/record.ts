/**
 * The versioned account record of one smart screen (E04, AC-E04-03).
 *
 * Stored as ONE `workspace_settings` row per screen (scope 'user', key `scr_screen.<id>`) —
 * the existing account preference store, so no new table, service or migration. Each record
 * carries a monotonically increasing `rev`; every write is a compare-and-set against the rev
 * the writer last saw, which is what turns a second device's stale write into an explicit
 * conflict instead of a silent overwrite.
 *
 * Shared by the API (what it will store) and the client (what it will trust when read back).
 */

import { GRAMMAR_VERSION, normalizeDefinition, type ScreenDefinition } from "./predicate";
import { normalizeReview, REVIEW_VERSION, reviewableDefinition, type ReviewSnapshot } from "./review";

export const RECORD_SCHEMA = 1 as const;
export const SCREEN_KEY_PREFIX = "scr_screen.";
export const MAX_SCREENS = 10;
export const MAX_RECORD_BYTES = 16 * 1024;
export const MAX_NAME_CHARS = 40;
export const SCREEN_ID_RE = /^[0-9a-f]{32}$/;

export type ScreenRecord = {
  schema: 1;
  id: string;
  rev: number;
  name: string;
  def: ScreenDefinition;
  hash: string;
  createdAt: string;
  updatedAt: string;
  review: ReviewSnapshot | null;
};

/** A record this version cannot interpret (written by a newer Terminal). Shown read-only and
 *  never rewritten by this version — only deletable, with the same rev check. */
export type ReadOnlyScreen = { id: string; rev: number; name: string | null; schema: number };

export const screenKey = (id: string): string => `${SCREEN_KEY_PREFIX}${id}`;
export const isScreenKey = (key: unknown): key is string =>
  typeof key === "string" && key.startsWith(SCREEN_KEY_PREFIX) && SCREEN_ID_RE.test(key.slice(SCREEN_KEY_PREFIX.length));

/** Trim, collapse whitespace, strip control characters; 1..40 chars or null. */
export function normalizeScreenName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name || [...name].length > MAX_NAME_CHARS) return null;
  return name;
}

const isIso = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const isRev = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000_000_000;

export type ParsedRecord =
  | { kind: "ok"; record: ScreenRecord }
  | { kind: "newer"; screen: ReadOnlyScreen }
  | { kind: "invalid" };

/** Parse a stored value. A newer schema or grammar is surfaced as read-only, never coerced. */
export function parseScreenRecord(value: unknown, keyId?: string): ParsedRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "invalid" };
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" && SCREEN_ID_RE.test(v.id) ? v.id : null;
  if (!id || (keyId !== undefined && id !== keyId) || !isRev(v.rev)) return { kind: "invalid" };
  const def = v.def as Record<string, unknown> | undefined;
  const grammar = def && typeof def === "object" ? def.grammar : undefined;
  const reviewVersion = v.review && typeof v.review === "object" ? (v.review as Record<string, unknown>).v : undefined;
  const newer = (typeof v.schema === "number" && v.schema > RECORD_SCHEMA)
    || (typeof grammar === "number" && grammar > GRAMMAR_VERSION)
    || (typeof reviewVersion === "number" && reviewVersion > REVIEW_VERSION);
  if (newer) {
    return {
      kind: "newer",
      screen: { id, rev: v.rev, name: normalizeScreenName(v.name), schema: typeof v.schema === "number" ? v.schema : RECORD_SCHEMA },
    };
  }
  if (v.schema !== RECORD_SCHEMA) return { kind: "invalid" };
  const name = normalizeScreenName(v.name);
  const normalized = normalizeDefinition(v.def);
  if (!name || !normalized.ok || v.hash !== normalized.hash || !isIso(v.createdAt) || !isIso(v.updatedAt)) return { kind: "invalid" };
  let review: ReviewSnapshot | null = null;
  if (v.review !== null && v.review !== undefined) {
    const checked = normalizeReview(v.review, normalized.hash);
    if (!checked.ok || !reviewableDefinition(normalized.def)) return { kind: "invalid" };
    review = checked.review;
  }
  return {
    kind: "ok",
    record: {
      schema: RECORD_SCHEMA, id, rev: v.rev, name, def: normalized.def, hash: normalized.hash,
      createdAt: v.createdAt, updatedAt: v.updatedAt, review,
    },
  };
}

/** Byte size of a record as stored (UTF-8 JSON). */
export const recordBytes = (record: unknown): number => new TextEncoder().encode(JSON.stringify(record)).byteLength;

/** Fresh 128-bit client-proposed id — proposed by the client so a retried create is the SAME
 *  create (idempotent), not a duplicate screen. */
export function newScreenId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
