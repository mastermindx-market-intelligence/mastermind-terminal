import { describe, expect, it } from "vitest";
import { LEX } from "@/lib/i18n";

// B-PLAT-7: plain-language law (DEC:CHAIRMAN-FRONTEND-PLAIN-LANGUAGE-LAW-2026-09-06) — the
// launcher's accessible name/tooltip must be a plain sentence in EN and ZH, never machine text.
const CJK_RE = /[一-鿿]/;
const ASCII_LETTER_RE = /[A-Za-z]/;
const BANNED_RE = /[_{}[\]]|\bstate\b|\bslug\b/i;

describe("launcher i18n labels", () => {
  for (const key of ["launcherAsk", "launcherAskHint"] as const) {
    it(`${key} is a 2-tuple of plain EN/ZH sentences`, () => {
      const tuple = (LEX as Record<string, unknown>)[key];
      expect(Array.isArray(tuple)).toBe(true);
      const [en, zh] = tuple as [string, string];
      expect(typeof en).toBe("string");
      expect(typeof zh).toBe("string");
      expect(CJK_RE.test(en)).toBe(false);
      expect(ASCII_LETTER_RE.test(zh)).toBe(false);
      expect(BANNED_RE.test(en)).toBe(false);
      expect(BANNED_RE.test(zh)).toBe(false);
    });
  }
});
