/**
 * Pure codec for shareable Options Tape filter state.
 *
 * The encoded string carries filter state only — never payload or event IDs,
 * account/auth state, or historical snapshot claims. The wire format is a
 * compact versioned JSON object with a strict whitelist: malformed state
 * decodes to null instead of silently widening the requested population.
 *
 * No dependencies, no React, no I/O.
 */

export type TapeDteBucket = '0d' | '1_7d' | '8_30d' | '31_90d' | '90p';

export type TapeMnyBucket = 'itm' | 'atm' | 'near_otm' | 'far_otm';

export type TapeViewState = {
  minPrem: number;
  dteBuckets: TapeDteBucket[];
  mnyBuckets: TapeMnyBucket[];
  groupFilter: string;
  drillTicker: string | null;
  tapeTickerSearch: string;
  sideFilter: string;
  flagFilter: string;
  sortKey: 'ts' | 'premium';
  sortDir: 1 | -1;
};

const ENCODED_VERSION = 1;
const MAX_ENCODED_LENGTH = 2048;
const MAX_GROUP_FILTER_CODE_POINTS = 80;

const MIN_PREM_WHITELIST: readonly number[] = [
  0, 100000, 250000, 500000, 1000000, 5000000,
];

const DTE_BUCKET_WHITELIST: readonly TapeDteBucket[] = [
  '0d',
  '1_7d',
  '8_30d',
  '31_90d',
  '90p',
];

const MNY_BUCKET_WHITELIST: readonly TapeMnyBucket[] = [
  'itm',
  'atm',
  'near_otm',
  'far_otm',
];

const SIDE_FILTER_WHITELIST: readonly string[] = ['', '~buy', '~sell', 'mixed'];

const FLAG_FILTER_WHITELIST: readonly string[] = ['', 'repeated', 'put_buy', 'swept'];

const SORT_KEY_WHITELIST: readonly string[] = ['ts', 'premium'];

/** Ticker roots and search roots: 1-10 chars, leading letter, A-Z 0-9 dot dash. */
const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** Control, format, surrogate, and line/paragraph separator code points. */
const NON_PRINTABLE_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

const STATE_KEYS = [
  'minPrem',
  'dteBuckets',
  'mnyBuckets',
  'groupFilter',
  'drillTicker',
  'tapeTickerSearch',
  'sideFilter',
  'flagFilter',
  'sortKey',
  'sortDir',
] as const;

const EXPECTED_KEY_COUNT = STATE_KEYS.length + 1; // state keys + "v"

type RawRecord = Record<string, unknown>;

function reject(detail: string): never {
  throw new Error(`optionsTapeView: ${detail}`);
}

function validateMinPrem(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject('minPrem must be a finite number');
  }
  if (!MIN_PREM_WHITELIST.includes(value)) {
    reject('minPrem is not one of the allowed thresholds');
  }
  return value;
}

/**
 * Bucket sets normalize to whitelist order and deduplicate. Returns a fresh
 * array on every call so callers can mutate the result freely.
 */
function normalizeBucketSet<T extends string>(
  value: unknown,
  whitelist: readonly T[],
  label: string,
): T[] {
  if (!Array.isArray(value)) {
    reject(`${label} must be an array`);
  }
  const selected = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !whitelist.includes(entry as T)) {
      reject(`${label} contains an unsupported bucket`);
    }
    selected.add(entry);
  }
  return whitelist.filter((bucket) => selected.has(bucket));
}

function validateGroupFilter(value: unknown): string {
  if (typeof value !== 'string') {
    reject('groupFilter must be a string');
  }
  if (value.length === 0) {
    return value;
  }
  if (NON_PRINTABLE_PATTERN.test(value)) {
    reject('groupFilter must not contain control characters');
  }
  if (Array.from(value).length > MAX_GROUP_FILTER_CODE_POINTS) {
    reject('groupFilter exceeds 80 characters');
  }
  return value;
}

function validateTickerRoot(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !TICKER_PATTERN.test(value)) {
    reject(`${label} must be null or an uppercase ticker root`);
  }
  return value;
}

function validateTickerSearch(value: unknown): string {
  if (typeof value !== 'string') {
    reject('tapeTickerSearch must be a string');
  }
  const normalized = value.trim().toUpperCase();
  if (Array.from(normalized).length > 80 || NON_PRINTABLE_PATTERN.test(value)) {
    reject('tapeTickerSearch must be printable and at most 80 characters');
  }
  // The existing Tape performs substring matching, including punctuation in
  // roots such as BRK.B. Keep that same population when sharing a view.
  return normalized;
}

