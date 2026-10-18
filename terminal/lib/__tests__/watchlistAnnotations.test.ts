import { describe, expect, it } from "vitest";
import {
  ANNOTATION_NOTE_MAX,
  ANNOTATION_SCHEMA_VERSION,
  ANNOTATION_WRITE_BATCH_MAX,
  normalizeAnnotationSymbol,
  normalizeAnnotationValue,
  normalizeRevision,
  normalizeWriteBatch,
  parseAnnotationReadResponse,
  parseAnnotationWriteResponse,
  recordField,
} from "@/lib/watchlistAnnotations";
import { FLAG_COLORS } from "@/lib/flagPalette";

// E05 — the wire contract every side of annotation sync shares.

describe("annotation symbols", () => {
  it("canonicalises and bounds the symbol key", () => {
    expect(normalizeAnnotationSymbol(" aapl ")).toBe("AAPL");
    expect(normalizeAnnotationSymbol("600519.SS")).toBe("600519.SS");
    expect(normalizeAnnotationSymbol("")).toBeNull();
    expect(normalizeAnnotationSymbol("   ")).toBeNull();
    expect(normalizeAnnotationSymbol("A".repeat(129))).toBeNull();
    expect(normalizeAnnotationSymbol("AA\u0000PL")).toBeNull();
    expect(normalizeAnnotationSymbol(42)).toBeNull();
  });
});

describe("annotation values", () => {
  it("accepts every flag the shell palette can produce, lower-cased", () => {
    for (const color of FLAG_COLORS) expect(normalizeAnnotationValue("flag", color.toUpperCase())).toBe(color.toLowerCase());
  });

  it("refuses a flag that is not a 7-character hex colour", () => {
    for (const bad of ["red", "#fff", "#12345g", "javascript:alert(1)", "", 7]) expect(normalizeAnnotationValue("flag", bad)).toBeUndefined();
    expect(normalizeAnnotationValue("flag", null)).toBeNull();
  });

  it("keeps note text verbatim (CJK, newlines, tabs) and treats a blank note as a clear", () => {
    expect(normalizeAnnotationValue("note", "財報後回調 — 关注 1680 支撐\n第二行\tok")).toBe("財報後回調 — 关注 1680 支撐\n第二行\tok");
    expect(normalizeAnnotationValue("note", "   \n ")).toBeNull();
    expect(normalizeAnnotationValue("note", null)).toBeNull();
  });

  it("bounds note length at 500 and refuses other control characters", () => {
    expect(normalizeAnnotationValue("note", "注".repeat(ANNOTATION_NOTE_MAX))).toBe("注".repeat(ANNOTATION_NOTE_MAX));
    expect(normalizeAnnotationValue("note", "x".repeat(ANNOTATION_NOTE_MAX + 1))).toBeUndefined();
    expect(normalizeAnnotationValue("note", "bell\u0007")).toBeUndefined();
    expect(normalizeAnnotationValue("note", { text: "x" })).toBeUndefined();
  });

  it("accepts only non-negative integer revisions", () => {
    expect(normalizeRevision(0)).toBe(0);
    expect(normalizeRevision(7)).toBe(7);
    for (const bad of [-1, 1.5, "3", null, Number.NaN, 3_000_000_000]) expect(normalizeRevision(bad)).toBeNull();
  });
});

