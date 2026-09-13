import { describe, expect, it } from "vitest";
import { EVENT_WORKSPACE_ABSENCE_REASONS } from "@/lib/eventWorkspace";
import {
  EVENT_WORKSPACE_ATTRIBUTION,
  MANAGER_STYLE_KEYS,
  MANAGER_STYLE_LABELS,
  NOT_CLASSIFIED,
  TECHNICAL_DETAILS_SUMMARY,
  TOPIC_TAG_KEYS,
  TOPIC_TAG_LABELS,
  TYPED_ABSENCE_REASON_LABELS,
  managerStyleLabel,
  topicTagLabel,
  typedAbsenceReasonLabel,
} from "@/lib/companyIntelligenceLabels";

function assertPlainLabel(label: string, slug: string) {
  expect(label.trim().length).toBeGreaterThan(0);
  expect(label).not.toContain("_");
  expect(label).not.toBe(slug);
}

describe("company intelligence labels", () => {
  it("gives every manager style a non-empty EN and ZH label that is not the slug", () => {
    expect(MANAGER_STYLE_KEYS.length).toBeGreaterThan(0);
    for (const key of MANAGER_STYLE_KEYS) {
      const pair = MANAGER_STYLE_LABELS[key];
      expect(pair.en.trim().length).toBeGreaterThan(0);
      expect(pair.zh.trim().length).toBeGreaterThan(0);
      assertPlainLabel(managerStyleLabel(key, false), key);
      assertPlainLabel(managerStyleLabel(key, true), key);
    }
  });

  it("covers every EventWorkspace typed-absence reason with a plain sentence in EN and ZH", () => {
    const mapped = Object.keys(TYPED_ABSENCE_REASON_LABELS).sort();
    expect(mapped).toEqual([...EVENT_WORKSPACE_ABSENCE_REASONS].sort());
    for (const reason of EVENT_WORKSPACE_ABSENCE_REASONS) {
      const pair = TYPED_ABSENCE_REASON_LABELS[reason as keyof typeof TYPED_ABSENCE_REASON_LABELS];
      expect(pair.en.trim().length).toBeGreaterThan(0);
      expect(pair.zh.trim().length).toBeGreaterThan(0);
      assertPlainLabel(typedAbsenceReasonLabel(reason, false), reason);
      assertPlainLabel(typedAbsenceReasonLabel(reason, true), reason);
    }
  });

  it("gives every known topic tag a non-empty EN and ZH label that is not the slug", () => {
    expect(TOPIC_TAG_KEYS.length).toBeGreaterThan(0);
    for (const key of TOPIC_TAG_KEYS) {
      const pair = TOPIC_TAG_LABELS[key];
      expect(pair.en.trim().length).toBeGreaterThan(0);
      expect(pair.zh.trim().length).toBeGreaterThan(0);
      assertPlainLabel(topicTagLabel(key, false), key);
      assertPlainLabel(topicTagLabel(key, true), key);
    }
  });

  it("humanises unknown slug-shaped topic tags and manager styles in both languages", () => {
    const tag = "ai_capex";
    const style = "multi_strat";
    const humanTag = "Ai capex";
    const humanStyle = "Multi strat";

    expect(topicTagLabel(tag, false)).toBe(humanTag);
    expect(topicTagLabel(tag, true)).toBe(humanTag);
    expect(topicTagLabel(tag, false)).not.toContain("_");
    expect(topicTagLabel(tag, false)).not.toBe(tag);
    expect(topicTagLabel(tag, false).charAt(0)).toBe("A");

    expect(managerStyleLabel(style, false)).toBe(humanStyle);
    expect(managerStyleLabel(style, true)).toBe(humanStyle);
    expect(managerStyleLabel(style, false)).not.toContain("_");
    expect(managerStyleLabel(style, false)).not.toBe(style);
    expect(managerStyleLabel(style, false).charAt(0)).toBe("M");
  });

  it("lower-cases an ALL-CAPS slug before capitalising the first letter", () => {
    expect(managerStyleLabel("MULTI_STRAT", false)).toBe("Multi strat");
    expect(managerStyleLabel("MULTI_STRAT", true)).toBe("Multi strat");
    expect(topicTagLabel("AI_CAPEX", false)).toBe("Ai capex");
    expect(topicTagLabel("AI_CAPEX", true)).toBe("Ai capex");
  });

  it("uses plain finance wording for the mandated EN/ZH labels", () => {
    expect(typedAbsenceReasonLabel("document_bytes_not_held", false)).toBe("The document file is not stored.");
    expect(typedAbsenceReasonLabel("document_bytes_not_held", true)).toBe("未保存该文档文件。");
    expect(typedAbsenceReasonLabel("no_primary_release", false)).toBe("No official company release.");
    expect(typedAbsenceReasonLabel("no_primary_release", true)).toBe("没有公司正式公告。");
    expect(managerStyleLabel("quality_growth", false)).toBe("Quality growth");
    expect(managerStyleLabel("quality_growth", true)).toBe("优质成长");
    expect(typedAbsenceReasonLabel("speaker_unresolvable", true)).toBe("无法确定发言人。");
    expect(typedAbsenceReasonLabel("missing_period", true)).toBe("缺少报告期间。");
    expect(managerStyleLabel("activist", true)).toBe("维权股东");
    expect(managerStyleLabel("long_only", true)).toBe("纯多头");
  });

  it("returns the neutral label for an empty topic tag", () => {
    expect(topicTagLabel("", false)).toBe(NOT_CLASSIFIED.en);
    expect(topicTagLabel("   ", true)).toBe(NOT_CLASSIFIED.zh);
    expect(managerStyleLabel("", false)).toBe(NOT_CLASSIFIED.en);
    expect(managerStyleLabel(" \t ", true)).toBe(NOT_CLASSIFIED.zh);
  });

  it("returns the neutral label for an unknown typed-absence reason", () => {
    const unknown = "not_a_real_slug";
    expect(typedAbsenceReasonLabel(unknown, false)).toBe(NOT_CLASSIFIED.en);
    expect(typedAbsenceReasonLabel(unknown, true)).toBe(NOT_CLASSIFIED.zh);
    expect(typedAbsenceReasonLabel(unknown, false)).not.toContain("_");
    expect(typedAbsenceReasonLabel(unknown, false)).not.toBe(unknown);
  });

  it("keeps attribution and technical-detail copy free of module identifiers", () => {
    expect(EVENT_WORKSPACE_ATTRIBUTION.en).toBe("From the company event workspace");
    expect(EVENT_WORKSPACE_ATTRIBUTION.zh).toBe("来自公司事件工作区");
    expect(EVENT_WORKSPACE_ATTRIBUTION.en).not.toContain("event_workspace");
    expect(EVENT_WORKSPACE_ATTRIBUTION.zh).not.toContain("event_workspace");
    expect(TECHNICAL_DETAILS_SUMMARY.en).toBe("Show technical details");
    expect(TECHNICAL_DETAILS_SUMMARY.zh).toBe("显示技术细节");
    assertPlainLabel(EVENT_WORKSPACE_ATTRIBUTION.en, "event_workspace.v1");
    assertPlainLabel(EVENT_WORKSPACE_ATTRIBUTION.zh, "event_workspace.v1");
  });
});
