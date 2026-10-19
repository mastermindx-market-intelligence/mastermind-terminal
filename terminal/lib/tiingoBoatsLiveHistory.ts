// Server-only Terminal side of the private current-night BOATS history delivery.
//
// Two responsibilities, neither of which performs authentication, holds
// credentials, opens a network connection or spawns a subprocess:
//
//   1. `requestBoatsLiveHistory` records chart demand as a small interest
//      record under `<TIINGO_BOATS_LIVE_DIR>/requests/<vendorSymbol>.json`.
//      CALLER PLACEMENT CONTRACT (parent integration decision, 2026-10-19):
//      the Terminal route must invoke this AFTER the existing auth middleware
//      has admitted the request and BEFORE the cache layer, so demand is only
//      recorded for authenticated chart reads. This module performs no
//      authentication itself and simulates none — it cannot tell an
//      authenticated caller from an unauthenticated one and does not try.
//      Production credential provisioning stays on the Mac collector side;
//      the only observable precondition here is the preprovisioned private
//      root (root 700 with `requests/` and `bars/` subdirectories, 700).
//   2. `readBoatsLiveSnapshot` validates one strictly bounded snapshot from
//      `bars/<vendorSymbol>.json` into display-epoch raw minutes for the
//      store, which merges it with the baseline REST history and resamples
//      once after the raw-minute merge (`mergeBoatsLiveHistory`).
//
// Any IO, validation or capacity failure is a structured status, never an
// exception reaching the chart: every failure degrades to the existing
// baseline history path.
import { open, opendir, rename, rm, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { type Bar6, tfMinutes, INTRADAY_TFS } from "./intradayShared";
import { isUsEquityTradingDate, usEquitySessionAtDisplayEpoch } from "./usEquityCalendar";
import { parseTiingoBoatsHistory } from "./tiingoBoatsHistory";

// ── Contract constants (private current-night history contract v1) ──────────
const LIVE_SNAPSHOT_SCHEMA = "terminal.boats_live_history.v1";
const INTEREST_SCHEMA = "terminal.boats_history_interest.v1";
const INTEREST_STATUS_SCHEMA = "terminal.boats_history_interest_status.v1";
// bars/<vendorSymbol>.json is capped at 512 KiB and at most 480 vendor minute bars.
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_SNAPSHOT_BARS = 480;
// Interest records are single small objects; anything larger is not ours.
const MAX_INTEREST_BYTES = 4 * 1024;
// Active requests expire after 120s; per-symbol touches at most once per 30s.
const REQUEST_TTL_MS = 120_000;
const TOUCH_THROTTLE_MS = 30_000;
// At most 256 regular demand records under requests/.
const MAX_INTEREST_RECORDS = 256;
const MAX_DIRECTORY_ENTRIES = 1024;
// An observation stamp may not be in the future by more than 5 seconds.
const FUTURE_TOLERANCE_MS = 5_000;

// Same ticker grammar as the store reader and the strict history parser.
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,31}$/;

// Terminal's US A/B class shares use dots; Tiingo documents hyphens.
// Keep venue suffixes and other dotted identifiers literal, never guess a listing.
// https://www.tiingo.com/documentation/appendix/symbology
// Defined once here (symbology, not storage) and re-exported by the store for
// its existing public interface.
export function boatsVendorSymbol(symbol: string): string {
  return symbol.replace(/^([A-Z][A-Z0-9]{0,29})\.([AB])$/, "$1-$2");
}
// Demand record file names (temp files are dot-prefixed and never counted).
const INTEREST_FILE = /^([A-Z][A-Z0-9.-]{0,31})\.json$/;
// ISO-8601 with mandatory explicit zone: `Z` or +/-HH:MM (parser grammar).
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

const MINUTE_TFS: ReadonlySet<string> = new Set(INTRADAY_TFS);

// ── Small pure helpers ───────────────────────────────────────────────────────
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** Validate a strict real calendar date string; null when it does not exist
 * (JS Date overflow normalization can never validate a date for us). */
function validCalendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return value;
}

/** Strict ISO-8601 with an explicit zone (same grammar as the strict history
 * parser); returns the resolved UTC epoch milliseconds, or null. */
export function parseIsoEpochMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[8];
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMs = 0;
  if (zone !== "Z") {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return null;
    offsetMs = (offsetHours * 3_600 + offsetMinutes * 60) * 1_000 * (zone[0] === "-" ? -1 : 1);
  }
  const millis = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  return (daysFromCivil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second - offsetMs / 1000) * 1_000 + millis;
}

