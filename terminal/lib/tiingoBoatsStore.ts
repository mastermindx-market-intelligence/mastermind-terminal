// Server-only BOATS REST history reader. The private directory is configured by
// the existing Terminal process; this module starts no collector or publisher.
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { type Bar6, tfMinutes, isSecondTf, resampleUsEquitySession } from "./intradayShared";
import { usEquitySessionAtDisplayEpoch } from "./usEquityCalendar";
import { parseTiingoBoatsHistory } from "./tiingoBoatsHistory";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_BARS = 20_000;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,31}$/;
// Terminal's US A/B class shares use dots; Tiingo documents hyphens.
// Keep venue suffixes and other dotted identifiers literal, never guess a listing.
// https://www.tiingo.com/documentation/appendix/symbology
export function boatsVendorSymbol(symbol: string): string {
  return symbol.replace(/^([A-Z][A-Z0-9]{0,29})\.([AB])$/, "$1-$2");
}
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
};

export async function readTiingoBoatsHistory(sym: string, tf: string): Promise<{ bars: Bar6[]; evidence: BoatsHistoryEvidence }> {
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
  const directory = process.env.TIINGO_BOATS_HISTORY_DIR;
  if (!directory) return done();
  if (!path.isAbsolute(directory)) { evidence.status = "unreadable"; return done(); }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let raw: Buffer;
  try {
    handle = await open(path.join(directory, `${vendorSymbol}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) { evidence.status = "malformed"; return done(); }
    // Read at most the bounded advertised size + one byte. A growing file cannot
    // allocate an unbounded read; changing input fails JSON/integrity validation.
    const buffer = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = await handle.read(buffer, count, buffer.length - count, count);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count !== stat.size) { evidence.status = "malformed"; return done(); }
    raw = buffer.subarray(0, count);
  } catch (error: unknown) {
    evidence.status = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unreadable";
    return done();
  } finally { await handle?.close(); }
  evidence.content_sha256 = createHash("sha256").update(raw).digest("hex");
  try {
    const history = parseTiingoBoatsHistory(JSON.parse(raw.toString("utf8")), vendorSymbol);
    evidence.receipt_ids = history.receiptIds;
    evidence.observed_at_utc = history.observedAt;
    evidence.input_bars = history.bars.length;
    // Reuse the immutable NYSE calendar. Never infer sessions from a weekday or
    // manufacture a missing minute. A closed calendar bar cannot create a candle.
    const selected = history.bars.filter(bar => usEquitySessionAtDisplayEpoch(bar[0]).session === "overnight");
    evidence.calendar_excluded_bars = history.bars.length - selected.length;
    const bars = resampleUsEquitySession(selected, minutes, "24h").slice(-MAX_BARS);
    evidence.returned_bars = bars.length;
    evidence.status = bars.length ? "available" : "empty";
    return done(bars);
  } catch { evidence.status = "malformed"; return done(); }
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
