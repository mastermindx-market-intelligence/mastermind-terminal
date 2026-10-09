// accountExport.ts — pure builder for the self-serve "download my data" artifact (B-F12-4).
//
// Terminal-owned tables in this file: watchlists, portfolio positions, saved_scripts, and
// chart_layouts, drawings (export key chart_drawings) and alerts. It is deliberately NOT a whole-account export: chat
// history, usage records, profile/plan, payment records and the download allowance live elsewhere
// and are disclosed by name in `coverage.not_included` rather than silently omitted (F12
// incompleteness danger). A source read that fails is disclosed in `coverage.unavailable` and its
// collection is dropped from `included` and returned as `[]` — never a zero count that reads as
// "you have none". A capped or unpageable read is disclosed in `coverage.partial` with the true
// in-file row_count — never a complete-count claim.
//
// saved_scripts / chart_layouts are each a point-in-time, owner-filtered page of that table on
// the same authenticated DB client. There is no cross-service atomic snapshot: other collections
// may change while one is read. Schema evidence is live-supabase-metadata.json pg_catalog
// (readonly metadata, no customer rows): saved_scripts = id,user_id,name,lang,source,params,
// is_public,updated_at,created_at; chart_layouts = id,user_id,name,config,updated_at,created_at.
// Neither table carries is_locked/is_builtin/source_kind. name is NOTNULL text — '' is valid.
//
// Watchlists/positions I/O is injected by the caller. Scripts/layouts also expose
// `readSavedScriptsForExport` / `readChartLayoutsForExport` for the authenticated route; both
// reuse the caller's RLS-scoped client (no second DB reader or storage plane).

import type { DbResult, DbRow, WatchlistDb, WatchlistQuery } from "@/lib/watchlists";
import type { ServerWatchlist } from "@/lib/watchlists";
import { listWatchlists } from "@/lib/watchlists";
import type { Position } from "@/lib/portfolio";
import { accountExportPayload, canonicalExportJson, type ExportIntegrityManifest, type ExportSha256 } from "@/lib/accountExportIntegrity";

export const EXPORT_SCHEMA = "mm.terminal_account_export.v1";
export type ExportFormat = "json" | "csv";

// Bounded pagination for scripts/layouts. Callers may override in tests.
export const EXPORT_PAGE_SIZE = 100;
/** Retained-row ceiling for one collection export. */
export const EXPORT_MAX_ROWS = 1000;
/** PHYSICAL rows visited ceiling — independent of how many rows are retained. */
export const EXPORT_MAX_PHYSICAL_ROWS = 5000;
/** Pages visited ceiling — independent of how many rows are retained. */
export const EXPORT_MAX_PAGES = 50;

export type ExportPageOpts = {
  pageSize?: number;
  maxRows?: number;
  maxPhysicalRows?: number;
  maxPages?: number;
};

export type NormalizedExportPageOpts = {
  pageSize: number;
  maxRows: number;
  maxPhysicalRows: number;
  maxPages: number;
};

/** Safe finite positive-integer ceiling. Malformed values fall back — never a second reader,
 *  never an unbounded loop. */
function safeCeiling(value: unknown, fallback: number, min: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) return fallback;
  return n;
}

/** Normalize caller opts to safe finite positive-integer ceilings. A declared `maxRows`
 *  smaller than `pageSize` remains the true retained ceiling — never raised by
 *  `Math.max(pageSize)`. Omitted opts keep physical 5000 / pages 50 hard-scan defaults. */
export function normalizeExportPageOpts(opts?: ExportPageOpts): NormalizedExportPageOpts {
  const pageSize = safeCeiling(opts?.pageSize, EXPORT_PAGE_SIZE, 1);
  const maxRows = safeCeiling(opts?.maxRows, EXPORT_MAX_ROWS, 1);
  const maxPhysicalRows = safeCeiling(opts?.maxPhysicalRows, EXPORT_MAX_PHYSICAL_ROWS, 1);
  const maxPages = safeCeiling(opts?.maxPages, EXPORT_MAX_PAGES, 1);
  return { pageSize, maxRows, maxPhysicalRows, maxPages };
}

/** EN, ZH — same tuple order as lib/i18n.tsx LEX. */
export type Bilingual = readonly [string, string];

export type CoveredEntry = {
  key: string;
  what: Bilingual;
  row_count: number;
  snapshot?: Bilingual;
};
export type OmittedEntry = { key: string; what: Bilingual; why: Bilingual; how_to_ask: Bilingual };
export type UnavailableEntry = { key: string; what: Bilingual; why: Bilingual };
export type PartialEntry = { key: string; what: Bilingual; why: Bilingual };

export type SavedScriptExport = {
  id: string;
  name: string;
  lang: string;
  source: string;
  params: unknown;
  is_public: boolean;
  updated_at: string | null;
  created_at: string | null;
  version: string | null;
};

export type ChartLayoutExport = {
  id: string;
  name: string;
  config: unknown;
  updated_at: string | null;
  created_at: string | null;
  version: string | null;
};

/** Persisted physical drawing row; nested geometry and operation metadata are kept verbatim. */
export type ChartDrawingExport = {
  id: string; symbol: string; kind: string; data: unknown; created_at: string;
  /** Only the stored collection revision. Creation time is not a revision. */
  version: string | null;
};
export type AlertExport = {
  id: string; symbol: string; condition: unknown; active: boolean; created_at: string;
  /** The live alerts table has no revision/update column. */
  version: null;
};

