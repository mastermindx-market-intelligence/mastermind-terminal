import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ISSUE_LIFECYCLE } from "@/components/prophet/optionsIssueDeskTypes";
import {
  APPROVE_REASONS,
  EVENT_STATE_LABELS,
  FORM_FIELD_LABELS,
  LIFECYCLE_LABELS,
  REJECT_REASONS,
  REQUIRED_FORM_FIELDS,
  approveReasonLabel,
  confirmActionLabel,
  eventStateLabel,
  lifecycleLabel,
  quoteSourceLabel,
  reasonLabel,
  rejectReasonLabel,
  visibleReceiptFields,
} from "@/components/prophet/optionsIssueDeskLabels";

const UNKNOWN = "NOT_A_REAL_CODE";

function assertPlainPair(en: string, zh: string, raw: string) {
  expect(en.length).toBeGreaterThan(0);
  expect(zh.length).toBeGreaterThan(0);
  expect(en).not.toBe(raw);
  expect(zh).not.toBe(raw);
  expect(en).not.toContain("_");
  expect(zh).not.toContain("_");
  expect(en).not.toContain(raw);
  expect(zh).not.toContain(raw);
  expect(en.toLowerCase()).not.toContain("falsifier");
  expect(en.toLowerCase()).not.toContain("refuted");
  expect(zh).not.toContain("证伪");
}

