// Coverage for the A10 scripts/layouts vertical of account export.
// Meaningful owner-filtered mocks; the shipped fixture DB has no saved_scripts/chart_layouts
// collections and must not be used to invent rows for these tables.

import { describe, expect, it } from "vitest";
import {
  EXPORT_MAX_PAGES,
  EXPORT_MAX_PHYSICAL_ROWS,
  EXPORT_MAX_ROWS,
  EXPORT_PAGE_SIZE,
  assertNoSecrets,
  buildAccountExport,
  normalizeExportPageOpts,
  readChartLayoutsForExport,
  readChartDrawingsForExport,
  readAlertsForExport,
  readSavedScriptsForExport,
  serializeCsv,
  serializeJson,
  type ChartLayoutExport,
  type ExportSources,
  type SavedScriptExport,
} from "@/lib/accountExport";
import type { DbResult, DbRow, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";

const OWNED_USER = "user-owner";

const scriptRow = (over: Partial<DbRow> = {}): DbRow => ({
  id: "script-1",
  user_id: OWNED_USER,
  name: "My breakout",
  lang: "pine",
  source: "study(\"x\")",
  params: { length: 20 },
  is_public: false,
  updated_at: "2026-09-01T10:00:00.000Z",
  created_at: "2026-08-01T10:00:00.000Z",
  ...over,
});

const layoutRow = (over: Partial<DbRow> = {}): DbRow => ({
  id: "layout-1",
  user_id: OWNED_USER,
  name: "Swing desk",
  config: { panes: 2, drawings: ["trend"] },
  updated_at: "2026-09-02T11:00:00.000Z",
  created_at: "2026-08-02T11:00:00.000Z",
  ...over,
});

type MockTable = {
  rows: DbRow[];
  failMessage?: string;
  /** When set, range() is unsupported (fixture-like driver). */
  noRange?: boolean;
  /** Force a cut after this many rows have been delivered across pages. */
  cutAfter?: number;
  /** Simulate a driver that ignores .eq — foreign rows leak through to the mapper. */
  leakEq?: boolean;
};

/** Owner-filtered structural mock: applies .eq user_id and optional range pagination. */
function makeOwnerDb(tables: Record<string, MockTable>): {
  db: WatchlistDb;
  eqCalls: Array<{ table: string; column: string; value: unknown }>;
  rangeCalls: Array<{ table: string; from: number; to: number }>;
  selectCalls: Array<{ table: string; fields: string | undefined }>;
} {
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
  const rangeCalls: Array<{ table: string; from: number; to: number }> = [];
  const selectCalls: Array<{ table: string; fields: string | undefined }> = [];

  const db = {
    from(table: string) {
      const config = tables[table] ?? { rows: [], failMessage: `Unknown mocked relation ${table}` };
      const predicates: Array<(row: DbRow) => boolean> = [];
      let orderKey: string | null = null;
      let ascending = true;
      let limitTo: number | null = null;
      let projection: string[] | null = null;

      const project = (rows: DbRow[]): DbRow[] => {
        if (!projection) return rows.map((r) => ({ ...r }));
        return rows.map((row) => Object.fromEntries(projection!.map((f) => [f, row[f]])));
      };

      const applyOrder = (rows: DbRow[]): DbRow[] => {
        if (!orderKey) return rows;
        return [...rows].sort((a, b) => {
          const left = a[orderKey!] as string | number;
          const right = b[orderKey!] as string | number;
          if (left === right) return 0;
          const cmp = left > right ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      };

      const result = (rows: DbRow[]): DbResult => {
        if (config.failMessage) return { data: null, error: { message: config.failMessage } };
        return { data: project(rows), error: null };
      };

      const matched = (): DbRow[] => {
        let rows = config.rows.filter((row) => predicates.every((p) => p(row)));
        rows = applyOrder(rows);
        return rows;
      };

      const q = {
        select(fields?: string): WatchlistQuery {
          selectCalls.push({ table, fields });
          projection = fields && fields !== "*" ? fields.split(",").map((f) => f.trim()) : null;
          return q as unknown as WatchlistQuery;
        },
        eq(column: string, value: unknown): WatchlistQuery {
          eqCalls.push({ table, column, value });
          if (!config.leakEq) {
            predicates.push((row) => row[column] === value);
          }
          return q as unknown as WatchlistQuery;
        },
        in(): WatchlistQuery {
          return q as unknown as WatchlistQuery;
        },
        order(column: string, options?: { ascending?: boolean }): WatchlistQuery {
          orderKey = column;
          ascending = options?.ascending !== false;
          return q as unknown as WatchlistQuery;
        },
        limit(count: number): WatchlistQuery {
          limitTo = count;
          return q as unknown as WatchlistQuery;
        },
        range(from: number, to: number): WatchlistQuery & PromiseLike<DbResult> {
          if (config.noRange) {
            return q as unknown as WatchlistQuery & PromiseLike<DbResult>;
          }
          rangeCalls.push({ table, from, to });
          const rows = matched().slice(from, to + 1);
          const capped = config.cutAfter !== undefined
            ? rows.slice(0, Math.max(0, config.cutAfter - rangeCalls.filter((c) => c.table === table).slice(0, -1).reduce((n, c) => n + (c.to - c.from + 1), 0)))
            : rows;
          return Promise.resolve(result(capped)) as unknown as WatchlistQuery & PromiseLike<DbResult>;
        },
        insert: () => q,
        upsert: () => q,
        update: () => q,
        delete: () => q,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then(onfulfilled?: (v: DbResult) => unknown, onrejected?: (r: unknown) => unknown) {
          let rows = matched();
          if (limitTo !== null) rows = rows.slice(0, limitTo);
          return Promise.resolve(result(rows)).then(onfulfilled, onrejected);
        },
      };
      if (config.noRange) delete (q as { range?: unknown }).range;
      return q as unknown as WatchlistQuery;
    },
  } as unknown as WatchlistDb;

  return { db, eqCalls, rangeCalls, selectCalls };
}

function baseSources(over: Partial<ExportSources> = {}): ExportSources {
  return {
    userId: OWNED_USER,
    email: "owner@example.com",
    generatedAt: "2026-10-06T00:00:00.000Z",
    watchlists: { ok: true, lists: [] },
    positions: { ok: true, positions: [] },
    ...over,
  };
}

describe("coverage keys for saved_scripts and chart_layouts", () => {
  it("truthfully includes both collections with real counts when reads succeed", () => {
    const doc = buildAccountExport(baseSources({
      saved_scripts: { ok: true, rows: [{ id: "s1", name: "A", lang: "pine", source: "", params: {}, is_public: false, updated_at: "t", created_at: "t", version: null }], complete: true },
      chart_layouts: { ok: true, rows: [{ id: "l1", name: "B", config: {}, updated_at: "t", created_at: "t", version: null }], complete: true },
    }));
    const included = doc.coverage.included.map((e) => e.key);
    expect(included).toContain("saved_scripts");
    expect(included).toContain("chart_layouts");
    expect(doc.coverage.included.find((e) => e.key === "saved_scripts")?.row_count).toBe(1);
    expect(doc.coverage.included.find((e) => e.key === "chart_layouts")?.row_count).toBe(1);
    expect(doc.saved_scripts).toHaveLength(1);
    expect(doc.chart_layouts).toHaveLength(1);
  });

  it("uses separate drawings/alerts omissions — no combined label claiming scripts or layouts absent when included", () => {
    const doc = buildAccountExport(baseSources({
      saved_scripts: { ok: true, rows: [], complete: true },
      chart_layouts: { ok: true, rows: [], complete: true },
    }));
    const keys = doc.coverage.not_included.map((e) => e.key);
    expect(keys).toContain("chart_drawings");
    expect(keys).toContain("alerts");
    expect(keys).not.toContain("chart_layouts_and_drawings");
    expect(keys).not.toContain("alerts_and_saved_scripts");
    expect(keys).not.toContain("saved_scripts");
    expect(keys).not.toContain("chart_layouts");
    for (const entry of doc.coverage.not_included) {
      expect(entry.what[0]).toBeTruthy();
      expect(entry.what[1]).toBeTruthy();
      expect(entry.why[0]).toBeTruthy();
      expect(entry.why[1]).toBeTruthy();
      expect(entry.how_to_ask[0]).toBeTruthy();
      expect(entry.how_to_ask[1]).toBeTruthy();
    }
  });

  it("legacy caller omitting new sources retains combined omissions and old doc key set", () => {
    const doc = buildAccountExport(baseSources());
    const keys = doc.coverage.not_included.map((e) => e.key);
    expect(keys).toContain("chart_layouts_and_drawings");
    expect(keys).toContain("alerts_and_saved_scripts");
    expect(Object.keys(doc).sort()).toEqual(
      ["account", "coverage", "generated_at", "portfolio_positions", "schema", "watchlists"].sort(),
    );
    expect(doc.coverage.included.map((e) => e.key)).toEqual(["watchlists", "portfolio_positions"]);
  });

  it("discloses a failed saved_scripts/chart_layouts read as unavailable, never zero success", () => {
    const doc = buildAccountExport(baseSources({
      saved_scripts: { ok: false, error: "scripts store down" },
      chart_layouts: { ok: false, error: "layouts store down" },
    }));
    const unavailable = doc.coverage.unavailable.map((e) => e.key);
    expect(unavailable).toContain("saved_scripts");
    expect(unavailable).toContain("chart_layouts");
    expect(doc.coverage.included.map((e) => e.key)).not.toContain("saved_scripts");
    expect(doc.coverage.included.map((e) => e.key)).not.toContain("chart_layouts");
    expect(doc.saved_scripts).toEqual([]);
    expect(doc.chart_layouts).toEqual([]);
    expect(doc.coverage.included.find((e) => e.key === "saved_scripts")).toBeUndefined();
  });

  it("preserves exact ids, updated_at versions and raw params/config snapshots", () => {
    const script: SavedScriptExport = {
      id: "9f0e11aa-1111-4111-8111-111111111111",
      name: "RSI flip",
      lang: "pine",
      source: "rsi(close, 14)",
      params: { length: 14, src: "close" },
      is_public: false,
      updated_at: "2026-09-15T08:30:00.000Z",
      created_at: "2026-09-01T08:30:00.000Z",
      version: "2026-09-15T08:30:00.000Z",
    };
    const layout: ChartLayoutExport = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      name: "4-pane",
      config: { panes: ["1h", "1d"], indicators: [{ id: "ema", args: { length: 20 } }] },
      updated_at: "2026-09-16T09:00:00.000Z",
      created_at: "2026-09-02T09:00:00.000Z",
      version: null,
    };
    const doc = buildAccountExport(baseSources({
      saved_scripts: { ok: true, rows: [script], complete: true },
      chart_layouts: { ok: true, rows: [layout], complete: true },
    }));
    expect(doc.saved_scripts?.[0]).toEqual(script);
    expect(doc.chart_layouts?.[0]).toEqual(layout);
    expect(JSON.parse(serializeJson(doc)).saved_scripts[0].params).toEqual({ length: 14, src: "close" });
  });
});

describe("readSavedScriptsForExport / readChartLayoutsForExport owner scoping", () => {
  it("always applies .eq user_id and drops foreign rows even if the driver returns them", async () => {
    const foreign = scriptRow({ id: "foreign", user_id: "user-other", name: "Not yours" });
    const own = scriptRow({ id: "own", user_id: OWNED_USER, name: "Yours" });
    const { db, eqCalls } = makeOwnerDb({
      saved_scripts: { rows: [foreign, own] },
    });
    const read = await readSavedScriptsForExport(db, OWNED_USER);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(eqCalls.some((c) => c.table === "saved_scripts" && c.column === "user_id" && c.value === OWNED_USER)).toBe(true);
    expect(read.rows.map((r) => r.id)).toEqual(["own"]);
  });

  it("selects explicit safe fields only (no user_id / credential columns in the projection)", async () => {
    const seen: string[] = [];
    const base = makeOwnerDb({ chart_layouts: { rows: [] } });
    const originalFrom = base.db.from.bind(base.db);
    (base.db as unknown as { from: WatchlistDb["from"] }).from = (table: string) => {
      const q = originalFrom(table);
      const select = q.select.bind(q);
      (q as unknown as { select: (f?: string) => WatchlistQuery }).select = (fields?: string) => {
        if (fields) seen.push(fields);
        return select(fields);
      };
      return q;
    };
    await readChartLayoutsForExport(base.db, OWNED_USER);
    expect(seen.length).toBeGreaterThan(0);
    for (const projection of seen) {
      expect(projection).not.toMatch(/\bpassword\b/i);
      expect(projection).not.toMatch(/\btoken\b/i);
      expect(projection).not.toMatch(/\bsecret\b/i);
      expect(projection).not.toMatch(/\bsession\b/i);
      expect(projection).not.toMatch(/\bsigning\b/i);
      expect(projection).not.toMatch(/\bprovider\b/i);
      // Safe fields from 0001_init.sql
      expect(projection).toContain("id");
      expect(projection).toContain("name");
    }
  });

  it("named schema contradiction: live saved_scripts/chart_layouts have no lock/builtin/source_kind columns", async () => {
    // SCHEMA CONTRADICTION (live-supabase-metadata.json pg_catalog, no customer rows):
    // saved_scripts: id,user_id,name,lang,source,params,is_public,updated_at,created_at
    // chart_layouts: id,user_id,name,config,updated_at,created_at,team_id,visibility
    // Neither table has is_locked, is_builtin, or source_kind. Catalog-owned proprietary
    // flagship templates are not rows in these owner tables. A synthetic lock-column
    // exclusion filter would invent DB fields the live table does not carry. Owner
    // .eq(user_id) plus SCRIPT_FIELDS/LAYOUT_FIELDS projection remain the actual
    // controls; extra mock flags are ignored, not used as exclusion predicates.
    const { db } = makeOwnerDb({
      saved_scripts: {
        rows: [
          scriptRow({ id: "locked", name: "Pro locked", is_locked: true }),
          scriptRow({ id: "builtin", name: "Built-in", is_builtin: true }),
          scriptRow({ id: "kind", name: "Locked kind", source_kind: "proprietary" }),
          scriptRow({ id: "mine", name: "Mine" }),
        ],
      },
      chart_layouts: {
        rows: [
          layoutRow({ id: "locked-l", name: "System layout", is_locked: true }),
          layoutRow({ id: "mine-l", name: "My layout" }),
        ],
      },
    });
    const scripts = await readSavedScriptsForExport(db, OWNED_USER);
    const layouts = await readChartLayoutsForExport(db, OWNED_USER);
    expect(scripts.ok && scripts.rows.map((r) => r.id)).toEqual(["builtin", "kind", "locked", "mine"]);
    expect(layouts.ok && layouts.rows.map((r) => r.id)).toEqual(["locked-l", "mine-l"]);
  });

  it("returns ok:false on driver error — never an empty successful read", async () => {
    const { db } = makeOwnerDb({
      saved_scripts: { rows: [], failMessage: "permission denied for table saved_scripts" },
      chart_layouts: { rows: [], failMessage: "permission denied for table chart_layouts" },
    });
    const scripts = await readSavedScriptsForExport(db, OWNED_USER);
    const layouts = await readChartLayoutsForExport(db, OWNED_USER);
    expect(scripts.ok).toBe(false);
    expect(layouts.ok).toBe(false);
    if (!scripts.ok) expect(scripts.error).toContain("permission denied");
  });

  it("returns ok:false when a fixture-like driver returns rows without required collection fields", async () => {
    // CONTRACT CONTRADICTION named: these fixture-like rows originally omitted `user_id`, so the
    // owner-filtered mock's `.eq("user_id", owner)` returned `[]` and collided with the genuine
    // empty-collection success case. The assertion is unchanged (ok:false on missing collection
    // fields). Rows now carry the owner id so the driver actually returns the wrong-shaped page.
    const { db } = makeOwnerDb({
      saved_scripts: { rows: [{ id: "s1", user_id: OWNED_USER, watchlist_id: "wl", symbol: "AAPL" }] },
      chart_layouts: { rows: [{ id: "l1", user_id: OWNED_USER, watchlist_id: "wl", symbol: "AAPL" }] },
    });
    const scripts = await readSavedScriptsForExport(db, OWNED_USER);
    const layouts = await readChartLayoutsForExport(db, OWNED_USER);
    expect(scripts.ok).toBe(false);
    expect(layouts.ok).toBe(false);
  });

  it("treats a genuinely empty owner collection as ok with zero rows (not unavailable)", async () => {
    const { db } = makeOwnerDb({
      saved_scripts: { rows: [] },
      chart_layouts: { rows: [] },
    });
    const scripts = await readSavedScriptsForExport(db, OWNED_USER);
    const layouts = await readChartLayoutsForExport(db, OWNED_USER);
    expect(scripts.ok && scripts.rows).toEqual([]);
    expect(layouts.ok && layouts.rows).toEqual([]);
  });
});

describe("bounded pagination", () => {
  it("collects multiple range pages up to the declared cap and marks the cut truthfully", async () => {
    const many = Array.from({ length: 45 }, (_, i) => scriptRow({ id: `s${String(i).padStart(3, "0")}`, name: `S${i}` }));
    const { db } = makeOwnerDb({ saved_scripts: { rows: many } });
    const read = await readSavedScriptsForExport(db, OWNED_USER, { pageSize: 10, maxRows: 25 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows.length).toBe(25);
    expect(read.complete).toBe(false);
    expect(read.cut).toBeTruthy();
  });

  it("a short final page that exceeds retained cap is partial, never complete", async()=>{
    const rows=Array.from({length:28},(_,i)=>scriptRow({id:`s${String(i).padStart(3,"0")}`}));
    const {db}=makeOwnerDb({saved_scripts:{rows}});
    const read=await readSavedScriptsForExport(db,OWNED_USER,{pageSize:10,maxRows:25});
    expect(read.ok).toBe(true);
    if(!read.ok)return;
    expect(read.rows).toHaveLength(25);
    expect(read.complete).toBe(false);
  });

  it("marks complete when a final short page arrives within the cap", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => layoutRow({ id: `l${i}`, name: `L${i}` }));
    const { db } = makeOwnerDb({ chart_layouts: { rows } });
    const read = await readChartLayoutsForExport(db, OWNED_USER, { pageSize: 10, maxRows: 50 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows).toHaveLength(15);
    expect(read.complete).toBe(true);
  });

  it("reports partial (not complete) when the driver has no range() and returns a full page", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => scriptRow({ id: `s${i}`, name: `S${i}` }));
    const { db } = makeOwnerDb({ saved_scripts: { rows, noRange: true } });
    const read = await readSavedScriptsForExport(db, OWNED_USER, { pageSize: 10, maxRows: 1000 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.complete).toBe(false);
    expect(read.cut).toMatch(/range/i);
  });

  it("exposes the default bounded constants for route callers", () => {
    expect(EXPORT_PAGE_SIZE).toBeGreaterThan(0);
    expect(EXPORT_MAX_ROWS).toBeGreaterThanOrEqual(EXPORT_PAGE_SIZE);
    expect(EXPORT_MAX_PHYSICAL_ROWS).toBe(5000);
    expect(EXPORT_MAX_PAGES).toBe(50);
  });

  it("exact cap edge: 25 owned rows pageSize 10 maxRows 25 is complete (short tail, no overflow)", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => scriptRow({ id: `s${String(i).padStart(3, "0")}` }));
    const { db } = makeOwnerDb({ saved_scripts: { rows } });
    const read = await readSavedScriptsForExport(db, OWNED_USER, { pageSize: 10, maxRows: 25 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows).toHaveLength(25);
    expect(read.complete).toBe(true);
  });

  it("maxRows less than pageSize remains a true retained ceiling and is never raised", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => scriptRow({ id: `s${i}` }));
    const { db } = makeOwnerDb({ saved_scripts: { rows } });
    const read = await readSavedScriptsForExport(db, OWNED_USER, { pageSize: 10, maxRows: 5 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows).toHaveLength(5);
    expect(read.complete).toBe(false);
    expect(read.cut).toMatch(/cap/i);
    const n = normalizeExportPageOpts({ pageSize: 10, maxRows: 5 });
    expect(n.pageSize).toBe(10);
    expect(n.maxRows).toBe(5);
    expect(n.maxRows).toBeLessThan(n.pageSize);
  });

  it("retains raw blank and whitespace names plus raw source/params/config/version", async () => {
    const { db } = makeOwnerDb({
      saved_scripts: {
        rows: [
          scriptRow({ id: "s-blank", name: "", source: "", params: { k: "" } }),
          scriptRow({ id: "s-ws", name: "  titled  ", source: "  pine  ", params: { n: 1 } }),
        ],
      },
      chart_layouts: {
        rows: [
          layoutRow({ id: "l-blank", name: "", config: {} }),
          layoutRow({ id: "l-ws", name: " \t ", config: { panes: [] } }),
        ],
      },
    });
    const scripts = await readSavedScriptsForExport(db, OWNED_USER);
    const layouts = await readChartLayoutsForExport(db, OWNED_USER);
    expect(scripts.ok && scripts.rows.map((r) => r.name)).toEqual(["", "  titled  "]);
    expect(scripts.ok && scripts.rows.map((r) => r.source)).toEqual(["", "  pine  "]);
    expect(scripts.ok && scripts.rows[0].params).toEqual({ k: "" });
    expect(scripts.ok && scripts.rows[0].version).toBe("2026-09-01T10:00:00.000Z");
    expect(scripts.ok && scripts.rows[1].version).toBe("2026-09-01T10:00:00.000Z");
    expect(layouts.ok && layouts.rows.map((r) => r.name)).toEqual(["", " \t "]);
    expect(layouts.ok && layouts.rows[0].config).toEqual({});
    expect(layouts.ok && layouts.rows[1].config).toEqual({ panes: [] });
  });

  it("a full page of duplicates is a bounded hard stop, never complete", async () => {
    const copies = Array.from({ length: 20 }, () => scriptRow({ id: "dup-id", name: "Same" }));
    const { db, rangeCalls } = makeOwnerDb({ saved_scripts: { rows: copies } });
    const read = await readSavedScriptsForExport(db, OWNED_USER, { pageSize: 10, maxRows: 1000, maxPages: 50 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows).toHaveLength(1);
    expect(read.complete).toBe(false);
    expect(rangeCalls.length).toBeLessThanOrEqual(2);
    expect(read.cut).toMatch(/duplicate|rejected/i);
  });

  it("a full page of rejected foreign rows is a bounded hard stop, never complete", async () => {
    const foreign = Array.from({ length: 30 }, (_, i) => scriptRow({ id: `f${String(i).padStart(3, "0")}`, user_id: "user-other" }));
    const { db, rangeCalls } = makeOwnerDb({ saved_scripts: { rows: foreign, leakEq: true } });
    const read = await readSavedScriptsForExport(db, OWNED_USER, { pageSize: 10, maxRows: 1000, maxPages: 50 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows).toHaveLength(0);
    expect(read.complete).toBe(false);
    expect(rangeCalls.length).toBe(1);
    expect(read.cut).toMatch(/rejected|foreign|drop/i);
  });

  it("mixed invalid rows on a short collection are partial, never complete", async () => {
    const { db } = makeOwnerDb({
      saved_scripts: {
        rows: [
          scriptRow({ id: "ok1" }),
          scriptRow({ id: "bad", source: null as unknown as string }),
          scriptRow({ id: "ok2" }),
        ],
      },
    });
    const read = await readSavedScriptsForExport(db, OWNED_USER, { pageSize: 10, maxRows: 25 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows.map((r) => r.id)).toEqual(["ok1", "ok2"]);
    expect(read.complete).toBe(false);
    expect(read.cut).toMatch(/rejected|invalid/i);
  });

  it("malformed unsafe options fall back to finite SAFE positive integer defaults", async () => {
    const n = normalizeExportPageOpts({
      pageSize: Number.NaN,
      maxRows: -3,
      maxPhysicalRows: Number.POSITIVE_INFINITY,
      maxPages: 0,
    });
    expect(n.pageSize).toBe(EXPORT_PAGE_SIZE);
    expect(n.maxRows).toBe(EXPORT_MAX_ROWS);
    expect(n.maxPhysicalRows).toBe(EXPORT_MAX_PHYSICAL_ROWS);
    expect(n.maxPages).toBe(EXPORT_MAX_PAGES);
    expect(normalizeExportPageOpts({ pageSize: 1.5 }).pageSize).toBe(EXPORT_PAGE_SIZE);
    expect(normalizeExportPageOpts({ maxRows: 0 }).maxRows).toBe(EXPORT_MAX_ROWS);
    const { db } = makeOwnerDb({ saved_scripts: { rows: [scriptRow({ id: "only" })] } });
    const read = await readSavedScriptsForExport(db, OWNED_USER, {
      pageSize: Number.NaN,
      maxRows: -1,
      maxPhysicalRows: Number.POSITIVE_INFINITY,
      maxPages: 0,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows).toHaveLength(1);
    expect(read.complete).toBe(true);
  });

  it("owner-foreign leak is refused at the mapper even when the driver ignores eq", async () => {
    const { db, eqCalls } = makeOwnerDb({
      saved_scripts: {
        leakEq: true,
        rows: [
          scriptRow({ id: "foreign", user_id: "user-other", name: "Not yours" }),
          scriptRow({ id: "own", user_id: OWNED_USER, name: "Yours" }),
        ],
      },
    });
    const read = await readSavedScriptsForExport(db, OWNED_USER);
    expect(eqCalls.some((c) => c.table === "saved_scripts" && c.column === "user_id" && c.value === OWNED_USER)).toBe(true);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows.map((r) => r.id)).toEqual(["own"]);
    expect(read.complete).toBe(false);
    expect(read.cut).toMatch(/foreign|rejected|drop/i);
  });
});

describe("CSV presentation for scripts/layouts", () => {
  it("emits id, name, raw params/config and updated_at rows with the existing formula guard", () => {
    const doc = buildAccountExport(baseSources({
      saved_scripts: {
        ok: true,
        rows: [{
          id: "s1",
          name: "=cmd|' /c calc'!A1",
          lang: "pine",
          source: "study(\"x\")",
          params: { a: 1 },
          is_public: true,
          updated_at: "2026-09-01T00:00:00.000Z",
          created_at: "2026-08-01T00:00:00.000Z",
          version: null,
        }],
        complete: true,
      },
      chart_layouts: {
        ok: true,
        rows: [{
          id: "l1",
          name: "Desk",
          config: { panes: 1 },
          updated_at: "2026-09-02T00:00:00.000Z",
          created_at: "2026-08-02T00:00:00.000Z",
          version: null,
        }],
        complete: true,
      },
    }));
    const csv = serializeCsv(doc);
    expect(csv).toContain("data,saved_scripts,s1,name,'=cmd");
    expect(csv).toContain("data,saved_scripts,s1,params,");
    expect(csv).toContain("data,saved_scripts,s1,updated_at,2026-09-01T00:00:00.000Z");
    expect(csv).toContain("data,chart_layouts,l1,name,Desk");
    expect(csv).toContain("data,chart_layouts,l1,config,");
    expect(csv).toContain("coverage,included,saved_scripts,row_count,1");
    expect(csv).toContain("coverage,not_included,chart_drawings");
  });

  it("does not emit legacy combined omission rows when the new collections are included", () => {
    const doc = buildAccountExport(baseSources({
      saved_scripts: { ok: true, rows: [], complete: true },
      chart_layouts: { ok: true, rows: [], complete: true },
    }));
    const csv = serializeCsv(doc);
    expect(csv).not.toContain("coverage,not_included,chart_layouts_and_drawings");
    expect(csv).not.toContain("coverage,not_included,alerts_and_saved_scripts");
    expect(csv).toContain("coverage,not_included,chart_drawings");
    expect(csv).toContain("coverage,not_included,alerts");
  });
});

describe("secret and injection defenses on the new vertical", () => {
  it("assertNoSecrets still trips on secret-shaped script source text", () => {
    expect(assertNoSecrets("source: access_token=abcdef12345").ok).toBe(false);
  });

  it("builds a clean export doc that passes the route-level secret guard when content is ordinary", () => {
    const doc = buildAccountExport(baseSources({
      saved_scripts: {
        ok: true,
        rows: [{
          id: "s1",
          name: "Breakout",
          lang: "pine",
          source: "ta.sma(close, 20)",
          params: { length: 20 },
          is_public: false,
          updated_at: "2026-09-01T00:00:00.000Z",
          created_at: "2026-08-01T00:00:00.000Z",
          version: null,
        }],
        complete: true,
      },
      chart_layouts: {
        ok: true,
        rows: [{
          id: "l1",
          name: "Swing",
          config: { panes: 2 },
          updated_at: "2026-09-02T00:00:00.000Z",
          created_at: "2026-08-02T00:00:00.000Z",
          version: null,
        }],
        complete: true,
      },
    }));
    const body = serializeJson(doc) + serializeCsv(doc);
    expect(assertNoSecrets(body).ok).toBe(true);
  });
});

describe("partial-page disclosure shape", () => {
  it("marks included rows and a partial entry when a read is capped — not a complete count claim", () => {
    const doc = buildAccountExport(baseSources({
      saved_scripts: {
        ok: true,
        rows: [
          { id: "s1", name: "A", lang: "pine", source: "", params: {}, is_public: false, updated_at: "t", created_at: "t", version: null },
          { id: "s2", name: "B", lang: "pine", source: "", params: {}, is_public: false, updated_at: "t", created_at: "t", version: null },
        ],
        complete: false,
        cut: "export cap 25 rows",
      },
      chart_layouts: { ok: true, rows: [], complete: true },
    }));
    const included = doc.coverage.included.find((e) => e.key === "saved_scripts");
    expect(included?.row_count).toBe(2);
    const partial = doc.coverage.partial?.find((e) => e.key === "saved_scripts");
    expect(partial).toBeTruthy();
    expect(partial?.why[0]).toMatch(/cap|partial|cut|full/i);
    expect(partial?.why[1]).toBeTruthy();
  });
});


const drawingRow = (over: Partial<DbRow> = {}): DbRow => ({
  id: "drawing-1", user_id: OWNED_USER, symbol: " NVDA ", kind: "__collection_v1",
  data: { revision: "actual-revision-7", opId: "op-7", priorOperations: ["op-6"],
    drawings: [{ id: "geometry-1", points: [{ time: 123, price: 45.6 }], futureField: { keep: true } }] },
  created_at: "2026-08-01T00:00:00.000Z", ...over,
});
const alertRow = (over: Partial<DbRow> = {}): DbRow => ({
  id: "alert-1", user_id: OWNED_USER, symbol: " NVDA ",
  condition: { type: "price", operator: ">", value: 150, triggered_at: "2026-10-08", unknown: [1, 2] },
  active: false, created_at: "2026-08-01T00:00:00.000Z", ...over,
});

describe("owned drawings and alert definition archive", () => {
  it("preserves collection geometry, legacy rows, stored condition and real revision without normalization", async () => {
    const collection = drawingRow(); const legacy = drawingRow({ id: "legacy", kind: "future_kind", data: { points: [1, 2], revision: "not-a-collection-revision" } });
    const alert = alertRow();
    const { db, eqCalls, rangeCalls, selectCalls } = makeOwnerDb({ drawings: { rows: [collection, legacy] }, alerts: { rows: [alert] } });
    const drawings = await readChartDrawingsForExport(db, OWNED_USER, { pageSize: 1 });
    const alerts = await readAlertsForExport(db, OWNED_USER, { pageSize: 1 });
    expect(drawings.ok && drawings.complete).toBe(true); expect(alerts.ok && alerts.complete).toBe(true);
    if (!drawings.ok || !alerts.ok) return;
    expect(drawings.rows[0]).toEqual({ id: collection.id, symbol: collection.symbol, kind: collection.kind,
      data: collection.data, created_at: collection.created_at, version: "actual-revision-7" });
    expect(drawings.rows[1].version).toBeNull(); expect(drawings.rows[1].data).toEqual(legacy.data);
    expect(alerts.rows[0]).toEqual({ id: alert.id, symbol: alert.symbol, condition: alert.condition,
      active: false, created_at: alert.created_at, version: null });
    expect(eqCalls).toHaveLength(rangeCalls.length);
    expect(eqCalls.every(c => c.column === "user_id" && c.value === OWNED_USER)).toBe(true);
    expect(selectCalls.filter(c => c.table === "drawings").every(c => c.fields === "id,user_id,symbol,kind,data,created_at")).toBe(true);
    expect(selectCalls.filter(c => c.table === "alerts").every(c => c.fields === "id,user_id,symbol,condition,active,created_at")).toBe(true);
    expect(JSON.stringify(drawings.rows) + JSON.stringify(alerts.rows)).not.toContain("user_id");
  });

  it.each(["drawings", "alerts"])("rejects foreign, missing-owner and malformed %s rows without a complete-count claim", async (table) => {
    const row = table === "alerts" ? alertRow : drawingRow;
    const { db } = makeOwnerDb({ [table]: { leakEq: true, rows: [row({ id: "a-owned" }), row({ id: "b-foreign", user_id: "other" }), row({ id: "c-no-owner", user_id: undefined }), row({ id: "d-invalid", created_at: undefined })] } });
    const read = await (table === "alerts" ? readAlertsForExport : readChartDrawingsForExport)(db, OWNED_USER);
    expect(read.ok).toBe(true); if (!read.ok) return;
    expect(read.rows.map(r => r.id)).toEqual(["a-owned"]); expect(read.complete).toBe(false);
  });

  it.each(["drawings", "alerts"])("bounds %s retained rows, physical pages and unpageable reads", async (table) => {
    const row = table === "alerts" ? alertRow : drawingRow;
    const reader = table === "alerts" ? readAlertsForExport : readChartDrawingsForExport;
    const rows = Array.from({ length: 8 }, (_, i) => row({ id: `row-${i}` }));
    const { db, rangeCalls } = makeOwnerDb({ [table]: { rows } });
    const read = await reader(db, OWNED_USER, { pageSize: 2, maxRows: 3 });
    expect(read.ok && read.rows.length).toBe(3); expect(read.ok && read.complete).toBe(false); expect(rangeCalls).toHaveLength(2);
    const capped = await reader(db, OWNED_USER, { pageSize: 2, maxPhysicalRows: 2 });
    expect(capped.ok && capped.complete).toBe(false);
    const unpaged = await reader(makeOwnerDb({ [table]: { rows, noRange: true } }).db, OWNED_USER);
    expect(unpaged.ok && unpaged.complete).toBe(false);
    const duplicate = await reader(makeOwnerDb({ [table]: { rows: [row(), row()] } }).db, OWNED_USER);
    expect(duplicate.ok && duplicate.rows.length).toBe(1); expect(duplicate.ok && duplicate.complete).toBe(false);
  });

  it("keeps unknown or null JSON payloads verbatim and never uses creation clocks as revisions", async () => {
    const drawings = await readChartDrawingsForExport(makeOwnerDb({ drawings: { rows: [drawingRow({ data: null })] } }).db, OWNED_USER);
    const alerts = await readAlertsForExport(makeOwnerDb({ alerts: { rows: [alertRow({ condition: null })] } }).db, OWNED_USER);
    expect(drawings.ok && drawings.rows[0].data).toBeNull(); expect(drawings.ok && drawings.rows[0].version).toBeNull();
    expect(alerts.ok && alerts.rows[0].condition).toBeNull(); expect(alerts.ok && alerts.rows[0].version).toBeNull();
  });

  it("counts physical persisted drawing rows and discloses partial, failed and remaining archive categories", async () => {
    const drawings = await readChartDrawingsForExport(makeOwnerDb({ drawings: { rows: [drawingRow()] } }).db, OWNED_USER);
    const doc = buildAccountExport(baseSources({ saved_scripts: { ok: true, rows: [], complete: true }, chart_layouts: { ok: true, rows: [], complete: true },
      chart_drawings: drawings, alerts: { ok: false, error: "unavailable" } }));
    expect(doc.coverage.included.find(e => e.key === "chart_drawings")?.row_count).toBe(1);
    expect(doc.coverage.unavailable.map(e => e.key)).toContain("alerts"); expect(doc.alerts).toEqual([]);
    const omissions = doc.coverage.not_included.map(e => e.key);
    expect(omissions).not.toContain("chart_drawings"); expect(omissions).not.toContain("alerts");
    expect(omissions).toEqual(expect.arrayContaining(["research_theses_and_versions", "investigations_and_revisions", "chart_layout_revisions", "favorites_briefs_and_device_local_work"]));
    const partial = buildAccountExport(baseSources({ chart_drawings: { ok: true, rows: [], complete: false }, alerts: { ok: true, rows: [], complete: true } }));
    expect(partial.coverage.partial?.map(e => e.key)).toEqual(["chart_drawings"]);
    expect(partial.coverage.not_included.map(e => e.key)).toEqual(expect.arrayContaining(["chart_layouts", "saved_scripts"]));
  });

  it("retains raw nested JSON and formula defenses in both download representations", async () => {
    const drawings = await readChartDrawingsForExport(makeOwnerDb({ drawings: { rows: [drawingRow({ symbol: "=formula" })] } }).db, OWNED_USER);
    const alerts = await readAlertsForExport(makeOwnerDb({ alerts: { rows: [alertRow()] } }).db, OWNED_USER);
    const doc = buildAccountExport(baseSources({ chart_drawings: drawings, alerts })); const csv = serializeCsv(doc);
    expect(csv).toContain("data,chart_drawings,drawing-1,symbol,'=formula");
    expect(csv).toContain("data,chart_drawings,drawing-1,data,"); expect(csv).toContain("data,alerts,alert-1,condition,");
    expect(csv).toContain("data,alerts,alert-1,active,false"); expect(JSON.parse(serializeJson(doc)).chart_drawings[0].data).toEqual(drawingRow().data);
  });
});


describe("structured JSON credential guard", () => {
  it("detects escaped credential strings nested in arrays without treating null, empty or prose as a credential", () => {
    expect(assertNoSecrets(JSON.stringify({ metadata: [{ API_Key: 'ab"cd' }] })).ok).toBe(false);
    expect(assertNoSecrets(JSON.stringify({ secret: null, password: "", note: "changed password; Secret picks" })).ok).toBe(true);
  });
  it("does not lose the withholding guard on deeply nested valid JSON", () => {
    const depth = 5000;
    const json = '{"child":'.repeat(depth) + '{"api_key":"fictional-deep-value"}' + '}'.repeat(depth);
    expect(assertNoSecrets(json).ok).toBe(false);
  });
});