export type CollectionRead<T> =
  | { ok: true; rows: T[]; complete: boolean; cut?: string }
  | { ok: false; error: string };

export type AccountExportDoc = {
  schema: typeof EXPORT_SCHEMA;
  generated_at: string;
  account: { user_id: string; email: string };
  coverage: {
    included: CoveredEntry[];
    not_included: OmittedEntry[];
    unavailable: UnavailableEntry[];
    partial?: PartialEntry[];
  };
  watchlists: ServerWatchlist[];
  portfolio_positions: Position[];
  saved_scripts?: SavedScriptExport[];
  chart_layouts?: ChartLayoutExport[];
  chart_drawings?: ChartDrawingExport[];
  alerts?: AlertExport[];
  integrity?: ExportIntegrityManifest;
};

export type ExportSources = {
  userId: string;
  email: string;
  generatedAt: string;
  watchlists: { ok: true; lists: ServerWatchlist[] } | { ok: false; error: string };
  positions: { ok: true; positions: Position[] } | { ok: false; error: string };
  saved_scripts?: CollectionRead<SavedScriptExport>;
  chart_layouts?: CollectionRead<ChartLayoutExport>;
  chart_drawings?: CollectionRead<ChartDrawingExport>;
  alerts?: CollectionRead<AlertExport>;
};

const UNAVAILABLE_WHY: Bilingual = [
  "We could not read this just now, so it is missing from this file. Nothing was changed.",
  "我们暂时无法读取，因此此文件中缺少这部分内容。你的数据没有任何改动。",
];

/** Per-collection snapshot interval + lack of cross-service atomicity (A10). */
const COLLECTION_SNAPSHOT: Bilingual = [
  "Per-collection snapshot interval: this table was read page-by-page at export time. There is no cross-service atomic snapshot with other collections.",
  "各集合快照区间：此表在导出时分页读取。与其他集合之间不存在跨服务原子快照。",
];

const SCRIPTS_WHAT: Bilingual = ["Your saved scripts", "你保存的脚本"];
const LAYOUTS_WHAT: Bilingual = ["Your saved chart layouts", "你保存的图表布局"];

const DRAWINGS_WHAT: Bilingual = ["Your saved chart drawings", "你保存的图表画线"];
const ALERTS_WHAT: Bilingual = ["Your saved alert definitions", "你保存的提醒定义"];

const ASK_SUPPORT: Bilingual = ["Ask support and we will send them to you.", "联系客服，我们会发送给你。"];
const NOT_IN_FILE_YET: Bilingual = [
  "They are not in this file yet. We would rather tell you than quietly leave them out.",
  "目前尚未包含在此文件中。与其悄悄省略，不如直接告诉你。",
];

/** Frozen §3.2 disclosure text — do not reuse #515 §2.4's wording, which promises categories
 *  this file does not contain. Combined keys remain the legacy (no new sources) shape. */
const NOT_INCLUDED_LEGACY: OmittedEntry[] = [
  {
    key: "chart_layouts_and_drawings",
    what: ["Saved chart layouts and drawings", "已保存的图表布局与画线"],
    why: NOT_IN_FILE_YET,
    how_to_ask: ASK_SUPPORT,
  },
  {
    key: "alerts_and_saved_scripts",
    what: ["Alerts and saved scripts", "提醒与已保存的脚本"],
    why: NOT_IN_FILE_YET,
    how_to_ask: ASK_SUPPORT,
  },
  {
    key: "chat_history",
    what: ["Your chat conversations", "你的对话记录"],
    why: NOT_IN_FILE_YET,
    how_to_ask: ASK_SUPPORT,
  },
  {
    key: "usage_records",
    what: ["Site usage records", "网站使用记录"],
    why: [
      "These are tracked by a browser or device identifier rather than stored as part of your account, so they are handled separately.",
      "这些记录通过浏览器或设备标识追踪，而非作为账户资料存储，因此单独处理。",
    ],
    how_to_ask: [
      "Contact support and name this category; we will explain what is kept and why.",
      "请联系客服并说明此类别；我们会解释保留了哪些内容及原因。",
    ],
  },
  {
    key: "profile_and_plan",
    what: ["Your name, email, sign-in method and plan", "你的姓名、邮箱、登录方式与订阅方案"],
    why: ["These live on your account page, not in this file.", "这些信息在账户页面，而不在此文件中。"],
    how_to_ask: ["Open your account page to see them.", "打开账户页面即可查看。"],
  },
  {
    key: "payment_records",
    what: ["Payment records", "付款记录"],
    why: [
      "Your payment provider keeps its own record of your payments, separate from this file.",
      "支付服务商会单独保存你的付款记录，与此文件分开。",
    ],
    how_to_ask: [
      "Find your receipts in the billing portal, or ask support for a copy.",
      "可在账单门户中查看收据，或联系客服索取副本。",
    ],
  },
  {
    key: "download_allowance",
    what: ["Download allowance counts", "下载额度计数"],
    why: ["This is a monthly usage count, not account content.", "这只是每月使用次数统计，不属于账户内容。"],
    how_to_ask: ["Contact support if you want to know your current count.", "如需了解当前计数，请联系客服。"],
  },
];

const OMISSION_CHART_DRAWINGS: OmittedEntry = {
  key: "chart_drawings",
  what: ["Saved chart drawings", "已保存的图表画线"],
  why: NOT_IN_FILE_YET,
  how_to_ask: ASK_SUPPORT,
};