describe("options issue desk labels", () => {
  it("gives every ISSUE_LIFECYCLE member a non-empty EN and ZH label", () => {
    for (const state of ISSUE_LIFECYCLE) {
      assertPlainPair(lifecycleLabel(state, false), lifecycleLabel(state, true), state);
      assertPlainPair(eventStateLabel(state, false), eventStateLabel(state, true), state);
    }
  });

  it("gives every APPROVE_REASONS member a non-empty EN and ZH label", () => {
    expect(APPROVE_REASONS).toEqual(["PORTFOLIO_FIT", "REGIME_ALIGNED", "EXECUTION_VERIFIED", "DIVERSIFICATION_FIT"]);
    for (const reason of APPROVE_REASONS) {
      assertPlainPair(approveReasonLabel(reason, false), approveReasonLabel(reason, true), reason);
      assertPlainPair(reasonLabel(reason, false), reasonLabel(reason, true), reason);
    }
  });

  it("gives every REJECT_REASONS member a non-empty EN and ZH label", () => {
    expect(REJECT_REASONS).toEqual(["ABSTAIN", "REGIME_MISMATCH", "CORRELATION_CAP", "COOLDOWN", "EVENT_RISK", "EXECUTION_MISSING", "LIQUIDITY", "NO_EDGE"]);
    for (const reason of REJECT_REASONS) {
      assertPlainPair(rejectReasonLabel(reason, false), rejectReasonLabel(reason, true), reason);
      assertPlainPair(reasonLabel(reason, false), reasonLabel(reason, true), reason);
    }
  });

  it("uses the prescribed plain-language wording for the named codes", () => {
    expect(lifecycleLabel("PARTIAL_ALLOWED", false)).toBe("Partial position allowed");
    expect(lifecycleLabel("PARTIAL_ALLOWED", true)).toBe("允许部分建仓");
    expect(reasonLabel("REGIME_MISMATCH", false)).toBe("Market conditions do not fit");
    expect(reasonLabel("REGIME_MISMATCH", true)).toBe("市场环境不匹配");
    expect(reasonLabel("NO_EDGE", false)).toBe("No clear advantage");
    expect(reasonLabel("NO_EDGE", true)).toBe("没有明显优势");
  });

  it("yields the neutral label for an unknown code and never echoes the raw code or an underscore", () => {
    const lookups = [lifecycleLabel, eventStateLabel, reasonLabel, approveReasonLabel, rejectReasonLabel];
    for (const lookup of lookups) {
      const en = lookup(UNKNOWN, false);
      const zh = lookup(UNKNOWN, true);
      expect(en).toBe("Not classified");
      expect(zh).toBe("未分类");
      expect(en).not.toContain("_");
      expect(zh).not.toContain("_");
      expect(en).not.toContain(UNKNOWN);
      expect(zh).not.toContain(UNKNOWN);
    }
  });

  it("names the confirm action in plain words and never mentions the proposal id", () => {
    expect(confirmActionLabel("approve", "LMT", false)).toBe("Issue a research plan for LMT");
    expect(confirmActionLabel("approve", "LMT", true)).toBe("为 LMT 发布研究计划");
    expect(confirmActionLabel("reject", "LMT", false)).toBe("Reject the LMT proposal");
    expect(confirmActionLabel("reject", "LMT", true)).toBe("拒绝 LMT 提案");
    expect(confirmActionLabel("approve", "LMT", false)).not.toContain("oidp_");
    expect(confirmActionLabel("reject", "LMT", false)).not.toMatch(/proposal_id/i);
  });

  it("surfaces labelled receipt fields when present and omits absent ones", () => {
    const fields = visibleReceiptFields({
      option: {
        occ_symbol: "LMT260918C00600000",
        quote_source: "operator_attested_nbbo",
        quote_at: "2026-08-08T21:16:00Z",
      },
    }, false);
    expect(fields.map((field) => field.key)).toEqual(["contract", "quote_source", "timestamp"]);
    expect(fields.find((field) => field.key === "contract")?.value).toBe("LMT260918C00600000");
    expect(fields.find((field) => field.key === "quote_source")?.label).toBe("Quote source");
    expect(fields.find((field) => field.key === "quote_source")?.value).not.toContain("_");
    expect(fields.find((field) => field.key === "quote_source")?.value).not.toBe("operator_attested_nbbo");
    expect(fields.find((field) => field.key === "timestamp")?.value).toBe("2026-08-08T21:16:00Z");
    expect(fields.map((field) => field.key as string)).not.toContain("venue");
    expect(JSON.stringify(fields)).not.toContain("undefined");
    expect(JSON.stringify(fields)).not.toContain("null");

    const zh = visibleReceiptFields({
      option: { occ_symbol: "LMT260918C00600000", quote_source: "operator_attested_nbbo", quote_at: "2026-08-08T21:16:00Z" },
    }, true);
    expect(fields.find((field) => field.key === "contract")?.label).toBe("Contract (OCC symbol)");
    expect(fields.find((field) => field.key === "timestamp")?.label).toBe("Quote time (New York)");
    expect(zh.find((field) => field.key === "contract")?.label).toBe("合约（OCC 代码）");
    expect(zh.find((field) => field.key === "quote_source")?.label).toBe("报价来源");
    expect(zh.find((field) => field.key === "timestamp")?.label).toBe("报价时间（纽约）");

    expect(visibleReceiptFields({ option: { occ_symbol: "LMT260918C00600000" } }, false).map((field) => field.key)).toEqual(["contract"]);
    expect(visibleReceiptFields({}, false)).toEqual([]);
    expect(visibleReceiptFields(null, false)).toEqual([]);
    expect(visibleReceiptFields({ option: { occ_symbol: null, quote_source: undefined, venue: null } }, false)).toEqual([]);
  });

  it("labels every required approval-editor field in EN and ZH without machine keys", () => {
    expect(REQUIRED_FORM_FIELDS.length).toBeGreaterThan(0);
    for (const key of REQUIRED_FORM_FIELDS) {
      const pair = FORM_FIELD_LABELS[key];
      expect(pair?.[0]?.length, `${key} EN`).toBeGreaterThan(0);
      expect(pair?.[1]?.length, `${key} ZH`).toBeGreaterThan(0);
      expect(pair[0]).not.toContain("_");
      expect(pair[1]).not.toContain("_");
    }
    expect(FORM_FIELD_LABELS.occ_symbol[0]).toContain("official options clearing record");
    expect(FORM_FIELD_LABELS.occ_symbol[1]).toContain("期权清算公司");
    expect(FORM_FIELD_LABELS.nbbo_bid[0]).toContain("best available quote");
    expect(FORM_FIELD_LABELS.nbbo_bid[1]).toContain("最优买卖报价");
    expect(FORM_FIELD_LABELS.quote_at[0]).toBe("Quote time (UTC)");
    expect(FORM_FIELD_LABELS.quote_at[1]).toBe("报价时间 (UTC)");
  });

  it("keeps JSON.stringify and proposal_id interpolations inside technical-details disclosures", () => {
    const source = readFileSync(join(__dirname, "../../components/prophet/OptionsIssueDeskView.tsx"), "utf8");
    expect(source).toContain("lifecycleLabel(");
    expect(source).toContain("eventStateLabel(");
    expect(source).toContain("reasonLabel(");
    expect(source).toContain("visibleReceiptFields(");
    expect(source).toContain("confirmActionLabel(");
    expect(source).toContain("FORM_FIELD_LABELS[");
    expect(source).not.toContain(".replaceAll(\"_\"");
    expect(source).not.toContain("reason_codes.join(");
    for (const join of source.matchAll(/\.join\(" · "\)/g)) {
      const window = source.slice(Math.max(0, join.index - 120), join.index);
      expect(window.includes("reasonLabel("), `.join(" · ") at ${join.index} is on raw codes`).toBe(true);
    }

    const detailLabelCount = source.split("Show technical details").length - 1;
    expect(source).toContain("Show technical details");
    expect(source).toContain("显示技术细节");
    expect(detailLabelCount).toBeGreaterThanOrEqual(3);
    expect(detailLabelCount).toBe(3);

    const insideDetails = (index: number) => {
      const before = source.slice(0, index);
      return before.lastIndexOf("<details") > before.lastIndexOf("</details>");
    };
    const isKeyAttr = (index: number) => {
      const sixBefore = (at: number) => source.slice(Math.max(0, at - 6), at).trim() === "key={";
      if (sixBefore(index)) return true;
      let cursor = index;
      while (cursor > 0 && /[\w.]/.test(source[cursor - 1]!)) cursor -= 1;
      return sixBefore(cursor);
    };

    const stringifyMatches = [...source.matchAll(/\{\s*JSON\.stringify\(/g)];
    expect(stringifyMatches.length).toBeGreaterThan(0);
    for (const match of stringifyMatches) {
      expect(insideDetails(match.index), `{JSON.stringify at ${match.index} is outside <details>`).toBe(true);
    }

    for (const match of source.matchAll(/proposal_id\s*[}.]/g)) {
      if (isKeyAttr(match.index)) continue;
      expect(insideDetails(match.index), `proposal_id at ${match.index} is outside <details>`).toBe(true);
    }
  });

  it("maps known quote sources, omits empty ones, and humanises attested free text", () => {
    expect(quoteSourceLabel("operator_attested_nbbo", false)).toBe("Operator-attested best available quote");
    expect(quoteSourceLabel("operator_attested_nbbo", true)).toBe("操作员确认的最优买卖报价");
    expect(quoteSourceLabel("", false)).toBe("");
    expect(quoteSourceLabel("   ", true)).toBe("");
    expect(quoteSourceLabel("cboe_live-tape", false)).toBe("Cboe live tape");
    expect(quoteSourceLabel("cboe_live-tape", true)).toBe("Cboe live tape");
    expect(quoteSourceLabel("cboe_live-tape", false)).not.toBe("Not classified");
    expect(quoteSourceLabel("cboe_live-tape", true)).not.toBe("未分类");
    expect(quoteSourceLabel("cboe_live-tape", false)).not.toContain("_");

    expect(visibleReceiptFields({ option: { occ_symbol: "LMT260918C00600000", quote_source: "" } }, false).map((field) => field.key)).toEqual(["contract"]);
    expect(visibleReceiptFields({ option: { occ_symbol: "LMT260918C00600000", quote_source: "   " } }, false).map((field) => field.key)).toEqual(["contract"]);
    expect(visibleReceiptFields({ option: { occ_symbol: "LMT260918C00600000", quote_source: "pit_print-manual" } }, false).find((field) => field.key === "quote_source")?.value).toBe("Pit print manual");
  });

  it("shares one lifecycle/event-state map and finishes the diversification gloss", () => {
    expect(EVENT_STATE_LABELS).toBe(LIFECYCLE_LABELS);
    expect(reasonLabel("DIVERSIFICATION_FIT", true)).toBe("有助于分散风险");
  });
});
