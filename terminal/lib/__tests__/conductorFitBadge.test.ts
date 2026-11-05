import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEX } from "@/lib/i18n";
import { fitBadgeText } from "@/lib/conductorState";

// The conductor rail's fit chip ({touches, max_dev_atr} on a line/zone ack) was a hardcoded English
// template in ChartConductor.tsx, so the zh view showed "8 touches · 0 ATR" (b-pl-6-batch-2 crop,
// #890). It now routes through LEX cmxFitOne / cmxFitMany, picked like drawingCountOne/Many.

// Stand-in for useT(): the same LEX lookup the hook does, pinned to one language.
const tFor = (col: 0 | 1) => (key: string, fallback?: string) => {
  const e = LEX[key];
  return e ? e[col] : (fallback ?? key);
};
const en = tFor(0);
const zh = tFor(1);

describe("conductor fit badge — LEX entries", () => {
  it("cmxFitOne / cmxFitMany carry both placeholders and the ATR abbreviation in en and zh", () => {
    for (const key of ["cmxFitOne", "cmxFitMany"]) {
      const pair = LEX[key];
      expect(pair, key).toBeDefined();
      for (const s of pair!) {
        expect(s).toContain("{n}");
        expect(s).toContain("{atr}");
        expect(s).toContain("ATR");
      }
    }
  });

  it("zh says 触及 and carries no English beyond ATR", () => {
    for (const key of ["cmxFitOne", "cmxFitMany"]) {
      const zhStr = LEX[key]![1];
      expect(zhStr).toContain("触及");
      expect(zhStr.replace(/\{(n|atr)\}/g, "").replace(/ATR/g, "")).not.toMatch(/[A-Za-z]/);
    }
  });
});

describe("fitBadgeText", () => {
  it("en: singular on exactly one touch, plural for zero and many", () => {
    expect(fitBadgeText({ touches: 1, max_dev_atr: 0.12 }, en)).toBe("1 touch · 0.12 ATR");
    expect(fitBadgeText({ touches: 8, max_dev_atr: 0 }, en)).toBe("8 touches · 0 ATR");
    expect(fitBadgeText({ touches: 0, max_dev_atr: 1.5 }, en)).toBe("0 touches · 1.5 ATR");
  });

  it("zh: the #890 leak case reads in Chinese with ATR kept", () => {
    expect(fitBadgeText({ touches: 8, max_dev_atr: 0 }, zh)).toBe("触及 8 次 · 0 ATR");
    expect(fitBadgeText({ touches: 1, max_dev_atr: 0.31 }, zh)).toBe("触及 1 次 · 0.31 ATR");
    expect(fitBadgeText({ touches: 0, max_dev_atr: 0 }, zh)).toBe("触及 0 次 · 0 ATR");
  });

  it("prints the ack's numbers verbatim", () => {
    expect(fitBadgeText({ touches: 12, max_dev_atr: 0.005 }, en)).toBe("12 touches · 0.005 ATR");
  });
});

describe("ChartConductor.tsx fit chip call site", () => {
  const src = readFileSync(join(__dirname, "../../components/ChartConductor.tsx"), "utf8");

  it("keeps no hardcoded English fit template", () => {
    expect(src).not.toMatch(/touches\s*·/);
    expect(src).not.toMatch(/\}\s*ATR</);
  });

  it("renders the chip through fitBadgeText(r.fit, t)", () => {
    expect(src).toMatch(/className="fit">\{fitBadgeText\(r\.fit, t\)\}</);
  });
});