const OMISSION_ALERTS: OmittedEntry = {
  key: "alerts",
  what: ["Alerts", "提醒"],
  why: NOT_IN_FILE_YET,
  how_to_ask: ASK_SUPPORT,
};

const REMAINING_WORK_OMISSIONS: OmittedEntry[] = [
  { key: "research_theses_and_versions", what: ["Saved research theses and their versions", "保存的研究论点及其版本"], why: NOT_IN_FILE_YET, how_to_ask: ASK_SUPPORT },
  { key: "investigations_and_revisions", what: ["Saved investigations, revisions and mutation receipts", "保存的调查、修订及变更记录"], why: NOT_IN_FILE_YET, how_to_ask: ASK_SUPPORT },
  { key: "chart_layout_revisions", what: ["Historical chart layout revisions", "图表布局的历史修订"], why: NOT_IN_FILE_YET, how_to_ask: ASK_SUPPORT },
  { key: "favorites_briefs_and_device_local_work", what: ["Research favorites, briefs and work saved only on a device", "研究收藏、简报及仅保存在设备上的内容"], why: NOT_IN_FILE_YET,
    how_to_ask: ["Keep a separate copy of device-local work; contact support about stored favorites and briefs.", "请另行保存设备上的内容；存储的收藏和简报可咨询客服。"] },
];

function notIncludedFor(src: ExportSources): OmittedEntry[] {
  const hasScripts = src.saved_scripts !== undefined;
  const hasLayouts = src.chart_layouts !== undefined;
  const hasDrawings = src.chart_drawings !== undefined;
  const hasAlerts = src.alerts !== undefined;
  if (!hasScripts && !hasLayouts && !hasDrawings && !hasAlerts) return NOT_INCLUDED_LEGACY;
  const omitted = NOT_INCLUDED_LEGACY.flatMap((entry): OmittedEntry[] => {
    if (entry.key === "chart_layouts_and_drawings" && (hasLayouts || hasDrawings)) {
      if (hasLayouts && hasDrawings) return [];
      return hasLayouts ? [OMISSION_CHART_DRAWINGS] : [{ key: "chart_layouts", what: LAYOUTS_WHAT, why: NOT_IN_FILE_YET, how_to_ask: ASK_SUPPORT }];
    }
    if (entry.key === "alerts_and_saved_scripts" && (hasScripts || hasAlerts)) {
      if (hasScripts && hasAlerts) return [];
      return hasScripts ? [OMISSION_ALERTS] : [{ key: "saved_scripts", what: SCRIPTS_WHAT, why: NOT_IN_FILE_YET, how_to_ask: ASK_SUPPORT }];
    }
    return [entry];
  });
  return hasDrawings || hasAlerts ? [...omitted, ...REMAINING_WORK_OMISSIONS] : omitted;
}

function covered(
  key: string,
  what: Bilingual,
  rowCount: number,
  withSnapshot: boolean,
): CoveredEntry {
  return withSnapshot
    ? { key, what, row_count: rowCount, snapshot: COLLECTION_SNAPSHOT }
    : { key, what, row_count: rowCount };
}

export function buildAccountExport(src: ExportSources): AccountExportDoc {
  const included: CoveredEntry[] = [];
  const unavailable: UnavailableEntry[] = [];
  const partial: PartialEntry[] = [];

  const watchlists: ServerWatchlist[] = src.watchlists.ok ? src.watchlists.lists : [];
  if (src.watchlists.ok) {
    const rowCount = src.watchlists.lists.reduce((n, l) => n + l.symbols.length, 0);
    included.push(covered(
      "watchlists",
      ["Your watchlists and the symbols in them", "你的自选列表及其中的代码"],
      rowCount,
      false,
    ));
  } else {
    unavailable.push({
      key: "watchlists",
      what: ["Your watchlists and the symbols in them", "你的自选列表及其中的代码"],
      why: UNAVAILABLE_WHY,
    });
  }

  const positions: Position[] = src.positions.ok ? src.positions.positions : [];
  if (src.positions.ok) {
    included.push(covered(
      "portfolio_positions",
      ["Your recorded positions, open and closed", "你记录的持仓（含已平仓）"],
      src.positions.positions.length,
      false,
    ));
  } else {
    unavailable.push({
      key: "portfolio_positions",
      what: ["Your recorded positions, open and closed", "你记录的持仓（含已平仓）"],
      why: UNAVAILABLE_WHY,
    });
  }

  const hasScripts = src.saved_scripts !== undefined;
  const hasLayouts = src.chart_layouts !== undefined;

  let saved_scripts: SavedScriptExport[] | undefined;
  if (hasScripts) {
    const read = src.saved_scripts!;
    if (read.ok) {
      saved_scripts = read.rows;
      included.push(covered("saved_scripts", SCRIPTS_WHAT, read.rows.length, true));
      if (!read.complete) {
        partial.push({
          key: "saved_scripts",
          what: SCRIPTS_WHAT,
          why: partialWhy(read.cut),
        });
      }
    } else {
      saved_scripts = [];
      unavailable.push({ key: "saved_scripts", what: SCRIPTS_WHAT, why: UNAVAILABLE_WHY });
    }
  }

  let chart_layouts: ChartLayoutExport[] | undefined;
  if (hasLayouts) {
    const read = src.chart_layouts!;
    if (read.ok) {
      chart_layouts = read.rows;
      included.push(covered("chart_layouts", LAYOUTS_WHAT, read.rows.length, true));
      if (!read.complete) {
        partial.push({
          key: "chart_layouts",
          what: LAYOUTS_WHAT,
          why: partialWhy(read.cut),
        });
      }
    } else {
      chart_layouts = [];
      unavailable.push({ key: "chart_layouts", what: LAYOUTS_WHAT, why: UNAVAILABLE_WHY });
    }
  }

  function appendOwnedCollection<T>(key: string, what: Bilingual, read: CollectionRead<T> | undefined): T[] | undefined {
    if (read === undefined) return undefined;
    if (!read.ok) {
      unavailable.push({ key, what, why: UNAVAILABLE_WHY });
      return [];
    }
    included.push(covered(key, what, read.rows.length, true));
    if (!read.complete) partial.push({ key, what, why: partialWhy(read.cut) });
    return read.rows;
  }
  const chartDrawings = appendOwnedCollection("chart_drawings", DRAWINGS_WHAT, src.chart_drawings);
  const alerts = appendOwnedCollection("alerts", ALERTS_WHAT, src.alerts);

  const coverage: AccountExportDoc["coverage"] = {
    included,
    not_included: notIncludedFor(src),
    unavailable,
  };
  if (partial.length) coverage.partial = partial;

  const doc: AccountExportDoc = {
    schema: EXPORT_SCHEMA,
    generated_at: src.generatedAt,
    account: { user_id: src.userId, email: src.email },
    coverage,
    watchlists,
    portfolio_positions: positions,
  };
  if (hasScripts) doc.saved_scripts = saved_scripts;
  if (hasLayouts) doc.chart_layouts = chart_layouts;
  if (src.chart_drawings !== undefined) doc.chart_drawings = chartDrawings;
  if (src.alerts !== undefined) doc.alerts = alerts;
  return doc;
}

