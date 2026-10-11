/**
 * Company Intelligence private projection decoder - pure and browser-safe.
 *
 * This module performs no I/O, imports nothing server-only, and never calls fetch. It
 * only decides whether a value that the private server helper has already bounded and
 * parsed has the exact shape of the published source contract at 9bf268e
 * (engine/company_intelligence/issuer_disclosures.py, issuer_disclosure_selection.py,
 * app/company_disclosures.py).
 *
 * Two things this decoder deliberately does not claim:
 *   1. A reference (schema/SHA-256/byte length) inside a projection is discovery
 *      metadata, never a permission token. Format equality grants nothing.
 *   2. Nothing here computes or recomputes a hash. Comparing reference components is a
 *      structural comparison; the source owner, not the consumer, verifies content.
 *
 * Every refusal throws PrivateDecodeError carrying one fixed reason label declared in
 * this file. A rejected object's contents are never copied into the error, because a
 * value that failed its contract may still carry fields the caller has no right to
 * read back.
 */

export const PRIVATE_ISSUER_SELECTIONS_SCHEMA = 'company_intelligence.private_issuer_selections/v1';
export const PRIVATE_PRODUCT_INTEGRATION_SCHEMA = 'company_intelligence.private_product_integration/v1';
export const PRIVATE_ERROR_SCHEMA = 'company_intelligence.private_error/v1';
export const PRIVATE_FACT_SCHEMA = 'company_intelligence.product_integration_fact/v1';
export const PRIVATE_EDITION_SCHEMA = 'company_intelligence.issuer_disclosure_edition/v1';
export const PRIVATE_KIND = 'product_integration';
export const PRIVATE_LIFECYCLE = 'planned';
export const PRIVATE_IDENTITY_MODE = 'current';
export const PRIVATE_ISSUER_ROLE = 'subject_disclosing_company';
export const PRIVATE_AUTHORITY = 'context_only';

/** Bounds copied from the supplied native source. */
export const PRIVATE_MAX_SELECTIONS = 16;
export const PRIVATE_MAX_OBJECT_BYTES = 16 * 1024;
export const PRIVATE_MAX_REVISION = 64;
export const PRIVATE_MAX_IDENTIFIER_LENGTH = 256;
export const PRIVATE_MAX_SCOPE_BYTES = 256;
export const PRIVATE_ISSUER_MAX_LENGTH = 128;
export const PRIVATE_FACT_ID_PREFIX = 'integration:';
export const PRIVATE_ISSUER_PREFIX = 'ISS:';

export interface PrivateReference {
  readonly schema: string;
  readonly sha256: string;
  readonly byte_length: number;
}

export interface PrivateIssuerBinding {
  readonly issuer_id: string;
  readonly evidenced_cik: string;
  readonly identity_snapshot_reference: PrivateReference;
}

export interface PrivateSelectionEntry {
  readonly fact_id: string;
  readonly fact_reference: PrivateReference;
  readonly edition_reference: PrivateReference;
  readonly kind: typeof PRIVATE_KIND;
  readonly lifecycle: typeof PRIVATE_LIFECYCLE;
}

export interface PrivateIssuerSelections {
  readonly schema: typeof PRIVATE_ISSUER_SELECTIONS_SCHEMA;
  readonly generation: string;
  readonly identity_mode: typeof PRIVATE_IDENTITY_MODE;
  readonly issuer_role: typeof PRIVATE_ISSUER_ROLE;
  readonly issuer_binding: PrivateIssuerBinding;
  readonly selections: readonly PrivateSelectionEntry[];
}

/**
 * The granted field subset of a native fact. Only fact_id/kind/lifecycle are
 * mandatory; every optional native field may be absent, and an absent magnitude field
 * is never required to be present or null.
 */
export interface PrivateFactFields {
  readonly fact_id: string;
  readonly kind: typeof PRIVATE_KIND;
  readonly lifecycle: typeof PRIVATE_LIFECYCLE;
  readonly revision?: number;
  readonly subject_id?: string;
  readonly object_id?: string;
  readonly product?: string;
  readonly platform?: string;
  readonly amount?: null;
  readonly economic_share?: null;
}

