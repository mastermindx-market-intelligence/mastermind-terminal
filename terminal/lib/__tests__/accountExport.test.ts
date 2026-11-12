import { describe, expect, it } from "vitest";
import {
  assertNoSecrets,
  buildAccountExport,
  exportFilename,
  readWatchlistsForExport,
  serializeCsv,
  serializeJson,
  type ExportSources,
} from "@/lib/accountExport";
import type { ServerWatchlist, WatchlistDb } from "@/lib/watchlists";
import type { Position } from "@/lib/portfolio";
import golden from "./fixtures/account_export_v1.json";

const baseSources = (): ExportSources => ({
  userId: "user-1",
  email: "a@example.com",
  generatedAt: "2026-09-06T00:00:00.000Z",
  watchlists: { ok: true, lists: [] },
  positions: { ok: true, positions: [] },
});

/** New-style sources: caller opts into saved_scripts/chart_layouts (A10 vertical). */
const withNewSources = (): ExportSources => ({
  ...baseSources(),
  saved_scripts: { ok: true, rows: [], complete: true },
  chart_layouts: { ok: true, rows: [], complete: true },
});

describe("buildAccountExport", () => {
  it("preserves known and unknown historical entry units in both owner export formats", () => {
    const src = baseSources();
    const row: Position = { id: "unit-known", ticker: "AAA", shares: 1, entryPrice: 100,
      entryCurrency: "HKD", entryDate: null, notes: null, status: "open", createdAt: null };
    src.positions = { ok: true, positions: [row, { ...row, id: "unit-unknown", entryCurrency: null }] };
    const doc = buildAccountExport(src);
    const parsed = JSON.parse(serializeJson(doc));
    expect(parsed.portfolio_positions.map((p: Position) => p.entryCurrency)).toEqual(["HKD", null]);
    const csv = serializeCsv(doc);
    const lines = csv.split("\r\n").filter(line => line.includes("entry_currency"));
    expect(lines).toHaveLength(2);
    expect(lines.find(line => line.includes("unit-known"))).toContain("HKD");
    expect(lines.find(line => line.includes("unit-unknown"))).not.toContain("HKD");
    expect(lines.find(line => line.includes("unit-unknown"))).not.toContain("USD");
  });
  it("includes both datasets with true row_counts, zero rows included not omitted", () => {
    const doc = buildAccountExport(baseSources());
    const wl = doc.coverage.included.find((e) => e.key === "watchlists");
    const pp = doc.coverage.included.find((e) => e.key === "portfolio_positions");
    expect(wl?.row_count).toBe(0);
    expect(pp?.row_count).toBe(0);
    expect(doc.coverage.unavailable).toHaveLength(0);
  });

  it("discloses a failed watchlist read in unavailable, drops it from included, keeps positions", () => {
    const src = baseSources();
    src.watchlists = { ok: false, error: "boom" };
    src.positions = { ok: true, positions: [] };
    const doc = buildAccountExport(src);
    expect(doc.coverage.unavailable.map((e) => e.key)).toContain("watchlists");
    expect(doc.coverage.included.map((e) => e.key)).not.toContain("watchlists");
    expect(doc.watchlists).toEqual([]);
  });

  it("carries all seven not_included entries with non-empty bilingual text", () => {
    const doc = buildAccountExport(baseSources());
    expect(doc.coverage.not_included).toHaveLength(7);
    for (const entry of doc.coverage.not_included) {
      expect(entry.what[0]).toBeTruthy();
      expect(entry.what[1]).toBeTruthy();
      expect(entry.what[1]).not.toBe(entry.what[0]);
      expect(entry.why[0]).toBeTruthy();
      expect(entry.why[1]).toBeTruthy();
      expect(entry.how_to_ask[0]).toBeTruthy();
      expect(entry.how_to_ask[1]).toBeTruthy();
    }
  });

  it("legacy omission (no new sources) keeps combined not_included keys and old doc key set", () => {
    const doc = buildAccountExport(baseSources());
    const keys = doc.coverage.not_included.map((e) => e.key);
    expect(keys).toContain("chart_layouts_and_drawings");
    expect(keys).toContain("alerts_and_saved_scripts");
    expect(Object.keys(doc).sort()).toEqual(Object.keys(golden).sort());
    expect(doc.coverage.included.map((e) => e.key)).toEqual(["watchlists", "portfolio_positions"]);
  });

  it("new-style sources include saved_scripts/chart_layouts and split drawings/alerts omissions", () => {
    const doc = buildAccountExport(withNewSources());
    const included = doc.coverage.included.map((e) => e.key);
    expect(included).toContain("saved_scripts");
    expect(included).toContain("chart_layouts");
    const omitted = doc.coverage.not_included.map((e) => e.key);
    expect(omitted).toContain("chart_drawings");
    expect(omitted).toContain("alerts");
    expect(omitted).not.toContain("chart_layouts_and_drawings");
    expect(omitted).not.toContain("alerts_and_saved_scripts");
    expect(doc.saved_scripts).toEqual([]);
    expect(doc.chart_layouts).toEqual([]);
  });

  it("failed new-source reads land in unavailable, not as zero included rows", () => {
    const src = withNewSources();
    src.saved_scripts = { ok: false, error: "scripts down" };
    src.chart_layouts = { ok: false, error: "layouts down" };
    const doc = buildAccountExport(src);
    const unavailable = doc.coverage.unavailable.map((e) => e.key);
    expect(unavailable).toContain("saved_scripts");
    expect(unavailable).toContain("chart_layouts");
    expect(doc.coverage.included.map((e) => e.key)).not.toContain("saved_scripts");
    expect(doc.saved_scripts).toEqual([]);
  });

  it("matches the golden fixture's exact key set (no fabricated field)", () => {
    const doc = buildAccountExport(baseSources());
    expect(Object.keys(doc).sort()).toEqual(Object.keys(golden).sort());
    expect(Object.keys(doc.coverage).sort()).toEqual(Object.keys((golden as unknown as typeof doc).coverage).sort());
  });

  it("exportFilename is UTC date-stamped with the right extension", () => {
    const doc = buildAccountExport(baseSources());
    expect(exportFilename(doc, "json")).toBe("mastermind-terminal-data-2026-09-06.json");
    expect(exportFilename(doc, "csv")).toBe("mastermind-terminal-data-2026-09-06.csv");
  });

  it("serializeJson round-trips through JSON.parse", () => {
    const doc = buildAccountExport(baseSources());
    expect(JSON.parse(serializeJson(doc)).schema).toBe(doc.schema);
  });
});