function partialWhy(cut?: string): Bilingual {
  const detail = cut && cut.trim() ? ` ${cut.trim()}.` : "";
  return [
    `This file holds a partial page of this collection, not a complete count.${detail} The row_count is the rows in this file.`,
    `此文件只包含该集合的部分页，不是完整计数。${detail} row_count 是本文件中的行数。`,
  ];
}

export function serializeJson(doc: AccountExportDoc): string {
  return JSON.stringify(doc, null, 2);
}

// ---- CSV ------------------------------------------------------------------

const NEEDS_QUOTE = /[,"\r\n]/;
// Formula-injection guard: a value whose first character is one of these gets a leading `'`.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvField(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  // The formula-injection guard is a text-field concern (a name/note typed by the user, or a
  // spreadsheet app's own reader deciding a leading char makes a cell a formula). A genuine
  // `number` (shares, entry_price) is never spreadsheet-executable text — escaping it corrupted
  // every negative value (`-100` -> `'-100`, a fidelity loss on a data-portability artifact;
  // review MINOR round 2). Only string-typed values get the guard.
  const isNumber = typeof raw === "number";
  let value = typeof raw === "string" ? raw : String(raw);
  if (!isNumber && FORMULA_LEAD.test(value)) value = "'" + value;
  if (NEEDS_QUOTE.test(value)) value = '"' + value.replace(/"/g, '""') + '"';
  return value;
}

function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function serializeCsv(doc: AccountExportDoc, sha256?: ExportSha256): string {
  const BOM = "\ufeff";
  let out = BOM + csvRow(["section", "dataset", "row_id", "field", "value"]);

  for (const entry of doc.coverage.included) {
    out += csvRow(["coverage", "included", entry.key, "what_en", entry.what[0]]);
    out += csvRow(["coverage", "included", entry.key, "what_zh", entry.what[1]]);
    out += csvRow(["coverage", "included", entry.key, "row_count", entry.row_count]);
    if (entry.snapshot) {
      out += csvRow(["coverage", "included", entry.key, "snapshot_en", entry.snapshot[0]]);
      out += csvRow(["coverage", "included", entry.key, "snapshot_zh", entry.snapshot[1]]);
    }
  }
  for (const entry of doc.coverage.not_included) {
    out += csvRow(["coverage", "not_included", entry.key, "what_en", entry.what[0]]);
    out += csvRow(["coverage", "not_included", entry.key, "what_zh", entry.what[1]]);
    out += csvRow(["coverage", "not_included", entry.key, "why_en", entry.why[0]]);
    out += csvRow(["coverage", "not_included", entry.key, "why_zh", entry.why[1]]);
    out += csvRow(["coverage", "not_included", entry.key, "how_to_ask_en", entry.how_to_ask[0]]);
    out += csvRow(["coverage", "not_included", entry.key, "how_to_ask_zh", entry.how_to_ask[1]]);
  }
  for (const entry of doc.coverage.unavailable) {
    out += csvRow(["coverage", "unavailable", entry.key, "what_en", entry.what[0]]);
    out += csvRow(["coverage", "unavailable", entry.key, "what_zh", entry.what[1]]);
    out += csvRow(["coverage", "unavailable", entry.key, "why_en", entry.why[0]]);
    out += csvRow(["coverage", "unavailable", entry.key, "why_zh", entry.why[1]]);
  }
  for (const entry of doc.coverage.partial ?? []) {
    out += csvRow(["coverage", "partial", entry.key, "what_en", entry.what[0]]);
    out += csvRow(["coverage", "partial", entry.key, "what_zh", entry.what[1]]);
    out += csvRow(["coverage", "partial", entry.key, "why_en", entry.why[0]]);
    out += csvRow(["coverage", "partial", entry.key, "why_zh", entry.why[1]]);
  }

  for (const list of doc.watchlists) {
    // An empty watchlist (a real list the owner named but never added a symbol to) had zero
    // iterations of the inner loop below, so its `list_name` — the only place its existence was
    // recorded in this CSV — was never written and the list silently disappeared from the export
    // (review MINOR round 3). A 0-symbol list now gets exactly one `list_name` row of its own;
    // a populated list keeps the prior per-symbol row shape unchanged.
    if (list.symbols.length === 0) {
      out += csvRow(["data", "watchlists", list.id, "list_name", list.name]);
      continue;
    }
    for (const sym of list.symbols) {
      out += csvRow(["data", "watchlists", list.id, "list_name", list.name]);
      out += csvRow(["data", "watchlists", list.id, "symbol", sym.symbol]);
      out += csvRow(["data", "watchlists", list.id, "section_label", sym.section]);
      out += csvRow(["data", "watchlists", list.id, "position", sym.position]);
    }
  }

  for (const pos of doc.portfolio_positions) {
    out += csvRow(["data", "portfolio_positions", pos.id, "ticker", pos.ticker]);
    out += csvRow(["data", "portfolio_positions", pos.id, "shares", pos.shares]);
    out += csvRow(["data", "portfolio_positions", pos.id, "entry_price", pos.entryPrice]);
    out += csvRow(["data", "portfolio_positions", pos.id, "entry_date", pos.entryDate]);
    out += csvRow(["data", "portfolio_positions", pos.id, "notes", pos.notes]);
    out += csvRow(["data", "portfolio_positions", pos.id, "status", pos.status]);
    out += csvRow(["data", "portfolio_positions", pos.id, "created_at", pos.createdAt]);
  }

  for (const script of doc.saved_scripts ?? []) {
    out += csvRow(["data", "saved_scripts", script.id, "name", script.name]);
    out += csvRow(["data", "saved_scripts", script.id, "lang", script.lang]);
    out += csvRow(["data", "saved_scripts", script.id, "source", script.source]);
    out += csvRow(["data", "saved_scripts", script.id, "params", jsonCell(script.params)]);
    out += csvRow(["data", "saved_scripts", script.id, "is_public", script.is_public]);
    out += csvRow(["data", "saved_scripts", script.id, "updated_at", script.updated_at]);
    out += csvRow(["data", "saved_scripts", script.id, "created_at", script.created_at]);
    out += csvRow(["data", "saved_scripts", script.id, "version", script.version]);
  }

  for (const layout of doc.chart_layouts ?? []) {
    out += csvRow(["data", "chart_layouts", layout.id, "name", layout.name]);
    out += csvRow(["data", "chart_layouts", layout.id, "config", jsonCell(layout.config)]);
    out += csvRow(["data", "chart_layouts", layout.id, "updated_at", layout.updated_at]);
    out += csvRow(["data", "chart_layouts", layout.id, "created_at", layout.created_at]);
    out += csvRow(["data", "chart_layouts", layout.id, "version", layout.version]);
  }

  for (const drawing of doc.chart_drawings ?? []) {
    out += csvRow(["data", "chart_drawings", drawing.id, "symbol", drawing.symbol]);
    out += csvRow(["data", "chart_drawings", drawing.id, "kind", drawing.kind]);
    out += csvRow(["data", "chart_drawings", drawing.id, "data", jsonCell(drawing.data)]);
    out += csvRow(["data", "chart_drawings", drawing.id, "created_at", drawing.created_at]);
    out += csvRow(["data", "chart_drawings", drawing.id, "version", drawing.version]);
  }
  for (const alert of doc.alerts ?? []) {
    out += csvRow(["data", "alerts", alert.id, "symbol", alert.symbol]);
    out += csvRow(["data", "alerts", alert.id, "condition", jsonCell(alert.condition)]);
    out += csvRow(["data", "alerts", alert.id, "active", alert.active]);
    out += csvRow(["data", "alerts", alert.id, "created_at", alert.created_at]);
    out += csvRow(["data", "alerts", alert.id, "version", alert.version]);
  }

  if (doc.integrity) {
    if (!sha256) throw new Error("sealed CSV requires SHA256");
    // The legacy row view is useful in spreadsheets but cannot reconstruct all JSON
    // relationships or distinguish null from empty strings. Include the exact logical
    // payload and receipt as JSON cells, then bind all preceding CSV bytes too.
    out += csvRow(["artifact", "logical_json", "", "canonical_json", canonicalExportJson(accountExportPayload(doc))]);
    out += csvRow(["integrity", "manifest", "", "canonical_json", canonicalExportJson(doc.integrity)]);
    const checksum = sha256(out);
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error("invalid CSV SHA256 result");
    out += csvRow(["integrity", "csv_bytes", "", "sha256", checksum]);
  }
  return out;
}

export function exportFilename(doc: AccountExportDoc, format: ExportFormat): string {
  const date = doc.generated_at.slice(0, 10);
  return `mastermind-terminal-data-${date}.${format}`;
}

// Structural, not substring: a watchlist named "Secret picks" or a note reading "changed
// password" must NOT withhold the export (review MAJOR acceptance-1/6) — only a value that
// is actually SHAPED like a credential (key=value, a bearer token, a session cookie, a JWT)
// trips this. Plain prose that merely mentions one of these words never matches.
const SECRET_PATTERNS: Array<{ label: string; test: (raw: string) => boolean }> = [
  { label: "jwt", test: (raw) => /\beyJ[A-Za-z0-9_-]{10,}\./.test(raw) },
  { label: "bearer_token", test: (raw) => /\bbearer\s+[A-Za-z0-9._-]{6,}/i.test(raw) },
  { label: "sb_cookie", test: (raw) => /\bsb-[a-z0-9_-]{2,}=\S/i.test(raw) },
  {
    label: "key_value_secret",
    test: (raw) =>
      /\b(password|secret|access_token|refresh_token|service_role|api[_-]?key|authorization)\b\s*[:=]\s*\S{4,}/i.test(
        raw,
      ),
  },
];

export function assertNoSecrets(serialized: string): { ok: true } | { ok: false; hit: string } {
  // JSON keys are quoted, so text key=value patterns alone miss raw nested user
  // content such as a condition/params object containing an api_key string.
  // Null/empty values and prose mentioning credentials are not secret-shaped.
  const secretKey = /^(password|secret|access_token|refresh_token|service_role|api[_-]?key|authorization)$/i;
  function hasStructuredSecret(value: unknown): boolean {
    const pending: unknown[] = [value];
    while (pending.length) {
      const item = pending.pop();
      if (item === null || typeof item !== "object") continue;
      for (const [key, entry] of Object.entries(item)) {
        if (secretKey.test(key) && typeof entry === "string" && entry.trim().length >= 4) return true;
        if (entry !== null && typeof entry === "object") pending.push(entry);
      }
    }
    return false;
  }
  try {
    if (hasStructuredSecret(JSON.parse(serialized))) return { ok: false, hit: "json_key_value_secret" };
  } catch { /* Non-JSON text/CSV keeps the existing text-pattern checks below. */ }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) return { ok: false, hit: pattern.label };
  }
  return { ok: true };
}

