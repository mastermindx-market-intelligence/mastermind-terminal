// Portable, unkeyed integrity receipts for the existing account artifact. These hashes
// detect accidental changes; anyone able to rewrite the file can also recompute them.
// They attest neither identity nor a complete/atomic cross-service account snapshot.
import type { AccountExportDoc } from "@/lib/accountExport";

export type ExportSha256 = (utf8Text: string) => string;
export type ExportReadWindow = { started_at: string; finished_at: string };
export const EXPORT_COLLECTIONS = ["watchlists", "portfolio_positions", "saved_scripts", "chart_layouts"] as const;
type CollectionKey = typeof EXPORT_COLLECTIONS[number];
type CollectionIntegrity = {
  state: "included_unverified" | "complete" | "partial" | "unavailable" | "not_requested";
  item_count: number | null;
  coverage_row_count: number | null;
  sha256: string | null;
};
export type ExportIntegrityManifest = {
  schema: "mm.terminal_account_export.integrity.v1";
  algorithm: "sha256";
  canonicalization: "mm.json_sorted_keys.v1";
  digest_scope: "logical_json_payload_and_manifest";
  authentication: "unkeyed_checksums_not_identity_proof";
  consistency: "independent_collection_reads";
  read_window: ExportReadWindow;
  collections: Record<CollectionKey, CollectionIntegrity>;
  payload_sha256: string;
  manifest_sha256: string;
};
export type SealedAccountExport = AccountExportDoc & { integrity: ExportIntegrityManifest };

/** v1: plain JSON objects sorted by JS UTF-16 key order; arrays retain order; numbers and
 * strings use JSON.stringify; hash the resulting UTF-8 bytes. Not an RFC8785 claim.
 * Refuse values JSON.stringify would silently drop or turn into null. */
export function canonicalExportJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== "object") throw new Error("export contains a non-JSON value");
    if (ancestors.has(item)) throw new Error("export contains a cycle");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const values: string[] = [];
        for (let i = 0; i < item.length; i++) {
          if (!Object.hasOwn(item, i)) throw new Error("export contains a sparse array");
          values.push(encode(item[i]));
        }
        return "[" + values.join(",") + "]";
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error("export contains a non-JSON object");
      const obj = item as Record<string, unknown>;
      return "{" + Object.keys(obj).sort().map((key) => JSON.stringify(key) + ":" + encode(obj[key])).join(",") + "}";
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value);
}

function digest(text: string, sha256: ExportSha256): string {
  const result = sha256(text);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error("invalid export SHA256 result");
  return result;
}

export function accountExportPayload(doc: AccountExportDoc): Omit<AccountExportDoc, "integrity"> {
  const { integrity: _receipt, ...payload } = doc;
  return payload;
}

function validateWindow(window: ExportReadWindow): void {
  for (const time of [window.started_at, window.finished_at]) {
    const parsed = new Date(time);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== time) throw new Error("invalid export read interval");
  }
  if (window.started_at > window.finished_at) throw new Error("export read clock moved backwards");
}

export function sealAccountExport(doc: AccountExportDoc, window: ExportReadWindow, sha256: ExportSha256): SealedAccountExport {
  validateWindow(window);
  const payload = accountExportPayload(doc);
  if (payload.schema !== "mm.terminal_account_export.v1") throw new Error("unsupported export schema");
  const collections = {} as Record<CollectionKey, CollectionIntegrity>;
  for (const key of EXPORT_COLLECTIONS) {
    const included = payload.coverage.included.filter((entry) => entry.key === key);
    const unavailable = payload.coverage.unavailable.filter((entry) => entry.key === key);
    const partial = (payload.coverage.partial ?? []).filter((entry) => entry.key === key);
    const rows = payload[key];
    if (included.length > 1 || unavailable.length > 1 || partial.length > 1 ||
        (included.length && unavailable.length) || (partial.length && !included.length)) {
      throw new Error("contradictory export coverage");
    }
    if (!included.length) {
      if (unavailable.length ? !Array.isArray(rows) || rows.length !== 0 : rows !== undefined) {
        throw new Error("undisclosed export collection");
      }
      collections[key] = { state: unavailable.length ? "unavailable" : "not_requested",
        item_count: null, coverage_row_count: null, sha256: null };
      continue;
    }
    if (!Array.isArray(rows)) throw new Error("missing included collection");
    const count = key === "watchlists"
      ? payload.watchlists.reduce((total, list) => total + list.symbols.length, 0)
      : rows.length;
    if (included[0].row_count !== count) throw new Error("incorrect export coverage count");
    // The legacy watchlist/position adapters normalize or cap rows without proving a
    // complete inventory. Do not upgrade their successful reads to completeness claims.
    const state = partial.length ? "partial" : key === "watchlists" || key === "portfolio_positions"
      ? "included_unverified" : "complete";
    collections[key] = { state, item_count: rows.length, coverage_row_count: count,
      sha256: digest(canonicalExportJson(rows), sha256) };
  }
  const manifest = {
    schema: "mm.terminal_account_export.integrity.v1" as const,
    algorithm: "sha256" as const,
    canonicalization: "mm.json_sorted_keys.v1" as const,
    digest_scope: "logical_json_payload_and_manifest" as const,
    authentication: "unkeyed_checksums_not_identity_proof" as const,
    consistency: "independent_collection_reads" as const,
    read_window: { ...window }, collections,
    payload_sha256: digest(canonicalExportJson(payload), sha256),
  };
  return { ...payload, integrity: { ...manifest, manifest_sha256: digest(canonicalExportJson(manifest), sha256) } };
}

/** Verify an unchanged logical payload and its read receipt. A valid checksum is not a
 * signature: re-sealing a modified artifact is possible and must not imply identity proof. */
export function verifyAccountExportIntegrity(doc: AccountExportDoc, sha256: ExportSha256): boolean {
  if (!doc.integrity) return false;
  try {
    const expected = sealAccountExport(doc, doc.integrity.read_window, sha256).integrity;
    return canonicalExportJson(expected) === canonicalExportJson(doc.integrity);
  } catch { return false; }
}

/** CSV final receipt hashes every byte before that receipt, BOM and CRLF included.
 * Its embedded canonical logical JSON and manifest retain all nested relationships. */
export function verifyAccountExportCsvChecksum(csv: string, sha256: ExportSha256): boolean {
  const suffix = /integrity,csv_bytes,,sha256,([a-f0-9]{64})\r\n$/.exec(csv);
  if (!suffix || suffix.index === 0 || csv.slice(suffix.index - 2, suffix.index) !== "\r\n") return false;
  try { return digest(csv.slice(0, suffix.index), sha256) === suffix[1]; } catch { return false; }
}
