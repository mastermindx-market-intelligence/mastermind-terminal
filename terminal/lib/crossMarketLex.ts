"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";
import type { TaxonomyId } from "./classificationScan";

/** Feature-local EN/ZH copy for cross-market screening (E03). Language state stays the shared
 *  LangProvider; keys fall back to the shared table, so a screen can mix both. */
export const CROSS_MARKET_LEX: Record<string, [string, string]> = {
  // money — price × volume is in the listing's own currency, so the column is not "$ Vol"
  cmTraded: ["Traded value", "成交额"],
  cmMinTraded: ["Min traded value", "最低成交额"],
  cmCcy: ["Currency scope", "币种范围"],
  cmCcyAuto: ["Currency · auto ({c})", "币种 · 自动（{c}）"],
  cmCcyNone: ["Currency · unavailable", "币种 · 不可用"],
  cmLiqOff: ["Listing currencies are unavailable, so a traded-value floor cannot be applied", "上市币种不可用，无法应用成交额下限"],
  cmCcyOpt: ["{c} · {n} listings", "{c} · {n} 个上市"],
  cmTradedTitle: ["Price × volume in the listing's own currency — never converted", "价格 × 成交量，以上市币种计 — 从不换算"],
  cmIndustry: ["Industry", "行业"],
  cmMoneyLine: ["Traded value in {c} · not converted", "成交额以 {c} 计 · 未换算"],
  cmMoneyOther: ["{n} in other currencies not compared", "{n} 个其他币种未比较"],
  cmMoneyUnknown: ["{n} with unknown currency not compared", "{n} 个币种未知未比较"],
  cmMoneyNotMoney: ["{n} indices / rates / FX / futures have no traded value", "{n} 个指数 / 利率 / 外汇 / 期货无成交额"],
  cmCcyUnknownTitle: ["Listing currency unknown — not comparable", "上市币种未知 — 无法比较"],
  cmNotMoneyTitle: ["Price × volume is not traded value for this instrument", "该品种的价格 × 成交量不代表成交额"],
  cmMcapUsd: ["Market cap (USD, US reference data)", "市值（美元，美股参考数据）"],

  // classification
  cmTaxonomy: ["Classification", "分类体系"],
  cmTaxonomyAny: ["Classification · auto", "分类体系 · 自动"],
  cmLabel: ["Classification label", "分类标签"],
  cmLabelAll: ["All labels", "全部标签"],
  cmLabelPick: ["Pick a classification first", "请先选择分类体系"],
  cmUnclassified: ["Unclassified", "未分类"],
  cmStale: ["stale", "过期"],
  cmVersionNone: ["version not stated", "未注明版本"],
  cmNoCrosswalk: ["native labels · no crosswalk", "原生标签 · 无跨体系映射"],
  cmCovCurrent: ["{n} current", "{n} 个当前"],
  cmCovStale: ["{n} stale", "{n} 个过期"],
  cmCovUnclassified: ["{n} unclassified", "{n} 个未分类"],
  cmInclStale: ["Include stale", "包含过期标签"],
  cmStaleExcluded: ["{n} match only by a stale label", "{n} 个仅以过期标签匹配"],
  cmUnclassifiedExcluded: ["{n} have no label here", "{n} 个在此体系下无标签"],
  cmShowUnclassified: ["Show unclassified", "查看未分类"],
  cmAsOf: ["as of {d}", "截至 {d}"],
  cmUndated: ["undated snapshot", "无日期快照"],
  cmAged: ["owner record older than {n} days", "来源记录超过 {n} 天"],
  cmGenAged: ["generation older than {n} days", "生成批次超过 {n} 天"],
  cmSourceLabel: ["Source label “{v}” — its taxonomy is not stated", "来源标签“{v}” — 未注明分类体系"],
  cmNotCovered: ["Not classified for this asset class", "该资产类别不适用分类"],
  cmClassUnavailable: ["Classification unavailable", "分类不可用"],

  // scan state
  cmScanAbsent: ["Listing classifications and currencies are not published yet — sectors show only the undated US snapshot, marked stale, and traded value cannot be compared or floored.", "上市分类与币种数据尚未发布 — 板块仅显示无日期的美股快照（标记为过期），成交额无法比较或设下限。"],
  cmScanError: ["Listing classifications and currencies could not be read — sectors show only the undated US snapshot, marked stale, and traded value cannot be compared or floored.", "无法读取上市分类与币种数据 — 板块仅显示无日期的美股快照（标记为过期），成交额无法比较或设下限。"],
  cmScanRefreshFailed: ["Showing the last classification read — the refresh failed.", "显示上次读取的分类 — 刷新失败。"],
  cmScanGenStale: ["Classifications generated {d} — older than {n} days, so every label is marked stale.", "分类生成于 {d} — 超过 {n} 天，所有标签均标记为过期。"],

  // market change
  cmCleared: ["Cleared for {m}:", "切换至 {m} 时已清除："],
  cmClrCcy: ["currency {v} (no listings here)", "币种 {v}（此市场无上市）"],
  cmClrLiq: ["traded-value floor (no listing currencies here)", "成交额下限（此市场无上市币种）"],
  cmClrMcap: ["market-cap floor (no market caps here)", "市值下限（此市场无市值数据）"],
  cmClrTax: ["{v} (no labels here)", "{v}（此市场无标签）"],
  cmClrLabel: ["{v} (not present here)", "{v}（此市场不存在）"],
  cmDismiss: ["Dismiss", "关闭"],
  cmEmptyExcluded: ["{n} listings were left out only because their label is stale or missing, or their traded value is in another or unknown currency — see the notes above.", "{n} 个上市仅因标签过期或缺失，或成交额币种不同或未知而未列出 — 见上方说明。"],
};

/** Short, translated names for the native taxonomies (the document's own name and authority
 *  are shown verbatim beside them in the classification line). */
export const TAXONOMY_LEX: Record<TaxonomyId, { name: [string, string]; chip: [string, string] }> = {
  gics_sector: { name: ["GICS sector", "GICS 板块"], chip: ["GICS", "GICS"] },
  yahoo_sector: { name: ["Yahoo Finance sector", "雅虎财经板块"], chip: ["YF", "YF"] },
  yahoo_industry: { name: ["Yahoo Finance industry", "雅虎财经行业"], chip: ["YF ind.", "YF 行业"] },
  cn_profile_sector: { name: ["CN profile sector", "A股资料板块"], chip: ["CN", "CN"] },
};

/** Display translations for the closed Yahoo sector vocabulary. The stored label is always the
 *  source's own English string; industries and CN profile labels are shown verbatim. */
export const YAHOO_SECTOR_ZH: Record<string, string> = {
  "Basic Materials": "基础材料",
  "Communication Services": "通信服务",
  "Consumer Cyclical": "周期性消费",
  "Consumer Defensive": "防御性消费",
  "Energy": "能源",
  "Financial Services": "金融服务",
  "Healthcare": "医疗保健",
  "Industrials": "工业",
  "Real Estate": "房地产",
  "Technology": "科技",
  "Utilities": "公用事业",
};

export function useCrossMarketT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, fallback?: string): string => {
    const pair = CROSS_MARKET_LEX[key];
    return pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key, fallback);
  }, [lang, sharedT]);
}