/** Error-distinguishing watchlist read. `listWatchlists` cannot fail on its own (its row helper
 *  collapses a driver error into `[]`), so an outage would otherwise render as "you have no
 *  watchlists" — exactly the incompleteness danger F12 names. Probe first, then shape with the
 *  shipped function; no query logic is duplicated. */
export async function readWatchlistsForExport(
  db: WatchlistDb,
  userId: string,
): Promise<{ ok: true; lists: ServerWatchlist[] } | { ok: false; error: string }> {
  let probe: { data?: unknown; error?: { message?: string } | null };
  try {
    probe = await db.from("watchlists").select("id").eq("user_id", userId).limit(1);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "watchlist probe failed" };
  }
  if (probe?.error) return { ok: false, error: probe.error.message || "watchlist probe failed" };
  return { ok: true, lists: await listWatchlists(db, userId) };
}

// ---- saved_scripts / chart_layouts (same authenticated client, owner-filtered) ----

// LIVE SCHEMA ONLY — live-supabase-metadata.json readonly pg_catalog (no customer rows):
//   saved_scripts: id,user_id,name,lang,source,params,is_public,updated_at,created_at
//   chart_layouts: id,user_id,name,config,updated_at,created_at
// Neither table has is_locked / is_builtin / source_kind / version. Catalog-owned proprietary
// built-ins are NOT rows in these owner tables; do not invent lock-column filters.
// name is text NOTNULL — `''` and whitespace are valid saved_scripts/chart_layouts data.
const SCRIPT_FIELDS = "id,user_id,name,lang,source,params,is_public,updated_at,created_at";
const LAYOUT_FIELDS = "id,user_id,name,config,updated_at,created_at";
// Read-only live pg_catalog evidence, 2026-10-09: exactly these six columns per table.
// No updated_at/version exists; no delivery/outbox/webhook-secret table is read.
const DRAWING_FIELDS = "id,user_id,symbol,kind,data,created_at";
const ALERT_FIELDS = "id,user_id,symbol,condition,active,created_at";

