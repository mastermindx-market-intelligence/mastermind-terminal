import { describe, expect, it } from "vitest";

import {
  isDocId,
  isSha256Hex,
  isUuid,
  parseReadingSelection,
  parseReadingUrl,
  progressKey,
  READING_MAX_SEGMENTS,
  readingQuery,
  type InvalidReadingRef,
  type ReadingSelection,
} from "@/lib/shared-shell/readingContracts";

const SUBJECT_A = "0b8f6f2e-1c3d-4a5b-9c8d-7e6f5a4b3c2d";
const SUBJECT_B = "7f3d9a1c-2b4e-4f60-8a90-123456789abc";

const GOOD: ReadingSelection = {
  docId: "paper_01H-XYZ_42",
  sourcePdfSha256: "a1".repeat(32),
  extractedTextSha256: "b2".repeat(32),
  extractorVersion: "extractor-1.4.2",
  segmenterVersion: "segmenter-2026.10",
};

const ALL_KEYS = [
  "docId",
  "sourcePdfSha256",
  "extractedTextSha256",
  "extractorVersion",
  "segmenterVersion",
] as const;

function without(key: (typeof ALL_KEYS)[number]): unknown {
  const clone: Record<string, unknown> = { ...GOOD };
  delete clone[key];
  return clone;
}

function withOverrides(overrides: Partial<ReadingSelection>): ReadingSelection {
  return { ...GOOD, ...overrides };
}

function invalidRef(docId: string): InvalidReadingRef {
  return { docId, invalid: true };
}

function goodParams(): URLSearchParams {
  return new URLSearchParams({
    doc_id: GOOD.docId,
    source_pdf_sha256: GOOD.sourcePdfSha256,
    extracted_text_sha256: GOOD.extractedTextSha256,
    extractor_version: GOOD.extractorVersion,
    segmenter_version: GOOD.segmenterVersion,
    segment_start: "0",
    max_segments: "2",
  });
}

describe("isDocId", () => {
  it("admits ASCII letters, digits, underscore and dash with length 1..128", () => {
    expect(isDocId("a")).toBe(true);
    expect(isDocId("A9_-mixed")).toBe(true);
    expect(isDocId("d".repeat(128))).toBe(true);
  });

  it("rejects empty, oversized, non-ASCII and newline-padded doc ids", () => {
    expect(isDocId("")).toBe(false);
    expect(isDocId("d".repeat(129))).toBe(false);
    expect(isDocId("has space")).toBe(false);
    expect(isDocId("sl/ash")).toBe(false);
    expect(isDocId("döt")).toBe(false);
    expect(isDocId("doc\n")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isDocId(null)).toBe(false);
    expect(isDocId(undefined)).toBe(false);
    expect(isDocId(42)).toBe(false);
    expect(isDocId(["doc"])).toBe(false);
  });
});

describe("isSha256Hex", () => {
  it("admits exactly 64 lowercase hex characters", () => {
    expect(isSha256Hex("0123456789abcdef".repeat(4))).toBe(true);
    expect(isSha256Hex("a".repeat(64))).toBe(true);
  });

  it("rejects wrong lengths, uppercase, non-hex and trailing newlines", () => {
    expect(isSha256Hex("")).toBe(false);
    expect(isSha256Hex("a".repeat(63))).toBe(false);
    expect(isSha256Hex("a".repeat(65))).toBe(false);
    expect(isSha256Hex("A".repeat(64))).toBe(false);
    expect(isSha256Hex("a".repeat(63) + "g")).toBe(false);
    expect(isSha256Hex("a".repeat(64) + "\n")).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
  });
});

