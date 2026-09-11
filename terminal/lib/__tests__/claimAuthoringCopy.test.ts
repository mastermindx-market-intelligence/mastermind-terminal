import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEX } from "@/lib/i18n";
import {
  CLAIM_COMPARATOR_WORDS,
  CLAIM_NOT_RECORDED_MESSAGE,
  CLAIM_OWNER_LAST_CLOSE,
  CLAIM_OWNERS,
  composeClaimText,
} from "@/lib/claimAuthoring";

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
  "claimSymbolUnset",
  "claimDirectionUnset",
  "claimCharsLeft",
  "claimCharsLeft1",
  "claimCharsOver",
  "claimErrThresholdTooHigh",
  "claimErrTextEmpty",
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

function exportedCopyPairs(): Array<[string, string, string]> {
  const pairs: Array<[string, string, string]> = [];
  for (const row of CLAIM_OWNERS) {
    pairs.push([`CLAIM_OWNERS.${row.owner}.en`, row.labelEn, row.labelZh]);
  }
  for (const cmp of Object.keys(CLAIM_COMPARATOR_WORDS.en) as Array<keyof typeof CLAIM_COMPARATOR_WORDS.en>) {
    pairs.push([`CLAIM_COMPARATOR_WORDS.${cmp}`, CLAIM_COMPARATOR_WORDS.en[cmp], CLAIM_COMPARATOR_WORDS.zh[cmp]]);
  }
  pairs.push(["CLAIM_NOT_RECORDED_MESSAGE", CLAIM_NOT_RECORDED_MESSAGE[0], CLAIM_NOT_RECORDED_MESSAGE[1]]);
  pairs.push([
    "composeClaimText.en",
    composeClaimText({ symbol: "NVDA", comparator: ">=", threshold: 150, date: "2026-09-10", lang: "en" }),
    composeClaimText({ symbol: "NVDA", comparator: ">=", threshold: 150, date: "2026-09-10", lang: "zh" }),
  ]);
  return pairs;
}

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

  it("CLAIM_OWNERS labels are the last-close canon Closing price / 收盘价", () => {
    expect(CLAIM_OWNER_LAST_CLOSE).toEqual({ owner: "hub/lib/anchor.js", metric: "close" });
    expect(CLAIM_OWNERS).toHaveLength(1);
    expect(CLAIM_OWNERS[0].owner).toBe(CLAIM_OWNER_LAST_CLOSE.owner);
    expect(CLAIM_OWNERS[0].metric).toBe("close");
    expect(CLAIM_OWNERS[0].labelEn).toBe("Closing price");
    expect(CLAIM_OWNERS[0].labelZh).toBe("收盘价");
  });

  it("exported claimAuthoring sentences pass the copy gates (banned vocabulary, 你 not 您, CJK terminal punctuation)", () => {
    for (const [label, en, zh] of exportedCopyPairs()) {
      const hay = `${en}\n${zh}`.toLowerCase();
      for (const token of BANNED) {
        expect(hay, `${label} contains ${token}`).not.toContain(token.toLowerCase());
      }
      expect(zh, `${label} uses 您`).not.toContain("您");
    }
    expect(CLAIM_NOT_RECORDED_MESSAGE[1]).toMatch(/[。！？]$/);
    const zh = composeClaimText({
      symbol: "NVDA",
      comparator: ">=",
      threshold: 150,
      date: "2026-09-10",
      lang: "zh",
    });
    expect(zh).toMatch(/[。！？]$/);
  });

  it("frozen glyph and error copy is the seat-ordered sentences", () => {
    expect(LEX.claimSymbolUnset[0]).toBe("No symbol chosen");
    expect(LEX.claimSymbolUnset[1]).toBe("未选择标的");
    expect(LEX.claimDirectionUnset[0]).toBe("Choose a direction");
    expect(LEX.claimDirectionUnset[1]).toBe("选择方向");
    expect(LEX.claimCharsLeft[0]).toBe("{n} characters left in this call");
    expect(LEX.claimCharsLeft[1]).toBe("这条判断还可输入 {n} 个字");
    expect(LEX.claimCharsLeft1[0]).toBe("1 character left in this call");
    expect(LEX.claimCharsLeft1[1]).toBe("这条判断还可输入 1 个字");
    expect(LEX.claimCharsOver[0]).toBe("{n} characters over");
    expect(LEX.claimCharsOver[1]).toBe("这条判断超出 {n} 个字");
    expect(LEX.claimErrThresholdTooHigh[0]).toBe("Enter a price between 0 and 1,000,000.");
    expect(LEX.claimErrThresholdTooHigh[1]).toBe("请输入 0 到 1,000,000 之间的价格。");
    expect(LEX.claimErrTextEmpty[0]).toBe("This call has no text yet. Write your call, then try again.");
    expect(LEX.claimErrTextEmpty[1]).toBe("这条判断还没有内容，请写下你的判断后重试。");
  });

  it("ThesisWorkspace renders claimEntryButton and drops the file-local makeACall copy", () => {
    const src = readFileSync(
      join(__dirname, "../../components/workspaces/ThesisWorkspace.tsx"),
      "utf8",
    );
    expect(src).toContain('t("claimEntryButton")');
    expect(src).not.toMatch(/makeACall:/);
    expect(src).not.toContain("copy.makeACall");
  });

  it("ClaimAuthoringForm disables submit above THRESHOLD_MAX and renders claimErrThresholdTooHigh beside Level", () => {
    const src = readFileSync(
      join(__dirname, "../../components/workspaces/ClaimAuthoringForm.tsx"),
      "utf8",
    );
    expect(src).toMatch(/THRESHOLD_MAX/);
    expect(src).toContain("thresholdOverMax = Number(threshold) > THRESHOLD_MAX");
    expect(src).toContain("disabled={saving || remaining < 0 || thresholdOverMax}");
    expect(src).toContain('t("claimErrThresholdTooHigh")');
    expect(src).toContain('t("claimSymbolUnset")');
    expect(src).toContain('t("claimDirectionUnset")');
    expect(src).toContain("claimCharsLeft");
    expect(src).toContain("claimCharsLeft1");
    expect(src).toContain("claimCharsOver");
    expect(src).toContain('claim_text_empty: "claimErrTextEmpty"');
  });
});
