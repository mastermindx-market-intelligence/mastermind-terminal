// Server-only BOATS REST history reader. The private directory is configured by
// the existing Terminal process; this module starts no collector or publisher.
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { type Bar6, tfMinutes, isSecondTf, resampleUsEquitySession, filterBarsToSessionDate } from "./intradayShared";
import { usEquitySessionAtDisplayEpoch } from "./usEquityCalendar";
import { parseTiingoBoatsHistory } from "./tiingoBoatsHistory";
import { boatsVendorSymbol, mergeBoatsLiveHistory, parseIsoEpochMs, readBoatsLiveSnapshot } from "./tiingoBoatsLiveHistory";

// Symbology is defined once beside the live-history reader; the public store
// interface (and the existing tests importing it from here) is unchanged.
export { boatsVendorSymbol };

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_BARS = 20_000;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,31}$/;
export type BoatsHistoryEvidence = {
  schema: "terminal.tiingo_boats_history_evidence.v1";
  status: "disabled" | "unsupported" | "missing" | "unreadable" | "malformed" | "empty" | "available";
  source: "tiingo-boats-rest";
  venue: "BOATS";
  requested_symbol: string;
  vendor_symbol: string;
  content_sha256: string | null;
  receipt_ids: string[];
  read_scope: "whole_input_file_not_requested_date";
  observed_at_utc: string[];
  price_basis: "vendor_reported_unqualified";
  volume_basis: "vendor_reported_shares";
  coverage: "captured_vendor_bars_only";
  complete: false;
  input_bars: number;
  calendar_excluded_bars: number;
  returned_bars: number;
  conflicts_excluded: number;
  /** Present only while TIINGO_BOATS_LIVE_DIR is configured. The live
   * snapshot never claims completeness: `complete` stays false above. */
  live_history?: {
    status: "missing" | "unreadable" | "malformed" | "stale" | "empty" | "applied";
    session_date: string | null;
    observed_at_utc: string | null;
    content_sha256: string | null;
    receipt_ids: string[];
  };
};

