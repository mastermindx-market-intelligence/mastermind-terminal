import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAccountExport, serializeCsv, serializeJson, type ExportSources } from "@/lib/accountExport";
import {
  canonicalExportJson,
  sealAccountExport,
  verifyAccountExportIntegrity,
  verifyAccountExportCsvChecksum,
} from "@/lib/accountExportIntegrity";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const window = { started_at: "2026-10-09T08:00:00.000Z", finished_at: "2026-10-09T08:00:01.000Z" };
function sources(): ExportSources {
  return {
    userId: "fictional-owner", email: "fixture@example.test", generatedAt: window.started_at,
    watchlists: { ok: true, lists: [{ id: "wl-1", name: "=SUM(1,2)", position: 0,
      symbols: [{ symbol: "NVDA", section: "Growth", position: 0 }] }] },
    positions: { ok: true, positions: [] },
    saved_scripts: { ok: true, complete: true, rows: [{ id: "script-1", name: "Sample", lang: "pine",
      source: "study(\"fixture\")", params: { period: 20 }, is_public: false,
      updated_at: "2026-10-08T00:00:00.000Z", created_at: null, version: "2026-10-08T00:00:00.000Z" }] },
    chart_layouts: { ok: true, complete: true, rows: [{ id: "layout-1", name: "Desk",
      config: { scriptId: "script-1", panes: ["price", "volume"] },
      updated_at: null, created_at: null, version: null }] },
  };
}
const sealed = () => sealAccountExport(buildAccountExport(sources()), window, sha256);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

describe("account export integrity", () => {
  it("seals actual collection counts and preserves identifiers and relationship payloads", () => {
    const doc = sealed();
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(true);
    expect(doc.integrity.collections.watchlists).toMatchObject({ state: "included_unverified", item_count: 1, coverage_row_count: 1 });
    expect(doc.integrity.collections.portfolio_positions).toMatchObject({ state: "included_unverified", item_count: 0 });
    expect(doc.integrity.collections.saved_scripts).toMatchObject({ state: "complete", item_count: 1 });
    expect(doc.chart_layouts?.[0].config).toEqual({ scriptId: "script-1", panes: ["price", "volume"] });
    expect(doc.integrity.read_window).toEqual(window);
    expect(doc.integrity.consistency).toBe("independent_collection_reads");
    expect(doc.integrity.authentication).toBe("unkeyed_checksums_not_identity_proof");
  });

  it.each(["content", "relationship", "row_order", "coverage", "read_interval", "account", "schema", "digest"])("detects %s tampering", (kind) => {
    const doc = clone(sealed());
    if (kind === "content") doc.saved_scripts![0].source += " changed";
    if (kind === "relationship") (doc.chart_layouts![0].config as { scriptId: string }).scriptId = "other";
    if (kind === "row_order") (doc.chart_layouts![0].config as { panes: string[] }).panes.reverse();
    if (kind === "coverage") doc.coverage.included[0].row_count = 999;
    if (kind === "read_interval") doc.integrity.read_window.finished_at = "2026-10-09T08:00:02.000Z";
    if (kind === "account") doc.account.user_id = "another-owner";
    if (kind === "schema") (doc as { schema: string }).schema = "unknown";
    if (kind === "digest") doc.integrity.payload_sha256 = "0".repeat(64);
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(false);
  });

  it("does not conflate a complete empty collection, a partial read, or a failed read", () => {
    const src = sources();
    src.saved_scripts = { ok: true, rows: [], complete: false, cut: "page ceiling" };
    src.chart_layouts = { ok: false, error: "driver unavailable" };
    const doc = sealAccountExport(buildAccountExport(src), window, sha256);
    expect(doc.integrity.collections.saved_scripts).toMatchObject({ state: "partial", item_count: 0 });
    expect(doc.integrity.collections.saved_scripts.sha256).toBe(sha256("[]"));
    expect(doc.integrity.collections.chart_layouts).toEqual({ state: "unavailable", item_count: null, coverage_row_count: null, sha256: null });
    src.saved_scripts = { ok: true, rows: [], complete: true };
    const empty = sealAccountExport(buildAccountExport(src), window, sha256);
    expect(empty.integrity.collections.saved_scripts).toMatchObject({ state: "complete", item_count: 0 });
    expect(empty.integrity.manifest_sha256).not.toBe(doc.integrity.manifest_sha256);
  });

  it("keeps legacy builder keys intact and does not invent an omitted source", () => {
    const src = sources(); delete src.saved_scripts; delete src.chart_layouts;
    const legacy = buildAccountExport(src);
    expect(legacy).not.toHaveProperty("integrity");
    expect(sealAccountExport(legacy, window, sha256).integrity.collections.saved_scripts)
      .toEqual({ state: "not_requested", item_count: null, coverage_row_count: null, sha256: null });
    expect(verifyAccountExportIntegrity(legacy, sha256)).toBe(false);
  });

  it("canonicalizes object keys without losing array order or Unicode", () => {
    expect(canonicalExportJson({ z: ["中文", "NVDA"], a: { y: 2, x: 1 } }))
      .toBe(canonicalExportJson({ a: { x: 1, y: 2 }, z: ["中文", "NVDA"] }));
    expect(canonicalExportJson([1, 2])).not.toBe(canonicalExportJson([2, 1]));
    expect(sha256(canonicalExportJson({ hello: "世界" }))).toBe(createHash("sha256").update('{"hello":"世界"}', "utf8").digest("hex"));
  });

  it.each([NaN, Infinity, undefined, new Date(), BigInt(1)])("refuses non-JSON or lossy values: %s", (value) => {
    expect(() => canonicalExportJson({ value })).toThrow();
  });

  it("refuses cycles, sparse arrays, contradictory coverage, and invalid clocks", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => canonicalExportJson(cyclic)).toThrow();
    expect(() => canonicalExportJson(new Array(1))).toThrow();
    const doc = buildAccountExport(sources()); doc.coverage.included[0].row_count = 9;
    expect(() => sealAccountExport(doc, window, sha256)).toThrow();
    expect(() => sealAccountExport(buildAccountExport(sources()), { ...window, finished_at: "2026-10-09T07:59:00.000Z" }, sha256)).toThrow();
    expect(() => sealAccountExport(buildAccountExport(sources()), { ...window, started_at: "yesterday" }, sha256)).toThrow();
  });

  it("round-trips JSON and seals all preceding CSV bytes, including its row view", () => {
    const doc = sealed();
    expect(verifyAccountExportIntegrity(JSON.parse(serializeJson(doc)), sha256)).toBe(true);
    const csv = serializeCsv(doc, sha256);
    expect(verifyAccountExportCsvChecksum(csv, sha256)).toBe(true);
    expect(csv).toContain("logical_json");
    expect(csv).toContain("'=SUM");
    expect(verifyAccountExportCsvChecksum(csv.slice(1), sha256)).toBe(false); // deleted BOM is a byte change
    expect(verifyAccountExportCsvChecksum(csv.replace("Growth", "Value"), sha256)).toBe(false);
    expect(verifyAccountExportCsvChecksum(csv.replace("fictional-owner", "other-owner"), sha256)).toBe(false);
    expect(verifyAccountExportCsvChecksum(csv.slice(0, -8), sha256)).toBe(false);
    expect(() => serializeCsv(doc)).toThrow();
    expect(serializeCsv(buildAccountExport(sources()))).not.toContain("csv_bytes");
  });
});


