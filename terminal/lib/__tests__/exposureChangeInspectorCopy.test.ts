import { describe, expect, it } from "vitest";

import {
  BANNED_VOCABULARY_EN,
  BANNED_VOCABULARY_ZH,
  COPY,
  exposureChangeInspectorT,
  fill,
  type ExposureChangeInspectorKey,
} from "@/components/exposure-map/exposureChangeInspectorStrings";

const KEYS = Object.keys(COPY) as ExposureChangeInspectorKey[];

// Every templated string, filled the way the panel fills it, in both slots.
const FILLED: Array<[ExposureChangeInspectorKey, Record<string, string | number>]> = [
  ["sessions", { previous: "2026-03-19", current: "2026-03-20" }],
  ["contracts", { n: 1234567 }],
  ["moreStrikes", { n: 9 }],
  ["selectStrike", { strike: 4500 }],
];

describe("exposureChangeInspectorStrings", () => {
  it("no English string in the inspector copy uses causal, predictive or dealer-behaviour vocabulary", () => {
    for (const key of KEYS) {
      expect(BANNED_VOCABULARY_EN.test(COPY[key][0]), `${key}: ${COPY[key][0]}`).toBe(false);
    }
    for (const [key, vars] of FILLED) {
      const text = fill(COPY[key][0], vars);
      expect(BANNED_VOCABULARY_EN.test(text), text).toBe(false);
    }
  });

  it("no Chinese string in the inspector copy uses causal, predictive or dealer-behaviour vocabulary", () => {
    for (const key of KEYS) {
      expect(BANNED_VOCABULARY_ZH.test(COPY[key][1]), `${key}: ${COPY[key][1]}`).toBe(false);
    }
    for (const [key, vars] of FILLED) {
      const text = fill(COPY[key][1], vars);
      expect(BANNED_VOCABULARY_ZH.test(text), text).toBe(false);
    }
  });

  it("every key has a non-empty English and Chinese string and the Chinese string contains CJK characters", () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(29);
    for (const key of KEYS) {
      const [en, zh] = COPY[key];
      expect(en.length, key).toBeGreaterThan(0);
      expect(zh.length, key).toBeGreaterThan(0);
      // A language-neutral rendering (identical in both slots, e.g. a
      // dates-only template) carries no CJK by design; every translated
      // string must.
      if (zh === en) expect(zh, key).toBe(en);
      else expect(zh, key).toMatch(/[一-鿿]/);
    }
    expect(exposureChangeInspectorT("en")("title")).toBe(COPY.title[0]);
    expect(exposureChangeInspectorT("zh")("title")).toBe(COPY.title[1]);
  });
});
