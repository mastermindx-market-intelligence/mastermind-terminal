import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIN_COMPARE_LEX, fcText, type FinCompareKey } from "../finCompareLex";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Financials · Compare copy", () => {
  it("has non-empty English and Chinese text for every key, with the same placeholders", () => {
    for (const [key, [en, zh]] of Object.entries(FIN_COMPARE_LEX)) {
      expect(en.trim(), `${key} EN`).not.toBe("");
      expect(zh.trim(), `${key} ZH`).not.toBe("");
      expect(placeholders(zh), `${key} placeholders`).toEqual(placeholders(en));
    }
  });

  it("fills placeholders and leaves an unknown name visible rather than blank", () => {
    expect(fcText(false, "fcRank", { rank: 2, of: 5 })).toBe("#2 of 5");
    expect(fcText(true, "fcRank", { rank: 2, of: 5 })).toBe("第2/5");
    expect(fcText(false, "fcRank", { rank: 2 })).toBe("#2 of {of}");
  });

  it("names every cell refusal reason the comparison can return, in both languages", () => {
    const reasons = [
      "no_period", "no_value", "family_mismatch", "family_ambiguous", "currency_mismatch",
      "currency_unknown", "cumulative_flow", "missing_base", "flow_basis_unknown",
      "margin_undefined", "calendar_collision", "calendar_straddle",
    ];
    for (const r of reasons) {
      expect(FIN_COMPARE_LEX).toHaveProperty(`fcR_${r}`);
      expect(FIN_COMPARE_LEX).toHaveProperty(`fcRT_${r}`);
    }
    const src = readFileSync(join(__dirname, "..", "finCompare.ts"), "utf8");
    const declared = src.match(/export type CellReason =([^;]+);/)?.[1] ?? "";
    expect([...declared.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort()).toEqual([...reasons].sort());
  });

  it("is never routed through the global LEX", () => {
    const i18n = readFileSync(join(__dirname, "..", "i18n.tsx"), "utf8");
    for (const key of Object.keys(FIN_COMPARE_LEX) as FinCompareKey[]) expect(i18n.includes(key)).toBe(false);
  });
});
