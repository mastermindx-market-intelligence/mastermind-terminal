// E01 feature-local EN/ZH copy. Pins parity (two non-empty strings, same placeholders, Chinese
// glyphs on the ZH side), that every coverage reason the producer or the reader can emit has
// words, and that every key the technical-screen surfaces ask for exists — a missing key would
// otherwise render as its raw id.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIELD_NULL_REASON,
  KNOWN_SIGNAL_TYPES,
  TECHNICAL_CONSUMER_REASONS,
  TECHNICAL_PRODUCER_REASONS,
} from "../technicalScan";
import { TECHNICAL_SCAN_LEX, technicalReasonLabel, technicalSignalLabel } from "../technicalScanLex";
import { TECH_CHIPS } from "../technicalScreenControls";

const CJK = /[㐀-鿿]/;
const holes = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort();

describe("technicalScanLex", () => {
  it("every entry has EN and ZH text with the same placeholders", () => {
    for (const [key, [en, zh]] of Object.entries(TECHNICAL_SCAN_LEX)) {
      expect(en.trim(), key).not.toBe("");
      expect(zh.trim(), key).not.toBe("");
      expect(CJK.test(zh), `${key} ZH has Chinese glyphs`).toBe(true);
      expect(holes(zh), key).toEqual(holes(en));
    }
  });

  it("every producer and reader coverage reason has words in both languages", () => {
    const reasons = [
      ...TECHNICAL_PRODUCER_REASONS.unsupported,
      ...TECHNICAL_PRODUCER_REASONS.unavailable,
      ...TECHNICAL_CONSUMER_REASONS.stale,
      ...TECHNICAL_CONSUMER_REASONS.unsupported,
      ...TECHNICAL_CONSUMER_REASONS.unavailable,
      FIELD_NULL_REASON,
      "invalid_coverage", // accountCoverage's own bucket for a malformed classification
    ];
    for (const r of reasons) {
      expect(TECHNICAL_SCAN_LEX[`tsR_${r}`], r).toBeDefined();
      expect(technicalReasonLabel(r, "en")).not.toBe(r);
      expect(CJK.test(technicalReasonLabel(r, "zh")), r).toBe(true);
    }
  });

  it("an unknown reason or signal is shown verbatim, never re-labelled", () => {
    expect(technicalReasonLabel("brand_new_reason", "zh")).toBe("brand_new_reason");
    expect(technicalSignalLabel("NEW_TYPE", "en")).toBe("NEW_TYPE");
    for (const s of KNOWN_SIGNAL_TYPES) {
      expect(technicalSignalLabel(s, "en").length).toBeGreaterThan(0);
      expect(CJK.test(technicalSignalLabel(s, "zh")), s).toBe(true);
    }
  });

  it("every key the technical surfaces request exists", () => {
    const root = path.join(__dirname, "..", "..");
    const used = new Set<string>(Object.values(TECH_CHIPS).map((c) => c.key));
    for (const f of ["components/screener/TechnicalScreenBar.tsx", "components/ScreenerView.tsx"]) {
      const src = readFileSync(path.join(root, f), "utf8");
      for (const m of src.matchAll(/\btt\(\s*"([A-Za-z_]+)"/g)) used.add(m[1]);
      for (const m of src.matchAll(/"(ts[A-Z][A-Za-z]+)"/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(30);
    for (const k of used) expect(TECHNICAL_SCAN_LEX[k], k).toBeDefined();
  });
});
