import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEX } from "@/lib/i18n";
import {
  UNAVAILABLE_NOTE,
  UNREADABLE_NOTE,
  settledNote,
} from "@/lib/dailyCloseResolver";
import { UNDETERMINED_NOTE } from "@/lib/personalAccuracyStore";

const FROZEN_GLANCE_KEYS = [
  "accTitle",
  "accSub",
  "accStanceEarly",
  "accStanceMostly",
  "accStanceMixed",
  "accStanceNot",
  "accEmpty",
  "accEarlyN",
  "accEarly1",
  "accCheckedN",
  "accCalibWithheld",
  "accUnscorableN",
  "accCeiling",
] as const;

const GLANCE_KEYS = [
  ...FROZEN_GLANCE_KEYS,
  "accClaimCountN",
  "accClaimCount1",
  "accUnread",
  "accDetLoadErr",
  "accCalibProgress",
  "accSignInToSee",
  "accUnscorable1",
  "accUnscorableIncompleteN",
  "accUnscorableIncomplete1",
  "accUnscorableWithdrawnN",
  "accUnscorableWithdrawn1",
  "accUnscorableNotBinaryN",
  "accUnscorableNotBinary1",
  "accUnscorableBadDateN",
  "accUnscorableBadDate1",
  "accUnscorableBadKindN",
  "accUnscorableBadKind1",
  "accUnscorableBadStatusN",
  "accUnscorableBadStatus1",
  "accUnscorableOtherN",
  "accUnscorableOther1",
  "accDetailOpen",
  "accDetailClose",
] as const;

const FROZEN_EN = [
  "Your calls, checked.",
  "We only check what you wrote down first: the call, the day it settles, and what would prove it wrong.",
  "Too early to say",
  "Mostly landing so far",
  "Mixed so far",
  "Not landing yet",
  "Nothing has settled yet. Your first call gets checked on the day you set.",
  // META-CEO B round 7 seat amendment of frozen §6 lines (session d640f3ef, 2026-09-09 20:35Z)
  "Too early to say — checked {n} groups of your calls so far.",
  // META-CEO B heal round h7: accEarly1 twin of frozen accEarlyN
  "Too early to say — checked 1 group of your calls so far.",
  "Checked so far: {n} groups of your calls.",
  // same ruling: noun is groups of calls; ({n} of 30) tail removed
  "Not enough settled groups of calls yet to check how well your odds match reality.",
  "{n} calls could not be checked — the data they named wasn't there.",
  "This is a learning record. It never changes what we show you, what we rank, or what you can do here.",
];

const FROZEN_ZH = [
  "你的判断，逐条核对。",
  "只核对你事先写下的：判断本身、结算日期，以及什么情况算判断错了。",
  "还看不出来",
  "目前多数落在正确一边",
  "目前好坏参半",
  "目前还没落在正确一边",
  "还没有到期的判断。第一条会在你设定的那天核对。",
  // META-CEO B round 7 seat amendment of frozen §6 lines (session d640f3ef, 2026-09-09 20:35Z)
  "现在下结论还太早——目前已核对你的 {n} 组判断。",
  // META-CEO B heal round h7: accEarly1 ZH is accEarlyN with {n} replaced by 1
  "现在下结论还太早——目前已核对你的 1 组判断。",
  "目前已核对：你的 {n} 组判断。",
  // same ruling: 条 → 组 for the same noun; （{n}／30） tail removed
  "还没有足够的已结算判断组来核对你的把握是否准确。",
  "有 {n} 条判断无法核对——所引用的数据不存在。",
  "这只是学习记录。它不会改变我们展示什么、如何排序，也不会改变你能做什么。",
];

const BANNED = [
  "Brier",
  "hit-rate",
  "hit rate",
  "p-value",
  "pvalue",
  "explanation_memory",
  "trial_ledger",
  "Calibration Lab",
  "right-for-right-reason",
  "validated",
  "已验证",
];

const ACCURACY_KEY = /^acc[A-Z]/;