describe("six-collection integrity compatibility", () => {
  function ownedDoc() {
    const src = sources();
    src.chart_drawings = { ok: true, complete: true, rows: [{ id: "drawing-1", symbol: "NVDA", kind: "__collection_v1", data: { revision: "r1", drawings: [{ points: [1, 2] }] }, created_at: window.started_at, version: "r1" }] };
    src.alerts = { ok: true, complete: true, rows: [{ id: "alert-1", symbol: "NVDA", condition: { value: 150, nested: { keep: true } }, active: false, created_at: window.started_at, version: null }] };
    return sealAccountExport(buildAccountExport(src), window, sha256);
  }
  it("retains the exact legacy v1 four-collection receipt and verifies it after the upgrade", () => {
    const doc = sealed(); expect(doc.integrity.schema).toBe("mm.terminal_account_export.integrity.v1");
    expect(Object.keys(doc.integrity.collections)).toEqual(["watchlists", "portfolio_positions", "saved_scripts", "chart_layouts"]);
    expect(verifyAccountExportIntegrity(JSON.parse(serializeJson(doc)), sha256)).toBe(true);
  });
  it("seals and verifies six collections with a new receipt schema", () => {
    const doc = ownedDoc(); expect(doc.integrity.schema).toBe("mm.terminal_account_export.integrity.v2");
    expect(doc.integrity.collections.chart_drawings).toMatchObject({ state: "complete", item_count: 1 });
    expect(doc.integrity.collections.alerts).toMatchObject({ state: "complete", item_count: 1 });
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(true); expect(verifyAccountExportCsvChecksum(serializeCsv(doc, sha256), sha256)).toBe(true);
  });
  it.each(["geometry", "revision", "condition", "active", "state", "count", "schema", "missing_collection", "extra_collection"])("rejects new %s tampering", kind => {
    const doc = clone(ownedDoc());
    if (kind === "geometry") (doc.chart_drawings![0].data as { drawings: { points: number[] }[] }).drawings[0].points.reverse();
    if (kind === "revision") doc.chart_drawings![0].version = "wrong";
    if (kind === "condition") (doc.alerts![0].condition as { value: number }).value++;
    if (kind === "active") doc.alerts![0].active = true;
    if (kind === "state") doc.integrity.collections.alerts!.state = "unavailable";
    if (kind === "count") doc.integrity.collections.chart_drawings!.item_count = 4;
    if (kind === "schema") doc.integrity.schema = "mm.terminal_account_export.integrity.v1";
    if (kind === "missing_collection") delete doc.integrity.collections.alerts;
    if (kind === "extra_collection") Object.assign(doc.integrity.collections, { invented: doc.integrity.collections.alerts });
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(false);
  });
  it("does not accept a v1 receipt with new collections grafted onto its payload", () => {
    const doc = clone(sealed()); Object.assign(doc, { chart_drawings: [], alerts: [] });
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(false);
  });
  it("distinguishes failed new sources from complete emptiness and partial reads", () => {
    const src = sources(); src.chart_drawings = { ok: false, error: "outage" }; src.alerts = { ok: true, rows: [], complete: false };
    const doc = sealAccountExport(buildAccountExport(src), window, sha256);
    expect(doc.integrity.collections.chart_drawings).toEqual({ state: "unavailable", item_count: null, coverage_row_count: null, sha256: null });
    expect(doc.integrity.collections.alerts).toMatchObject({ state: "partial", item_count: 0, sha256: sha256("[]") });
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(true);
  });
});