// ICU tz data owns the DST rules; the ET wall clock is read as UTC, the same
// display-epoch convention the strict history parser and the store use.
const ET_DISPLAY_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** America/New_York display epoch of a real UTC instant, or null. */
function etDisplayEpochFromUtcMs(utcMs: number): number | null {
  if (!Number.isFinite(utcMs)) return null;
  const parts = ET_DISPLAY_FORMATTER.formatToParts(new Date(utcMs));
  const fields = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== "literal") fields.set(part.type, part.value);
  }
  if (fields.size < 6) return null;
  const epoch = (daysFromCivil(Number(fields.get("year")), Number(fields.get("month")), Number(fields.get("day"))) * 86_400
    + Number(fields.get("hour")) * 3_600 + Number(fields.get("minute")) * 60 + Number(fields.get("second")));
  return Number.isFinite(epoch) ? epoch : null;
}

/**
 * The current-night BOATS session window for a trading date, in the app's
 * display epoch: [tradeDate-1 20:00, tradeDate 04:00) ET wall clock. The
 * overnight window is a fixed 20:00–04:00 ET wall span, so the display-epoch
 * arithmetic is date-only; the immutable NYSE calendar decides whether the
 * date is a trading date at all (holidays and weekends have no session).
 */
export function boatsLiveSessionWindow(sessionDate: string): [number, number] | null {
  const date = validCalendarDate(sessionDate);
  if (!date || !isUsEquityTradingDate(date)) return null;
  const dayStart = daysFromCivil(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))) * 86_400;
  return [dayStart - 4 * 3_600, dayStart + 4 * 3_600];
}

/**
 * Pure store-side merge: an accepted snapshot replaces the ENTIRE same-session
 * window of the baseline raw minutes and never blends conflicting
 * current-minute OHLCV or sums revisions. Baseline bars outside the snapshot
 * window (other sessions) are retained untouched. A window is present exactly
 * when a snapshot was accepted — including the authoritative empty snapshot,
 * whose window is vacated, never refilled from the baseline. Resampling
 * happens once, after this merge, in the store.
 */
export function mergeBoatsLiveHistory(
  baseMinutes: Bar6[],
  liveMinutes: Bar6[],
  window: readonly [number, number] | null,
): { minutes: Bar6[]; excluded_base_bars: number } {
  if (!window) return { minutes: baseMinutes, excluded_base_bars: 0 };
  const [start, end] = window;
  const kept: Bar6[] = [];
  let excluded = 0;
  for (const bar of baseMinutes) {
    if (bar[0] >= start && bar[0] < end) { excluded += 1; continue; }
    kept.push(bar);
  }
  return { minutes: [...kept, ...liveMinutes].sort((a, b) => a[0] - b[0]), excluded_base_bars: excluded };
}

// ── Snapshot reader (bars/) ──────────────────────────────────────────────────
export type BoatsLiveSnapshotStatus =
  | "disabled" | "missing" | "unreadable" | "malformed" | "stale" | "empty" | "applied";

export type BoatsLiveSnapshot = {
  status: BoatsLiveSnapshotStatus;
  session_date: string | null;
  observed_at_utc: string | null;
  content_sha256: string | null;
  receipt_ids: string[];
  /** Validated display-epoch raw minutes; empty unless applied or empty. */
  minutes: Bar6[];
  /** Display-epoch window of the snapshot session when applied or empty. */
  window: readonly [number, number] | null;
};

const SNAPSHOT_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(["schema", "session_date", "captured_at_utc", "history"]);

/**
 * Read and strictly validate the whole-session live snapshot for one vendor
 * symbol. Refuse-only: any wrapper, metadata, receipt, count, window,
 * recency or staleness violation degrades to a structured status with no
 * minutes, so the chart falls back to the baseline history. An empty provider
 * response is an authoritative empty current-window snapshot, not an error.
 */