describe("serializeCsv", () => {
  const listWithSymbol = (name: string, sectionLabel: string): ServerWatchlist => ({
    id: "list-1",
    name,
    position: 0,
    symbols: [{ symbol: "AAPL", section: sectionLabel, position: 0 }],
  });

  it("has the exact header, a BOM, and CRLF line endings", () => {
    const doc = buildAccountExport(baseSources());
    const csv = serializeCsv(doc);
    expect(csv.startsWith("﻿section,dataset,row_id,field,value\r\n")).toBe(true);
    expect(csv.includes("\n") && !csv.includes("\r\n\r")).toBe(true);
  });

  it("quotes a value containing a comma, quote or newline (RFC-4180)", () => {
    const src = baseSources();
    src.watchlists = { ok: true, lists: [listWithSymbol('My, "special" list', "core")] };
    const doc = buildAccountExport(src);
    const csv = serializeCsv(doc);
    expect(csv).toContain('"My, ""special"" list"');
  });

  it("guards against formula injection in a name and a note", () => {
    const src = baseSources();
    src.watchlists = { ok: true, lists: [listWithSymbol("=cmd|' /c calc'!A1", "core")] };
    const position: Position = {
      id: "p1",
      ticker: "AAPL",
      shares: 1,
      entryPrice: 1,
      entryDate: "2026-01-01",
      notes: "+1 note",
      status: "open",
      createdAt: "2026-01-01T00:00:00Z",
    };
    src.positions = { ok: true, positions: [position] };
    const doc = buildAccountExport(src);
    const csv = serializeCsv(doc);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+1 note");
  });

  it("never mangles a genuine negative number (shares/entry_price) with the formula-injection quote (review MINOR round 2)", () => {
    const src = baseSources();
    const position: Position = {
      id: "p1",
      ticker: "AAPL",
      shares: -100,
      entryPrice: -12.5,
      entryDate: "2026-01-01",
      notes: null,
      status: "open",
      createdAt: "2026-01-01T00:00:00Z",
    };
    src.positions = { ok: true, positions: [position] };
    const doc = buildAccountExport(src);
    const csv = serializeCsv(doc);
    expect(csv).toContain(",shares,-100\r\n");
    expect(csv).toContain(",entry_price,-12.5\r\n");
    expect(csv).not.toContain("'-100");
    expect(csv).not.toContain("'-12.5");
  });

  it("still guards a note that merely LOOKS numeric-negative but is a string (formula-injection risk lives in text fields)", () => {
    const src = baseSources();
    const position: Position = {
      id: "p1",
      ticker: "AAPL",
      shares: 1,
      entryPrice: 1,
      entryDate: "2026-01-01",
      notes: "-2+3+cmd|' /c calc'!A1",
      status: "open",
      createdAt: "2026-01-01T00:00:00Z",
    };
    src.positions = { ok: true, positions: [position] };
    const doc = buildAccountExport(src);
    const csv = serializeCsv(doc);
    expect(csv).toContain("'-2+3+cmd");
  });

  it("renders null as empty string, never the literal 'null'", () => {
    const src = baseSources();
    const position: Position = {
      id: "p1",
      ticker: "AAPL",
      shares: null,
      entryPrice: null,
      entryDate: null,
      notes: null,
      status: "open",
      createdAt: null,
    };
    src.positions = { ok: true, positions: [position] };
    const doc = buildAccountExport(src);
    const csv = serializeCsv(doc);
    expect(csv).not.toContain(",null\r\n");
  });

  it("carries the coverage disclosure rows even without any data rows", () => {
    const doc = buildAccountExport(baseSources());
    const csv = serializeCsv(doc);
    expect(csv).toContain("coverage,not_included,chart_layouts_and_drawings");
  });

  it("legacy CSV keeps combined omission label when new sources are omitted", () => {
    const csv = serializeCsv(buildAccountExport(baseSources()));
    expect(csv).toContain("coverage,not_included,chart_layouts_and_drawings");
    expect(csv).toContain("coverage,not_included,alerts_and_saved_scripts");
    expect(csv).not.toContain("data,saved_scripts,");
    expect(csv).not.toContain("data,chart_layouts,");
  });

  it("new-style CSV carries script/layout data rows and split omission keys", () => {
    const src = withNewSources();
    src.saved_scripts = {
      ok: true,
      rows: [{
        id: "script-9",
        name: "My script",
        lang: "pine",
        source: "study(\"x\")",
        params: { length: 20 },
        is_public: false,
        updated_at: "2026-09-01T10:00:00.000Z",
        created_at: "2026-08-01T10:00:00.000Z",
        version: null,
      }],
      complete: true,
    };
    src.chart_layouts = {
      ok: true,
      rows: [{
        id: "layout-3",
        name: "Desk",
        config: { panes: 2 },
        updated_at: "2026-09-02T11:00:00.000Z",
        created_at: "2026-08-02T11:00:00.000Z",
        version: null,
      }],
      complete: true,
    };
    const csv = serializeCsv(buildAccountExport(src));
    expect(csv).toContain("data,saved_scripts,script-9,name,My script");
    expect(csv).toContain("data,saved_scripts,script-9,lang,pine");
    expect(csv).toContain("data,saved_scripts,script-9,source,");
    expect(csv).toContain("data,saved_scripts,script-9,updated_at,2026-09-01T10:00:00.000Z");
    expect(csv).toContain("data,chart_layouts,layout-3,name,Desk");
    expect(csv).toContain("data,chart_layouts,layout-3,updated_at,2026-09-02T11:00:00.000Z");
    expect(csv).toContain("coverage,not_included,chart_drawings");
    expect(csv).toContain("coverage,not_included,alerts");
    expect(csv).not.toContain("coverage,not_included,chart_layouts_and_drawings");
    expect(csv).not.toContain("coverage,not_included,alerts_and_saved_scripts");
  });

  it("emits a row for an empty watchlist (name, 0 symbols) so it never disappears from the export (review MINOR round 3)", () => {
    const emptyList: ServerWatchlist = { id: "list-empty", name: "Someday", position: 0, symbols: [] };
    const src = baseSources();
    src.watchlists = { ok: true, lists: [emptyList] };
    const doc = buildAccountExport(src);
    const csv = serializeCsv(doc);
    expect(csv).toContain("data,watchlists,list-empty,list_name,Someday");
  });

  it("still emits a name row for a populated list alongside its symbol rows (unchanged shape)", () => {
    const doc = buildAccountExport({ ...baseSources(), watchlists: { ok: true, lists: [listWithSymbol("Core", "core")] } });
    const csv = serializeCsv(doc);
    expect(csv).toContain("data,watchlists,list-1,list_name,Core");
    expect(csv).toContain("data,watchlists,list-1,symbol,AAPL");
  });
});

