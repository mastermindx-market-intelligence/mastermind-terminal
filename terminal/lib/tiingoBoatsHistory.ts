/**
 * Strict framework-free parser for the `terminal.tiingo_boats_history.v1`
 * receipt-bound Tiingo BOATS REST 1-minute history export.
 *
 * The parser is total and refuse-only: any malformed field, wrong metadata
 * flag, invalid lineage reference, non-calendar timestamp or non-minute bar
 * boundary throws. Bad data is never coerced, defaulted or silently dropped.
 *
 * No Node/React imports: runs in any ES2020+ runtime under TypeScript strict
 * mode. Timestamp handling is pure integer civil-date math (no `Date`
 * parsing), so JS `Date` overflow normalization (e.g. 2026-02-31 rolling to
 * March) can never masquerade as a valid capture. America/New_York display
 * conversion uses `Intl.DateTimeFormat` (ICU tz data, DST-correct) as
 * specified.
 *
 * Tests: see tiingoBoatsHistory.test.ts
 *   npx vitest run tiingoBoatsHistory.test.ts
 */

/** Source-shaped bar tuple: [epoch, open, high, low, close, volume].
 * In results the epoch slot carries the America/New_York DISPLAY epoch (ET
 * wall-clock components treated as UTC); OHLCV stays the exact vendor numbers. */
export type BoatsHistoryBar = [number, number, number, number, number, number];

export interface TiingoBoatsHistoryResult {
  /** Bars in input order, epoch converted to the ET display epoch. */
  bars: BoatsHistoryBar[];
  /** Receipt IDs in input receipts order (receipt IDs are unique). */
  receiptIds: string[];
  /** observed_at_utc per receipt, aligned index-for-index with receiptIds. */
  observedAt: string[];
}

const METADATA_FLAGS: Readonly<Record<string, string>> = {
  schema: 'terminal.tiingo_boats_history.v1',
  source: 'tiingo-boats-rest',
  venue: 'BOATS',
  timestamp_basis: 'utc',
  price_basis: 'vendor_reported_unqualified',
  volume_basis: 'vendor_reported_shares',
  coverage: 'captured_vendor_bars_only',
};

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(METADATA_FLAGS),
  'symbol',
  'bar_seconds',
  'complete',
  'receipts',
  'bars',
  'bar_receipt_ids',
]);

const RECEIPT_KEYS: ReadonlySet<string> = new Set([
  'receipt_id',
  'raw_sha256',
  'observed_at_utc',
  'request_path',
]);

const MAX_BARS = 100_000;
const MAX_RECEIPTS = 512;

// Supported UTC window: [2000-01-01T00:00:00Z, 2100-01-01T00:00:00Z).
const MIN_EPOCH_SECONDS = 946_684_800;
const MAX_EPOCH_SECONDS = 4_102_444_800;

const HEX64 = /^[0-9a-f]{64}$/;
// Upper-case ticker that can be embedded verbatim in a request path.
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,31}$/;
// ISO-8601 with mandatory explicit zone: `Z` or +/-HH:MM.
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