export async function readTiingoBoatsHistory(
  sym: string, tf: string, sessionDate = "", options: { live?: boolean } = {},
): Promise<{ bars: Bar6[]; evidence: BoatsHistoryEvidence }> {
  const symbol = sym.toUpperCase();
  const vendorSymbol = boatsVendorSymbol(symbol);
  const evidence: BoatsHistoryEvidence = {
    schema: "terminal.tiingo_boats_history_evidence.v1", status: "disabled",
    source: "tiingo-boats-rest", venue: "BOATS", requested_symbol: symbol,
    vendor_symbol: vendorSymbol, content_sha256: null,
    receipt_ids: [], read_scope: "whole_input_file_not_requested_date", observed_at_utc: [], price_basis: "vendor_reported_unqualified",
    volume_basis: "vendor_reported_shares", coverage: "captured_vendor_bars_only", complete: false,
    input_bars: 0, calendar_excluded_bars: 0, returned_bars: 0, conflicts_excluded: 0,
  };
  const done = (bars: Bar6[] = []) => ({ bars, evidence });
  const minutes = tfMinutes(tf);
  if (!SYMBOL.test(symbol) || isSecondTf(tf) || !Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
    evidence.status = "unsupported"; return done();
  }
  if (sessionDate && (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)
      || !Number.isFinite(Date.parse(`${sessionDate}T00:00:00Z`))
      || new Date(`${sessionDate}T00:00:00Z`).toISOString().slice(0, 10) !== sessionDate)) {
    evidence.status = "unsupported"; return done();
  }
  // Baseline archive read. A baseline failure is remembered, not fatal: with
  // the private live root configured the validated live snapshot may still
  // serve the current night, and otherwise the remembered failure is
  // reported exactly as before.
  const directory = process.env.TIINGO_BOATS_HISTORY_DIR;
  let rawMinutes: Bar6[] = [];
  let baseFail: "disabled" | "missing" | "unreadable" | "malformed" | null = null;
  if (!directory) baseFail = "disabled";
  else if (!path.isAbsolute(directory)) baseFail = "unreadable";
  else {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let raw: Buffer | undefined;
    try {
      handle = await open(path.join(directory, `${vendorSymbol}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) { baseFail = "malformed"; }
      else {
        // Read at most the bounded advertised size + one byte. A growing file cannot
        // allocate an unbounded read; changing input fails JSON/integrity validation.
        const buffer = Buffer.alloc(stat.size + 1);
        let count = 0;
        while (count < buffer.length) {
          const read = await handle.read(buffer, count, buffer.length - count, count);
          if (!read.bytesRead) break;
          count += read.bytesRead;
        }
        if (count !== stat.size) baseFail = "malformed";
        else raw = buffer.subarray(0, count);
      }
    } catch (error: unknown) {
      baseFail = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unreadable";
    } finally { await handle?.close().catch(() => undefined); }
    if (raw) {
      evidence.content_sha256 = createHash("sha256").update(raw).digest("hex");
      try {
        const history = parseTiingoBoatsHistory(JSON.parse(raw.toString("utf8")), vendorSymbol);
        evidence.receipt_ids = history.receiptIds;
        evidence.observed_at_utc = history.observedAt;
        evidence.input_bars = history.bars.length;
        rawMinutes = history.bars;
      } catch { baseFail = "malformed"; }
    }
  }
  // Private current-night live snapshot. Ignored entirely when the private
  // root is unset or the caller has not verified access. Default callers read
  // only the existing archive; private live consumption requires explicit opt-in.
  const baseNewestObservedMs = evidence.observed_at_utc.reduce<number | null>((newest, stamp) => {
    const epochMs = parseIsoEpochMs(stamp);
    return epochMs != null && (newest == null || epochMs > newest) ? epochMs : newest;
  }, null);
  const live = options.live === true
    ? await readBoatsLiveSnapshot(vendorSymbol, baseNewestObservedMs, Date.now()) : null;
  if (live && live.status !== "disabled") {
    evidence.live_history = {
      status: live.status, session_date: live.session_date, observed_at_utc: live.observed_at_utc,
      content_sha256: live.content_sha256, receipt_ids: live.receipt_ids,
    };
    // An accepted (or authoritative-empty) snapshot replaces the whole
    // same-session window at raw-minute level; resampling happens once below.
    const merged = mergeBoatsLiveHistory(rawMinutes, live.minutes, live.window);
    rawMinutes = merged.minutes;
    if (live.status === "applied" || live.status === "empty") baseFail = null;
  }
  // Reuse the immutable NYSE calendar. Never infer sessions from a weekday or
  // manufacture a missing minute. A closed calendar bar cannot create a candle.
  const selected = rawMinutes.filter(bar => usEquitySessionAtDisplayEpoch(bar[0]).session === "overnight");
  evidence.calendar_excluded_bars = rawMinutes.length - selected.length;
  const resampled = resampleUsEquitySession(selected, minutes, "24h");
  // Select a historical day before the latest-window cap can discard it.
  const bars = (sessionDate ? filterBarsToSessionDate(resampled, sessionDate) : resampled).slice(-MAX_BARS);
  evidence.returned_bars = bars.length;
  evidence.status = bars.length ? "available" : baseFail ?? "empty";
  return done(bars);
}

/** Existing provider bars retain authority on collisions; venues never mix inside a candle. */
export function prependBoatsHistory(history: Bar6[], current: Bar6[]): { bars: Bar6[]; addedEpochs: number[]; conflicts: number } {
  const existing = new Set(current.map(bar => bar[0]));
  const added = history.filter(bar => !existing.has(bar[0]));
  const bars = [...added, ...current].sort((a, b) => a[0] - b[0]).slice(-MAX_BARS);
  const retained = new Set(bars.map(bar => bar[0]));
  return { bars, addedEpochs: added.filter(bar => retained.has(bar[0])).map(bar => bar[0]),
    conflicts: history.length - added.length };
}