function validateWhitelistedString(
  value: unknown,
  whitelist: readonly string[],
  label: string,
): string {
  if (typeof value !== 'string' || !whitelist.includes(value)) {
    reject(`${label} is not one of the allowed values`);
  }
  return value;
}

function validateSortDir(value: unknown): 1 | -1 {
  if (value !== 1 && value !== -1) {
    reject('sortDir must be 1 or -1');
  }
  return value as 1 | -1;
}

/**
 * Validates every field of a raw record against the whitelist and returns the
 * normalized view state with keys in canonical order.
 */
function normalizeState(raw: RawRecord): TapeViewState {
  const minPrem = validateMinPrem(raw.minPrem);
  const dteBuckets = normalizeBucketSet(raw.dteBuckets, DTE_BUCKET_WHITELIST, 'dteBuckets');
  const mnyBuckets = normalizeBucketSet(raw.mnyBuckets, MNY_BUCKET_WHITELIST, 'mnyBuckets');
  const groupFilter = validateGroupFilter(raw.groupFilter);
  const drillTicker = validateTickerRoot(raw.drillTicker, 'drillTicker');
  const tapeTickerSearch = validateTickerSearch(raw.tapeTickerSearch);
  const sideFilter = validateWhitelistedString(raw.sideFilter, SIDE_FILTER_WHITELIST, 'sideFilter');
  const flagFilter = validateWhitelistedString(raw.flagFilter, FLAG_FILTER_WHITELIST, 'flagFilter');
  const sortKey = validateWhitelistedString(raw.sortKey, SORT_KEY_WHITELIST, 'sortKey');
  const sortDir = validateSortDir(raw.sortDir);
  // The Tape ignores group while drilled, but retains it for clearing the
  // drill. Search remains applied. Preserve both rather than widening a view.
  return {
    minPrem,
    dteBuckets,
    mnyBuckets,
    groupFilter,
    drillTicker,
    tapeTickerSearch,
    sideFilter,
    flagFilter,
    sortKey: sortKey as TapeViewState['sortKey'],
    sortDir,
  };
}

/**
 * Strict shape check of a decoded payload: exactly the version key plus the
 * ten state keys, no unknown keys, no missing keys, known version.
 */
function parseEncoded(encoded: string): RawRecord {
  if (encoded.length > MAX_ENCODED_LENGTH) {
    reject('encoded state exceeds the maximum length');
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    reject('encoded state is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    reject('encoded state must be a JSON object');
  }
  const record = parsed as RawRecord;
  const keys = Object.keys(record);
  if (keys.length !== EXPECTED_KEY_COUNT) {
    reject('encoded state has an unexpected key set');
  }
  for (const key of keys) {
    if (key !== 'v' && !(STATE_KEYS as readonly string[]).includes(key)) {
      reject(`encoded state has an unknown key: ${key}`);
    }
  }
  for (const key of STATE_KEYS) {
    if (!(key in record)) {
      reject(`encoded state is missing key: ${key}`);
    }
  }
  if (record.v !== ENCODED_VERSION) {
    reject('encoded state has an unsupported version');
  }
  return record;
}

export function createDefaultTapeView(): TapeViewState {
  return {
    minPrem: 0,
    dteBuckets: [],
    mnyBuckets: [],
    groupFilter: '',
    drillTicker: null,
    tapeTickerSearch: '',
    sideFilter: '',
    flagFilter: '',
    sortKey: 'ts',
    sortDir: -1,
  };
}

/**
 * Encodes a view state as a compact versioned JSON object. Throws on invalid
 * state; the output is deterministic for a given normalized state.
 */
export function encodeTapeView(state: TapeViewState): string {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    reject('state must be an object');
  }
  const keys = Object.keys(state);
  if (keys.length !== STATE_KEYS.length || keys.some((key) => !(STATE_KEYS as readonly string[]).includes(key))) {
    reject('state has an unexpected key set');
  }
  const normalized = normalizeState(state as unknown as RawRecord);
  const encoded = JSON.stringify({ v: ENCODED_VERSION, ...normalized });
  if (encoded.length > MAX_ENCODED_LENGTH) {
    reject('encoded state exceeds the maximum length');
  }
  return encoded;
}

/**
 * Decodes an encoded view state. Never throws: any malformed, oversized,
 * unknown-version, or out-of-whitelist input returns null.
 */
export function decodeTapeView(encoded: string | null): TapeViewState | null {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    return null;
  }
  try {
    return normalizeState(parseEncoded(encoded));
  } catch {
    return null;
  }
}