export async function readBoatsLiveSnapshot(
  vendorSymbol: string,
  baseNewestObservedMs: number | null,
  nowMs: number,
): Promise<BoatsLiveSnapshot> {
  const none: Omit<BoatsLiveSnapshot, "status"> = {
    session_date: null, observed_at_utc: null, content_sha256: null, receipt_ids: [], minutes: [], window: null,
  };
  const done = (status: BoatsLiveSnapshotStatus, extra?: Partial<BoatsLiveSnapshot>): BoatsLiveSnapshot =>
    ({ ...none, ...extra, status });
  const root = process.env.TIINGO_BOATS_LIVE_DIR;
  if (!root) return done("disabled");
  if (!path.isAbsolute(root) || !SYMBOL.test(vendorSymbol)) return done("unreadable");
  if (!await provisionedLiveRoot(root)) return done("unreadable");
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let raw: Buffer;
  try {
    handle = await open(path.join(root, "bars", `${vendorSymbol}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) return done("malformed");
    if (stat.uid !== process.geteuid?.() || (stat.mode & 0o777) !== 0o600) return done("unreadable");
    // Bounded advertised-size read (+1 byte detects growth), same discipline
    // as the baseline store reader; a growing input fails validation.
    const buffer = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = await handle.read(buffer, count, buffer.length - count, count);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count !== stat.size) return done("malformed");
    raw = buffer.subarray(0, count);
  } catch (error: unknown) {
    return done((error as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unreadable");
  } finally { await handle?.close().catch(() => undefined); }
  const contentSha256 = createHash("sha256").update(raw).digest("hex");
  try {
    const value: unknown = JSON.parse(raw.toString("utf8"));
    if (!isPlainObject(value)) return done("malformed");
    for (const key of Object.keys(value)) {
      if (!SNAPSHOT_TOP_LEVEL_KEYS.has(key)) return done("malformed");
    }
    if (value.schema !== LIVE_SNAPSHOT_SCHEMA) return done("malformed");
    const sessionDate = validCalendarDate(value.session_date);
    if (!sessionDate) return done("malformed");
    // The immutable NYSE calendar owns session existence; a snapshot for a
    // holiday or weekend session is malformed, not silently rendered.
    const window = boatsLiveSessionWindow(sessionDate);
    if (!window) return done("malformed");
    const capturedAt = value.captured_at_utc;
    if (typeof capturedAt !== "string") return done("malformed");
    const capturedMs = parseIsoEpochMs(capturedAt);
    if (capturedMs == null || capturedMs > nowMs + FUTURE_TOLERANCE_MS) return done("malformed");
    const observedDisplay = etDisplayEpochFromUtcMs(capturedMs);
    if (observedDisplay == null || observedDisplay < window[0]) return done("malformed");
    const history = parseTiingoBoatsHistory(value.history, vendorSymbol);
    // The wrapper carries exactly one receipt lineage (or an explicitly
    // empty one) and the vendor minute-bar cap; the strict parser is
    // deliberately reused, never reimplemented or relaxed.
    if (history.bars.length > MAX_SNAPSHOT_BARS) return done("malformed");
    // Even an empty older snapshot must not revoke a newer archive window.
    if (baseNewestObservedMs != null && capturedMs < baseNewestObservedMs) return done("stale");
    if (history.bars.length === 0) {
      if (history.receiptIds.length !== 0) return done("malformed");
      return done("empty", { session_date: sessionDate, observed_at_utc: capturedAt, content_sha256: contentSha256, window });
    }
    if (history.receiptIds.length !== 1 || history.observedAt[0] !== capturedAt) return done("malformed");
    for (const bar of history.bars) {
      // Every actual vendor minute must sit inside this session's overnight
      // window and no bar may be later than the observation.
      if (bar[0] < window[0] || bar[0] >= window[1] || bar[0] > observedDisplay) return done("malformed");
    }
    return done("applied", {
      session_date: sessionDate, observed_at_utc: capturedAt, content_sha256: contentSha256,
      receipt_ids: history.receiptIds, minutes: history.bars, window,
    });
  } catch {
    return done("malformed");
  }
}

// ── Interest writer (requests/) ──────────────────────────────────────────────
export type BoatsInterestStatus = {
  schema: "terminal.boats_history_interest_status.v1";
  status: "disabled" | "unprovisioned" | "unsupported" | "coalesced" | "recorded" | "capacity" | "error";
  symbol: string;
  vendor_symbol: string;
  session_date: string | null;
  requested_at_utc: string | null;
  reason: string | null;
};

// Same-process serialized mutations: bounded scans, pruning and writes never
// interleave inside one Node process.
let mutationQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(task, task);
  mutationQueue = run.catch(() => undefined);
  return run;
}

// Per-symbol touch throttle is process-local politeness, keyed by root so
// concurrent test/workspaces never share a window.
const lastTouchAt = new Map<string, number>();

type InterestRecord = { schema: string; symbol: string; session_date: string; requested_at_utc: string };
const INTEREST_KEYS: ReadonlySet<string> = new Set(["schema", "symbol", "session_date", "requested_at_utc"]);

/** Strictly validate one interest record file; null when it is not ours. */
async function readInterestRecord(filePath: string): Promise<InterestRecord | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_INTEREST_BYTES || stat.size === 0
      || stat.uid !== process.geteuid?.() || (stat.mode & 0o777) !== 0o600) return null;
    const buffer = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = await handle.read(buffer, count, buffer.length - count, count);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count !== stat.size) return null;
    const value: unknown = JSON.parse(buffer.subarray(0, count).toString("utf8"));
    if (!isPlainObject(value)) return null;
    for (const key of Object.keys(value)) {
      if (!INTEREST_KEYS.has(key)) return null;
    }
    if (value.schema !== INTEREST_SCHEMA) return null;
    if (typeof value.symbol !== "string" || !SYMBOL.test(value.symbol)) return null;
    if (path.basename(filePath) !== `${value.symbol}.json`) return null;
    if (typeof value.session_date !== "string" || !validCalendarDate(value.session_date)) return null;
    if (typeof value.requested_at_utc !== "string" || parseIsoEpochMs(value.requested_at_utc) == null) return null;
    return value as InterestRecord;
  } catch {
    return null;
  } finally { await handle?.close().catch(() => undefined); }
}

/** Atomic same-directory replace: the record is written to a dot-prefixed
 * unique temp (mode 0600, O_EXCL) and renamed over the validated owned target.
 * A collision never authorizes deleting another writer's temporary file. */
async function writeInterestRecord(requestsDir: string, vendorSymbol: string, record: InterestRecord): Promise<void> {
  const temp = path.join(requestsDir, `.${vendorSymbol}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    created = true;
    await handle.writeFile(Buffer.from(JSON.stringify(record), "utf8"));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, path.join(requestsDir, `${vendorSymbol}.json`));
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    if (created) await rm(temp, { force: true }).catch(() => undefined);
  }
}

async function provisionedLiveRoot(root: string): Promise<string | null> {
  if (!path.isAbsolute(root)) return null;
  try {
    for (const part of [root, path.join(root, "requests"), path.join(root, "bars")]) {
      const stat = await lstat(part);
      if (!stat.isDirectory() || stat.uid !== process.geteuid?.() || (stat.mode & 0o777) !== 0o700) return null;
    }
  } catch {
    return null;
  }
  return path.join(root, "requests");
}

/**
 * Record current-night BOATS chart demand for one symbol/timeframe.
 *
 * Caller placement (parent integration decision, 2026-10-19): invoke AFTER
 * the route's existing auth check and BEFORE the cache layer. This function
 * never authenticates and never fabricates a candle; it only records demand
 * under the preprovisioned private root. Only US normal minute timeframes
 * (1m..12h) are eligible, only while an overnight session for a NYSE trading
 * date is actually live, and only for that current trading date — demand for
 * any historical date is refused. Returns a structured status; never throws.
 */
export async function requestBoatsLiveHistory(
  sym: string,
  tf: string,
  sessionDate = "",
  nowMs = Date.now(),
): Promise<BoatsInterestStatus> {
  const symbol = typeof sym === "string" ? sym.toUpperCase() : "";
  const vendorSymbol = boatsVendorSymbol(symbol);
  const emit = (
    status: BoatsInterestStatus["status"], reason: string,
    session_date: string | null = null, requested_at_utc: string | null = null,
  ): BoatsInterestStatus => ({
    schema: INTEREST_STATUS_SCHEMA, status, symbol, vendor_symbol: vendorSymbol,
    session_date, requested_at_utc, reason,
  });
  try {
    if (!SYMBOL.test(symbol) || !SYMBOL.test(vendorSymbol)) return emit("unsupported", "symbol_grammar");
    if (!MINUTE_TFS.has(tf) || !Number.isInteger(tfMinutes(tf)) || tfMinutes(tf) < 1 || tfMinutes(tf) > 720) {
      return emit("unsupported", "timeframe_not_us_normal_minute");
    }
    // The live overnight trading date is owned by the immutable NYSE clock:
    // demand exists only while that session is live right now.
    const nowDisplay = etDisplayEpochFromUtcMs(nowMs);
    if (nowDisplay == null) return emit("error", "clock_unavailable");
    const phase = usEquitySessionAtDisplayEpoch(nowDisplay);
    if (phase.session !== "overnight" || phase.tradeDate == null) {
      return emit("unsupported", "no_live_overnight_session");
    }
    if (sessionDate) {
      if (validCalendarDate(sessionDate) !== sessionDate || sessionDate !== phase.tradeDate) {
        return emit("unsupported", "session_date_not_current_trading_date", phase.tradeDate);
      }
    }
    const root = process.env.TIINGO_BOATS_LIVE_DIR;
    if (!root) return emit("disabled", "tiingo_boats_live_dir_unset", phase.tradeDate);
    const requestsDir = await provisionedLiveRoot(root);
    if (!requestsDir) return emit("unprovisioned", "live_root_not_provisioned", phase.tradeDate);
    const requestedAt = new Date(nowMs).toISOString();
    const throttleKey = `${root}\u0000${vendorSymbol}`;
    // Narrowed once: the calendar guarantees the current-night trading date.
    const nightSession: string = phase.tradeDate;
    return await serialize(async () => {
      // Per-symbol touches are coalesced at most once per 30s inside the
      // serialized queue, so concurrent chart refreshes cannot double-write.
      const lastTouch = lastTouchAt.get(throttleKey);
      if (lastTouch != null && nowMs - lastTouch < TOUCH_THROTTLE_MS) {
        return emit("coalesced", "demand_refresh_throttled", nightSession, requestedAt);
      }
      let regularRecords = 0;
      let hasOwn = false;
      const candidates: string[] = [];
      try {
        // Bound the scan itself, including foreign files and pending writes.
        let scanned = 0;
        for await (const entry of await opendir(requestsDir)) {
          if (++scanned > MAX_DIRECTORY_ENTRIES) return emit("capacity", "directory_scan_limit", nightSession, requestedAt);
          const match = INTEREST_FILE.exec(entry.name);
          if (!match) continue;
          if (match[1] === vendorSymbol) {
            if (!entry.isFile() || !await readInterestRecord(path.join(requestsDir, entry.name))) {
              return emit("error", "target_not_owned_interest", nightSession, requestedAt);
            }
            hasOwn = true;
            continue;
          }
          // Unrecognized contents count against capacity but cannot be pruned.
          regularRecords += 1;
          if (entry.isFile()) candidates.push(entry.name);
        }
      } catch (error: unknown) {
        return emit("error", (error as NodeJS.ErrnoException)?.code ?? "scan_failed", nightSession, requestedAt);
      }
      if (!hasOwn && regularRecords >= MAX_INTEREST_RECORDS) {
        // Capacity pressure: remove only schema-valid expired owned records.
        for (const name of candidates) {
          const record = await readInterestRecord(path.join(requestsDir, name));
          if (!record) continue;
          const requestedMs = parseIsoEpochMs(record.requested_at_utc);
          if (requestedMs == null || requestedMs + REQUEST_TTL_MS <= nowMs) {
            // unlink(2) never follows the final symlink component.
            try {
              await rm(path.join(requestsDir, name), { force: false });
              regularRecords -= 1;
            } catch { /* Failed removal does not create a capacity slot. */ }
          }
        }
        if (regularRecords >= MAX_INTEREST_RECORDS) {
          return emit("capacity", "demand_record_capacity_exhausted", nightSession, requestedAt);
        }
      }
      const record: InterestRecord = {
        schema: INTEREST_SCHEMA, symbol: vendorSymbol, session_date: nightSession, requested_at_utc: requestedAt,
      };
      await writeInterestRecord(requestsDir, vendorSymbol, record);
      for (const [key, stamp] of lastTouchAt) {
        if (stamp + REQUEST_TTL_MS <= nowMs) lastTouchAt.delete(key);
      }
      if (lastTouchAt.size >= MAX_INTEREST_RECORDS) lastTouchAt.delete(lastTouchAt.keys().next().value!);
      lastTouchAt.set(throttleKey, nowMs);
      return emit("recorded", "demand_recorded", nightSession, requestedAt);
    });
  } catch (error: unknown) {
    return emit("error", (error as NodeJS.ErrnoException)?.code ?? "interest_write_failed");
  }
}