type RangeQuery = WatchlistQuery & {
  range?: (from: number, to: number) => PromiseLike<DbResult> | WatchlistQuery;
};

type Mapped<T extends { id: string }> = { kind: "invalid" } | { kind: "drop" } | { kind: "ok"; value: T };

function rowVersion(row: DbRow): string | null {
  // live schema has no version column; derived snapshot version falls back to updated_at.
  if ("version" in row) {
    return typeof row.version === "string" && row.version ? row.version : null;
  }
  return typeof row.updated_at === "string" && row.updated_at ? row.updated_at : null;
}

/** Owner mismatch only. No lock/builtin/proprietary columns exist on the live tables. */
function isForeignRow(row: DbRow, userId: string): boolean {
  return row.user_id != null && row.user_id !== userId;
}

function mapScript(row: DbRow, userId: string): Mapped<SavedScriptExport> {
  if (isForeignRow(row, userId)) return { kind: "drop" };
  const id = typeof row.id === "string" && row.id ? row.id : "";
  // Preserve raw valid names including '' and surrounding whitespace (live NOTNULL text).
  const nameOk = typeof row.name === "string";
  const name = nameOk ? (row.name as string) : "";
  const langOk = typeof row.lang === "string";
  const lang = langOk ? (row.lang as string) : "";
  const sourceOk = typeof row.source === "string";
  const paramsOk = row.params !== undefined && row.params !== null;
  if (!id || !nameOk || !langOk || !sourceOk || !paramsOk) return { kind: "invalid" };
  return {
    kind: "ok",
    value: {
      id,
      name,
      lang,
      source: row.source as string,
      params: row.params,
      is_public: row.is_public === true,
      updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
      created_at: typeof row.created_at === "string" ? row.created_at : null,
      version: rowVersion(row),
    },
  };
}

