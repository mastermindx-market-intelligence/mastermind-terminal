import { describe, expect, it } from "vitest";
import { parseGuideDocument } from "@/lib/guides/document";
import {
  GUIDE_VISUAL_IDS,
  GUIDE_VISUALS,
  getGuideVisualMetadata,
} from "@/lib/guides/experience";
import { hasGuide, loadGuide } from "@/lib/guides/registry";
import { MODULE_CATALOG } from "@/lib/suites/catalog";

const catalogGuideIds = MODULE_CATALOG.map(
  ({ suiteKey, moduleKey }) => `${suiteKey}/${moduleKey}`,
);

describe("indicator guide experience", () => {
  it("covers every catalog module with one guide and one original visual", () => {
    expect(MODULE_CATALOG).toHaveLength(31);
    expect(new Set(catalogGuideIds).size).toBe(31);
    expect(GUIDE_VISUAL_IDS).toEqual(catalogGuideIds);
    expect(Object.keys(GUIDE_VISUALS)).toEqual(catalogGuideIds);

    for (const entry of MODULE_CATALOG) {
      const id = `${entry.suiteKey}/${entry.moduleKey}`;
      const metadata = getGuideVisualMetadata(entry.suiteKey, entry.moduleKey);

      expect(hasGuide(entry.suiteKey, entry.moduleKey), id).toBe(true);
      expect(metadata?.id, id).toBe(id);
      expect(metadata?.suiteKey, id).toBe(entry.suiteKey);
      expect(metadata?.moduleKey, id).toBe(entry.moduleKey);
      expect(metadata?.title.en.trim().length, id).toBeGreaterThan(0);
      expect(metadata?.title.zh.trim().length, id).toBeGreaterThan(0);
      expect(metadata?.caption.en.trim().length, id).toBeGreaterThan(20);
      expect(metadata?.caption.zh.trim().length, id).toBeGreaterThan(8);
      expect(metadata?.legend.length, id).toBeGreaterThan(0);

      for (const item of metadata?.legend ?? []) {
        expect(item.label.en.trim().length, `${id} English legend`).toBeGreaterThan(0);
        expect(item.label.zh.trim().length, `${id} Chinese legend`).toBeGreaterThan(0);
        expect(["bull", "bear", "accent", "warn", "muted", "volume"], id).toContain(item.tone);
      }
    }

    expect(
      GUIDE_VISUAL_IDS.filter((id) => GUIDE_VISUALS[id].experience !== "static"),
    ).toEqual(["structure/ob", "structure/mfp", "trend/te"]);
    expect(GUIDE_VISUALS["structure/ob"].experience).toBe("order-block-lifecycle");
    expect(GUIDE_VISUALS["structure/mfp"].experience).toBe("money-flow-profile");
    expect(GUIDE_VISUALS["trend/te"].experience).toBe("trend-engine-trade-path");

    expect(hasGuide("trend", "missing")).toBe(false);
    expect(getGuideVisualMetadata("trend", "missing")).toBeNull();
  });

  it("loads complete English and Chinese documents with stable section ids", async () => {
    // Issue every catalog load at once (31 modules × en/zh). A sequential await per
    // module can exceed the default 5s test timeout when the worker is busy.
    const loaded = await Promise.all(
      MODULE_CATALOG.map((entry) =>
        Promise.all([
          loadGuide(entry.suiteKey, entry.moduleKey, "en"),
          loadGuide(entry.suiteKey, entry.moduleKey, "zh"),
        ]),
      ),
    );

    for (const [index, entry] of MODULE_CATALOG.entries()) {
      const id = `${entry.suiteKey}/${entry.moduleKey}`;
      const [english, chinese] = loaded[index];

      expect(english, `${id} English guide`).not.toBeNull();
      expect(chinese, `${id} Chinese guide`).not.toBeNull();
      expect(english?.fellBack, `${id} English fallback`).toBe(false);
      expect(chinese?.fellBack, `${id} Chinese fallback`).toBe(false);

      const enDocument = parseGuideDocument(english?.text ?? "");
      const zhDocument = parseGuideDocument(chinese?.text ?? "");
      const enIds = enDocument.sections.map((section) => section.id);
      const zhIds = zhDocument.sections.map((section) => section.id);

      expect(enDocument.title.trim().length, `${id} English title`).toBeGreaterThan(0);
      expect(zhDocument.title.trim().length, `${id} Chinese title`).toBeGreaterThan(0);
      expect(enDocument.intro.trim().length, `${id} English intro`).toBeGreaterThan(20);
      expect(zhDocument.intro.trim().length, `${id} Chinese intro`).toBeGreaterThan(8);
      expect(enIds.slice(0, 4), `${id} English core sections`).toEqual([
        "anatomy",
        "playbook",
        "settings",
        "alerts",
      ]);
      expect(zhIds, `${id} localized section ids`).toEqual(enIds);
      expect(new Set(enIds).size, `${id} unique section ids`).toBe(enIds.length);

      for (const section of [...enDocument.sections, ...zhDocument.sections]) {
        expect(section.title.trim().length, `${id}/${section.id} title`).toBeGreaterThan(0);
        expect(section.markdown.trim().length, `${id}/${section.id} body`).toBeGreaterThan(0);
        expect(section.html.trim().length, `${id}/${section.id} html`).toBeGreaterThan(0);
      }
    }

    await expect(loadGuide("trend", "missing", "en")).resolves.toBeNull();
  }, 30_000);

  it("keeps ids language-neutral, unique, and deterministic for repeated headings", () => {
    const english = parseGuideDocument(`# Example

An English introduction.

## What you see
Anatomy.

## How to trade it
Playbook.

## Settings
Inputs.

## Signals & alerts
Events.

## Settings
More inputs.

## Research note
First detail.

## Another note
Second detail.`);
    const chinese = parseGuideDocument(`# 示例

中文简介。

## 图上都有什么
结构。

## 如何交易
方法。

## 设置
参数。

## 信号与提醒
事件。

## 参数
更多参数。

## 研究说明
第一项。

## 另一说明
第二项。`);

    const expected = [
      "anatomy",
      "playbook",
      "settings",
      "alerts",
      "settings-2",
      "detail-6",
      "detail-7",
    ];
    expect(english.sections.map(({ id }) => id)).toEqual(expected);
    expect(chinese.sections.map(({ id }) => id)).toEqual(expected);
    expect(parseGuideDocument(english.sections.map((section) => `## ${section.title}\n${section.markdown}`).join("\n\n"))
      .sections.map(({ id }) => id)).toEqual(expected);
  });
});