export interface PrivateProductIntegration {
  readonly schema: typeof PRIVATE_PRODUCT_INTEGRATION_SCHEMA;
  readonly fact: PrivateFactFields;
  readonly reference: PrivateReference;
  readonly edition: PrivateReference;
  readonly generation: string;
  readonly authority: typeof PRIVATE_AUTHORITY;
}

/** Closed machine codes the mounted private transport can emit, with their status. */
export type PrivateErrorCode =
  | 'REQUEST_INVALID'
  | 'AUTHENTICATION_REQUIRED'
  | 'ENTITLEMENT_REQUIRED'
  | 'AUTHENTICATION_UNAVAILABLE'
  | 'PRIVATE_SERVICE_UNAVAILABLE'
  | 'SOURCE_RUNTIME_UNAVAILABLE'
  | 'PRIVATE_SOURCE_UNAVAILABLE'
  | 'SOURCE_NOT_ADMITTED';

export interface PrivateErrorPayload {
  readonly schema: typeof PRIVATE_ERROR_SCHEMA;
  readonly code: PrivateErrorCode;
  readonly automatic_retry_permitted: false;
}

export type PrivateDecodeReason =
  | 'OBJECT'
  | 'KEYSET'
  | 'SCHEMA'
  | 'IDENTIFIER'
  | 'DIGEST'
  | 'INTEGER'
  | 'CIK'
  | 'LIMIT'
  | 'ORDER'
  | 'VALUE'
  | 'REFERENCE'
  | 'MAGNITUDE'
  | 'TEXT'
  | 'STATUS'
  | 'RETRY'
  | 'BINDING'
  | 'IDENTITY'
  | 'COMPOSITION';

/** Bounded refusal: the message is a fixed label, never data from the rejected value. */
export class PrivateDecodeError extends Error {
  readonly reason: PrivateDecodeReason;