describe("B-F13-5 glance copy", () => {
  it("glance LEX values match the frozen EN copy block verbatim", () => {
    FROZEN_GLANCE_KEYS.forEach((key, i) => {
      expect(LEX[key]?.[0], key).toBe(FROZEN_EN[i]);
    });
  });

  it("glance LEX values match the frozen ZH copy block verbatim", () => {
    FROZEN_GLANCE_KEYS.forEach((key, i) => {
      expect(LEX[key]?.[1], key).toBe(FROZEN_ZH[i]);
    });
  });

  it("accClaimCountN is glance prose with singular English at n = 1", () => {
    expect(LEX.accClaimCountN[0]).toBe("{n} calls written down.");
    expect(LEX.accClaimCountN[1]).toBe("共写下 {n} 条判断。");
    expect(LEX.accClaimCount1[0]).toBe("1 call written down.");
    expect(LEX.accClaimCount1[1]).toBe("共写下 1 条判断。");
  });

  it("accUnscorable1 is the n = 1 twin of accUnscorableN, routed like accClaimCount1", () => {
    // Seat-ordered R5(a) variant of a frozen line (round 4 R3(a)).
    expect(LEX.accUnscorable1[0]).toBe("1 call could not be checked — the data they named wasn't there.");
    expect(LEX.accUnscorable1[1]).toBe("有 1 条判断无法核对——所引用的数据不存在。");
    expect(LEX.accUnscorableN[1]).toBe("有 {n} 条判断无法核对——所引用的数据不存在。");
  });

  it("unread glance copy is the seat-ordered neutral sentence", () => {
    expect(LEX.accUnread[0]).toBe("Reading your record.");
    expect(LEX.accUnread[1]).toBe("正在读取你的记录。");
  });

  it("every accuracy key carries both an EN and a ZH value", () => {
    const keys = Object.keys(LEX).filter((k) => ACCURACY_KEY.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(GLANCE_KEYS.length);
    for (const key of keys) {
      const pair = LEX[key];
      expect(pair, key).toBeTruthy();
      expect(pair[0].trim().length, `${key} EN`).toBeGreaterThan(0);
      expect(pair[1].trim().length, `${key} ZH`).toBeGreaterThan(0);
    }
  });

  it("glance tier contains no banned vocabulary", () => {
    for (const key of GLANCE_KEYS) {
      const [en, zh] = LEX[key];
      const hay = `${en}\n${zh}`;
      for (const token of BANNED) {
        expect(hay.toLowerCase(), `${key} contains ${token}`).not.toContain(token.toLowerCase());
      }
    }
  });

  it("the {n} placeholder appears in exactly the frozen sentences that carry it", () => {
    // META-CEO B round 7: accCalibWithheld no longer carries {n}; accCalibProgress does.
    const frozenWithN = FROZEN_GLANCE_KEYS.filter((key) => LEX[key][0].includes("{n}"));
    expect(frozenWithN).toEqual(["accEarlyN", "accCheckedN", "accUnscorableN"]);
    const withN = GLANCE_KEYS.filter((key) => LEX[key][0].includes("{n}"));
    expect(withN).toEqual([
      "accEarlyN",
      "accCheckedN",
      "accUnscorableN",
      "accClaimCountN",
      "accCalibProgress",
      "accUnscorableIncompleteN",
      "accUnscorableWithdrawnN",
      "accUnscorableNotBinaryN",
      "accUnscorableBadDateN",
      "accUnscorableBadKindN",
      "accUnscorableBadStatusN",
      "accUnscorableOtherN",
    ]);
    for (const key of withN) {
      expect(LEX[key][1]).toContain("{n}");
    }
    for (const key of GLANCE_KEYS.filter((k) => !withN.includes(k))) {
      expect(LEX[key][0]).not.toContain("{n}");
      expect(LEX[key][1]).not.toContain("{n}");
    }
  });

  it("no glance string contains a percent sign or a decimal number", () => {
    for (const key of GLANCE_KEYS) {
      const [en, zh] = LEX[key];
      expect(en, key).not.toContain("%");
      expect(zh, key).not.toContain("%");
      expect(en, key).not.toMatch(/\d+\.\d+/);
      expect(zh, key).not.toMatch(/\d+\.\d+/);
    }
  });

  it("GLANCE_KEYS is exactly the acc* keys the glance region can render", () => {
    const src = readFileSync(
      join(__dirname, "../../components/settings/SectionAccuracy.tsx"),
      "utf8",
    );
    const collect = (chunk: string): string[] =>
      [...chunk.matchAll(/"(acc[A-Za-z0-9]+)"/g)].map((m) => m[1]);
    const glanceJsx = src.slice(src.indexOf("<SectionHead"), src.indexOf("{open ? ("));
    const stance = src.match(/const STANCE_KEY[\s\S]*?};/)?.[0] ?? "";
    const phrases = src.match(/function unscorableGlancePhrases[\s\S]*?\n\}/)?.[0] ?? "";
    const claimCount = src.match(/function claimCountPhrase[\s\S]*?\n\}/)?.[0] ?? "";
    const derived = [...new Set([
      ...collect(glanceJsx),
      ...collect(stance),
      ...collect(phrases),
      ...collect(claimCount),
    ])].sort();
    expect(derived).toEqual([...GLANCE_KEYS].sort());
  });
});

