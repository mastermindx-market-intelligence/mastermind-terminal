import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLAG_COLORS } from "@/lib/flagPalette";
import { FLAG_COLOR_NAME_KEYS, WATCHLIST_ANNOTATION_LEX, flagColorNameKey } from "@/lib/watchlistAnnotationLex";

// E05 — the feature-local EN/ZH copy. Every key the sync UI asks for exists in both languages,
// every key here is used, and a flag colour is shown by name, never as a hex code.

const COMPONENT = join(process.cwd(), "components", "watchlist", "WatchlistAnnotationSync.tsx");
const LEX = join(process.cwd(), "lib", "watchlistAnnotationLex.ts");

describe("watchlist annotation copy", () => {
  it("has non-empty English and Chinese text for every key", () => {
    for (const [key, [en, zh]] of Object.entries(WATCHLIST_ANNOTATION_LEX)) {
      expect(en.trim(), key).not.toBe("");
      expect(zh.trim(), key).not.toBe("");
    }
  });

  it("defines every key the sync UI asks for, and carries no unused key", () => {
    const source = readFileSync(COMPONENT, "utf8");
    // Every quoted lex key in the component, including the ones picked by a ternary inside t(…).
    const asked = new Set([...source.matchAll(/"(was[A-Z][A-Za-z]*)"/g)].map((match) => match[1]));
    for (const key of asked) expect(WATCHLIST_ANNOTATION_LEX[key], key).toBeDefined();
    const named = new Set<string>([...FLAG_COLOR_NAME_KEYS, "wasFlagOther"]);
    const unused = Object.keys(WATCHLIST_ANNOTATION_LEX).filter((key) => !asked.has(key) && !named.has(key));
    expect(unused).toEqual([]);
    // The colour-name keys are reached through flagColorNameKey, which must stay wired in.
    expect(source).toContain("flagColorNameKey(");
    expect(readFileSync(LEX, "utf8")).toContain('"wasFlagOther"');
  });

  it("names every palette colour, index for index, and calls anything else 'Other color'", () => {
    expect(FLAG_COLOR_NAME_KEYS.length).toBe(FLAG_COLORS.length);
    FLAG_COLORS.forEach((color, index) => {
      expect(flagColorNameKey(color)).toBe(FLAG_COLOR_NAME_KEYS[index]);
      expect(flagColorNameKey(` ${color.toUpperCase()} `)).toBe(FLAG_COLOR_NAME_KEYS[index]);
    });
    expect(flagColorNameKey("#123456")).toBe("wasFlagOther");
    expect(WATCHLIST_ANNOTATION_LEX[flagColorNameKey("#f23645")]).toEqual(["Red", "红色"]);
    for (const key of [...FLAG_COLOR_NAME_KEYS, "wasFlagOther"]) {
      const [en, zh] = WATCHLIST_ANNOTATION_LEX[key];
      expect(en).not.toMatch(/#[0-9a-f]{3,6}/i);
      expect(zh).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });
});
