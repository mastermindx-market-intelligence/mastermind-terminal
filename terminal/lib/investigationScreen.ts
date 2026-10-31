/**
 * The boundary the Investigation transaction crosses to read ONE saved smart screen (E04).
 *
 * Investigation names a screen as evidence with a PINNED reference (owner
 * `terminal.smart_screen`, object_type `screen_definition`, one screen id, one version, one
 * fingerprint). This module is everything that crossing shares: it parses the capture the
 * transaction was asked for, recognises a reference that IS a screen-capture reference, and
 * turns the store's found response into the one saved record the reference names — or null.
 *
 * Pure and dependency-light on purpose: no I/O, no auth, no SQL, no effects, and no second
 * opinion about what a screen is. The owner parser (`parseScreenRecord`) stays the ONE
 * interpretation of a stored record; a body this Terminal cannot interpret (a newer schema,
 * grammar or review format, or a corrupt one) comes back null — never downgraded to a weaker
 * definition, never rewritten.
 *
 * Two things this module deliberately does NOT do:
 *   - It does not verify the fingerprint against the body. The reference tuple is compared
 *     as strings; recomputing and checking the body's retained fingerprint is the DB
 *     readback's job. Nothing here is a cryptographic proof of content.
 *   - It does not authenticate anybody. A parsed capture grants no admission by itself, and
 *     a returned record proves nothing about who asked. An accepted shape still needs the
 *     transaction's own authorization, like every other owner crossing.
 *
 * A retained screen carries `review: null` — evaluated rows and review history are not part
 * of a saved definition, so a body that still carries a review is refused, not trimmed.
 */

import type { InvestigationEvidenceRef } from "./investigationContracts";
import { isScreenRevision, parseScreenRecord, SCREEN_ID_RE, type ScreenRecord } from "./smartScreen/record";

/** The evidence owner and object_type of every saved-screen capture. */
export const SCREEN_EVIDENCE_OWNER = "terminal.smart_screen";
export const SCREEN_EVIDENCE_TYPE = "screen_definition";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
/** The reference fields: all six required, nothing else allowed. */
const REF_FIELDS = ["owner", "object_type", "object_id", "mode", "version_ref", "fingerprint"] as const;

/** What a client asks the transaction to capture: which screen, at the revision it last saw —
 *  so a stale capture fails the owner's compare-and-set instead of pinning something the
 *  user never saw. */
export type ScreenCapture = { screen_id: string; expected_revision: number };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Own enumerable keys exactly `fields` — a missing field and an extra field both fail. */
const hasExactly = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
};

/** Parse an untrusted capture. Own keys exactly `screen_id` and `expected_revision`: a
 *  missing field, an extra field, an upper-case or short id, a non-integer or out-of-range
 *  revision are all null, never trimmed into shape. The result is a fresh detached object
 *  holding only the two admitted values. */
export function parseScreenCapture(value: unknown): ScreenCapture | null {
  if (!isPlainObject(value) || !hasExactly(value, ["screen_id", "expected_revision"])) return null;
  const screen_id = value.screen_id;
  if (typeof screen_id !== "string" || !SCREEN_ID_RE.test(screen_id)) return null;
  const expected_revision = value.expected_revision;
  if (!isScreenRevision(expected_revision)) return null;
  return { screen_id, expected_revision };
}

/** Is this THE reference shape a screen capture may use — the screen evidence owner and
 *  object_type, `pinned` only (evidence must name one version that cannot move; a
 *  `follow_head` mode or a `selection` would let it change after the fact), a 32-lowercase-hex
 *  screen id, a lowercase UUID version and a lowercase sha-256 fingerprint? Own keys only:
 *  nothing extra, nothing missing, nothing optional. */
export function isScreenEvidenceReference(value: unknown): value is InvestigationEvidenceRef {
  if (!isPlainObject(value) || !hasExactly(value, REF_FIELDS)) return false;
  return value.owner === SCREEN_EVIDENCE_OWNER
    && value.object_type === SCREEN_EVIDENCE_TYPE
    && value.mode === "pinned"
    && typeof value.object_id === "string" && SCREEN_ID_RE.test(value.object_id)
    && typeof value.version_ref === "string" && UUID_RE.test(value.version_ref)
    && typeof value.fingerprint === "string" && FINGERPRINT_RE.test(value.fingerprint);
}

/** The store's answer for one pinned screen reference: `found:false` when that exact version
 *  is gone; when found, the reference tuple it resolved, the stored record body and the
 *  workspace_settings revision the body was read at. */
export type ScreenEvidenceLookup = {
  found: boolean;
  owner: string;
  object_type: string;
  object_id: string;
  mode: string;
  version_ref: string;
  fingerprint: string;
  source_revision: number;
  record: unknown;
};

const LOOKUP_FIELDS = ["found", ...REF_FIELDS, "source_revision", "record"] as const;

/** The retained saved screen behind a capture, or null.
 *
 *  Accepts ONLY a found lookup that is exactly the pinned reference asked for — every tuple
 *  field equal to `expectedRef`, so a different version, object or mode can never be read as
 *  the evidence — whose `source_revision` equals the revision inside the body, and whose body
 *  the owner parser accepts as a CURRENT record (`parseScreenRecord(record,
 *  expectedRef.object_id)` kind "ok"). Everything else is null: not found, a mismatched tuple
 *  field, a newer schema/grammar/review format, a corrupt body, a body whose id is not the
 *  referenced screen, a revision that disagrees — or a review still attached. Evaluated rows
 *  and review history are not part of a retained definition, so a present non-null review is
 *  refused, never stripped.
 *
 *  The fingerprint is compared as a reference string, NOT recomputed over the body — the DB
 *  readback owns that check. This function verifies no cryptography and authenticates no
 *  caller; it only refuses shapes the Investigation transaction must not treat as a retained
 *  screen. */
export function parseRetainedInvestigationScreen(raw: unknown, expectedRef: InvestigationEvidenceRef): ScreenRecord | null {
  if (!isScreenEvidenceReference(expectedRef)) return null;
  if (!isPlainObject(raw) || !hasExactly(raw, LOOKUP_FIELDS)) return null;
  if (raw.found !== true) return null;
  if (REF_FIELDS.some((field) => raw[field] !== expectedRef[field])) return null;
  const sourceRevision = raw.source_revision;
  if (typeof sourceRevision !== "number" || !Number.isSafeInteger(sourceRevision)) return null;
  const parsed = parseScreenRecord(raw.record, expectedRef.object_id);
  if (parsed.kind !== "ok") return null;
  const record = parsed.record;
  if (record.review !== null || record.rev !== sourceRevision) return null;
  return record;
}