describe("isUuid", () => {
  it("admits canonical hyphenated hex uuids, any case", () => {
    expect(isUuid(SUBJECT_A)).toBe(true);
    expect(isUuid(SUBJECT_A.toUpperCase())).toBe(true);
  });

  it("rejects malformed uuids", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("0b8f6f2e1c3d4a5b9c8d7e6f5a4b3c2d")).toBe(false);
    expect(isUuid("0b8f6f2e-1c3d-4a5b-9c8d-7e6f5a4b3c2")).toBe(false);
    expect(isUuid("0b8f6f2g-1c3d-4a5b-9c8d-7e6f5a4b3c2d")).toBe(false);
    expect(isUuid(SUBJECT_A + "\n")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe("parseReadingSelection", () => {
  it("accepts a complete valid tuple", () => {
    expect(parseReadingSelection({ ...GOOD })).toEqual(GOOD);
  });

  it("drops unknown extra fields instead of trusting them", () => {
    expect(parseReadingSelection({ ...GOOD, injected: "x" })).toEqual(GOOD);
  });

  it("returns null for non-records", () => {
    expect(parseReadingSelection(null)).toBeNull();
    expect(parseReadingSelection(undefined)).toBeNull();
    expect(parseReadingSelection(42)).toBeNull();
    expect(parseReadingSelection("paper")).toBeNull();
    expect(parseReadingSelection([GOOD])).toBeNull();
  });

  it("rejects a tuple missing any single member", () => {
    for (const key of ALL_KEYS) {
      expect(parseReadingSelection(without(key))).toBeNull();
    }
  });

  it("rejects malformed members", () => {
    expect(parseReadingSelection(withOverrides({ docId: "../escape" }))).toBeNull();
    expect(parseReadingSelection(withOverrides({ docId: "" }))).toBeNull();
    expect(parseReadingSelection(withOverrides({ sourcePdfSha256: "A".repeat(64) }))).toBeNull();
    expect(parseReadingSelection(withOverrides({ sourcePdfSha256: "short" }))).toBeNull();
    expect(parseReadingSelection(withOverrides({ extractedTextSha256: "b".repeat(65) }))).toBeNull();
    expect(parseReadingSelection(withOverrides({ extractorVersion: "" }))).toBeNull();
    expect(parseReadingSelection(withOverrides({ segmenterVersion: "has space" }))).toBeNull();
    expect(
      parseReadingSelection(withOverrides({ sourcePdfSha256: 123 as unknown as string })),
    ).toBeNull();
  });
});

describe("readingQuery", () => {
  it("sends both snake_case pins, versions, segment_start and max_segments=2 by default", () => {
    const params = readingQuery(GOOD);
    expect(params.get("doc_id")).toBe(GOOD.docId);
    expect(params.get("source_pdf_sha256")).toBe(GOOD.sourcePdfSha256);
    expect(params.get("extracted_text_sha256")).toBe(GOOD.extractedTextSha256);
    expect(params.get("extractor_version")).toBe(GOOD.extractorVersion);
    expect(params.get("segmenter_version")).toBe(GOOD.segmenterVersion);
    expect(params.get("segment_start")).toBe("0");
    expect(params.get("max_segments")).toBe("2");
    expect(READING_MAX_SEGMENTS).toBe(2);
  });

  it("keeps both revision pins in the query at segment 0 and beyond", () => {
    for (const start of [0, 1, 7]) {
      const params = readingQuery(GOOD, start);
      expect(params.get("source_pdf_sha256")).toBe(GOOD.sourcePdfSha256);
      expect(params.get("extracted_text_sha256")).toBe(GOOD.extractedTextSha256);
      expect(params.get("extractor_version")).toBe(GOOD.extractorVersion);
      expect(params.get("segmenter_version")).toBe(GOOD.segmenterVersion);
      expect(params.get("segment_start")).toBe(String(start));
    }
  });

  it("accepts 0 and Number.MAX_SAFE_INTEGER as starts", () => {
    expect(readingQuery(GOOD, 0).get("segment_start")).toBe("0");
    expect(readingQuery(GOOD, Number.MAX_SAFE_INTEGER).get("segment_start")).toBe(
      String(Number.MAX_SAFE_INTEGER),
    );
  });

  it("rejects an invalid selection tuple", () => {
    expect(() => readingQuery(without("extractedTextSha256") as ReadingSelection)).toThrow(TypeError);
    expect(() => readingQuery(withOverrides({ sourcePdfSha256: "A".repeat(64) }))).toThrow(TypeError);
    expect(() => readingQuery(null as unknown as ReadingSelection)).toThrow(TypeError);
  });

  it("rejects negative, fractional and non-integer starts", () => {
    expect(() => readingQuery(GOOD, -1)).toThrow(TypeError);
    expect(() => readingQuery(GOOD, -0.5)).toThrow(TypeError);
    expect(() => readingQuery(GOOD, 1.5)).toThrow(TypeError);
    expect(() => readingQuery(GOOD, Number.NaN)).toThrow(TypeError);
    expect(() => readingQuery(GOOD, Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => readingQuery(GOOD, 2 ** 53)).toThrow(TypeError);
    expect(() => readingQuery(GOOD, "0" as unknown as number)).toThrow(TypeError);
    expect(() => readingQuery(GOOD, null as unknown as number)).toThrow(TypeError);
  });
});

describe("progressKey", () => {
  it("is stable and carries the subject plus the entire revision tuple", () => {
    const key = progressKey(SUBJECT_A, GOOD);
    expect(typeof key).toBe("string");
    expect(key).toBe(progressKey(SUBJECT_A, { ...GOOD }));
    expect(key).toContain(SUBJECT_A);
    expect(key).toContain(GOOD.docId);
    expect(key).toContain(GOOD.sourcePdfSha256);
    expect(key).toContain(GOOD.extractedTextSha256);
    expect(key).toContain(GOOD.extractorVersion);
    expect(key).toContain(GOOD.segmenterVersion);
  });

  it("treats uuid case as the same account", () => {
    expect(progressKey(SUBJECT_A.toUpperCase(), GOOD)).toBe(progressKey(SUBJECT_A, GOOD));
  });

  it("separates keys for distinct accounts, documents, hashes and versions", () => {
    const base = progressKey(SUBJECT_A, GOOD);
    expect(progressKey(SUBJECT_B, GOOD)).not.toBe(base);
    expect(progressKey(SUBJECT_A, withOverrides({ docId: "other_doc" }))).not.toBe(base);
    expect(progressKey(SUBJECT_A, withOverrides({ sourcePdfSha256: "c".repeat(64) }))).not.toBe(base);
    expect(progressKey(SUBJECT_A, withOverrides({ extractedTextSha256: "d".repeat(64) }))).not.toBe(base);
    expect(progressKey(SUBJECT_A, withOverrides({ extractorVersion: "extractor-1.5.0" }))).not.toBe(base);
    expect(progressKey(SUBJECT_A, withOverrides({ segmenterVersion: "segmenter-2026.11" }))).not.toBe(base);
  });

  it("rejects an invalid subject uuid", () => {
    expect(() => progressKey("not-a-uuid", GOOD)).toThrow(TypeError);
    expect(() => progressKey("", GOOD)).toThrow(TypeError);
    expect(() => progressKey("0b8f6f2e1c3d4a5b9c8d7e6f5a4b3c2d", GOOD)).toThrow(TypeError);
    expect(() => progressKey(42 as unknown as string, GOOD)).toThrow(TypeError);
  });

  it("rejects an unvalidated selection tuple", () => {
    expect(() => progressKey(SUBJECT_A, without("segmenterVersion") as ReadingSelection)).toThrow(TypeError);
    expect(() => progressKey(SUBJECT_A, withOverrides({ docId: "" }))).toThrow(TypeError);
  });

  it("persists no body and leaves the input tuple untouched", () => {
    const snapshot = { ...GOOD };
    progressKey(SUBJECT_A, GOOD);
    expect(GOOD).toEqual(snapshot);
  });
});

describe("parseReadingUrl", () => {
  it("returns null when no document is named", () => {
    expect(parseReadingUrl(new URLSearchParams())).toBeNull();
    expect(parseReadingUrl(new URLSearchParams("max_segments=2&segment_start=0"))).toBeNull();
    expect(parseReadingUrl(new URLSearchParams("doc_id="))).toBeNull();
  });

  it("reopens a fully pinned selection at any segment offset", () => {
    expect(parseReadingUrl(readingQuery(GOOD, 0))).toEqual(GOOD);
    expect(parseReadingUrl(readingQuery(GOOD, 4))).toEqual(GOOD);
    expect(parseReadingUrl(goodParams())).toEqual(GOOD);
  });

  it("marks the document invalid when a sha256 pin is missing", () => {
    const missingSource = goodParams();
    missingSource.delete("source_pdf_sha256");
    expect(parseReadingUrl(missingSource)).toEqual(invalidRef(GOOD.docId));

    const missingExtracted = goodParams();
    missingExtracted.delete("extracted_text_sha256");
    expect(parseReadingUrl(missingExtracted)).toEqual(invalidRef(GOOD.docId));
  });

  it("marks the document invalid when a version pin is missing", () => {
    const missingExtractor = goodParams();
    missingExtractor.delete("extractor_version");
    expect(parseReadingUrl(missingExtractor)).toEqual(invalidRef(GOOD.docId));

    const missingSegmenter = goodParams();
    missingSegmenter.delete("segmenter_version");
    expect(parseReadingUrl(missingSegmenter)).toEqual(invalidRef(GOOD.docId));
  });

  it("never silently discards malformed pins or doc ids", () => {
    const upperHash = goodParams();
    upperHash.set("source_pdf_sha256", "A".repeat(64));
    expect(parseReadingUrl(upperHash)).toEqual(invalidRef(GOOD.docId));

    const shortHash = goodParams();
    shortHash.set("extracted_text_sha256", "b".repeat(63));
    expect(parseReadingUrl(shortHash)).toEqual(invalidRef(GOOD.docId));

    const spacedVersion = goodParams();
    spacedVersion.set("segmenter_version", "seg 2026");
    expect(parseReadingUrl(spacedVersion)).toEqual(invalidRef(GOOD.docId));

    const emptyVersion = goodParams();
    emptyVersion.set("extractor_version", "");
    expect(parseReadingUrl(emptyVersion)).toEqual(invalidRef(GOOD.docId));

    const traversalDoc = goodParams();
    traversalDoc.set("doc_id", "../../etc");
    expect(parseReadingUrl(traversalDoc)).toEqual(invalidRef("../../etc"));

    const longDoc = goodParams();
    longDoc.set("doc_id", "d".repeat(129));
    expect(parseReadingUrl(longDoc)).toEqual(invalidRef("d".repeat(129)));
  });

  it("returns an invalid marker, never a partial selection", () => {
    const partial = goodParams();
    partial.delete("extractor_version");
    const parsed = parseReadingUrl(partial) as InvalidReadingRef;
    expect(parsed.invalid).toBe(true);
    expect(parsed).not.toHaveProperty("extractorVersion");
    expect(parsed).not.toHaveProperty("sourcePdfSha256");
  });
});