function mapLayout(row: DbRow, userId: string): Mapped<ChartLayoutExport> {
  if (isForeignRow(row, userId)) return { kind: "drop" };
  const id = typeof row.id === "string" && row.id ? row.id : "";
  const nameOk = typeof row.name === "string";
  const name = nameOk ? (row.name as string) : "";
  const configOk = row.config !== undefined && row.config !== null;
  if (!id || !nameOk || !configOk) return { kind: "invalid" };
  return {
    kind: "ok",
    value: {
      id,
      name,
      config: row.config,
      updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
      created_at: typeof row.created_at === "string" ? row.created_at : null,
      version: rowVersion(row),
    },
  };
}

function mapDrawing(row: DbRow, userId: string): Mapped<ChartDrawingExport> {
  if (row.user_id !== userId) return row.user_id == null ? { kind: "invalid" } : { kind: "drop" };
  if (typeof row.id !== "string" || !row.id || typeof row.symbol !== "string" ||
      typeof row.kind !== "string" || typeof row.created_at !== "string" || row.data === undefined) return { kind: "invalid" };
  const data = row.data;
  const revision = row.kind === "__collection_v1" && data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>).revision : null;
  return { kind: "ok", value: { id: row.id, symbol: row.symbol, kind: row.kind, data,
    created_at: row.created_at, version: typeof revision === "string" && revision ? revision : null } };
}

function mapAlert(row: DbRow, userId: string): Mapped<AlertExport> {
  if (row.user_id !== userId) return row.user_id == null ? { kind: "invalid" } : { kind: "drop" };
  if (typeof row.id !== "string" || !row.id || typeof row.symbol !== "string" ||
      typeof row.active !== "boolean" || typeof row.created_at !== "string" || row.condition === undefined) return { kind: "invalid" };
  return { kind: "ok", value: { id: row.id, symbol: row.symbol, condition: row.condition,
    active: row.active, created_at: row.created_at, version: null } };
}

function rowsOf(result: DbResult): DbRow[] | null {
  if (result?.error) return null;
  if (!Array.isArray(result?.data)) return null;
  return result.data as DbRow[];
}

async function readPage(
  db: WatchlistDb,
  table: string,
  userId: string,
  fields: string,
  from: number,
  to: number,
): Promise<{ result: DbResult; rangePaged: boolean; rangeMissing: boolean }> {
  // Owner scope is mandatory on every page: RLS + explicit .eq(user_id).
  const q = db.from(table).select(fields).eq("user_id", userId).order("id", { ascending: true }) as RangeQuery;
  const span = to - from + 1;
  if (typeof q.range === "function") {
    const ranged = q.range(from, to);
    const result = (await ranged) as DbResult;
    const count = Array.isArray(result?.data) ? result.data.length : 0;
    // rangePaged only when the driver returned no more than the requested span.
    return { result, rangePaged: count <= span, rangeMissing: false };
  }
  if (from !== 0) {
    return {
      result: { data: [], error: { message: `${table} read requires range() pagination for offset ${from}` } },
      rangePaged: false,
      rangeMissing: true,
    };
  }
  const result = (await q.limit(span)) as DbResult;
  return { result, rangePaged: false, rangeMissing: true };
}

/**
 * One owner-scoped, physically bounded scan. Physical rows/pages visited are capped
 * independently of retained rows so pages of rejected/foreign/duplicate rows cannot scan
 * indefinitely. `complete:true` only when every physical row examined was a retained owned
 * row, a short final page was observed, and no ceiling/hard-stop/rejection/overflow occurred.
 * Any invalid, dropped, duplicate, or retained-overflow row forces explicit partial —
 * a short final page never implies completeness after dropped data.
 */
