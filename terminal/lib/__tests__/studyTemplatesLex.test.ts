// E07 — feature-local EN/ZH copy for the study-template library.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STUDY_TEMPLATES_LEX, studyTemplatesText } from "../studyTemplatesLex";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const ROOT = join(__dirname, "..", "..");
const SOURCES = [
  ...readdirSync(join(ROOT, "components", "studyTemplates"))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(ROOT, "components", "studyTemplates", name)),
  join(ROOT, "components", "IndicatorsModal.tsx"),
];

describe("STUDY_TEMPLATES_LEX", () => {
  it("every key has non-empty EN and ZH copy with the same placeholders", () => {
    for (const [key, [en, zh]] of Object.entries(STUDY_TEMPLATES_LEX)) {
      expect(key.startsWith("stpl"), key).toBe(true);
      expect(en.trim(), key).not.toBe("");
      expect(zh.trim(), key).not.toBe("");
      expect(placeholders(zh), key).toEqual(placeholders(en));
      expect(/[一-鿿]/.test(zh), `${key} ZH copy is Chinese`).toBe(true);
    }
  });

  it("every stpl key the template UI names exists in the lex (no raw key reaches the screen)", () => {
    const used = new Set<string>();
    for (const file of SOURCES) {
      for (const match of readFileSync(file, "utf8").matchAll(/["'](stpl[A-Za-z0-9]+)["']/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(40);
    const missing = [...used].filter((key) => !(key in STUDY_TEMPLATES_LEX));
    expect(missing).toEqual([]);
  });
});

describe("studyTemplatesText", () => {
  it("fills placeholders in the requested language", () => {
    expect(studyTemplatesText("en", "stplDeleteConfirm", { name: "Swing" })).toBe("Delete “Swing”? This can’t be undone.");
    expect(studyTemplatesText("zh", "stplDeleteConfirm", { name: "Swing" })).toBe("删除“Swing”？此操作无法撤销。");
    expect(studyTemplatesText("en", "stplReasonGuestLimit", { max: 3 })).toBe("Guest charts show up to 3 studies. Sign in for more");
  });

  it("keeps an unfilled placeholder visible and returns an unknown key unchanged", () => {
    expect(studyTemplatesText("en", "stplDeleteConfirm")).toBe("Delete “{name}”? This can’t be undone.");
    expect(studyTemplatesText("en", "noSuchKey")).toBe("noSuchKey");
  });
});