  constructor(reason: PrivateDecodeReason) {
    super('company_intelligence_private_' + reason);
    this.name = 'PrivateDecodeError';
    this.reason = reason;
  }
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/;
const DIGITS_10 = /^[0-9]{10}$/;
const ALL_ZEROS = /^0+$/;
const ASCII_LETTER_OR_DIGIT = /^[A-Za-z0-9]$/;
const IDENTIFIER_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.:/-';
const ASCII_TWO_LETTERS = /^[A-Za-z]{2}$/;
const MIC_SHAPE = /^[A-Za-z0-9]{4}$/;
const LISTING_CODE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const LISTING_KEY_PARTS = /^([^-]*)-([^-]*)-(.*)$/;
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * The MIC set is closed on purpose in lib/dataos/identity.py; the issuer id shape a
 * canonical Data OS issuer can carry is bounded here exactly as far as that supplied
 * source establishes. This is input validation only: it asserts no identity binding,
 * mints nothing, and never turns a well-formed string into a permission.
 */
const KNOWN_MICS = ['BATS', 'XNYS', 'XNAS', 'XASE', 'ARCX', 'XSHG', 'XSHE', 'XBSE', 'XHKG', 'XTSE', 'XTSX'];

const FACT_MANDATORY_KEYS = ['fact_id', 'kind', 'lifecycle'] as const;
const FACT_OPTIONAL_KEYS = ['revision', 'subject_id', 'object_id', 'product', 'platform', 'amount', 'economic_share'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function closedObject(value: unknown, closedKeys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw new PrivateDecodeError('OBJECT');
  const keys = Object.keys(value);
  if (keys.length !== closedKeys.length) throw new PrivateDecodeError('KEYSET');
  for (const key of keys) {
    if (!closedKeys.includes(key)) throw new PrivateDecodeError('KEYSET');
  }
  return value;
}

function subsetObject(value: unknown, mandatory: readonly string[], optional: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw new PrivateDecodeError('OBJECT');
  const allowed = mandatory.concat(optional);
  const keys = Object.keys(value);
  if (keys.length > allowed.length) throw new PrivateDecodeError('KEYSET');
  for (const key of keys) {
    if (!allowed.includes(key)) throw new PrivateDecodeError('KEYSET');
  }
  for (const key of mandatory) {
    if (!keys.includes(key)) throw new PrivateDecodeError('KEYSET');
  }
  return value;
}

function nativeIdentifier(value: unknown): string {
  if (typeof value !== 'string') throw new PrivateDecodeError('IDENTIFIER');
  if (value.length < 1 || value.length > PRIVATE_MAX_IDENTIFIER_LENGTH) throw new PrivateDecodeError('IDENTIFIER');
  if (!ASCII_LETTER_OR_DIGIT.test(value.charAt(0))) throw new PrivateDecodeError('IDENTIFIER');
  for (const character of value) {
    if (!IDENTIFIER_CHARACTERS.includes(character)) throw new PrivateDecodeError('IDENTIFIER');
  }
  return value;
}

function nativeDigest(value: unknown): string {
  if (typeof value !== 'string' || !LOWER_HEX_64.test(value)) throw new PrivateDecodeError('DIGEST');
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new PrivateDecodeError('INTEGER');
  if (value < minimum || value > maximum) throw new PrivateDecodeError('INTEGER');
  return value;
}

function evidencedCik(value: unknown): string {
  if (typeof value !== 'string' || !DIGITS_10.test(value)) throw new PrivateDecodeError('CIK');
  if (ALL_ZEROS.test(value)) throw new PrivateDecodeError('CIK');
  return value;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Native fact scope text: non-empty, at most 256 characters and 256 UTF-8 bytes, untrimmed rejected. */
function nativeScopeText(value: unknown): string {
  if (typeof value !== 'string') throw new PrivateDecodeError('TEXT');
  if (value.length < 1) throw new PrivateDecodeError('TEXT');
  if (value !== value.trim()) throw new PrivateDecodeError('TEXT');
  // TextEncoder replaces lone surrogates; native UTF-8 encoding rejects them.
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) throw new PrivateDecodeError('TEXT');
  }
  if (Array.from(value).length > PRIVATE_MAX_SCOPE_BYTES) throw new PrivateDecodeError('TEXT');
  if (utf8ByteLength(value) > PRIVATE_MAX_SCOPE_BYTES) throw new PrivateDecodeError('TEXT');
  return value;
}

function nativeFactId(value: unknown): string {
  const identifier = nativeIdentifier(value);
  if (!identifier.startsWith(PRIVATE_FACT_ID_PREFIX)) throw new PrivateDecodeError('VALUE');
  if (!LOWER_HEX_64.test(identifier.slice(PRIVATE_FACT_ID_PREFIX.length))) throw new PrivateDecodeError('VALUE');
  return identifier;
}

function canonicalIssuerIdentifier(value: unknown): string {
  if (typeof value !== 'string') throw new PrivateDecodeError('IDENTIFIER');
  if (value.length > PRIVATE_ISSUER_MAX_LENGTH) throw new PrivateDecodeError('IDENTIFIER');
  nativeIdentifier(value);
  if (!value.startsWith(PRIVATE_ISSUER_PREFIX)) throw new PrivateDecodeError('IDENTIFIER');
  const match = LISTING_KEY_PARTS.exec(value.slice(PRIVATE_ISSUER_PREFIX.length));
  if (match === null) throw new PrivateDecodeError('IDENTIFIER');
  const country = match[1];
  const mic = match[2];
  let tail = match[3];
  if (!ASCII_TWO_LETTERS.test(country) || !MIC_SHAPE.test(mic)) throw new PrivateDecodeError('IDENTIFIER');
  if (!KNOWN_MICS.includes(mic.toUpperCase())) throw new PrivateDecodeError('IDENTIFIER');
  if (tail.length === 0) throw new PrivateDecodeError('IDENTIFIER');
  const dot = tail.lastIndexOf('.');
  if (dot > 0 && dot < tail.length - 1) {
    const digits = tail.slice(dot + 1);
    if (DIGITS_ONLY.test(digits)) {
      if (Number.parseInt(digits, 10) < 2) throw new PrivateDecodeError('IDENTIFIER');
      tail = tail.slice(0, dot);
    }
  }
  if (!LISTING_CODE.test(tail)) throw new PrivateDecodeError('IDENTIFIER');
  return value;
}

/** Structural shape test used by the server helper before the fixed owner fetch. */
export function isCanonicalIssuerShape(value: unknown): value is string {
  try {
    canonicalIssuerIdentifier(value);
    return true;
  } catch (error) {
    if (error instanceof PrivateDecodeError) return false;
    throw error;
  }
}

export function isFactIdShape(value: unknown): value is string {
  try {
    nativeFactId(value);
    return true;
  } catch (error) {
    if (error instanceof PrivateDecodeError) return false;
    throw error;
  }
}

/** An exact native content reference: fixed schema for its position, SHA-256, 1..16384 bytes. */
function decodeNativeReference(value: unknown, expectedSchema: string): PrivateReference {
  const record = closedObject(value, ['schema', 'sha256', 'byte_length']);
  if (record.schema !== expectedSchema) throw new PrivateDecodeError('REFERENCE');
  return Object.freeze({
    schema: expectedSchema,
    sha256: nativeDigest(record.sha256),
    byte_length: boundedInteger(record.byte_length, 1, PRIVATE_MAX_OBJECT_BYTES),
  });
}

/**
 * The identity snapshot reference names whatever actual receipt schema the incumbent
 * identity owner supplied; no Data OS snapshot contract is invented or hardcoded here.
 */
function decodeSnapshotReference(value: unknown): PrivateReference {
  const record = closedObject(value, ['schema', 'sha256', 'byte_length']);
  return Object.freeze({
    schema: nativeIdentifier(record.schema),
    sha256: nativeDigest(record.sha256),
    byte_length: boundedInteger(record.byte_length, 1, PRIVATE_MAX_OBJECT_BYTES),
  });
}

function sameReference(left: PrivateReference, right: PrivateReference): boolean {
  return left.schema === right.schema && left.sha256 === right.sha256 && left.byte_length === right.byte_length;
}

function sameSelectionEntry(left: PrivateSelectionEntry, right: PrivateSelectionEntry): boolean {
  return left.fact_id === right.fact_id
    && sameReference(left.fact_reference, right.fact_reference)
    && sameReference(left.edition_reference, right.edition_reference)
    && left.kind === right.kind
    && left.lifecycle === right.lifecycle;
}

function decodeFactFields(value: unknown): PrivateFactFields {
  const fact = subsetObject(value, FACT_MANDATORY_KEYS, FACT_OPTIONAL_KEYS);
  if (fact.kind !== PRIVATE_KIND || fact.lifecycle !== PRIVATE_LIFECYCLE) throw new PrivateDecodeError('VALUE');
  const draft: {
    fact_id: string;
    kind: typeof PRIVATE_KIND;
    lifecycle: typeof PRIVATE_LIFECYCLE;
    revision?: number;
    subject_id?: string;
    object_id?: string;
    product?: string;
    platform?: string;
    amount?: null;
    economic_share?: null;
  } = { fact_id: nativeFactId(fact.fact_id), kind: PRIVATE_KIND, lifecycle: PRIVATE_LIFECYCLE };
  if ('revision' in fact) draft.revision = boundedInteger(fact.revision, 1, PRIVATE_MAX_REVISION);
  if ('subject_id' in fact) draft.subject_id = nativeIdentifier(fact.subject_id);
  if ('object_id' in fact) draft.object_id = nativeIdentifier(fact.object_id);
  if (draft.subject_id !== undefined && draft.object_id !== undefined && draft.subject_id === draft.object_id) {
    throw new PrivateDecodeError('IDENTITY');
  }
  if ('product' in fact) draft.product = nativeScopeText(fact.product);
  if ('platform' in fact) draft.platform = nativeScopeText(fact.platform);
  if ('amount' in fact) {
    if (fact.amount !== null) throw new PrivateDecodeError('MAGNITUDE');
    draft.amount = null;
  }
  if ('economic_share' in fact) {
    if (fact.economic_share !== null) throw new PrivateDecodeError('MAGNITUDE');
    draft.economic_share = null;
  }
  return Object.freeze(draft);
}

function decodeSelectionEntries(value: unknown): readonly PrivateSelectionEntry[] {
  if (!Array.isArray(value)) throw new PrivateDecodeError('VALUE');
  if (value.length > PRIVATE_MAX_SELECTIONS) throw new PrivateDecodeError('LIMIT');
  const entries: PrivateSelectionEntry[] = [];
  let previous = '';
  for (const [index, element] of value.entries()) {
    const record = closedObject(element, ['fact_id', 'fact_reference', 'edition_reference', 'kind', 'lifecycle']);
    const factId = nativeFactId(record.fact_id);
    if (record.kind !== PRIVATE_KIND || record.lifecycle !== PRIVATE_LIFECYCLE) throw new PrivateDecodeError('VALUE');
    const factReference = decodeNativeReference(record.fact_reference, PRIVATE_FACT_SCHEMA);
    const editionReference = decodeNativeReference(record.edition_reference, PRIVATE_EDITION_SCHEMA);
    // Sorted and unique is the source ordering contract: it also refuses duplicates.
    if (index > 0 && !(factId > previous)) throw new PrivateDecodeError('ORDER');
    previous = factId;
    entries.push(Object.freeze({
      fact_id: factId,
      fact_reference: factReference,
      edition_reference: editionReference,
      kind: PRIVATE_KIND,
      lifecycle: PRIVATE_LIFECYCLE,
    }));
  }
  return Object.freeze(entries);
}

/**
 * Decode one current issuer selection projection. A qualified empty list is valid and
 * stays empty; a malformed projection is a refusal, never an empty answer.
 */
export function decodePrivateIssuerSelections(value: unknown, expectedIssuerId: string): PrivateIssuerSelections {
  const root = closedObject(value, ['schema', 'generation', 'identity_mode', 'issuer_role', 'issuer_binding', 'selections']);
  if (root.schema !== PRIVATE_ISSUER_SELECTIONS_SCHEMA) throw new PrivateDecodeError('SCHEMA');
  if (root.identity_mode !== PRIVATE_IDENTITY_MODE) throw new PrivateDecodeError('VALUE');
  if (root.issuer_role !== PRIVATE_ISSUER_ROLE) throw new PrivateDecodeError('VALUE');
  const generation = nativeIdentifier(root.generation);
  const binding = closedObject(root.issuer_binding, ['issuer_id', 'evidenced_cik', 'identity_snapshot_reference']);
  const issuerId = canonicalIssuerIdentifier(binding.issuer_id);
  // The expected issuer is the caller's already-resolved company context; a projection
  // that names any other issuer is refused. The shape of a CIK grants nothing.
  if (issuerId !== expectedIssuerId) throw new PrivateDecodeError('BINDING');
  const cik = evidencedCik(binding.evidenced_cik);
  const snapshot = decodeSnapshotReference(binding.identity_snapshot_reference);
  const selections = decodeSelectionEntries(root.selections);
  return Object.freeze({
    schema: PRIVATE_ISSUER_SELECTIONS_SCHEMA,
    generation,
    identity_mode: PRIVATE_IDENTITY_MODE,
    issuer_role: PRIVATE_ISSUER_ROLE,
    issuer_binding: Object.freeze({
      issuer_id: issuerId,
      evidenced_cik: cik,
      identity_snapshot_reference: snapshot,
    }),
    selections,
  });
}

/**
 * Decode one current private product-integration fact. The expected fact id must match
 * exactly; the granted subset may omit every optional native field, so a fact decoded
 * here is not yet evidence that it belongs to any issuer selection.
 */
export function decodePrivateProductIntegration(value: unknown, expectedFactId: string): PrivateProductIntegration {
  const root = closedObject(value, ['schema', 'fact', 'reference', 'edition', 'generation', 'authority']);
  if (root.schema !== PRIVATE_PRODUCT_INTEGRATION_SCHEMA) throw new PrivateDecodeError('SCHEMA');
  if (root.authority !== PRIVATE_AUTHORITY) throw new PrivateDecodeError('VALUE');
  const generation = nativeIdentifier(root.generation);
  const reference = decodeNativeReference(root.reference, PRIVATE_FACT_SCHEMA);
  const edition = decodeNativeReference(root.edition, PRIVATE_EDITION_SCHEMA);
  const fact = decodeFactFields(root.fact);
  if (fact.fact_id !== expectedFactId) throw new PrivateDecodeError('BINDING');
  return Object.freeze({
    schema: PRIVATE_PRODUCT_INTEGRATION_SCHEMA,
    fact,
    reference,
    edition,
    generation,
    authority: PRIVATE_AUTHORITY,
  });
}

/** Status-bound allowlist mirrored from the mounted transport in app/company_disclosures.py. */
const KNOWN_PRIVATE_ERRORS: Readonly<Record<number, readonly PrivateErrorCode[]>> = Object.freeze({
  400: Object.freeze(['REQUEST_INVALID'] as const),
  401: Object.freeze(['AUTHENTICATION_REQUIRED'] as const),
  403: Object.freeze(['ENTITLEMENT_REQUIRED'] as const),
  502: Object.freeze(['AUTHENTICATION_UNAVAILABLE'] as const),
  503: Object.freeze(['PRIVATE_SERVICE_UNAVAILABLE', 'SOURCE_RUNTIME_UNAVAILABLE', 'PRIVATE_SOURCE_UNAVAILABLE', 'SOURCE_NOT_ADMITTED'] as const),
});

export function isKnownPrivateErrorPairing(status: number, code: string): code is PrivateErrorCode {
  const allowed = KNOWN_PRIVATE_ERRORS[status];
  if (allowed === undefined) return false;
  return allowed.includes(code as PrivateErrorCode);
}

/** The only bounded local error namespace this consumer may emit or forward. */
export function privateErrorPayload(code: PrivateErrorCode): PrivateErrorPayload {
  return Object.freeze({ schema: PRIVATE_ERROR_SCHEMA, code, automatic_retry_permitted: false });
}

/**
 * Decode a closed upstream error. An unknown code, a code bound to the wrong status,
 * a missing or extra key, or any retry permission is a refusal, not a pass-through.
 */
export function decodePrivateError(value: unknown, status: number): PrivateErrorPayload {
  if (!Number.isSafeInteger(status)) throw new PrivateDecodeError('STATUS');
  const root = closedObject(value, ['schema', 'code', 'automatic_retry_permitted']);
  if (root.schema !== PRIVATE_ERROR_SCHEMA) throw new PrivateDecodeError('SCHEMA');
  const code = root.code;
  if (typeof code !== 'string' || !isKnownPrivateErrorPairing(status, code)) throw new PrivateDecodeError('STATUS');
  if (root.automatic_retry_permitted !== false) throw new PrivateDecodeError('RETRY');
  return privateErrorPayload(code);
}

/**
 * The narrow selection-to-fact join the later admitted host calls before display.
 *
 * It requires what the native reader requires of a selected fact: the entry really
 * belongs to this snapshot, the fact is the entry's exact fact id, its subject_id is
 * present and equals the selection issuer, the fact and edition references match
 * component for component, and the generation matches. A caller cannot force an old
 * generation to stay authorized: any mismatch is a refusal.
 *
 * subject_id is mandatory here even though the generic fact decoder leaves every
 * optional granted field absent. This assertion compares projection metadata; it does
 * not recompute content hashes and it is not an admission decision.
 */
export function assertPrivateComposition(
  selection: PrivateIssuerSelections,
  entry: PrivateSelectionEntry,
  fact: PrivateProductIntegration,
): void {
  if (!isPlainObject(selection) || !isPlainObject(entry) || !isPlainObject(fact)) {
    throw new PrivateDecodeError('COMPOSITION');
  }
  if (!selection.selections.some((candidate) => sameSelectionEntry(candidate, entry))) {
    throw new PrivateDecodeError('COMPOSITION');
  }
  if (fact.fact.fact_id !== entry.fact_id) throw new PrivateDecodeError('COMPOSITION');
  const subjectId = fact.fact.subject_id;
  if (typeof subjectId !== 'string' || subjectId !== selection.issuer_binding.issuer_id) {
    throw new PrivateDecodeError('COMPOSITION');
  }
  if (!sameReference(fact.reference, entry.fact_reference)) throw new PrivateDecodeError('COMPOSITION');
  if (!sameReference(fact.edition, entry.edition_reference)) throw new PrivateDecodeError('COMPOSITION');
  if (fact.generation !== selection.generation) throw new PrivateDecodeError('COMPOSITION');
  if (entry.kind !== fact.fact.kind || entry.lifecycle !== fact.fact.lifecycle) {
    throw new PrivateDecodeError('COMPOSITION');
  }
}