describe("assertNoSecrets", () => {
  const secretShaped = [
    "access_token=abcdef1234", "refresh_token: abcdef1234", "service_role=abcdef1234",
    "apikey=abcdef1234", "api_key: abcdef1234", "authorization: Bearer abcdef1234",
    "password=abcdef1234", "secret=abcdef1234", "bearer token-x", "sb-access-token=x",
    "eyJhbGciOiJIUzI1NiJ9.xxxxxxxxxx.yyy",
  ];

  it.each(secretShaped)("trips on secret-shaped value: %s", (needle) => {
    expect(assertNoSecrets(`clean text ${needle} more text`).ok).toBe(false);
  });

  it("passes a clean document", () => {
    expect(assertNoSecrets("just plain export content").ok).toBe(true);
  });

  it("does NOT trip when a banned word is ordinary prose in a note (review MAJOR acceptance-1/6)", () => {
    const result = assertNoSecrets("note: remember your password when you call support");
    expect(result.ok).toBe(true);
  });

  it("does NOT trip on a watchlist named 'Secret picks'", () => {
    const result = assertNoSecrets("watchlist name: Secret picks, section: core");
    expect(result.ok).toBe(true);
  });

  it("still trips on an actual key=value shaped secret embedded in ordinary content", () => {
    const result = assertNoSecrets("note: api_key=sk_live_abcdefgh12345 rest of note");
    expect(result.ok).toBe(false);
  });
});

describe("readWatchlistsForExport", () => {
  const makeDb = (probeResult: { data: unknown; error: unknown }): WatchlistDb => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.limit = () => Promise.resolve(probeResult);
      q.order = () => Promise.resolve({ data: [], error: null });
      q.in = () => Promise.resolve({ data: [], error: null });
      return q;
    },
  }) as unknown as WatchlistDb;

  it("returns ok:false when the probe resolves an error", async () => {
    const db = makeDb({ data: null, error: { message: "down" } });
    const result = await readWatchlistsForExport(db, "user-1");
    expect(result.ok).toBe(false);
  });

  it("returns ok:true with shaped lists when the probe succeeds", async () => {
    const db = makeDb({ data: [{ id: "w1" }], error: null });
    const result = await readWatchlistsForExport(db, "user-1");
    expect(result.ok).toBe(true);
  });
});
