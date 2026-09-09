import { describe, expect, it } from "vitest";
import { LEX } from "@/lib/i18n";

const CLAIM_KEY = /^claim[A-Z]/;

const REQUIRED = [
  "claimEntryButton",
  "claimModalTitle",
  "claimModalSub",
  "claimOwnerLabel",
  "claimComparatorLabel",
  "claimThresholdLabel",
  "claimResolvesAtLabel",
  "claimProbabilityToggle",
  "claimNoteLabel",
  "claimSubmit",
  "claimSaving",
  "claimSaved",
  "claimListEmpty",
  "claimGoToLedger",
  "claimClose",
] as const;

const BANNED = [
  "Brier",
  "hit-rate",
  "hit rate",
  "rank",
  "leaderboard",
  "percentile",
  "score",
  "grade",
  "validated",
];

describe("B-F13-6 claim authoring copy", () => {
  it("every claim* key carries both an EN and a ZH value", () => {
    const keys = Object.keys(LEX).filter((k) => CLAIM_KEY.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(REQUIRED.length);
    for (const key of REQUIRED) {
      expect(keys, key).toContain(key);
    }
    for (const key of keys) {
      const pair = LEX[key];
      expect(pair, key).toBeTruthy();
      expect(pair[0].trim().length, `${key} EN`).toBeGreaterThan(0);
      expect(pair[1].trim().length, `${key} ZH`).toBeGreaterThan(0);
    }
  });

  it("no claim* string contains banned vocabulary (Brier, hit-rate, rank, leaderboard, percentile, score, grade, validated)", () => {
    const keys = Object.keys(LEX).filter((k) => CLAIM_KEY.test(k));
    for (const key of keys) {
      const [en, zh] = LEX[key];
      const hay = `${en}\n${zh}`.toLowerCase();
      for (const token of BANNED) {
        expect(hay, `${key} contains ${token}`).not.toContain(token.toLowerCase());
      }
    }
  });

  it("claimSaved contains no predictive or evaluative language", () => {
    const [en, zh] = LEX.claimSaved;
    expect(en).toBe("Saved. Checked on the date above.");
    expect(zh).toBe("已保存。将在上方日期核对。");
    const hay = `${en} ${zh}`.toLowerCase();
    for (const token of ["good call", "on track", "correct", "wrong", "landing", "hit", "miss", "score", "grade"]) {
      expect(hay).not.toContain(token);
    }
  });

  it("claimListEmpty does not reuse the ledger's own accEmpty string verbatim", () => {
    expect(LEX.claimListEmpty[0]).toBe("Calls you save this session appear here.");
    expect(LEX.claimListEmpty[1]).toBe("本次会话中保存的判断会显示在这里。");
    expect(LEX.claimListEmpty[0]).not.toBe(LEX.accEmpty[0]);
    expect(LEX.claimListEmpty[1]).not.toBe(LEX.accEmpty[1]);
  });
});