async function readBoundedCollection<T extends { id: string }>(
  db: WatchlistDb,
  table: string,
  userId: string,
  fields: string,
  mapRow: (row: DbRow, userId: string) => Mapped<T>,
  opts?: ExportPageOpts,
): Promise<CollectionRead<T>> {
  const { pageSize, maxRows, maxPhysicalRows, maxPages } = normalizeExportPageOpts(opts);
  const collected: T[] = [];
  const seenIds = new Set<string>();
  let from = 0;
  let pagesVisited = 0;
  let physicalRows = 0;
  let sawShortPage = false;
  let untrustedRange = false;
  let hardStop = false;
  let cut = "";
  let rangeCut = "";
  let totalInvalid = 0;
  let totalDropped = 0;
  let totalDuplicates = 0;
  let totalRetainedOverflow = 0;

  try {
    for (;;) {
      if (pagesVisited >= maxPages) {
        cut = `page ceiling ${maxPages} pages visited`;
        hardStop = true;
        break;
      }
      if (physicalRows >= maxPhysicalRows) {
        cut = `physical row ceiling ${maxPhysicalRows} rows visited`;
        hardStop = true;
        break;
      }
      if (collected.length >= maxRows) {
        cut = `export cap ${maxRows} rows`;
        hardStop = true;
        break;
      }

      const take = Math.min(pageSize, maxPhysicalRows - physicalRows);
      if (take <= 0) {
        cut = `physical row ceiling ${maxPhysicalRows} rows visited`;
        hardStop = true;
        break;
      }

      const page = await readPage(db, table, userId, fields, from, from + take - 1);
      pagesVisited += 1;
      if (page.result?.error) {
        const message = page.result.error.message || `${table} read failed`;
        return { ok: false, error: message };
      }
      const raw = rowsOf(page.result);
      if (!raw) return { ok: false, error: `${table} read returned no row set` };

      const delivered = raw.length;
      const room = Math.max(0, maxPhysicalRows - physicalRows);
      const toProcess = delivered > room ? raw.slice(0, room) : raw;
      const overflowPhysical = delivered - toProcess.length;
      physicalRows += toProcess.length;

      if (!page.rangePaged) {
        untrustedRange = true;
        rangeCut = page.rangeMissing
          ? "no range() pagination; export is a partial read"
          : "driver range() did not page; export is a partial read";
      }

      let invalid = 0;
      let dropped = 0;
      let duplicates = 0;
      let kept = 0;
      let retainedOverflow = 0;

      for (const row of toProcess) {
        const mapped = mapRow(row, userId);
        if (mapped.kind === "invalid") {
          invalid += 1;
        } else if (mapped.kind === "drop") {
          dropped += 1;
        } else if (seenIds.has(mapped.value.id)) {
          duplicates += 1;
        } else if (collected.length < maxRows) {
          seenIds.add(mapped.value.id);
          collected.push(mapped.value);
          kept += 1;
        } else {
          // Valid owned unique row dropped by the retained-row ceiling.
          retainedOverflow += 1;
        }
      }
      totalInvalid += invalid;
      totalDropped += dropped;
      totalDuplicates += duplicates;
      totalRetainedOverflow += retainedOverflow;

      if (toProcess.length > 0 && kept === 0 && invalid === toProcess.length && dropped === 0 && duplicates === 0 && retainedOverflow === 0) {
        return { ok: false, error: `${table} rows missing required collection fields` };
      }

      if (toProcess.length > 0 && kept === 0 && retainedOverflow === 0) {
        // All-rejected page hard stop — never complete success, never unbounded rescan.
        cut = `page ${pagesVisited}: all ${toProcess.length} rows rejected (invalid=${invalid} foreign/drop=${dropped} duplicate=${duplicates}); scan hard-stopped`;
        hardStop = true;
        break;
      }

      if (overflowPhysical > 0) {
        cut = `physical row ceiling ${maxPhysicalRows} rows visited; ${overflowPhysical} delivered rows not processed`;
        hardStop = true;
        break;
      }

      if (retainedOverflow > 0) {
        cut = `export cap ${maxRows} rows; dropped ${totalRetainedOverflow} retained overflow`;
        hardStop = true;
        break;
      }

      if (untrustedRange) {
        // No safe offset advance — one response only.
        break;
      }

      if (toProcess.length < take) {
        sawShortPage = true;
        break;
      }

      from += take;
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : `${table} read failed` };
  }

  const rejected = totalInvalid + totalDropped + totalDuplicates;

  if (untrustedRange) {
    return {
      ok: true,
      rows: collected,
      complete: false,
      cut: rangeCut || cut || "range() untrusted; export is partial",
    };
  }
  if (hardStop) {
    return { ok: true, rows: collected, complete: false, cut: cut || "bounded scan stopped before complete read" };
  }
  if (!sawShortPage) {
    return { ok: true, rows: collected, complete: false, cut: cut || "scan ended without a short page" };
  }
  if (rejected > 0) {
    return {
      ok: true,
      rows: collected,
      complete: false,
      cut: `rejected rows during scan (invalid=${totalInvalid} foreign=${totalDropped} duplicate=${totalDuplicates}); not a complete count`,
    };
  }
  return { ok: true, rows: collected, complete: true };
}

/** Thin owner-scoped reader — single bounded scan, no second reader. */
export async function readSavedScriptsForExport(
  db: WatchlistDb,
  userId: string,
  opts?: ExportPageOpts,
): Promise<CollectionRead<SavedScriptExport>> {
  return readBoundedCollection(db, "saved_scripts", userId, SCRIPT_FIELDS, mapScript, opts);
}

/** Thin owner-scoped reader — single bounded scan, no second reader. */
export async function readChartLayoutsForExport(
  db: WatchlistDb,
  userId: string,
  opts?: ExportPageOpts,
): Promise<CollectionRead<ChartLayoutExport>> {
  return readBoundedCollection(db, "chart_layouts", userId, LAYOUT_FIELDS, mapLayout, opts);
}


/** Raw persisted rows on the existing authenticated client, including legacy drawing kinds. */
export async function readChartDrawingsForExport(db: WatchlistDb, userId: string, opts?: ExportPageOpts): Promise<CollectionRead<ChartDrawingExport>> {
  return readBoundedCollection(db, "drawings", userId, DRAWING_FIELDS, mapDrawing, opts);
}

/** Saved alert definitions only, preserving condition payloads and inactive/triggered rows. */
export async function readAlertsForExport(db: WatchlistDb, userId: string, opts?: ExportPageOpts): Promise<CollectionRead<AlertExport>> {
  return readBoundedCollection(db, "alerts", userId, ALERT_FIELDS, mapAlert, opts);
}
