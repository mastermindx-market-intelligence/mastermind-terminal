// E06 — feature-local EN/ZH copy for multiple study instances.
import { describe, expect, it } from "vitest";
import { STUDY_INSTANCES_LEX, studyInstancesText } from "../studyInstancesLex";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("STUDY_INSTANCES_LEX", () => {
  it("every key has non-empty EN and ZH copy with the same placeholders", () => {
    for (const [key, [en, zh]] of Object.entries(STUDY_INSTANCES_LEX)) {
      expect(en.trim(), key).not.toBe("");
      expect(zh.trim(), key).not.toBe("");
      expect(placeholders(zh), key).toEqual(placeholders(en));
      expect(/[一-鿿]/.test(zh), `${key} ZH copy is Chinese`).toBe(true);
    }
  });
});

describe("studyInstancesText", () => {
  it("fills placeholders in the requested language", () => {
    expect(studyInstancesText("en", "sinstAddAnother", { label: "RSI" })).toBe("Add another RSI");
    expect(studyInstancesText("zh", "sinstAddAnother", { label: "RSI" })).toBe("再添加一个RSI");
    expect(studyInstancesText("en", "sinstCount", { count: 2, max: 4 })).toBe("2 of 4 on this chart · each keeps its own settings");
    expect(studyInstancesText("zh", "sinstLimit", { max: 4, label: "RSI" })).toBe("已达上限 · 每个图表最多 4 个RSI");
  });

  it("keeps an unfilled placeholder visible and returns an unknown key unchanged", () => {
    expect(studyInstancesText("en", "sinstAddAnother")).toBe("Add another {label}");
    expect(studyInstancesText("en", "noSuchKey")).toBe("noSuchKey");
  });
});
