// accountExport.ts — pure builder for the self-serve "download my data" artifact (B-F12-4).
//
// This module owns ONLY the Terminal's two own-tables (watchlists, portfolio positions). It is
// deliberately NOT a whole-account export: chart layouts/drawings, alerts/scripts, chat history,
// usage records, profile/plan, payment records and the download allowance all live elsewhere and
// are disclosed by name in `coverage.not_included` rather than silently omitted (F12 incompleteness
// danger). A source read that fails is disclosed in `coverage.unavailable` and its collection is
// dropped from `included` and returned as `[]` — never a zero count that reads as "you have none".
//
// No I/O happens here except the two injected reads the caller performs before calling
// `buildAccountExport`; everything below is pure and unit-testable without a database.

import type { ServerWatchlist, WatchlistDb } from "@/lib/watchlists";
import { listWatchlists } from "@/lib/watchlists";
import type { Position } from "@/lib/portfolio";

export const EXPORT_SCHEMA = "mm.terminal_account_export.v1";
export type ExportFormat = "json" | "csv";

/** EN, ZH — same tuple order as lib/i18n.tsx LEX. */
export type Bilingual = readonly [string, string];

export type CoveredEntry = { key: string; what: Bilingual; row_count: number };
export type OmittedEntry = { key: string; what: Bilingual; why: Bilingual; how_to_ask: Bilingual };
export type UnavailableEntry = { key: string; what: Bilingual; why: Bilingual };

export type AccountExportDoc = {
  schema: typeof EXPORT_SCHEMA;
  generated_at: string;
  account: { user_id: string; email: string };
  coverage: {
    included: CoveredEntry[];
    not_included: OmittedEntry[];
    unavailable: UnavailableEntry[];
  };
  watchlists: ServerWatchlist[];
  portfolio_positions: Position[];
};

export type ExportSources = {
  userId: string;
  email: string;
  generatedAt: string;
  watchlists: { ok: true; lists: ServerWatchlist[] } | { ok: false; error: string };
  positions: { ok: true; positions: Position[] } | { ok: false; error: string };
};

const UNAVAILABLE_WHY: Bilingual = [
  "We could not read this just now, so it is missing from this file. Nothing was changed.",
  "我们暂时无法读取，因此此文件中缺少这部分内容。你的数据没有任何改动。",
];

/** Frozen §3.2 disclosure text — do not reuse #515 §2.4's wording, which promises categories
 *  this file does not contain. */
const NOT_INCLUDED: OmittedEntry[] = [
  {
    key: "chart_layouts_and_drawings",
    what: ["Saved chart layouts and drawings", "已保存的图表布局与画线"],
    why: [
      "They are not in this file yet. We would rather tell you than quietly leave them out.",
      "目前尚未包含在此文件中。与其悄悄省略，不如直接告诉你。",
    ],
    how_to_ask: ["Ask support and we will send them to you.", "联系客服，我们会发送给你。"],
  },
  {
    key: "alerts_and_saved_scripts",
    what: ["Alerts and saved scripts", "提醒与已保存的脚本"],
    why: [
      "They are not in this file yet. We would rather tell you than quietly leave them out.",
      "目前尚未包含在此文件中。与其悄悄省略，不如直接告诉你。",
    ],
    how_to_ask: ["Ask support and we will send them to you.", "联系客服，我们会发送给你。"],
  },
  {
    key: "chat_history",
    what: ["Your chat conversations", "你的对话记录"],
    why: [
      "They are not in this file yet. We would rather tell you than quietly leave them out.",
      "目前尚未包含在此文件中。与其悄悄省略，不如直接告诉你。",
    ],
    how_to_ask: ["Ask support and we will send them to you.", "联系客服，我们会发送给你。"],
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

export function buildAccountExport(src: ExportSources): AccountExportDoc {
  const included: CoveredEntry[] = [];
  const unavailable: UnavailableEntry[] = [];

  const watchlists: ServerWatchlist[] = src.watchlists.ok ? src.watchlists.lists : [];
  if (src.watchlists.ok) {
    const rowCount = src.watchlists.lists.reduce((n, l) => n + l.symbols.length, 0);
    included.push({
      key: "watchlists",
      what: ["Your watchlists and the symbols in them", "你的自选列表及其中的代码"],
      row_count: rowCount,
    });
  } else {
    unavailable.push({
      key: "watchlists",
      what: ["Your watchlists and the symbols in them", "你的自选列表及其中的代码"],
      why: UNAVAILABLE_WHY,
    });
  }

  const positions: Position[] = src.positions.ok ? src.positions.positions : [];
  if (src.positions.ok) {
    included.push({
      key: "portfolio_positions",
      what: ["Your recorded positions, open and closed", "你记录的持仓（含已平仓）"],
      row_count: src.positions.positions.length,
    });
  } else {
    unavailable.push({
      key: "portfolio_positions",
      what: ["Your recorded positions, open and closed", "你记录的持仓（含已平仓）"],
      why: UNAVAILABLE_WHY,
    });
  }

  return {
    schema: EXPORT_SCHEMA,
    generated_at: src.generatedAt,
    account: { user_id: src.userId, email: src.email },
    coverage: { included, not_included: NOT_INCLUDED, unavailable },
    watchlists,
    portfolio_positions: positions,
  };
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

export function serializeCsv(doc: AccountExportDoc): string {
  const BOM = "﻿";
  let out = BOM + csvRow(["section", "dataset", "row_id", "field", "value"]);

  for (const entry of doc.coverage.included) {
    out += csvRow(["coverage", "included", entry.key, "what_en", entry.what[0]]);
    out += csvRow(["coverage", "included", entry.key, "what_zh", entry.what[1]]);
    out += csvRow(["coverage", "included", entry.key, "row_count", entry.row_count]);
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
