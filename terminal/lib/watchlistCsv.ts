/**
 * Watchlist CSV boundary. Logical records are parsed in full before a caller mutates
 * owner-scoped state. Do not "escape" dangerous formula strings with apostrophes:
 * ordinary user labels beginning with a real apostrophe must round-trip unchanged.
 */
import { normalizeSection, normalizeSymbols } from "@/lib/watchlists";
import { isUnsafeCsvText } from "@/lib/optionsCsv";

export type WatchlistCsvRow = { symbol: string; section: string };
export type WatchlistCsvExport =
  | { ok: true; csv: string }
  | { ok: false; row: number; column: "symbol" | "section" };
export type WatchlistCsvImport =
  | { ok: true; rows: WatchlistCsvRow[]; invalid: number }
  | { ok: false; reason: "malformed" | "extra_fields"; row: number };
export type WatchlistCsvPlan = {
  accepted: WatchlistCsvRow[];
  duplicate: number;
  symbols: string[];
  sections: Record<string, string>;
};

const CONTROL_CHAR = /[\u0000-\u001f\u007f]/u;

/** Never let a hazardous stored field reach Blob or the browser's download machinery. */
export function serializeWatchlistCsv(rows: readonly WatchlistCsvRow[]): WatchlistCsvExport {
  for (const [index, row] of rows.entries()) {
    for (const column of ["symbol", "section"] as const) {
      const field = row[column] ?? "";
      if (isUnsafeCsvText(field) || CONTROL_CHAR.test(field)) {
        return { ok: false, row: index + 1, column };
      }
    }
  }
  const quote = (value: string) => /[",\r\n]/u.test(value)
    ? `"${value.replace(/"/gu, '""')}"`
    : value;
  return { ok: true, csv: ["symbol,section", ...rows.map(
    ({ symbol, section }) => `${quote(symbol)},${quote(section || "")}`,
  )].join("\n") };
}

/**
 * Strict RFC-style logical-record reader. A quote may begin a field or close a
 * quoted field; a quote inside a plain field and characters after a close are malformed.
 * Record boundaries inside quotes are data, never phantom symbols.
 */
function tokenizeCsv(text: string):
  | { ok: true; records: string[][] }
  | { ok: false; reason: "malformed"; row: number } {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let mode: "plain" | "quoted" | "after_quote" = "plain";
  const endField = () => { record.push(field); field = ""; mode = "plain"; };
  const endRecord = () => { endField(); records.push(record); record = []; };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (mode === "quoted") {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else mode = "after_quote";
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (mode === "plain" && field.length === 0) { mode = "quoted"; continue; }
      return { ok: false, reason: "malformed", row: records.length + 1 };
    }
    if (char === ",") { endField(); continue; }
    if (char === "\r" || char === "\n") {
      endRecord();
      if (char === "\r" && input[i + 1] === "\n") i++;
      continue;
    }
    if (mode === "after_quote") {
      return { ok: false, reason: "malformed", row: records.length + 1 };
    }
    field += char;
  }
  if (mode === "quoted") return { ok: false, reason: "malformed", row: records.length + 1 };
  if (record.length || field.length || mode === "after_quote") endRecord();
  return { ok: true, records };
}

/**
 * Malformed quoting and excess columns invalidate the WHOLE file.
 * Canonically invalid logical rows are rejected individually, retaining neighbors.
 * The missing section is the empty ROOT, never the API's legacy Watchlist fallback.
 */
export function parseWatchlistCsv(text: string): WatchlistCsvImport {
  const parsed = tokenizeCsv(text);
  if (!parsed.ok) return parsed;
  const nonempty = parsed.records.filter((record) => !record.every((cell) => !cell.trim()));
  for (const [index, record] of nonempty.entries()) {
    if (record.length > 2) return { ok: false, reason: "extra_fields", row: index + 1 };
  }
  const first = nonempty[0];
  const hasHeader = !!first && first[0].trim().toLowerCase() === "symbol"
    && (first.length === 1 || (first.length === 2 && first[1].trim().toLowerCase() === "section"));
  const records = hasHeader ? nonempty.slice(1) : nonempty;
  const rows: WatchlistCsvRow[] = [];
  let invalid = 0;
  for (const record of records) {
    const symbol = normalizeSymbols([record[0]])[0];
    const section = normalizeSection(record[1] ?? "", "");
    if (!symbol || section === null) { invalid++; continue; }
    rows.push({ symbol, section });
  }
  return { ok: true, rows, invalid };
}

/** One accepted ordered set feeds BOTH local insertion and the exact server sections map. */
export function planWatchlistCsvImport(
  existing: readonly WatchlistCsvRow[],
  parsed: readonly WatchlistCsvRow[],
): WatchlistCsvPlan {
  const seen = new Set(existing.map((r) => normalizeSymbols([r.symbol])[0]).filter(Boolean));
  const accepted: WatchlistCsvRow[] = [];
  let duplicate = 0;
  for (const row of parsed) {
    if (seen.has(row.symbol)) { duplicate++; continue; }
    seen.add(row.symbol);
    accepted.push(row);
  }
  return {
    accepted,
    duplicate,
    symbols: accepted.map((r) => r.symbol),
    sections: Object.fromEntries(accepted.map((r) => [r.symbol, r.section])),
  };
}