describe("write batches", () => {
  it("refuses a malformed body outright", () => {
    expect(normalizeWriteBatch(null)).toEqual({ ok: false, error: "invalid body" });
    expect(normalizeWriteBatch([])).toEqual({ ok: false, error: "invalid body" });
    expect(normalizeWriteBatch({ writes: [] })).toEqual({ ok: false, error: "writes required" });
    expect(normalizeWriteBatch({ writes: [{ symbol: "AAPL", field: "signal", value: "x", baseRevision: 0 }] })).toEqual({ ok: false, error: "invalid write target" });
    const tooMany = Array.from({ length: ANNOTATION_WRITE_BATCH_MAX + 1 }, (_, index) => ({ symbol: `S${index}`, field: "note", value: "x", baseRevision: 0 }));
    expect(normalizeWriteBatch({ writes: tooMany })).toEqual({ ok: false, error: "batch too large" });
  });

  it("refuses two writes to the same symbol+field (after canonicalisation)", () => {
    const body = { writes: [{ symbol: "aapl", field: "note", value: "a", baseRevision: 0 }, { symbol: "AAPL", field: "note", value: "b", baseRevision: 1 }] };
    expect(normalizeWriteBatch(body)).toEqual({ ok: false, error: "duplicate write target" });
  });

  it("answers a bad item as `invalid` without sinking the rest of the batch", () => {
    const batch = normalizeWriteBatch({
      writes: [
        { symbol: "aapl", field: "note", value: "earnings 7/31", baseRevision: 2 },
        { symbol: "MSFT", field: "flag", value: "chartreuse", baseRevision: 0 },
        { symbol: "NVDA", field: "flag", value: "#F23645", baseRevision: -1 },
        { symbol: "TSLA", field: "note", value: null, baseRevision: 4 },
      ],
    });
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.writes).toEqual([
      { symbol: "AAPL", field: "note", value: "earnings 7/31", baseRevision: 2 },
      { symbol: "TSLA", field: "note", value: null, baseRevision: 4 },
    ]);
    expect(batch.invalid.map((result) => [result.symbol, result.field, result.status])).toEqual([
      ["MSFT", "flag", "invalid"],
      ["NVDA", "flag", "invalid"],
    ]);
  });
});

describe("client-side parsing", () => {
  const record = { symbol: "0700.HK", note: "腾讯：回购", noteRevision: 3, noteUpdatedAt: "2026-10-11T01:00:00Z", flag: "#089981", flagRevision: 1, flagUpdatedAt: null };

  it("parses a read and reports completeness (default complete)", () => {
    expect(parseAnnotationReadResponse({ schemaVersion: ANNOTATION_SCHEMA_VERSION, annotations: [record] })).toEqual({
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
      annotations: [record],
      complete: true,
    });
    expect(parseAnnotationReadResponse({ schemaVersion: ANNOTATION_SCHEMA_VERSION, annotations: [], complete: false })?.complete).toBe(false);
  });

  it("rejects a read that is not this contract rather than treating it as empty", () => {
    expect(parseAnnotationReadResponse(null)).toBeNull();
    expect(parseAnnotationReadResponse({ error: "annotations_read_failed" })).toBeNull();
    expect(parseAnnotationReadResponse({ schemaVersion: 2, annotations: [] })).toBeNull();
    expect(parseAnnotationReadResponse({ schemaVersion: 1, annotations: [{ ...record, flag: "red" }] })).toBeNull();
    expect(parseAnnotationReadResponse({ schemaVersion: 1, annotations: [{ ...record, noteRevision: -2 }] })).toBeNull();
  });

  it("parses write results and rejects malformed ones", () => {
    const ok = { symbol: "AAPL", field: "note", status: "ok", revision: 4, value: "x", updatedAt: "t" };
    expect(parseAnnotationWriteResponse({ results: [ok] })).toEqual([ok]);
    expect(parseAnnotationWriteResponse({ results: [{ ...ok, status: "maybe" }] })).toBeNull();
    expect(parseAnnotationWriteResponse({ results: [{ ...ok, revision: "4" }] })).toBeNull();
    expect(parseAnnotationWriteResponse({ error: "annotations_unavailable" })).toBeNull();
  });

  it("reads a field off an absent record as never written", () => {
    expect(recordField(null, "note")).toEqual({ value: null, revision: 0, updatedAt: null });
    expect(recordField(record, "flag")).toEqual({ value: "#089981", revision: 1, updatedAt: null });
  });
});