describe("B-F13-5 authored extras stay sentences and stay out of the glance body", () => {
  it("accDetHitsOf is a sentence in both languages, not a slash fraction", () => {
    // Seat-ordered R2(c) variant of a frozen line (条 → 组).
    const [en, zh] = LEX.accDetHitsOf;
    expect(en).toBe("{hits} of {n} checked groups of calls landed.");
    expect(zh).toBe("已核对的 {n} 组判断中，有 {hits} 组判中。");
    expect(en.trim()).not.toMatch(/^\{hits\}\s+of\s+\{n\}$/);
    expect(zh.trim()).not.toMatch(/^\{hits\}\s*\/\s*\{n\}$/);
    expect(en).toMatch(/[.!?]$/);
    expect(zh).toMatch(/[。！？]$/);
    expect(LEX.accDetHitsOf1[0]).toBe("{hits} of 1 checked group of calls landed.");
    expect(LEX.accDetHitsOf1[1]).toBe("已核对的 1 组判断中，有 {hits} 组判中。");
  });

  it("accDetLoadErr is rendered at the glance; the detail may repeat it", () => {
    const src = readFileSync(
      join(__dirname, "../../components/settings/SectionAccuracy.tsx"),
      "utf8",
    );
    const loadAt = src.indexOf('t("accDetLoadErr")');
    const detailAt = src.indexOf('data-acc="detail"');
    const toggleAt = src.indexOf("accDetailOpen");
    expect(loadAt, "accDetLoadErr must be rendered").toBeGreaterThan(0);
    expect(detailAt, "detail pane must exist").toBeGreaterThan(0);
    expect(toggleAt, "detail toggle must exist").toBeGreaterThan(0);
    const glance = src.slice(src.indexOf("acs-body"), detailAt);
    expect(glance).toContain('t("accDetLoadErr")');
    expect(loadAt).toBeLessThan(detailAt);
  });

  it("the settings sidebar tab is the noun Accuracy / 准确度, not the glance sentence", () => {
    expect(LEX.accNav[0]).toBe("Accuracy");
    expect(LEX.accNav[1]).toBe("准确度");
    const panel = readFileSync(
      join(__dirname, "../../components/settings/SettingsPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/id: "accuracy"[\s\S]{0,80}key: "accNav"/);
    expect(panel).toMatch(/accuracy: "accNav"/);
    expect(panel).not.toMatch(/id: "accuracy"[\s\S]{0,80}key: "accTitle"/);
  });

  it("accDetBrierN is a sentence that names the pair count in both languages", () => {
    // Seat-ordered R2(c) variant of a frozen line (条 → 组).
    const [en, zh] = LEX.accDetBrierN;
    expect(en).toBe("Brier {value} over {n} resolved groups of calls.");
    expect(zh).toBe("按 {n} 组已核对判断计算，Brier 分数 {value}。");
    expect(zh.startsWith("Brier"), "ZH must open with Chinese, not a Latin token").toBe(false);
    expect(en).toMatch(/[.!?]$/);
    expect(zh).toMatch(/[。！？]$/);
    expect(LEX.accDetBrierN1[0]).toBe("Brier {value} over 1 resolved group of calls.");
    expect(LEX.accDetBrierN1[1]).toBe("按 1 组已核对判断计算，Brier 分数 {value}。");
  });

  it("accDetEpisodes labels the total episode count, open ones included", () => {
    // Seat-ordered R2(a) variant of a frozen line.
    expect(LEX.accDetEpisodes[0]).toBe("Groups of calls");
    expect(LEX.accDetEpisodes[1]).toBe("判断组");
  });

  it("accDetUnscorable labels the call tally, not the episode tally", () => {
    // Seat-ordered R2(b).
    expect(LEX.accDetUnscorable[0]).toBe("Calls that could not be checked");
    expect(LEX.accDetUnscorable[1]).toBe("无法核对的判断");
  });

  it("accDetHitRate labels hits among checked groups of calls, matching the value unit", () => {
    // Seat ruling R1 round 5: the value (accDetHitsOf) is groups of calls; the
    // label must use the same unit word, not bare "calls" / "判断".
    expect(LEX.accDetHitRate[0]).toBe("Hits among checked groups of calls");
    expect(LEX.accDetHitRate[1]).toBe("已核对判断组中的命中");
  });

  it("accSignInToSee names this feature, not Sync", () => {
    expect(LEX.accSignInToSee[0]).toBe("Sign in to see how your calls have turned out.");
    expect(LEX.accSignInToSee[1]).toBe("登录后即可查看你的判断结果。");
  });

  it("accCalibProgress is a separate sentence from the withheld line", () => {
    expect(LEX.accCalibProgress[0]).toBe("Settled so far: {n} of the 30 groups needed.");
    expect(LEX.accCalibProgress[1]).toBe("目前已结清 {n} 组，需要 30 组。");
    expect(LEX.accCalibWithheld[0]).not.toContain("{n}");
    expect(LEX.accCalibWithheld[0]).not.toContain("of 30");
  });

  it("each M3 cause line has an n = 1 English twin, like accUnscorable1", () => {
    expect(LEX.accUnscorableIncomplete1[0]).toBe("1 call could not be checked because it did not say what to check.");
    expect(LEX.accUnscorableIncomplete1[1]).toBe("1 条判断无法核对，因为没有写明要核对什么。");
    expect(LEX.accUnscorableWithdrawn1[0]).toBe("1 call you withdrew.");
    expect(LEX.accUnscorableWithdrawn1[1]).toBe("你撤回了 1 条判断。");
    expect(LEX.accUnscorableNotBinary1[0]).toBe("1 call could not be checked — the result was not a clear yes or no.");
    expect(LEX.accUnscorableNotBinary1[1]).toBe("1 条判断无法核对——结果不是明确的是或否。");
    expect(LEX.accUnscorableBadDate1[0]).toBe("1 call could not be checked because its date could not be read.");
    expect(LEX.accUnscorableBadDate1[1]).toBe("1 条判断无法核对，因为日期无法读取。");
    expect(LEX.accUnscorableOther1[0]).toBe("1 call could not be checked; the reason was not recorded.");
    expect(LEX.accUnscorableOther1[1]).toBe("1 条判断无法核对，原因未记录。");
    expect(LEX.accUnscorableBadKind1[0]).toBe("1 call could not be checked because the subject it names is not one we score.");
    expect(LEX.accUnscorableBadKind1[1]).toBe("1 条判断无法核对，因为所写的标的类型不在可计分范围内。");
    expect(LEX.accUnscorableBadStatus1[0]).toBe("1 call could not be checked because its recorded state is not one we score.");
    expect(LEX.accUnscorableBadStatus1[1]).toBe("1 条判断无法核对，因为所写的状态不在可计分范围内。");
    expect(LEX.accUnscorableIncompleteN[0]).toBe("{n} calls could not be checked because they did not say what to check.");
    expect(LEX.accUnscorableBadKindN[0]).toBe("{n} calls could not be checked because the subject they name is not one we score.");
    expect(LEX.accUnscorableBadStatusN[0]).toBe("{n} calls could not be checked because the recorded state is not one we score.");
  });
});

describe("B-F13-7 last-close resolver notes", () => {
  it("UNAVAILABLE_NOTE is the honest-null sentence, matching the store constant", () => {
    expect(UNAVAILABLE_NOTE).toBe("the data this call named was not available");
    expect(UNAVAILABLE_NOTE).toBe(UNDETERMINED_NOTE);
  });

  it("settledNote names the close date in a plain sentence", () => {
    expect(settledNote("2026-09-04")).toBe("close on 2026-09-04");
  });

  it("UNREADABLE_NOTE is the frozen unreadable-threshold sentence", () => {
    expect(UNREADABLE_NOTE).toBe("what this call had to beat was not available");
  });

  it("resolver notes contain no banned vocabulary", () => {
    for (const note of [UNAVAILABLE_NOTE, UNREADABLE_NOTE, settledNote("2026-09-04")]) {
      for (const token of BANNED) {
        expect(note.toLowerCase(), `${note} contains ${token}`).not.toContain(token.toLowerCase());
      }
    }
  });
});