function refuse(reason: string): never {
  throw new Error(`tiingo_boats_history: ${reason}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Days since 1970-01-01 for a proleptic-Gregorian civil date
 * (Hinnant's `days_from_civil`, integer-exact). Inputs are pre-validated. */
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** Pure-integer UTC epoch seconds for an already-validated civil date-time. */
function civilToEpochSeconds(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  return daysFromCivil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second;
}

/** Validate an ISO-8601 timestamp with an explicit zone and return the input
 * string. Calendar validity (month lengths, leap years, hour/minute/second
 * ranges) is checked by hand before any arithmetic, so a non-existent
 * calendar time is refused instead of being normalized into the next month. */
function requireIsoTimestamp(input: unknown, where: string): string {
  if (typeof input !== 'string') {
    refuse(`${where}.observed_at_utc must be an ISO-8601 timestamp string`);
  }
  const match = ISO_TIMESTAMP.exec(input);
  if (match === null) {
    refuse(
      `${where}.observed_at_utc ${JSON.stringify(input)} is not an ISO-8601 ` +
        'timestamp with an explicit zone (Z or +/-HH:MM)',
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[8];

  if (year < 2000 || year > 2100) {
    refuse(`${where}.observed_at_utc year ${year} is outside the supported 2000..2100 range`);
  }
  if (month < 1 || month > 12) {
    refuse(`${where}.observed_at_utc month ${match[2]} is not a calendar month`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    refuse(
      `${where}.observed_at_utc day ${match[3]} does not exist in ` +
        `${year}-${match[2]} (refusing calendar normalization)`,
    );
  }
  if (hour > 23 || minute > 59 || second > 59) {
    refuse(`${where}.observed_at_utc time ${match[4]}:${match[5]}:${match[6]} is not a valid wall clock`);
  }

  let offsetSeconds = 0;
  if (zone !== 'Z') {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) {
      refuse(`${where}.observed_at_utc zone offset ${zone} is not a valid UTC offset`);
    }
    offsetSeconds = (offsetHours * 3_600 + offsetMinutes * 60) * (zone[0] === '-' ? -1 : 1);
  }
  const epoch = civilToEpochSeconds(year, month, day, hour, minute, second) - offsetSeconds;
  if (epoch < MIN_EPOCH_SECONDS || epoch >= MAX_EPOCH_SECONDS) {
    refuse(`${where}.observed_at_utc must resolve into the 2000..2100 UTC range`);
  }
  return input;
}

// ICU tz data provides the DST rules; this formatter is the specified
// conversion surface (en-GB, America/New_York, 24-hour clock).
const ET_DISPLAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** America/New_York display epoch for a UTC bar epoch: the ET wall-clock
 * components (DST-correct) are reinterpreted as if they were UTC. */
function etDisplayEpoch(utcEpochSeconds: number): number {
  const parts = ET_DISPLAY_FORMATTER.formatToParts(new Date(utcEpochSeconds * 1_000));
  const fields = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== 'literal') fields.set(part.type, part.value);
  }
  const missing = ['year', 'month', 'day', 'hour', 'minute', 'second'].filter(
    (field) => !fields.has(field),
  );
  if (missing.length > 0) {
    refuse(`runtime Intl.DateTimeFormat did not provide ${missing.join(', ')} for America/New_York`);
  }
  return civilToEpochSeconds(
    Number(fields.get('year')),
    Number(fields.get('month')),
    Number(fields.get('day')),
    Number(fields.get('hour')),
    Number(fields.get('minute')),
    Number(fields.get('second')),
  );
}

function requireFiniteNumber(input: unknown, what: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    refuse(`${what} must be a finite number (booleans, null, strings and unknowns are refused)`);
  }
  return input;
}

function requireSymbol(input: unknown): string {
  if (typeof input !== 'string' || !SYMBOL.test(input)) {
    refuse(`symbol must be an upper-case ticker (got ${JSON.stringify(input)})`);
  }
  return input;
}

function requireRequestPath(input: unknown, symbol: string, where: string): string {
  if (typeof input !== 'string') {
    refuse(`${where}.request_path must be a string`);
  }
  if (input.length === 0 || input.length > 2_048 || /[\s\u0000-\u001f\u007f]/.test(input)) {
    refuse(`${where}.request_path must be a printable request path without whitespace`);
  }
  if (!input.startsWith(`/boats/${symbol}/prices?`)) {
    refuse(`${where}.request_path must begin /boats/${symbol}/prices? (got ${input})`);
  }
  const query = new URLSearchParams(input.slice(input.indexOf('?') + 1));
  const intervals = query.getAll('resampleFreq');
  if (input.includes('#') || intervals.length !== 1 || intervals[0] !== '1min') {
    refuse(`${where}.request_path must contain the resampleFreq=1min query parameter`);
  }
  return input;
}

/** Validate the receipts list; returns receipt_id -> observed_at_utc. */
function parseReceipts(input: unknown, symbol: string): Map<string, string> {
  if (!Array.isArray(input)) refuse('receipts must be an array');
  if (input.length > MAX_RECEIPTS) {
    refuse(`receipts has ${input.length} entries; the limit is ${MAX_RECEIPTS}`);
  }
  const observedAtById = new Map<string, string>();
  input.forEach((entry, index) => {
    const where = `receipts[${index}]`;
    if (!isPlainObject(entry)) refuse(`${where} must be an object`);
    for (const key of Object.keys(entry)) {
      if (!RECEIPT_KEYS.has(key)) refuse(`${where} has unexpected field "${key}"`);
    }
    const receiptId = entry.receipt_id;
    if (typeof receiptId !== 'string' || !HEX64.test(receiptId)) {
      refuse(`${where}.receipt_id must be 64 lowercase hex characters`);
    }
    const rawSha256 = entry.raw_sha256;
    if (typeof rawSha256 !== 'string' || !HEX64.test(rawSha256)) {
      refuse(`${where}.raw_sha256 must be 64 lowercase hex characters`);
    }
    const observedAt = requireIsoTimestamp(entry.observed_at_utc, where);
    requireRequestPath(entry.request_path, symbol, where);
    if (observedAtById.has(receiptId)) {
      refuse(`duplicate receipt_id ${receiptId} in receipts`);
    }
    observedAtById.set(receiptId, observedAt);
  });
  return observedAtById;
}

function parseBars(input: unknown): BoatsHistoryBar[] {
  if (!Array.isArray(input)) refuse('bars must be an array');
  if (input.length > MAX_BARS) {
    refuse(`bars has ${input.length} rows; the limit is ${MAX_BARS}`);
  }
  const bars: BoatsHistoryBar[] = [];
  let previousEpoch = Number.NEGATIVE_INFINITY;
  input.forEach((row, index) => {
    const where = `bars[${index}]`;
    if (!Array.isArray(row) || row.length !== 6) {
      refuse(`${where} must be [epoch, open, high, low, close, volume]`);
    }
    const [epoch, open, high, low, close, volume] = row as unknown[];

    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch)) {
      refuse(`${where} epoch must be an integer number of UTC seconds`);
    }
    if (epoch < MIN_EPOCH_SECONDS || epoch >= MAX_EPOCH_SECONDS) {
      refuse(`${where} epoch must fall in the 2000..2100 UTC range`);
    }
    if (epoch % 60 !== 0) {
      refuse(`${where} epoch must sit on a 60-second minute boundary`);
    }
    if (epoch <= previousEpoch) {
      refuse(`${where} epoch is not strictly ascending (duplicate or out-of-order UTC minute)`);
    }
    previousEpoch = epoch;

    const openPrice = requireFiniteNumber(open, `${where}.open`);
    const highPrice = requireFiniteNumber(high, `${where}.high`);
    const lowPrice = requireFiniteNumber(low, `${where}.low`);
    const closePrice = requireFiniteNumber(close, `${where}.close`);
    if (openPrice <= 0 || highPrice <= 0 || lowPrice <= 0 || closePrice <= 0) {
      refuse(`${where} OHLC prices must be positive`);
    }
    if (!(lowPrice <= Math.min(openPrice, closePrice) && Math.max(openPrice, closePrice) <= highPrice)) {
      refuse(`${where} must satisfy low <= min(open, close) <= max(open, close) <= high`);
    }
    const volumeShares = requireFiniteNumber(volume, `${where}.volume`);
    if (volumeShares < 0) {
      refuse(`${where}.volume must be non-negative`);
    }
    bars.push([epoch, openPrice, highPrice, lowPrice, closePrice, volumeShares]);
  });
  return bars;
}

function parseBarReceiptIds(
  input: unknown,
  barCount: number,
  knownReceiptIds: ReadonlySet<string>,
): string[][] {
  if (!Array.isArray(input)) refuse('bar_receipt_ids must be an array');
  if (input.length !== barCount) {
    refuse(`bar_receipt_ids must have exactly one entry per bar (${barCount})`);
  }
  return input.map((refs, index) => {
    const where = `bar_receipt_ids[${index}]`;
    if (!Array.isArray(refs)) refuse(`${where} must be an array of receipt IDs`);
    if (barCount > 0 && refs.length < 1) {
      refuse(`${where} is missing lineage: every captured bar needs at least one receipt`);
    }
    const validated: string[] = [];
    for (const ref of refs) {
      if (typeof ref !== 'string' || !HEX64.test(ref)) {
        refuse(`${where} contains a receipt ID that is not 64 lowercase hex characters`);
      }
      if (!knownReceiptIds.has(ref)) {
        refuse(`${where} references unknown receipt ${ref}`);
      }
      if (validated.includes(ref)) refuse(`${where} contains duplicate receipt lineage`);
      validated.push(ref);
    }
    return validated;
  });
}

/**
 * Parse a receipt-bound Tiingo BOATS REST history export.
 *
 * @param value The captured export object (schema `terminal.tiingo_boats_history.v1`).
 * @param symbol The exact requested upper-case ticker.
 * @returns Bars with ET display epochs (exact source OHLCV), receipt IDs and
 * their observed_at_utc values.
 * @throws Error on any malformed field, wrong flag, invalid lineage or
 * non-calendar time. Nothing is coerced or dropped.
 */
export function parseTiingoBoatsHistory(value: unknown, symbol: string): TiingoBoatsHistoryResult {
  const requestedSymbol = requireSymbol(symbol);
  if (!isPlainObject(value)) refuse('export must be a JSON object');

  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) refuse(`unexpected top-level field "${key}"`);
  }
  for (const [field, expected] of Object.entries(METADATA_FLAGS)) {
    if (value[field] !== expected) refuse(`${field} must be "${expected}"`);
  }

  const exportSymbol = requireSymbol(value.symbol);
  if (exportSymbol !== requestedSymbol) {
    refuse(`export symbol ${exportSymbol} does not match the requested symbol ${requestedSymbol}`);
  }
  if (value.bar_seconds !== 60) refuse('bar_seconds must be exactly 60');
  if (value.complete !== false) {
    refuse('complete must be exactly false: only captured vendor bars are exported');
  }

  const observedAtById = parseReceipts(value.receipts, requestedSymbol);
  const bars = parseBars(value.bars);
  parseBarReceiptIds(value.bar_receipt_ids, bars.length, new Set(observedAtById.keys()));

  // Source epochs are strictly ascending; the ET display mapping must stay
  // strictly ascending too. A fall-back DST collision (two UTC minutes that
  // share one America/New_York wall clock) is a refusal, never a silent merge.
  const displayBars: BoatsHistoryBar[] = [];
  let previousDisplay = Number.NEGATIVE_INFINITY;
  bars.forEach((bar, index) => {
    const display = etDisplayEpoch(bar[0]);
    if (display <= previousDisplay) {
      refuse(
        `bars[${index}] America/New_York display time collides with the previous bar ` +
          `(fall-back DST duplication at UTC epoch ${bar[0]})`,
      );
    }
    previousDisplay = display;
    displayBars.push([display, bar[1], bar[2], bar[3], bar[4], bar[5]]);
  });

  return {
    bars: displayBars,
    receiptIds: [...observedAtById.keys()],
    observedAt: [...observedAtById.values()],
  };
}
